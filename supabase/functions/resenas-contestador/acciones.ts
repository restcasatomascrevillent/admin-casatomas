// ============================================================================
//  resenas-contestador / acciones.ts — lo que hace cada acción (sin Deno)
// ----------------------------------------------------------------------------
//  La base de datos va detrás de `Repo` y la IA, Google y la sincronización de
//  Places se inyectan: los tests corren sin red ni Supabase.
//
//  Regla del dueño: NADA se publica en Google sin aprobación. Solo `aprobar`
//  (el dueño pulsa) y el ciclo con la respuesta automática ENCENDIDA (y solo
//  para las estrellas elegidas) llaman a `responder`.
// ============================================================================

import {
  avisosRespuesta,
  elegibleAutorespuesta,
  emparejarConPlaces,
  firmarEstado,
  limpiarRespuesta,
  MAX_AUTORESPUESTAS_POR_CICLO,
  MAX_INDICACION,
  MAX_PROPUESTAS_POR_CICLO,
  mensajesRespuesta,
  normalizarEstrellas,
  normalizarResenaGbp,
  verificarEstado,
  volverPermitido,
  type AjustesContestador,
  type EstadoRespuesta,
  type MensajeChat,
  type Resena,
} from "../_shared/resenas/contestador.ts";
import {
  canjearCodigo,
  crearClienteGbp,
  elegirUbicacion,
  ErrorGoogle,
  tokenDeAcceso,
  urlAutorizacion,
  type ClienteGbp,
  type CredencialesOAuth,
} from "../_shared/resenas/google-business.ts";

export class ErrorAccion extends Error {
  constructor(readonly status: number, readonly codigo: string, message: string) {
    super(message);
    this.name = "ErrorAccion";
  }
}

export interface AjustesFila extends AjustesContestador {
  gbp_cuenta: string | null;
  gbp_ubicacion: string | null;
  gbp_ubicacion_nombre: string | null;
  gbp_email: string | null;
  gbp_conectada_en: string | null;
  gbp_ultima_sincronizacion: string | null;
  gbp_ultimo_error: string | null;
  ultimo_ciclo: string | null;
  ultimo_ciclo_resumen: unknown;
}

export interface Repo {
  ajustes(): Promise<AjustesFila>;
  actualizarAjustes(cambios: Partial<AjustesFila>): Promise<void>;
  resena(id: string): Promise<Resena | null>;
  actualizarResena(id: string, cambios: Record<string, unknown>): Promise<void>;
  pendientesDePropuesta(limite: number): Promise<Resena[]>;
  candidatasAutorespuesta(limite: number): Promise<Resena[]>;
  porGbp(nombre: string): Promise<Resena | null>;
  sinGbpCerca(fecha: string): Promise<Resena[]>;
  insertarResena(fila: Record<string, unknown>): Promise<void>;
  leerToken(): Promise<string | null>;
  guardarToken(t: { refresh_token: string; scope: string | null; email: string | null; creado_por: string | null }): Promise<void>;
  borrarToken(): Promise<void>;
  placeId(): Promise<string | null>;
  guia(): Promise<string | null>;
}

export type LlamadaIa = (mensajes: MensajeChat[], disparador: string) => Promise<{ texto: string; modelo: string }>;

export interface Deps {
  repo: Repo;
  ia: LlamadaIa | null;
  fetch: typeof fetch;
  oauth: CredencialesOAuth | null;
  /** Clave para firmar el estado del OAuth (la service role key). */
  claveEstado: string;
  /** URI de vuelta que hay que registrar en Google Cloud (se enseña aunque falten las credenciales). */
  redirectUri?: string;
  sincronizarPlaces?: () => Promise<Record<string, unknown>>;
  ahora?: () => Date;
}

const ID = /^[0-9a-f-]{36}$/i;
const ahoraIso = (d: Deps) => (d.ahora ? d.ahora() : new Date()).toISOString();

function exigirId(id: unknown): string {
  if (typeof id !== "string" || !ID.test(id)) throw new ErrorAccion(400, "id_no_valido", "Falta el identificador de la reseña.");
  return id;
}

async function exigirResena(d: Deps, id: unknown): Promise<Resena> {
  const r = await d.repo.resena(exigirId(id));
  if (!r) throw new ErrorAccion(404, "no_existe", "La reseña no existe.");
  return r;
}

