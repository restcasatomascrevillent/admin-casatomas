/**
 * instagram-ia, fase 2 «Fechas y campañas»: acciones proponer_campana e
 * ideas_semana. Las despacha manejarIA (ia.ts) después de autorizar
 * (Marketing en edición) y de leer el cuerpo. NUNCA publica ni programa:
 * una campaña se guarda como «propuesta» y solo una persona la acepta (RPC
 * instagram_aceptar_campana, que crea BORRADORES).
 *
 *   POST `${SUPABASE_URL}/functions/v1/instagram-ia`
 *
 *   proponer_campana:
 *     { accion: "proponer_campana", marca: "casa-tomas" | "touza",
 *       desde?: "AAAA-MM-DD" (por defecto mañana; de hoy a +60 días),
 *       semanas?: 2..4 (3), piezasPorSemana?: 1..5 (3),
 *       objetivo?: string ≤ 500 («¿Qué quieres empujar?»; se quitan correos y teléfonos) }
 *     200 { ok, accion, campanaId, sugerenciaId, modelo, versionGuia,
 *           campana: { titulo, objetivo, publico, mensaje, razonamiento, desde, hasta,
 *                      fases[{ nombre, desde, hasta }],
 *                      piezas[{ fecha, hora, formato, plantilla, platoId, plato, foto,
 *                               faltaFoto, antetitulo, titular, gancho, caption, hashtags,
 *                               altText, porQue, fase, encargoSugerido, avisos[] }] },
 *           descartadas[{ donde, motivos[] }], avisos[] }
 *
 *   ideas_semana:
 *     { accion: "ideas_semana", marca, semana?: "AAAA-MM-DD" (cualquier día; se toma
 *       su lunes; por defecto la semana actual; hasta 8 semanas vista) }
 *     200 { ok, accion, sugerenciaId, modelo, versionGuia, desde, hasta,
 *           ideas[{ fecha, titulo, idea, motivo, formato, plantilla, platoId, plato, gancho, avisos[] }],
 *           fechas[{ titulo, desde, hasta, verificacion }], descartadas[], avisos[] }
 *
 *   Errores como sugerir_texto: 400 entrada · 422 nada pasó los validadores
 *   (ni al reintento) · 429 cupo diario (el MISMO cupo) · 502 OpenAI o BD ·
 *   503 falta la clave o la migración 20261109000000_instagram_campanas.
 *
 * Contexto (RPC instagram_ia_contexto, con el JWT del usuario): carta activa
 * de la marca SIN precios (featured primero), novedades del periodo, fechas
 * señaladas, fotos de la biblioteca, resumen de métricas de 90 días e
 * historial de ganchos; más la guía de la marca. Nunca datos de clientes.
 * Fase 3: si existe la RPC instagram_que_funciona (20261110000000), las
 * métricas que ve el modelo son su resumen («Qué funciona», con muestra
 * mínima y frases con datos reales) en vez del de instagram_ia_contexto, y
 * se quitan del razonamiento, los «por qué» y las ideas las frases con
 * porcentajes que no salen de ahí.
 *
 * Validadores (_shared/instagram/validar-campana.ts): los MISMOS que los
 * textos y además platos solo por id y existentes, TOUZA sin «reservar» en
 * ningún texto, sin emoji y fechas dentro del rango.
 *
 * Clave, coste y registro: los mismos que sugerir_texto (claveOpenAI("otros"),
 * AcumuladorUso + registrarUso en el finally; disparador campana:<uuid> si se
 * guardó la campaña, si no usuario:<uuid>).
 */
import { claveOpenAI } from "../_shared/clave-openai.ts";
import { AcumuladorUso, registrarUso } from "../_shared/registrar-uso-ia.ts";
import { json } from "../_shared/instagram/http.ts";
import { registrarSecreto, registro } from "../_shared/instagram/secretos.ts";
import type { Sesion } from "../_shared/instagram/supabase.ts";
import {
  cifrasPermitidas,
  igUserIdDeMarca,
  leerQueFuncionaIA,
  quitarCifrasInventadas,
  resumenQueFuncionaIA,
} from "../_shared/instagram/que-funciona.ts";
import { anonimizar, CUENTAS_PROPIAS, type MarcaIA } from "../_shared/instagram/validar-ia.ts";
import {
  esFecha,
  lunesDe,
  revisarCampana,
  revisarIdea,
  sumarDiasFecha,
  type Campana,
  type ContextoCampana,
  type Descartada,
  type IdeaSemana,
  type PlatoCarta,
} from "../_shared/instagram/validar-campana.ts";
import {
  cab,
  contarHoy,
  CUPO_DIARIO_POR_DEFECTO,
  ErrorBD,
  ErrorOpenAI,
  faltaTabla,
  FUNCION,
  guardarSugerencia,
  leerGuia,
  MODELO_POR_DEFECTO,
  pedirModelo,
  textoError,
  type DependenciasIA,
  type Mensaje,
} from "./ia.ts";
import { plantillasCampana } from "./plantillas.ts";
import {
  ESQUEMA_CAMPANA,
  ESQUEMA_IDEAS,
  mensajePlanificacion,
  mensajeReintentoPlan,
  promptSistemaCampana,
  promptSistemaIdeas,
} from "./prompts-campanas.ts";

