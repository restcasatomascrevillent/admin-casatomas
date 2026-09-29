// ============================================================================
// PROPUESTA AL CLIENTE DESDE UNA SOLICITUD DEL BOT — lógica pura (sin I/O)
// ============================================================================
// Flujo (ver migración 20260923210000_solicitud_propuesta_espacio.sql):
//   panel "Enviar propuesta"  -> POST /enviar-propuesta-solicitud
//   correo con 2 botones      -> web del negocio /reserva/respuesta?token=... (pantalla "¿confirmas?")
//                                POST /enlace/consultar (no muta) y, tras el clic,
//                                POST /enlace/ejecutar -> fn_aceptar_propuesta_solicitud
//                                                      o fn_rechazar_propuesta_solicitud
//                                (ver enlaces-web.ts; los GET /propuesta/... antiguos redirigen a la web)
//
// Reutiliza de la contraoferta: plantilla 'propuesta', firma HMAC (tokens.ts)
// y envío con Idempotency-Key. Diferencias:
//   · El sujeto del token es la SOLICITUD (acciones propias
//     'aceptar_solicitud'/'rechazar_solicitud': un token de solicitud nunca
//     vale en /aceptar de reservas ni al revés).
//   · Huella = v2|fecha|hora|pax|enviada_at (segundos): cualquier cambio de
//     la propuesta o un reenvío invalida el enlace anterior. La sala NO entra
//     (reservas-sin-salas): es interna y asignarla no rompe el enlace. Los
//     enlaces antiguos (fecha|hora|pax|sala|enviada_at) siguen valiendo
//     ignorando la sala hasta que caducan (ver huellaSolicitudCoincide).
//   · Sin fila en envios_email_reserva (su reserva_id es NOT NULL y la reserva
//     aún no existe): no hay reintento automático; el panel ve el error al
//     momento y el personal reintenta.
// Importable desde vitest (sin sintaxis Deno).
// ============================================================================

import type { DatosReservaParaCorreo } from "./plantillas.ts";
import { resolverMarcaPorNotas, NEGOCIO_POR_DEFECTO, esMarcaValida, type Marca } from "../reservas-web/plantillas.ts";

export interface SolicitudParaPropuesta {
  id: string;
  nombre: string | null;
  telefono: string | null;
  email: string | null;
  fecha_solicitada: string | null;
  hora_solicitada: string | null;
  numero_comensales: number | null;
  notas_internas: string | null;
  estado: string;
  espacio_propuesto_id?: string | null;
  propuesta_estado?: string | null;
  propuesta_enviada_at?: string | null;
  /** Texto del cliente; el formulario de El Reservado (web de Touza) lo
   * empieza con "Solicitud de El Reservado". */
  notas_cliente?: string | null;
  /** Negocio guardado (migración 20260930100000). Ausente si la migración
   * aún no está aplicada: entonces se deduce como antes. */
  marca?: string | null;
}

/**
 * Negocio de una solicitud: la columna `marca` si viene y es válida
 * (20260930100000, la misma que lee `fn_aceptar_propuesta_solicitud`). Si no
 * (migración sin aplicar), la regla antigua: el de la sala propuesta
 * (`marcaEspacioPropuesto` = su `caracteristicas.marca`); si no, el marcador
 * de El Reservado en las notas; si no, Casa Tomás.
 */
export function marcaDeSolicitudParaCorreo(
  s: Pick<SolicitudParaPropuesta, "espacio_propuesto_id" | "notas_cliente" | "marca">,
  marcaEspacioPropuesto: unknown,
): Marca {
  if (esMarcaValida(s.marca)) return s.marca;
  if (s.espacio_propuesto_id) return esMarcaValida(marcaEspacioPropuesto) ? marcaEspacioPropuesto : NEGOCIO_POR_DEFECTO;
  return resolverMarcaPorNotas(s.notas_cliente ?? null) ?? NEGOCIO_POR_DEFECTO;
}

export type ErrorEnvioPropuesta =
  | "migracion_pendiente"
  | "solicitud_cerrada"
  | "ya_aceptada"
  | "sin_email"
  | "email_invalido"
  | "propuesta_incompleta"
  | "fecha_pasada";

export const MENSAJE_ERROR_ENVIO: Record<ErrorEnvioPropuesta, string> = {
  migracion_pendiente:
    "Falta aplicar la migración 20260923210000_solicitud_propuesta_espacio.sql en Supabase.",
  solicitud_cerrada: "La solicitud ya está resuelta o descartada.",
  ya_aceptada: "El cliente ya aceptó esta propuesta: la reserva existe.",
  sin_email: "El cliente no dejó email. Llámale y registra su respuesta desde el panel.",
  email_invalido: "El email de la solicitud no parece válido.",
  propuesta_incompleta: "Faltan día, hora o comensales en la propuesta.",
  fecha_pasada: "El día propuesto ya ha pasado.",
};

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function horaCorta(hora: string | null | undefined): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hora ?? "").trim());
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function fechaIso(fecha: string | null | undefined): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(fecha ?? ""));
  return m ? m[1] : null;
}

/** Epoch en segundos de un timestamptz, tolerante al formato de Postgres
 * ("2026-09-23 21:00:00.123+00") y al de JS ("...Z"). */
