// ============================================================================
// PROPUESTA AL CLIENTE (solicitud del bot -> correo -> aceptación) — lógica
// pura para el panel. Backend: migración 20260923210000_solicitud_propuesta_
// espacio.sql + supabase/functions/emails-reserva/propuesta-solicitud.ts.
// ============================================================================

export type EstadoPropuesta = "borrador" | "enviada" | "aceptada" | "rechazada" | "caducada";

export interface SolicitudConPropuesta {
  estado: string;
  email: string | null;
  fecha_solicitada: string | null;
  hora_solicitada: string | null;
  numero_comensales: number | null;
  propuesta_estado?: string | null;
  propuesta_enviada_at?: string | null;
  propuesta_respondida_at?: string | null;
  propuesta_respuesta_via?: string | null;
  propuesta_error?: string | null;
}

/** La migración de propuesta está aplicada si la fila trae `propuesta_estado`
 * (se lee con select("*"), así que la columna simplemente no viene si no). */
export function tieneColumnasPropuesta(s: object | null | undefined): boolean {
  return !!s && "propuesta_estado" in s;
}

const dd = (n: number) => String(n).padStart(2, "0");

/** "23/09 21:05" en hora local del navegador. */
export function fechaHoraCorta(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${dd(d.getDate())}/${dd(d.getMonth() + 1)} ${dd(d.getHours())}:${dd(d.getMinutes())}`;
}

export interface EstadoPropuestaVista {
  clave: EstadoPropuesta;
  etiqueta: string;
  /** Texto largo para el diálogo. */
  detalle: string;
  tono: "neutro" | "info" | "exito" | "aviso" | "peligro";
}

/**
 * Estado a mostrar. `hoy` = "yyyy-MM-dd". Una propuesta enviada cuyo día ya
 * pasó se muestra "Caducada" aunque la BD aún diga 'enviada' (no hay cron:
 * la BD la marca caducada si el cliente intenta aceptarla).
 */
export function estadoPropuestaVista(s: SolicitudConPropuesta, hoy: string): EstadoPropuestaVista | null {
  if (!tieneColumnasPropuesta(s)) return null;
  const via = s.propuesta_respuesta_via === "telefono" ? " (por teléfono)" : s.propuesta_respuesta_via === "email" ? " (por email)" : "";
  const fecha = (s.fecha_solicitada ?? "").slice(0, 10);
  let clave = (s.propuesta_estado ?? "borrador") as EstadoPropuesta;
  if (clave === "enviada" && fecha && fecha < hoy) clave = "caducada";
  switch (clave) {
    case "enviada":
      return {
        clave,
        etiqueta: `Propuesta enviada ${fechaHoraCorta(s.propuesta_enviada_at)}`.trim(),
        detalle: "Esperando respuesta del cliente. Si cambias la propuesta, el enlace del correo deja de valer y hay que reenviarla.",
        tono: "info",
      };
    case "aceptada":
      return {
        clave,
        etiqueta: "Aceptada",
        detalle: `El cliente aceptó${via} ${fechaHoraCorta(s.propuesta_respondida_at)}. La reserva ya está creada.`.replace(/\s+\./, "."),
        tono: "exito",
      };
    case "rechazada":
      return {
        clave,
        etiqueta: "Rechazada",
        detalle: `El cliente rechazó la propuesta${via} ${fechaHoraCorta(s.propuesta_respondida_at)}. La solicitud sigue abierta: puedes proponer otra cosa o descartarla.`,
        tono: "peligro",
      };
    case "caducada":
      return {
        clave,
        etiqueta: "Caducada",
        detalle: "El día propuesto ya pasó sin respuesta del cliente.",
        tono: "aviso",
      };
    default:
      return {
        clave: "borrador",
        etiqueta: "Borrador",
        detalle: "La propuesta aún no se ha enviado al cliente.",
        tono: "neutro",
      };
  }
}

export type MotivoNoEnviar =
  | "sin_migracion"
  | "cerrada"
  | "aceptada"
  | "sin_email"
  | "incompleta"
  | "fecha_pasada";

export const TEXTO_MOTIVO_NO_ENVIAR: Record<MotivoNoEnviar, string> = {
  sin_migracion: "Para enviar propuestas hay que aplicar antes la migración 20260923210000 en Supabase.",
  cerrada: "La solicitud ya está resuelta o descartada.",
  aceptada: "El cliente ya aceptó: la reserva existe.",
  sin_email: "El cliente no dejó email: llámale y, si acepta, registra la aceptación aquí.",
  incompleta: "Elige día, hora y comensales.",
  fecha_pasada: "El día propuesto ya ha pasado.",
};

/** Por qué no se puede enviar el correo de propuesta (null = se puede). */
export function motivoNoEnviar(s: SolicitudConPropuesta, hoy: string): MotivoNoEnviar | null {
  if (!tieneColumnasPropuesta(s)) return "sin_migracion";
  if (s.propuesta_estado === "aceptada") return "aceptada";
  if (s.estado === "resuelta" || s.estado === "descartada") return "cerrada";
  if (!(s.email ?? "").trim()) return "sin_email";
  if (!s.fecha_solicitada || !s.hora_solicitada || !(Number(s.numero_comensales) > 0)) return "incompleta";
  if (s.fecha_solicitada.slice(0, 10) < hoy) return "fecha_pasada";
  return null;
}

/** Mensaje para el personal a partir del `error` de fn_aceptar/rechazar. */
export function mensajeErrorPropuesta(error: string | null | undefined, detalle?: string | null): string {
  switch (error) {
    case "sin_aforo":
      return "No hay aforo en ese turno: la base de datos no deja crear la reserva. Cambia la hora o el día.";
    case "fecha_pasada":
      return "El día propuesto ya ha pasado. Cambia la fecha.";
    case "propuesta_incompleta":
      return "Faltan día, hora o comensales en la propuesta.";
    case "solicitud_cerrada":
      return "La solicitud ya está resuelta o descartada.";
    case "ya_aceptada":
      return "El cliente ya había aceptado esta propuesta.";
    case "no_encontrada":
      return "No se encontró la solicitud (¿la han borrado?).";
    case "propuesta_no_vigente":
      return "La propuesta ha cambiado desde que se envió.";
    case "datos_invalidos":
      return `La base de datos rechazó la reserva${detalle ? `: ${detalle}` : "."}`;
    default:
      return `No se pudo completar la operación${detalle ? `: ${detalle}` : error ? ` (${error})` : "."}`;
  }
}

/** Error de PostgREST/Postgres por columna o función que aún no existe
 * (migración sin aplicar). */
export function esErrorEsquemaPendiente(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (["PGRST204", "PGRST202", "42703", "42883"].includes(code)) return true;
  return /column .* does not exist|could not find the .* (column|function)/i.test(error.message ?? "");
}