function exigirTexto(texto: unknown): string {
  const t = limpiarRespuesta(texto, { quitarEmoji: false });
  if (t.length < 2) throw new ErrorAccion(400, "texto_vacio", "La respuesta está vacía.");
  if (typeof texto === "string" && texto.trim().length > 4096) throw new ErrorAccion(400, "texto_largo", "Google admite respuestas de hasta 4.096 caracteres.");
  return t;
}

// ─── Proponer (IA) ──────────────────────────────────────────────────────────

export async function proponer(d: Deps, id: unknown, indicacion?: unknown, origen = "panel") {
  const r = await exigirResena(d, id);
  if (!d.ia) throw new ErrorAccion(503, "sin_clave_ia", "Falta la clave de OpenAI en Supabase (OPENAI_API_KEY).");
  if (indicacion !== undefined && indicacion !== null && (typeof indicacion !== "string" || indicacion.length > MAX_INDICACION)) {
    throw new ErrorAccion(400, "indicacion_no_valida", `La indicación admite hasta ${MAX_INDICACION} caracteres.`);
  }
  const ajustes = await d.repo.ajustes();
  const guia = await d.repo.guia().catch(() => null);
  const mensajes = mensajesRespuesta(r, { firma: ajustes.firma, indicaciones: ajustes.indicaciones, guia, indicacion: indicacion as string | undefined });
  const res = await d.ia(mensajes, `resena:${r.id}:${origen}`);
  const texto = limpiarRespuesta(res.texto);
  if (texto.length < 2) throw new ErrorAccion(502, "ia_vacia", "La IA devolvió una respuesta vacía.");
  // Si ya estaba publicada, el borrador nuevo no toca lo publicado.
  const estado: EstadoRespuesta = r.respuesta_estado === "publicada" ? "publicada" : "propuesta";
  await d.repo.actualizarResena(r.id, {
    respuesta_propuesta: texto,
    respuesta_estado: estado,
    respuesta_origen: "ia",
    respuesta_modelo: res.modelo,
    respuesta_error: null,
    respuesta_aprobada_por: null,
    respuesta_aprobada_en: null,
  });
  return { ok: true, propuesta: texto, modelo: res.modelo, avisos: avisosRespuesta(texto), estado };
}

// ─── Borrador, aprobar, marcar, descartar ───────────────────────────────────

export async function guardarBorrador(d: Deps, id: unknown, texto: unknown) {
  const r = await exigirResena(d, id);
  const t = exigirTexto(texto);
  const estado: EstadoRespuesta = r.respuesta_estado === "publicada" ? "publicada" : "propuesta";
  await d.repo.actualizarResena(r.id, { respuesta_propuesta: t, respuesta_estado: estado, respuesta_origen: "editada", respuesta_aprobada_por: null, respuesta_aprobada_en: null });
  return { ok: true, propuesta: t, estado, avisos: avisosRespuesta(t) };
}

async function clienteGoogle(d: Deps): Promise<{ gbp: ClienteGbp; ubicacion: string } | null> {
  if (!d.oauth) return null;
  const ajustes = await d.repo.ajustes();
  if (!ajustes.gbp_ubicacion) return null;
  const refresh = await d.repo.leerToken();
  if (!refresh) return null;
  const acceso = await tokenDeAcceso(d.fetch, d.oauth, refresh);
  return { gbp: crearClienteGbp(d.fetch, acceso), ubicacion: ajustes.gbp_ubicacion };
}

async function publicar(d: Deps, r: Resena, texto: string, gbp: ClienteGbp, automatica: boolean) {
  try {
    await gbp.responder(r.gbp_review_name!, texto);
    await d.repo.actualizarResena(r.id, {
      respuesta: texto,
      fecha_respuesta: ahoraIso(d),
      respuesta_propuesta: texto,
      respuesta_estado: "publicada",
      respuesta_automatica: automatica,
      respuesta_error: null,
    });
    return { publicada: true as const };
  } catch (e) {
    const msg = (e as Error)?.message?.slice(0, 300) ?? "error";
    await d.repo.actualizarResena(r.id, {
      respuesta_estado: "error",
      respuesta_error: msg,
      respuesta_intentos: ((r as Resena & { respuesta_intentos?: number }).respuesta_intentos ?? 0) + 1,
    });
    return { publicada: false as const, motivo: msg, codigo: e instanceof ErrorGoogle ? e.codigo : "google_error" };
  }
}