export type AccionPlanificacion = "proponer_campana" | "ideas_semana";
export const ACCIONES_PLANIFICACION: readonly AccionPlanificacion[] = ["proponer_campana", "ideas_semana"];

const MIGRACION = "20261109000000_instagram_campanas.sql";
const MAX_INTENTOS = 2;
const MS_SUPABASE = 15_000;
const MAX_OBJETIVO = 500;
const MAX_DIAS_VISTA = 60;
const MAX_SEMANAS_IDEAS = 8;
const TOKENS_CAMPANA = 8000;
const TOKENS_IDEAS = 2500;

// ── Entrada ─────────────────────────────────────────────────────────────────

export interface EntradaCampana {
  accion: "proponer_campana";
  marca: MarcaIA;
  desde: string;
  hasta: string;
  semanas: number;
  piezasPorSemana: number;
  objetivo: string;
}

export interface EntradaIdeas {
  accion: "ideas_semana";
  marca: MarcaIA;
  desde: string;
  hasta: string;
}

/** Hoy en Madrid (AAAA-MM-DD). */
export function hoyMadrid(ahora: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
}

const entero = (v: unknown, defecto: number): number | null =>
  v === undefined || v === null ? defecto : Number.isInteger(v) ? (v as number) : null;

export function validarEntradaPlanificacion(
  valor: unknown,
  ahora: Date,
): { ok: true; entrada: EntradaCampana | EntradaIdeas } | { ok: false; error: string } {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return { ok: false, error: "El cuerpo debe ser un objeto JSON" };
  const o = valor as Record<string, unknown>;
  if (o.marca !== "casa-tomas" && o.marca !== "touza") return { ok: false, error: "marca debe ser «casa-tomas» o «touza»" };
  const hoy = hoyMadrid(ahora);

  if (o.accion === "ideas_semana") {
    if (o.semana !== undefined && o.semana !== null && !esFecha(o.semana)) return { ok: false, error: "semana debe ser una fecha AAAA-MM-DD" };
    const desde = lunesDe(typeof o.semana === "string" ? o.semana : hoy);
    if (desde < lunesDe(hoy)) return { ok: false, error: "No se piden ideas para una semana que ya ha pasado" };
    if (desde > sumarDiasFecha(lunesDe(hoy), 7 * MAX_SEMANAS_IDEAS)) return { ok: false, error: `Como mucho ${MAX_SEMANAS_IDEAS} semanas vista` };
    return { ok: true, entrada: { accion: "ideas_semana", marca: o.marca, desde, hasta: sumarDiasFecha(desde, 6) } };
  }

  const semanas = entero(o.semanas, 3);
  if (semanas === null || semanas < 2 || semanas > 4) return { ok: false, error: "semanas debe ser 2, 3 o 4" };
  const porSemana = entero(o.piezasPorSemana, 3);
  if (porSemana === null || porSemana < 1 || porSemana > 5) return { ok: false, error: "piezasPorSemana debe estar entre 1 y 5" };
  if (o.desde !== undefined && o.desde !== null && !esFecha(o.desde)) return { ok: false, error: "desde debe ser una fecha AAAA-MM-DD" };
  const desde = typeof o.desde === "string" ? o.desde : sumarDiasFecha(hoy, 1);
  if (desde < hoy) return { ok: false, error: "La campaña no puede empezar en el pasado" };
  if (desde > sumarDiasFecha(hoy, MAX_DIAS_VISTA)) return { ok: false, error: `La campaña tiene que empezar en los próximos ${MAX_DIAS_VISTA} días` };
  if (o.objetivo !== undefined && o.objetivo !== null && typeof o.objetivo !== "string") return { ok: false, error: "objetivo debe ser texto" };
  if (typeof o.objetivo === "string" && [...o.objetivo].length > MAX_OBJETIVO) return { ok: false, error: `objetivo: máximo ${MAX_OBJETIVO} caracteres` };
  return {
    ok: true,
    entrada: {
      accion: "proponer_campana",
      marca: o.marca,
      desde,
      hasta: sumarDiasFecha(desde, semanas * 7 - 1),
      semanas,
      piezasPorSemana: porSemana,
      objetivo: anonimizar(typeof o.objetivo === "string" ? o.objetivo.trim() : ""),
    },
  };
}

