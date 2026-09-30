// ============================================================================
// VERIFICACIÓN DE RESERVAS — piezas PURAS (tipos, textos y reglas sin I/O).
// ----------------------------------------------------------------------------
// Antes vivían en `src/hooks/useVerificacionReservas.ts`, mezcladas con las
// funciones que escribían en `reservas`. Desde el paso 2 esas funciones son
// acciones del único ejecutor (`useAccionesServicioReserva`: aceptar, verificar,
// rechazar, aceptar en bloque) y lo que queda aquí es lo que NO toca Supabase, para
// que la tabla de acciones (`accionesEjecutables.ts`) pueda leerlo sin arrastrar el
// cliente. `useVerificacionReservas.ts` lo reexporta: quien ya importaba de allí
// (el modal, la lista, los tests) no cambia.
//
// Contrato con el backend (ver supabase/functions/emails-reserva/index.ts):
//   - `reservas.hora` / `reservas.espacio_id`           = lo VIGENTE.
//   - `reservas.hora_solicitada` / `espacio_solicitado_id` = snapshot INMUTABLE de lo
//     que pidió el cliente (lo rellena un trigger BEFORE INSERT, nunca se escribe
//     desde aquí). Los nombres de columna siguen hablando de «solicitado»: son
//     nombres de base de datos, no texto de pantalla.
//   - `tipoEmailParaEstado`: pendiente->solicitud_recibida, verificada->propuesta,
//     confirmada->confirmada, cancelada->rechazada. Por eso basta con cambiar
//     `estado` (+ hora/espacio_id) y avisar a `notify-reservation-change`: el correo
//     con la comparación «pediste X, te damos Y» lo arma esa función a partir de
//     estas mismas columnas.
//
// La migración 20260920010000_sistema_emails_reserva.sql que añade
// hora_solicitada/espacio_solicitado_id puede no estar aplicada: se trabaja
// CONTRA el contrato y se traduce el error de Postgres/PostgREST a un mensaje legible
// si falta (`esErrorMigracionReservasFaltante`).
// ============================================================================

export interface ReservaParaVerificar {
  id: string;
  nombre: string | null;
  telefono: string | null;
  email: string | null;
  fecha: string;
  hora: string;
  numero_comensales: number;
  estado: string;
  notas_cliente: string | null;
  espacio_id: string | null;
  canal?: string | null;
  /** NUEVO (migración 20260920010000, aún no aplicada). Puede faltar. */
  hora_solicitada?: string | null;
  /** NUEVO (migración 20260920010000, aún no aplicada). Puede faltar. */
  espacio_solicitado_id?: string | null;
  /** Negocio (`reservas.marca`): casa_tomas | touza (El Reservado). */
  marca?: string | null;
}

export interface CambiosVerificacion {
  hora: string;
  espacio_id: string | null;
  estado: "verificada" | "cancelada";
}

export const MENSAJE_MIGRACION_PENDIENTE =
  "No se pudo guardar: falta aplicar en la base de datos la migración pendiente (hora_solicitada/espacio_solicitado_id). Pide que se aplique y vuelve a intentarlo.";

/**
 * ¿El error viene de que la migración de hora_solicitada no está aplicada?
 * Cubre columna ausente en SELECT/UPDATE (42703, PGRST204) y «no encontrada
 * en el caché de esquema» de PostgREST (PGRST203), además de un mensaje que
 * mencione literalmente las columnas nuevas.
 */
export function esErrorMigracionReservasFaltante(error: unknown): boolean {
  const mensaje = String((error as { message?: string } | null)?.message ?? "");
  const codigo = String((error as { code?: string } | null)?.code ?? "");
  return (
    codigo === "42703" ||
    codigo === "PGRST204" ||
    codigo === "PGRST203" ||
    /hora_solicitada|espacio_solicitado_id/.test(mensaje)
  );
}

/** "13:00:00" | "13:00" -> "13:00". */
export function horaCorta(hora: string | null | undefined): string {
  return (hora ?? "").slice(0, 5);
}

/** A qué hora/espacio equivale «aceptar tal cual lo pedido». */
export function objetivoAceptarComoSolicitado(
  reserva: Pick<ReservaParaVerificar, "hora" | "hora_solicitada" | "espacio_id" | "espacio_solicitado_id">,
): { hora: string; espacio_id: string | null } {
  return {
    hora: reserva.hora_solicitada ?? reserva.hora,
    espacio_id: reserva.espacio_solicitado_id !== undefined ? reserva.espacio_solicitado_id : (reserva.espacio_id ?? null),
  };
}

/**
 * Línea de detalle de los avisos: lo ÚNICO que el camarero no puede
 * comprobar mirando la pantalla es si al cliente le llega el correo. Que
 * acaba de pulsar «Verificar» ya lo sabe; que este cliente no tiene correo y
 * hay que llamarle, no. Sin correo no se manda nada (`emails-reserva` no
 * tiene a dónde enviarlo), así que decirlo aquí evita el fallo de creer que
 * al cliente ya se le ha avisado.
 */
export function avisoAlCliente(reserva: Pick<ReservaParaVerificar, "email">): string {
  const email = (reserva.email ?? "").trim();
  return email ? `Se le manda el correo a ${email}` : "No tiene correo: hay que avisarle por teléfono";
}