/** El dueño aprueba (y, si la cuenta está conectada, se publica en Google). */
export async function aprobar(d: Deps, id: unknown, texto: unknown, usuario: string | null, publicarEnGoogle = true) {
  const r = await exigirResena(d, id);
  const t = exigirTexto(texto);
  await d.repo.actualizarResena(r.id, {
    respuesta_propuesta: t,
    respuesta_estado: "aprobada",
    respuesta_origen: r.respuesta_propuesta && r.respuesta_propuesta.trim() === t ? (r as { respuesta_origen?: string }).respuesta_origen ?? "editada" : "editada",
    respuesta_aprobada_por: usuario,
    respuesta_aprobada_en: ahoraIso(d),
    respuesta_error: null,
  });
  if (!publicarEnGoogle) return { ok: true, estado: "aprobada", publicada: false, motivo: "solo_aprobar" };
  if (!r.gbp_review_name) {
    return { ok: true, estado: "aprobada", publicada: false, motivo: "sin_enlace_gbp", mensaje: "Aprobada. Cópiala y respóndela en Google (la reseña aún no está enlazada con Business Profile)." };
  }
  let google: Awaited<ReturnType<typeof clienteGoogle>> = null;
  try {
    google = await clienteGoogle(d);
  } catch (e) {
    await d.repo.actualizarResena(r.id, { respuesta_estado: "error", respuesta_error: (e as Error).message.slice(0, 300) });
    return { ok: true, estado: "error", publicada: false, motivo: (e as Error).message };
  }
  if (!google) return { ok: true, estado: "aprobada", publicada: false, motivo: "sin_conexion", mensaje: "Aprobada. Conecta Google Business Profile para publicarla desde aquí; mientras, cópiala y respóndela en Google." };
  const p = await publicar(d, { ...r, respuesta_propuesta: t }, t, google.gbp, false);
  return p.publicada ? { ok: true, estado: "publicada", publicada: true } : { ok: true, estado: "error", publicada: false, motivo: p.motivo, codigo: p.codigo };
}

/** El dueño la ha respondido a mano en Google: se guarda como publicada. */
export async function marcarRespondida(d: Deps, id: unknown, texto: unknown, usuario: string | null) {
  const r = await exigirResena(d, id);
  const t = exigirTexto(texto ?? r.respuesta_propuesta);
  await d.repo.actualizarResena(r.id, {
    respuesta: t,
    respuesta_propuesta: t,
    fecha_respuesta: ahoraIso(d),
    respuesta_estado: "publicada",
    respuesta_origen: "manual",
    respuesta_aprobada_por: usuario,
    respuesta_aprobada_en: ahoraIso(d),
    respuesta_error: null,
  });
  return { ok: true, estado: "publicada" };
}

export async function descartar(d: Deps, id: unknown) {
  const r = await exigirResena(d, id);
  const estado: EstadoRespuesta = r.respuesta && r.respuesta.trim() ? "publicada" : "pendiente";
  await d.repo.actualizarResena(r.id, {
    respuesta_propuesta: estado === "publicada" ? r.respuesta : null,
    respuesta_estado: estado,
    respuesta_error: null,
    respuesta_aprobada_por: null,
    respuesta_aprobada_en: null,
  });
  return { ok: true, estado };
}

// ─── Business Profile: conectar, elegir ficha, sincronizar ──────────────────

export async function iniciarConexion(d: Deps, usuario: string, volver: unknown) {
  if (!d.oauth) {
    throw new ErrorAccion(503, "google_sin_configurar", "Faltan GOOGLE_BUSINESS_CLIENT_ID y GOOGLE_BUSINESS_CLIENT_SECRET en los secretos de Supabase.");
  }
  if (!volverPermitido(volver)) throw new ErrorAccion(400, "volver_no_valido", "Origen del panel no permitido.");
  const ahora = (d.ahora ? d.ahora() : new Date()).getTime();
  const estado = await firmarEstado({ usuario, volver, exp: ahora + 15 * 60_000 }, d.claveEstado);
  return { ok: true, url: urlAutorizacion(d.oauth, estado) };
}