// ── Base de datos (con el JWT del usuario) ──────────────────────────────────

export interface ContextoBD {
  carta: PlatoCarta[];
  novedades: unknown[];
  fechas: Array<{ titulo?: string; desde?: string; hasta?: string; verificacion?: string; [k: string]: unknown }>;
  fotos: Array<{ id: string; tipo?: string; descripcion?: string }>;
  metricas: unknown;
  historial: unknown[];
}

export async function leerContexto(s: Sesion, marca: MarcaIA, desde: string, hasta: string): Promise<ContextoBD> {
  const r = await s.fetch(`${s.sb.url}/rest/v1/rpc/instagram_ia_contexto`, {
    method: "POST",
    headers: cab(s, { "Content-Type": "application/json" }),
    body: JSON.stringify({ p_marca: marca, p_desde: desde, p_hasta: hasta }),
    signal: AbortSignal.timeout(MS_SUPABASE),
  });
  if (!r.ok) {
    const t = await textoError(r);
    if (faltaTabla(r.status, t) || /PGRST202|Could not find the function/i.test(t)) {
      throw new ErrorBD(`Falta aplicar la migración ${MIGRACION} en este Supabase.`, 503);
    }
    throw new ErrorBD(`No se pudo leer el contexto de la marca (${r.status})`, 502);
  }
  const c = ((await r.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const lista = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    carta: lista<PlatoCarta>(c.carta).filter((p) => p && typeof p.id === "string" && typeof p.nombre === "string"),
    novedades: lista(c.novedades),
    fechas: lista(c.fechas),
    fotos: lista<{ id: string }>(c.fotos).filter((f) => f && typeof f.id === "string"),
    metricas: c.metricas ?? null,
    historial: lista(c.historial),
  };
}

export async function guardarCampana(s: Sesion, fila: Record<string, unknown>): Promise<string> {
  const r = await s.fetch(`${s.sb.url}/rest/v1/instagram_campanas?select=id`, {
    method: "POST",
    headers: cab(s, { "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify(fila),
    signal: AbortSignal.timeout(MS_SUPABASE),
  });
  if (!r.ok) {
    const t = await textoError(r);
    if (faltaTabla(r.status, t)) throw new ErrorBD(`Falta aplicar la migración ${MIGRACION} en este Supabase.`, 503);
    registro("error", FUNCION, `no se pudo guardar la campaña (${r.status}): ${t}`);
    throw new ErrorBD(`La campaña se ha generado, pero no se ha podido guardar (${r.status}). Prueba otra vez.`, 502);
  }
  const filas = (await r.json().catch(() => [])) as Array<{ id?: string }>;
  const id = filas?.[0]?.id;
  if (!id) throw new ErrorBD("La campaña se ha generado, pero no se ha podido guardar. Prueba otra vez.", 502);
  return id;
}

// ── Manejador ───────────────────────────────────────────────────────────────

export interface ContextoManejador {
  sesion: Sesion;
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  deps: DependenciasIA;
}

/** Carta para el modelo: sin alérgenos (no los necesita para planificar) ni precios. */
function cartaParaModelo(carta: PlatoCarta[]): unknown[] {
  return carta.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    categoria: p.categoria ?? null,
    featured: p.featured === true,
    descripcion: p.descripcion ?? null,
    tiene_foto: p.tiene_foto === true,
  }));
}