export function epochSegundos(iso: string | null | undefined): number | null {
  if (!iso) return null;
  // "+00" (sin minutos) no lo entiende Date.parse -> "+00:00".
  const normalizado = String(iso).trim().replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const t = Date.parse(normalizado);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

/** Validación previa al envío. `hoy` = "yyyy-MM-dd" en Madrid. */
export function validarSolicitudParaEnvio(s: SolicitudParaPropuesta, hoy: string): ErrorEnvioPropuesta | null {
  if (s.propuesta_estado === undefined) return "migracion_pendiente";
  if (s.propuesta_estado === "aceptada") return "ya_aceptada";
  if (s.estado === "resuelta" || s.estado === "descartada") return "solicitud_cerrada";
  const email = (s.email ?? "").trim();
  if (!email) return "sin_email";
  if (!RE_EMAIL.test(email)) return "email_invalido";
  const fecha = fechaIso(s.fecha_solicitada);
  if (!fecha || !horaCorta(s.hora_solicitada) || !(Number(s.numero_comensales) > 0)) return "propuesta_incompleta";
  if (fecha < hoy) return "fecha_pasada";
  return null;
}

interface DatosHuellaSolicitud {
  fecha_solicitada: string | null;
  hora_solicitada: string | null;
  numero_comensales: number | null;
  espacio_propuesto_id?: string | null;
  propuesta_enviada_at?: string | null;
}

/** Las cuatro partes que SÍ identifican la propuesta: fecha, HH:MM, pax y
 * envío (epoch s). La sala no (reservas-sin-salas). */
function partesHuellaSolicitud(s: DatosHuellaSolicitud): [string, string, string, string] {
  return [
    fechaIso(s.fecha_solicitada) ?? "",
    horaCorta(s.hora_solicitada) ?? "",
    String(Number(s.numero_comensales) || 0),
    String(epochSegundos(s.propuesta_enviada_at) ?? ""),
  ];
}

/** v2|fecha|HH:MM|pax|enviada(epoch s). Pura. La sala propuesta NO entra. */
export function huellaPropuestaSolicitud(s: DatosHuellaSolicitud): string {
  return ["v2", ...partesHuellaSolicitud(s)].join("|");
}

/**
 * ¿La huella del token sigue casando con la solicitud actual?
 *  - v2: igualdad estricta con `huellaPropuestaSolicitud`.
 *  - legado (`fecha|HH:MM|pax|sala|enviada`, enlaces firmados antes de
 *    reservas-sin-salas): exactamente 5 partes; se comparan la 0, 1, 2 y 4 y
 *    se ignora la sala (parte 3). Deja de aplicarse sola cuando caducan (TTL
 *    14 días, tokens.ts). TODO(reservas-sin-salas): quitar a despliegue + 15 d.
 */
export function huellaSolicitudCoincide(fpToken: string, s: DatosHuellaSolicitud): boolean {
  const fp = fpToken ?? "";
  if (fp.startsWith("v2|")) return fp === huellaPropuestaSolicitud(s);
  const legado = fp.split("|");
  if (legado.length !== 5) return false;
  const [fecha, hora, pax, enviada] = partesHuellaSolicitud(s);
  return legado[0] === fecha && legado[1] === hora && legado[2] === pax && legado[4] === enviada;
}

const RE_PETICION_ORIGINAL = /\[Petición original del cliente: (\S+) (\S+), (\S+) pax\]/;

/** Hora que pidió el cliente, leída de la línea que el panel antepone a
 * notas_internas al cambiar la propuesta (src/lib/reservas/solicitudPropuesta.ts). */
export function horaOriginalDeNotas(notas: string | null | undefined): string | null {
  const m = RE_PETICION_ORIGINAL.exec(notas ?? "");
  return m ? horaCorta(m[2]) : null;
}

/** Datos para renderPlantilla('propuesta'). La sala no se compara (el
 * cliente nunca pidió una), la hora sí: si cambió, sale "Solicitado/Ofrecido". */
export function datosCorreoPropuestaSolicitud(
  s: SolicitudParaPropuesta,
  nombreEspacio: string | null,
  urls: { aceptar: string; rechazar: string },
): DatosReservaParaCorreo {
  const hora = horaCorta(s.hora_solicitada) ?? "";
  return {
    nombre: s.nombre || "Cliente",
    fecha: fechaIso(s.fecha_solicitada) ?? "",
    hora,
    comensales: Number(s.numero_comensales) || 0,
    espacio: nombreEspacio,
    horaSolicitada: horaOriginalDeNotas(s.notas_internas) ?? hora,
    espacioSolicitado: nombreEspacio,
    botonPrincipalUrl: urls.aceptar,
    botonSecundarioUrl: urls.rechazar,
  };
}

export function claveIdempotenciaPropuestaSolicitud(solicitudId: string, enviadaEpoch: number): string {
  return `propuesta-solicitud-${solicitudId}-${enviadaEpoch}`;
}

/** Resultado de fn_aceptar_propuesta_solicitud -> qué página ve el cliente. */
export type PaginaTrasAceptar = "confirmada" | "recibida" | "sin_aforo" | "fecha_pasada" | "no_vigente" | "error";

export function paginaTrasAceptar(res: { ok?: boolean; error?: string; estado?: string } | null): PaginaTrasAceptar {
  if (!res) return "error";
  if (res.ok) return res.estado === "pendiente" ? "recibida" : "confirmada";
  switch (res.error) {
    case "sin_aforo":
      return "sin_aforo";
    case "fecha_pasada":
      return "fecha_pasada";
    case "propuesta_no_vigente":
    case "solicitud_cerrada":
    case "no_encontrada":
      return "no_vigente";
    default:
      return "error";
  }
}