/** Vuelta de Google (GET con ?code&state). Devuelve a dónde redirigir. */
export async function completarConexion(d: Deps, code: unknown, state: unknown, errorGoogle?: string | null): Promise<string> {
  const e = await verificarEstado(state, d.claveEstado, (d.ahora ? d.ahora() : new Date()).getTime());
  if (!e) throw new ErrorAccion(400, "estado_no_valido", "El enlace de conexión ha caducado o no es válido. Vuelve a pulsar «Conectar» en el panel.");
  const volver = `${e.volver}/super-admin/resenas`;
  if (errorGoogle) return `${volver}?google=cancelado`;
  if (!d.oauth || typeof code !== "string" || !code) return `${volver}?google=error`;
  try {
    const t = await canjearCodigo(d.fetch, d.oauth, code);
    await d.repo.guardarToken({ refresh_token: t.refreshToken, scope: t.scope, email: t.email, creado_por: e.usuario });
    const cambios: Partial<AjustesFila> = { gbp_email: t.email, gbp_conectada_en: ahoraIso(d), gbp_ultimo_error: null };
    try {
      const lista = await crearClienteGbp(d.fetch, t.accessToken).ubicaciones();
      const elegida = elegirUbicacion(lista, await d.repo.placeId());
      if (elegida) {
        cambios.gbp_ubicacion = elegida.name;
        cambios.gbp_cuenta = elegida.name.split("/locations/")[0];
        cambios.gbp_ubicacion_nombre = elegida.titulo || null;
      } else {
        cambios.gbp_ultimo_error = lista.length ? "Hay varias fichas: elige cuál en el panel." : "La cuenta no administra ninguna ficha de Business Profile.";
      }
    } catch (err) {
      cambios.gbp_ultimo_error = (err as Error).message.slice(0, 300);
    }
    await d.repo.actualizarAjustes(cambios);
    return `${volver}?google=conectado`;
  } catch (err) {
    await d.repo.actualizarAjustes({ gbp_ultimo_error: (err as Error).message.slice(0, 300) }).catch(() => undefined);
    return `${volver}?google=error`;
  }
}

export async function listarUbicaciones(d: Deps) {
  if (!d.oauth) throw new ErrorAccion(503, "google_sin_configurar", "Google Business Profile no está configurado.");
  const refresh = await d.repo.leerToken();
  if (!refresh) throw new ErrorAccion(409, "google_sin_conectar", "Conecta antes la cuenta de Google del negocio.");
  const lista = await crearClienteGbp(d.fetch, await tokenDeAcceso(d.fetch, d.oauth, refresh)).ubicaciones();
  return { ok: true, ubicaciones: lista };
}

export async function elegirUbicacionAccion(d: Deps, nombre: unknown) {
  const { ubicaciones } = await listarUbicaciones(d);
  const u = ubicaciones.find((x) => x.name === nombre);
  if (!u) throw new ErrorAccion(400, "ubicacion_no_valida", "Esa ficha no está en la cuenta conectada.");
  await d.repo.actualizarAjustes({ gbp_ubicacion: u.name, gbp_cuenta: u.name.split("/locations/")[0], gbp_ubicacion_nombre: u.titulo || null, gbp_ultimo_error: null });
  return { ok: true, ubicacion: u };
}

export async function desconectar(d: Deps) {
  await d.repo.borrarToken();
  await d.repo.actualizarAjustes({ gbp_cuenta: null, gbp_ubicacion: null, gbp_ubicacion_nombre: null, gbp_email: null, gbp_conectada_en: null, gbp_ultimo_error: null });
  return { ok: true };
}

/** Trae TODAS las reseñas de la ficha (Places solo da 5) y las respuestas que ya hay en Google. */
export async function sincronizarGbp(d: Deps, google: { gbp: ClienteGbp; ubicacion: string }) {
  const { resenas } = await google.gbp.resenas(google.ubicacion);
  let nuevas = 0, enlazadas = 0, actualizadas = 0, descartadas = 0;
  for (const bruta of resenas) {
    const f = normalizarResenaGbp(bruta as never);
    if (!f) { descartadas++; continue; }
    let actual = await d.repo.porGbp(f.gbp_review_name);
    if (!actual) {
      actual = emparejarConPlaces(f, await d.repo.sinGbpCerca(f.fecha));
      if (actual) {
        await d.repo.actualizarResena(actual.id, { gbp_review_name: f.gbp_review_name });
        enlazadas++;
      }
    }
    const conRespuesta = f.respuesta
      ? { respuesta: f.respuesta, fecha_respuesta: f.fecha_respuesta, respuesta_estado: "publicada", respuesta_propuesta: f.respuesta }
      : {};
    if (!actual) {
      await d.repo.insertarResena({
        nombre_cliente: f.nombre_cliente,
        valoracion: f.valoracion,
        google_rating: f.valoracion,
        comentario: f.comentario,
        fecha: f.fecha,
        fuente: "google",
        estado: "publicada",
        gbp_review_name: f.gbp_review_name,
        ...(f.respuesta ? { ...conRespuesta, respuesta_origen: "google" } : {}),
      });
      nuevas++;
      continue;
    }
    const cambios: Record<string, unknown> = {};
    if (f.comentario !== actual.comentario && f.comentario) cambios.comentario = f.comentario;
    if (f.valoracion !== Number(actual.valoracion)) cambios.valoracion = f.valoracion;
    // Una respuesta escrita en Google (a mano o por nosotros) manda sobre el estado local.
    if (f.respuesta && f.respuesta !== (actual.respuesta ?? null)) Object.assign(cambios, conRespuesta, { respuesta_origen: "google" });
    if (Object.keys(cambios).length) {
      await d.repo.actualizarResena(actual.id, cambios);
      actualizadas++;
    }
  }
  await d.repo.actualizarAjustes({ gbp_ultima_sincronizacion: ahoraIso(d), gbp_ultimo_error: null });
  return { leidas: resenas.length, nuevas, enlazadas, actualizadas, descartadas };
}