export async function manejarPlanificacion(valor: unknown, m: ContextoManejador): Promise<Response> {
  const { sesion: s, env, deps } = m;
  const ahora = deps.ahora?.() ?? new Date();
  const v = validarEntradaPlanificacion(valor, ahora);
  if (!v.ok) return json(400, { ok: false, error: v.error });
  const e = v.entrada;

  const clave = claveOpenAI("otros", (n) => env[n]);
  if (!clave) {
    return json(503, {
      ok: false,
      error: "Falta la clave de OpenAI en los secretos de Supabase (OPENAI_API_KEY), la misma que usan las otras funciones de IA.",
    });
  }
  registrarSecreto(clave);
  const modelo = (env.INSTAGRAM_IA_MODEL ?? "").trim() || MODELO_POR_DEFECTO;
  const cupo = Number(env.INSTAGRAM_IA_CUPO_DIARIO) > 0 ? Math.floor(Number(env.INSTAGRAM_IA_CUPO_DIARIO)) : CUPO_DIARIO_POR_DEFECTO;

  let guia: Awaited<ReturnType<typeof leerGuia>>;
  let bd: ContextoBD;
  let queFunciona: Awaited<ReturnType<typeof leerQueFuncionaIA>> = null;
  try {
    const usadas = await contarHoy(s, ahora);
    if (usadas >= cupo) {
      return json(429, { ok: false, error: `Has llegado al tope de ${cupo} sugerencias de IA por día. Vuelve a probar mañana.` });
    }
    [guia, bd, queFunciona] = await Promise.all([
      leerGuia(s, e.marca),
      leerContexto(s, e.marca, e.desde, e.hasta),
      leerQueFuncionaIA(s.fetch, s.sb.url, cab(s), e.marca, igUserIdDeMarca(env, e.marca)),
    ]);
  } catch (err) {
    if (err instanceof ErrorBD) return json(err.estado, { ok: false, error: err.message });
    registro("error", FUNCION, "contexto de planificación", err);
    return json(502, { ok: false, error: "No se pudo leer el contexto de la base de datos" });
  }

  const plantillas = plantillasCampana(e.marca);
  const esCampana = e.accion === "proponer_campana";
  const maxPiezas = esCampana ? e.semanas * e.piezasPorSemana : 5;
  const ctx: ContextoCampana = {
    marca: e.marca,
    desde: e.desde,
    hasta: e.hasta,
    carta: bd.carta,
    ctas: guia.ctas,
    fotos: bd.fotos.map((f) => f.id),
    plantillas,
    maxPiezas,
    minPiezas: esCampana ? Math.max(2, Math.ceil(maxPiezas / 2)) : 1,
    cuentasPropias: CUENTAS_PROPIAS,
  };
  const avisos: string[] = [];
  if (!bd.carta.length) avisos.push("La carta de esta marca no tiene platos activos: la propuesta no cita platos.");

  const datos: Record<string, unknown> = {
    marca: e.marca,
    hoy: hoyMadrid(ahora),
    desde: e.desde,
    hasta: e.hasta,
    ...(esCampana ? { semanas: e.semanas, piezas_por_semana: e.piezasPorSemana, piezas_total: maxPiezas, peticion: e.objetivo } : {}),
    guia: { version: guia.version, texto: guia.guia, hashtags_base: guia.hashtags_base, ctas: guia.ctas },
    plantillas: plantillas.map((p) => ({ id: p.id, formatos: p.formatos, con_foto: p.conFoto, campos: p.campos, limites: p.limites })),
    carta: cartaParaModelo(bd.carta),
    novedades: bd.novedades,
    fechas: bd.fechas,
    fotos: bd.fotos,
    // Fase 3: «Qué funciona» (con muestra mínima) si está la migración; si no, el resumen de la fase 2.
    metricas: queFunciona ? resumenQueFuncionaIA(queFunciona) : bd.metricas,
    historial: bd.historial,
  };
  const permitidas = cifrasPermitidas(queFunciona);
  let cifrasQuitadas = 0;
  const limpiar = (t: string) => {
    const r = quitarCifrasInventadas(t, permitidas);
    cifrasQuitadas += r.quitadas;
    return r.texto;
  };
  const mensajes: Mensaje[] = [
    { role: "system", content: esCampana ? promptSistemaCampana(e.marca) : promptSistemaIdeas(e.marca) },
    { role: "user", content: mensajePlanificacion(datos) },
  ];

  const uso = new AcumuladorUso(FUNCION, modelo, "chat");
  const inicioMs = Date.now();
  const registrar = deps.registrar ?? registrarUso;
  let disparador = `usuario:${s.usuario}`;
  try {
    let campana: Campana | null = null;
    let ideas: IdeaSemana[] = [];
    let correcciones: string[] = [];
    const descartadas: Descartada[] = [];
    for (let intento = 0; intento < MAX_INTENTOS && !campana && !ideas.length; intento++) {
      const r = await pedirModelo(m.fetch, clave, modelo, mensajes, esCampana ? ESQUEMA_CAMPANA : ESQUEMA_IDEAS, uso, esCampana ? TOKENS_CAMPANA : TOKENS_IDEAS);
      let motivos: string[];
      if (esCampana) {
        const rev = revisarCampana(r.datos, ctx);
        descartadas.push(...rev.descartadas);
        if (rev.ok) {
          campana = {
            ...rev.valor,
            razonamiento: limpiar(rev.valor.razonamiento),
            piezas: rev.valor.piezas.map((p) => ({ ...p, porQue: limpiar(p.porQue) })),
          };
          correcciones = rev.correcciones;
        }
        motivos = rev.descartadas.flatMap((d) => d.motivos.map((x) => `${d.donde}: ${x}`));
      } else {
        const brutas = Array.isArray(r.datos.ideas) ? r.datos.ideas.slice(0, 8) : [];
        const revs = brutas.map((b) => revisarIdea(b, ctx));
        revs.forEach((x, i) => !x.ok && descartadas.push({ donde: `Idea ${i + 1}`, motivos: x.errores }));
        ideas = revs.filter((x) => x.ok).map((x) => ({ ...x.valor, idea: limpiar(x.valor.idea) })).slice(0, 5);
        motivos = descartadas.flatMap((d) => d.motivos);
        if (!brutas.length) motivos = ["No ha propuesto ninguna idea."];
      }
      if (!campana && !ideas.length && intento + 1 < MAX_INTENTOS) {
        mensajes.push({ role: "assistant", content: r.bruto });
        mensajes.push({ role: "user", content: mensajeReintentoPlan(motivos) });
      }
    }

    if (cifrasQuitadas) {
      avisos.push(`Se han quitado ${cifrasQuitadas} frase(s) con cifras de métricas que no salen de «Qué funciona».`);
    }
    const entrada = esCampana
      ? { accion: e.accion, marca: e.marca, desde: e.desde, hasta: e.hasta, semanas: e.semanas, piezasPorSemana: e.piezasPorSemana, objetivo: e.objetivo }
      : { accion: e.accion, marca: e.marca, desde: e.desde, hasta: e.hasta };
    const resumenDescartadas = descartadas.slice(0, 20).map((d) => ({ donde: d.donde, motivos: d.motivos.slice(0, 6) }));
    const sugerenciaId = await guardarSugerencia(s, {
      tipo: e.accion,
      marca: e.marca,
      pieza_id: null,
      entrada,
      salida: esCampana ? { campana, descartadas: resumenDescartadas, avisos } : { ideas, descartadas: resumenDescartadas, avisos },
      modelo,
      version_guia: guia.version,
      variantes: esCampana ? (campana ? 1 : 0) : ideas.length,
      descartadas: Math.min(descartadas.length, 10),
      tokens_entrada: uso.prompt,
      tokens_salida: uso.completion,
    });

    if (esCampana) {
      if (!campana) {
        return json(422, {
          ok: false,
          error: "La campaña no ha pasado las comprobaciones (platos, fechas, precios, alérgenos, datos personales…). Prueba otra vez o cambia lo que quieres empujar.",
          accion: e.accion,
          sugerenciaId,
          descartadas: resumenDescartadas,
          avisos,
        });
      }
      const campanaId = await guardarCampana(s, {
        marca: e.marca,
        titulo: campana.titulo,
        objetivo: campana.objetivo || null,
        publico: campana.publico || null,
        mensaje: campana.mensaje || null,
        razonamiento: campana.razonamiento || null,
        peticion: e.objetivo || null,
        desde: campana.desde,
        hasta: campana.hasta,
        propuesta: campana,
        sugerencia_id: sugerenciaId,
        modelo,
      });
      disparador = `campana:${campanaId}`;
      return json(200, {
        ok: true,
        accion: e.accion,
        campanaId,
        sugerenciaId,
        modelo,
        versionGuia: guia.version,
        campana,
        descartadas: resumenDescartadas,
        avisos: [...avisos, ...correcciones],
      });
    }

    if (!ideas.length) {
      return json(422, {
        ok: false,
        error: "Ninguna idea ha pasado las comprobaciones. Prueba otra vez.",
        accion: e.accion,
        sugerenciaId,
        descartadas: resumenDescartadas,
        avisos,
      });
    }
    return json(200, {
      ok: true,
      accion: e.accion,
      sugerenciaId,
      modelo,
      versionGuia: guia.version,
      desde: e.desde,
      hasta: e.hasta,
      ideas,
      fechas: bd.fechas.map((f) => ({ titulo: f.titulo, desde: f.desde, hasta: f.hasta, verificacion: f.verificacion })),
      descartadas: resumenDescartadas,
      avisos,
    });
  } catch (err) {
    uso.marcarError();
    if (err instanceof ErrorOpenAI) return json(502, { ok: false, error: err.message });
    if (err instanceof ErrorBD) return json(err.estado, { ok: false, error: err.message });
    registro("error", FUNCION, "fallo de planificación", err);
    return json(500, { ok: false, error: "No se pudo generar la propuesta" });
  } finally {
    await registrar(uso, { disparador, duracionMs: Date.now() - inicioMs });
  }
}
