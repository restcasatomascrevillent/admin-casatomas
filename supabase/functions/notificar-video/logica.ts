// Lógica pura de notificar-video (sin Deno ni red): validar el cuerpo,
// autorizar al llamante sobre el trabajo, construir la carga del push y
// decidir qué suscripciones están caducadas. La prueban los tests de vitest
// (supabase/functions/__tests__/notificar-video.test.ts).

export interface TrabajoNotificable {
  id: string;
  plato_id: string;
  estado: string;
  error: string | null;
  creado_por: string | null;
  procesado_por: string | null;
}

export interface PlatoNotificable {
  nombre: string | null;
  imagen_url?: string | null;
}

export interface CargaPush {
  titulo: string;
  cuerpo: string;
  imagen?: string;
  url: string;
  tag: string;
  trabajo_id: string;
  plato_id: string;
  estado: "listo" | "error";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function leerTrabajoId(cuerpo: unknown): string | null {
  const id = (cuerpo as { trabajo_id?: unknown } | null)?.trabajo_id;
  return typeof id === "string" && UUID.test(id) ? id : null;
}

export type Autorizacion = { ok: true } | { ok: false; status: 403 | 409; error: string };

/**
 * Solo avisa quien procesó el trabajo (o quien lo creó) y solo cuando ya
 * está terminado: así nadie puede mandar pushes arbitrarios.
 */
export function autorizarNotificacion(t: TrabajoNotificable, userId: string): Autorizacion {
  if (t.procesado_por !== userId && t.creado_por !== userId)
    return { ok: false, status: 403, error: "Este trabajo no es tuyo" };
  if (t.estado !== "listo" && t.estado !== "error")
    return { ok: false, status: 409, error: "El trabajo aún no ha terminado" };
  return { ok: true };
}

/** Ruta del panel que abre la notificación: la carta con ese plato. */
export function rutaPlato(platoId: string): string {
  return `/gestion-web?tab=carta&plato=${encodeURIComponent(platoId)}`;
}

export function construirCarga(t: TrabajoNotificable, plato: PlatoNotificable | null): CargaPush {
  const nombre = plato?.nombre?.trim() || "plato";
  const listo = t.estado === "listo";
  const carga: CargaPush = {
    titulo: listo ? `Vídeo listo: ${nombre}` : `No se pudo hacer el vídeo: ${nombre}`,
    cuerpo: listo
      ? "Ya está guardado en la carta. Pulsa para verlo."
      : `${(t.error ?? "Error al procesar").slice(0, 140)}. Pulsa para volver a intentarlo.`,
    url: rutaPlato(t.plato_id),
    tag: `video-${t.plato_id}`,
    trabajo_id: t.id,
    plato_id: t.plato_id,
    estado: listo ? "listo" : "error",
  };
  const img = plato?.imagen_url;
  if (listo && img && /^https:\/\//.test(img)) carga.imagen = img;
  return carga;
}

/** El servicio push dice que la suscripción ya no existe: hay que borrarla. */
export function suscripcionCaducada(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410;
}

// --- Recorte de fotos (tabla trabajos_recorte, cuerpo `{ trabajo_id, tipo: "recorte" }`) ---

export type TipoTrabajo = "video" | "recorte" | "reel" | "encargo";

/** `tipo` del cuerpo: "recorte", "reel", "encargo" o, por defecto (compatibilidad), "video". null si viene otro valor. */
export function leerTipo(cuerpo: unknown): TipoTrabajo | null {
  const tipo = (cuerpo as { tipo?: unknown } | null)?.tipo;
  if (tipo === undefined || tipo === null || tipo === "video") return "video";
  if (tipo === "recorte") return "recorte";
  if (tipo === "reel") return "reel";
  if (tipo === "encargo") return "encargo";
  return null;
}

/**
 * Sección del panel que hay que poder editar para avisar de cada tipo de trabajo.
 * Los encargos valen con Marketing (restaurante) o con Instagram · Agencia: ver
 * SECCIONES_ENCARGO; aquí devuelven «marketing» solo por compatibilidad.
 */
export function seccionDeTipo(tipo: TipoTrabajo): "gestor_carta" | "marketing" {
  return tipo === "reel" || tipo === "encargo" ? "marketing" : "gestor_carta";
}

// --- Reels de Instagram (tabla instagram_trabajos_render, `{ trabajo_id, tipo: "reel" }`) ---

export interface TrabajoReelNotificable {
  id: string;
  pieza_id: string;
  estado: string;
  error: string | null;
  creado_por: string | null;
  procesado_por: string | null;
}

/** Misma regla: solo quien lo generó (el trabajador) o quien lo encargó, y ya terminado. */
export function autorizarNotificacionReel(t: TrabajoReelNotificable, userId: string): Autorizacion {
  return autorizarNotificacion({ ...t, plato_id: t.pieza_id }, userId);
}

export function construirCargaReel(t: TrabajoReelNotificable): CargaPush {
  const listo = t.estado === "listo";
  return {
    titulo: listo ? "Reel listo" : "No se pudo generar el reel",
    cuerpo: listo
      ? "El vídeo ya está generado. Pulsa para verlo, probarlo y publicarlo."
      : `${(t.error ?? "Error al generar el vídeo").slice(0, 140)}. Pulsa para revisarlo.`,
    url: `/instagram?tab=reels&pieza=${encodeURIComponent(t.pieza_id)}`,
    tag: `reel-${t.pieza_id}`,
    trabajo_id: t.id,
    plato_id: t.pieza_id,
    estado: listo ? "listo" : "error",
  };
}

export interface TrabajoRecorteNotificable {
  id: string;
  tabla: string;
  registro_id: string;
  nombre: string | null;
  estado: string;
  error: string | null;
  creado_por: string | null;
  procesado_por: string | null;
}

/** Misma regla que los vídeos: solo quien lo procesó o lo creó, y ya terminado. */
export function autorizarNotificacionRecorte(t: TrabajoRecorteNotificable, userId: string): Autorizacion {
  return autorizarNotificacion({ ...t, plato_id: t.registro_id }, userId);
}

export function construirCargaRecorte(t: TrabajoRecorteNotificable, imagenUrl?: string | null): CargaPush {
  const nombre = t.nombre?.trim() || "la ficha";
  const listo = t.estado === "listo";
  const carga: CargaPush = {
    titulo: listo ? `Foto con fondo lista: ${nombre}` : `No se pudo recortar la foto: ${nombre}`,
    cuerpo: listo
      ? "Ya está guardada en la carta con el fondo elegido. Pulsa para verla."
      : `${(t.error ?? "Error al recortar").slice(0, 140)}. La foto normal sigue guardada.`,
    url: "/gestion-web?tab=carta",
    tag: `recorte-${t.tabla}-${t.registro_id}`,
    trabajo_id: t.id,
    plato_id: t.registro_id,
    estado: listo ? "listo" : "error",
  };
  if (listo && imagenUrl && /^https:\/\//.test(imagenUrl)) carga.imagen = imagenUrl;
  return carga;
}

// --- Encargos de Instagram (`{ evento_id, tipo: "encargo" }`, 10-11-2026) ---
// Cada cambio de estado o mensaje deja una fila en instagram_encargo_eventos;
// quien lo hizo pide el aviso con el id del evento y la función manda el push
// a la otra parte (destinatarios: RPC instagram_encargo_destinatarios).

/** Con cualquiera de las dos se puede avisar de un encargo (luego se exige ser el autor del evento). */
export const SECCIONES_ENCARGO = ["marketing", "instagram_agencia"] as const;

/**
 * Reels: el trabajador de render (sección propia «instagram_render», A6 de la
 * evaluación) o alguien de Marketing. Luego se exige haber procesado o creado
 * el trabajo.
 */
export const SECCIONES_REEL = ["instagram_render", "marketing"] as const;

/** Secciones con las que se puede pedir un aviso de ese tipo (con «Editar» en las de Instagram). */
export function seccionesDeTipo(tipo: TipoTrabajo): readonly string[] {
  if (tipo === "encargo") return SECCIONES_ENCARGO;
  if (tipo === "reel") return SECCIONES_REEL;
  return [seccionDeTipo(tipo)];
}

/**
 * Todo exige «Editar» (can_edit_section): Instagram desde 20261111000000 y la carta
 * (vídeos y recortes) desde 20261106500000 (06/11/2026: con solo «Ver» la carta se
 * consulta; los trabajos de vídeo y recorte ya solo los lee quien la edita).
 */
export function modoPermisoDeTipo(_tipo: TipoTrabajo): "editar" {
  return "editar";
}

/** Cliente mínimo (supabase-js con service role) para marcar el aviso. */
export interface ClienteAviso {
  from: (tabla: string) => {
    update: (v: Record<string, unknown>) => {
      eq: (c: string, v: string) => {
        is: (c: string, v: null) => { select: (c: string) => PromiseLike<{ data: unknown[] | null; error: { message?: string; code?: string } | null }> };
      };
    };
  };
}

/**
 * Marca el evento como avisado SOLO si no lo estaba (UPDATE … WHERE
 * notificado_at IS NULL): la primera llamada gana y las siguientes no mandan
 * nada (B4 de la evaluación). Si la columna aún no existe (migración
 * 20261111000000 sin aplicar), deja avisar como antes.
 */
export async function reclamarAvisoEncargo(admin: ClienteAviso, eventoId: string, ahora = new Date()): Promise<"avisar" | "ya_avisado"> {
  const { data, error } = await admin
    .from("instagram_encargo_eventos")
    .update({ notificado_at: ahora.toISOString() })
    .eq("id", eventoId)
    .is("notificado_at", null)
    .select("id");
  if (error) return /notificado_at|42703|PGRST204/.test(`${error.code ?? ""} ${error.message ?? ""}`) ? "avisar" : "ya_avisado";
  return Array.isArray(data) && data.length > 0 ? "avisar" : "ya_avisado";
}

/** Un aviso solo se puede pedir poco después del evento (no se reenvían avisos viejos). */
export const VIDA_AVISO_ENCARGO_MS = 15 * 60_000;

/** Acciones que avisan a la otra parte. */
export const ACCIONES_PUSH_ENCARGO = [
  "enviar", "reenviar", "aceptar", "rechazar", "empezar", "entregar", "pedir_cambios", "aprobar", "cancelar", "comentar",
] as const;

export interface EventoEncargoNotificable {
  id: string;
  encargo_id: string;
  actor: string | null;
  lado: string;
  accion: string;
  a_estado: string | null;
  comentario: string | null;
  created_at: string;
}

export interface EncargoNotificable {
  id: string;
  numero: number | null;
  titulo: string | null;
}

/** `evento_id` del cuerpo (o `trabajo_id`, por si se reutiliza el nombre). */
export function leerEventoId(cuerpo: unknown): string | null {
  const c = cuerpo as { evento_id?: unknown; trabajo_id?: unknown } | null;
  const id = c?.evento_id ?? c?.trabajo_id;
  return typeof id === "string" && UUID.test(id) ? id : null;
}

/** Solo avisa quien hizo el cambio, en los 15 minutos siguientes y de una acción que se avisa. */
export function autorizarNotificacionEncargo(ev: EventoEncargoNotificable, userId: string, ahora = Date.now()): Autorizacion {
  if (!ev.actor || ev.actor !== userId) return { ok: false, status: 403, error: "Este cambio no lo has hecho tú" };
  const cuando = Date.parse(ev.created_at);
  if (!Number.isFinite(cuando) || ahora - cuando > VIDA_AVISO_ENCARGO_MS) {
    return { ok: false, status: 409, error: "Ese aviso ya ha caducado" };
  }
  if (!(ACCIONES_PUSH_ENCARGO as readonly string[]).includes(ev.accion)) {
    return { ok: false, status: 409, error: "Ese cambio no lleva aviso" };
  }
  return { ok: true };
}

/** «ENC-0007». */
export function referenciaEncargo(numero: number | null | undefined): string {
  return typeof numero === "number" && Number.isFinite(numero) ? `ENC-${String(numero).padStart(4, "0")}` : "Encargo";
}

const TITULO_ACCION: Record<string, string> = {
  enviar: "Encargo nuevo",
  reenviar: "Encargo reenviado",
  aceptar: "Oficiosos aceptó el encargo",
  rechazar: "Oficiosos no puede hacer el encargo",
  empezar: "Oficiosos está con el encargo",
  entregar: "Encargo listo para revisar",
  pedir_cambios: "Piden cambios en el encargo",
  aprobar: "Encargo aprobado",
  cancelar: "Encargo cancelado",
  comentar: "Mensaje nuevo en el encargo",
};

export function construirCargaEncargo(ev: EventoEncargoNotificable, enc: EncargoNotificable | null): CargaPush {
  const encargoId = enc?.id ?? ev.encargo_id;
  const nombre = enc?.titulo?.trim() || "sin título";
  const detalle = ev.comentario?.trim() ? `: ${ev.comentario.trim()}` : "";
  return {
    titulo: TITULO_ACCION[ev.accion] ?? "Encargo de Instagram",
    cuerpo: `${referenciaEncargo(enc?.numero)} · ${nombre}${detalle}`.slice(0, 180),
    url: `/instagram?tab=encargos&encargo=${encodeURIComponent(encargoId)}`,
    tag: `encargo-${encargoId}`,
    trabajo_id: ev.id,
    plato_id: encargoId,
    estado: ev.accion === "rechazar" || ev.accion === "cancelar" ? "error" : "listo",
  };
}