// ─── Ciclo (cron dos veces al día, o «Sincronizar ahora») ───────────────────

export async function ciclo(d: Deps, origen: "cron" | "panel") {
  const resumen: Record<string, unknown> = { origen };
  const errores: string[] = [];

  if (d.sincronizarPlaces) {
    try {
      resumen.places = await d.sincronizarPlaces();
    } catch (e) {
      errores.push(`Places: ${(e as Error).message}`.slice(0, 300));
    }
  }

  let google: Awaited<ReturnType<typeof clienteGoogle>> = null;
  try {
    google = await clienteGoogle(d);
    if (google) resumen.google = await sincronizarGbp(d, google);
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    errores.push(`Business Profile: ${msg}`);
    await d.repo.actualizarAjustes({ gbp_ultimo_error: msg }).catch(() => undefined);
    google = null;
  }

  const ajustes = await d.repo.ajustes();
  let propuestas = 0;
  if (ajustes.proponer_automatico && d.ia) {
    for (const r of await d.repo.pendientesDePropuesta(MAX_PROPUESTAS_POR_CICLO)) {
      try {
        await proponer(d, r.id, undefined, origen);
        propuestas++;
      } catch (e) {
        errores.push(`Propuesta ${r.id}: ${(e as Error).message}`.slice(0, 300));
      }
    }
  }
  resumen.propuestas = propuestas;

  let automaticas = 0, fallidas = 0;
  if (ajustes.autorespuesta_activa && google) {
    const candidatas = (await d.repo.candidatasAutorespuesta(MAX_AUTORESPUESTAS_POR_CICLO * 3))
      .filter((r) => elegibleAutorespuesta({ ...ajustes, autorespuesta_estrellas: normalizarEstrellas(ajustes.autorespuesta_estrellas) }, r))
      .slice(0, MAX_AUTORESPUESTAS_POR_CICLO);
    for (const r of candidatas) {
      const p = await publicar(d, r, limpiarRespuesta(r.respuesta_propuesta), google.gbp, true);
      if (p.publicada) automaticas++;
      else { fallidas++; errores.push(`Respuesta automática ${r.id}: ${p.motivo}`.slice(0, 300)); }
    }
  }
  resumen.automaticas = automaticas;
  resumen.automaticas_fallidas = fallidas;
  resumen.errores = errores.slice(0, 20);

  await d.repo.actualizarAjustes({ ultimo_ciclo: ahoraIso(d), ultimo_ciclo_resumen: resumen });
  return { ok: errores.length === 0, ...resumen };
}

// ─── Estado (para el panel) ─────────────────────────────────────────────────

export async function estado(d: Deps) {
  const a = await d.repo.ajustes();
  const conectada = !!(await d.repo.leerToken());
  return {
    ok: true,
    ia: !!d.ia,
    google: {
      configurada: !!d.oauth,
      conectada,
      email: a.gbp_email,
      ubicacion: a.gbp_ubicacion,
      ubicacion_nombre: a.gbp_ubicacion_nombre,
      ultima_sincronizacion: a.gbp_ultima_sincronizacion,
      ultimo_error: a.gbp_ultimo_error,
      redirect_uri: d.oauth?.redirectUri ?? d.redirectUri ?? null,
    },
  };
}
