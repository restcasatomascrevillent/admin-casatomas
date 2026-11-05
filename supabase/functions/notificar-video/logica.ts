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

export type TipoTrabajo = "video" | "recorte" | "reel";

/** `tipo` del cuerpo: "recorte", "reel" o, por defecto (compatibilidad), "video". null si viene otro valor. */
export function leerTipo(cuerpo: unknown): TipoTrabajo | null {
  const tipo = (cuerpo as { tipo?: unknown } | null)?.tipo;
  if (tipo === undefined || tipo === null || tipo === "video") return "video";
  if (tipo === "recorte") return "recorte";
  if (tipo === "reel") return "reel";
  return null;
}

/** Sección del panel que hay que poder editar para avisar de cada tipo de trabajo. */
export function seccionDeTipo(tipo: TipoTrabajo): "gestor_carta" | "marketing" {
  return tipo === "reel" ? "marketing" : "gestor_carta";
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
