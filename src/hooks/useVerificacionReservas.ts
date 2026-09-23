// ============================================================================
// VERIFICACIÓN DE RESERVAS CON CONTRAOFERTA
// ============================================================================
// Operaciones de la pantalla "Verificar solicitud" (Lista/Hoy + ModalVerificacionReserva):
// aceptar tal cual lo pidió el cliente (un clic), ofrecerle otra hora/zona
// (contraoferta) o rechazar la solicitud.
//
// Contrato con el backend (ver supabase/functions/emails-reserva/index.ts,
// NO tocado por este encargo — es de otro agente):
//   - `reservas.hora` / `reservas.espacio_id`           = lo VIGENTE / ofrecido.
//   - `reservas.hora_solicitada` / `espacio_solicitado_id` = snapshot INMUTABLE
//     de lo que pidió el cliente (lo rellena un trigger BEFORE INSERT, nunca
//     se escribe desde aquí).
//   - `tipoEmailParaEstado`: pendiente->solicitud_recibida, verificada->propuesta,
//     confirmada->confirmada, cancelada->rechazada. Por eso basta con cambiar
//     `estado` (+ hora/espacio_id si hay contraoferta) y avisar a
//     `notify-reservation-change`: el correo con la comparación "pediste
//     X, te ofrecemos Y" lo arma esa función a partir de estas mismas columnas.
//
// La migración 20260920010000_sistema_emails_reserva.sql que añade
// hora_solicitada/espacio_solicitado_id NO está aplicada todavía (a propósito,
// no es de este encargo tocarla). Todo lo de aquí developea CONTRA el
// contrato ya asumiendo que existen, y traduce el error de Postgres/PostgREST
// a un mensaje legible si no — mismo patrón que
// `useConfiguracionTurnos.ts` (esErrorColumnaEscaleraFaltante / relanzarErrorEscalera).
// ============================================================================
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
}

export interface CambiosVerificacion {
  hora: string;
  espacio_id: string | null;
  estado: "verificada" | "cancelada";
}

const MENSAJE_MIGRACION_PENDIENTE =
  "No se pudo guardar: falta aplicar la migración pendiente de contraoferta (hora_solicitada/espacio_solicitado_id) en la base de datos. Pide que se aplique y vuelve a intentarlo.";

/**
 * ¿El error viene de que la migración de contraoferta no está aplicada?
 * Cubre columna ausente en SELECT/UPDATE (42703, PGRST204) y "no encontrada
 * en el caché de esquema" de PostgREST (PGRST203), además de un mensaje que
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

function mensajeDeErrorReserva(error: unknown, prefijo: string): string {
  if (esErrorMigracionReservasFaltante(error)) return MENSAJE_MIGRACION_PENDIENTE;
  const mensaje = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
  return `${prefijo}: ${mensaje}`;
}

/** "13:00:00" | "13:00" -> "13:00". */
function horaCorta(hora: string | null | undefined): string {
  return (hora ?? "").slice(0, 5);
}

/**
 * ¿Lo que se ofrece hoy (hora/espacio_id) difiere de lo que pidió el
 * cliente? Si `hora_solicitada`/`espacio_solicitado_id` no existen todavía
 * (migración sin aplicar, o fila anterior a ella) se asume que no hay
 * contraoferta — no se puede afirmar una diferencia que no se puede leer.
 */
export function difiereSolicitudDeOferta(reserva: ReservaParaVerificar): boolean {
  if (reserva.hora_solicitada == null && reserva.espacio_solicitado_id === undefined) return false;
  const difiereHora = horaCorta(reserva.hora_solicitada) !== horaCorta(reserva.hora);
  const difiereEspacio = (reserva.espacio_solicitado_id ?? null) !== (reserva.espacio_id ?? null);
  return difiereHora || difiereEspacio;
}

/** A qué hora/espacio equivale "aceptar tal cual lo pedido". */
export function objetivoAceptarComoSolicitado(reserva: ReservaParaVerificar): { hora: string; espacio_id: string | null } {
  return {
    hora: reserva.hora_solicitada ?? reserva.hora,
    espacio_id: reserva.espacio_solicitado_id !== undefined ? reserva.espacio_solicitado_id : (reserva.espacio_id ?? null),
  };
}

/** Notifica el cambio de estado (dispara el correo que toque). Fire-and-forget, best-effort — igual que ya hacían ModalVerificacionReserva.tsx y ListaReservasAvanzada.tsx. También lo usa el alta del panel (FormularioReserva) para mandar "Confirma tu reserva". */
export function notificarCambioReserva<T extends object>(reservaId: string, cambios: T): void {
  supabase.functions
    .invoke("notify-reservation-change", { body: { id: reservaId, ...cambios } })
    .catch((err) => console.error("Error notificando cambio de reserva:", err));
}

interface OpcionesAccion {
  /** No mostrar toast individual (para acciones en bloque, que muestran un resumen). */
  silencioso?: boolean;
}

async function actualizarReserva(
  id: string,
  cambios: CambiosVerificacion,
): Promise<{ ok: boolean; error: string | null }> {
  // `cambios` es un tipo con forma cerrada (sin índice), así que se pasa por
  // variable en vez de literal — y por eso necesita `as any` para calzar con
  // el `Update` generado, igual que ya hace useConfiguracionTurnos.ts con
  // sus propios payloads de columnas nuevas/estrictas.
  //
  // Un solo shape con `error` SIEMPRE presente (en vez de la unión
  // discriminada `{ok:true}|{ok:false,error}` que tenía esto antes) a
  // propósito: con `strict:false`/`strictNullChecks:false`
  // (tsconfig.app.json de este proyecto) el compilador no estrecha bien una
  // unión discriminada por un booleano literal — `if (!resultado.ok)
  // resultado.error` seguía viendo la unión completa y marcaba `error` como
  // inexistente (comprobado con un repro aislado). Un solo shape sin ramas
  // evita depender de ese estrechamiento.
  const { error } = await supabase.from("reservas").update(cambios as any).eq("id", id);
  if (error) return { ok: false, error: mensajeDeErrorReserva(error, "No se pudo guardar") };
  return { ok: true, error: null };
}

/** Un clic: acepta la reserva exactamente como la pidió el cliente. */
export async function aceptarComoSolicitado(
  reserva: ReservaParaVerificar,
  opciones: OpcionesAccion = {},
): Promise<{ ok: boolean; cambios?: CambiosVerificacion }> {
  const objetivo = objetivoAceptarComoSolicitado(reserva);
  const cambios: CambiosVerificacion = { ...objetivo, estado: "verificada" };
  const resultado = await actualizarReserva(reserva.id, cambios);

  if (!resultado.ok) {
    if (!opciones.silencioso) toast.error(resultado.error ?? "No se pudo guardar la reserva");
    return { ok: false };
  }

  if (!opciones.silencioso) toast.success(`Reserva de ${reserva.nombre || "cliente"} aceptada tal y como se pidió`);
  notificarCambioReserva(reserva.id, cambios);
  return { ok: true, cambios };
}

/** Verifica la reserva ofreciendo una hora/zona distinta a la solicitada (contraoferta). */
export async function verificarConContraoferta(
  reserva: ReservaParaVerificar,
  oferta: { hora: string; espacio_id: string | null },
  opciones: OpcionesAccion = {},
): Promise<{ ok: boolean; cambios?: CambiosVerificacion }> {
  const cambios: CambiosVerificacion = { ...oferta, estado: "verificada" };
  const resultado = await actualizarReserva(reserva.id, cambios);

  if (!resultado.ok) {
    if (!opciones.silencioso) toast.error(resultado.error ?? "No se pudo guardar la propuesta");
    return { ok: false };
  }

  if (!opciones.silencioso) toast.success("Propuesta enviada por correo al cliente");
  notificarCambioReserva(reserva.id, cambios);
  return { ok: true, cambios };
}

/** Rechaza la solicitud/reserva: pasa a cancelada y dispara el correo de rechazo. */
export async function rechazarReserva(
  reserva: ReservaParaVerificar,
  opciones: OpcionesAccion = {},
): Promise<{ ok: boolean; cambios?: Pick<CambiosVerificacion, "estado"> }> {
  const { error } = await supabase.from("reservas").update({ estado: "cancelada" }).eq("id", reserva.id);

  if (error) {
    if (!opciones.silencioso) toast.error(mensajeDeErrorReserva(error, "No se pudo rechazar la solicitud"));
    return { ok: false };
  }

  if (!opciones.silencioso) toast.success("Solicitud rechazada");
  notificarCambioReserva(reserva.id, { estado: "cancelada" });
  return { ok: true, cambios: { estado: "cancelada" } };
}

/** Acción en bloque: aceptar varias solicitudes tal cual, con un único toast de resumen. */
export async function aceptarVariasComoSolicitado(
  reservas: ReservaParaVerificar[],
): Promise<{ ok: Map<string, CambiosVerificacion>; fallidas: string[] }> {
  const resultados = await Promise.all(
    reservas.map(async (r) => ({ id: r.id, ...(await aceptarComoSolicitado(r, { silencioso: true })) })),
  );

  const ok = new Map<string, CambiosVerificacion>();
  const fallidas: string[] = [];
  for (const r of resultados) {
    if (r.ok && r.cambios) ok.set(r.id, r.cambios);
    else fallidas.push(r.id);
  }

  if (ok.size > 0) toast.success(`${ok.size} solicitud${ok.size === 1 ? "" : "es"} aceptada${ok.size === 1 ? "" : "s"}`);
  if (fallidas.length > 0) toast.error(`${fallidas.length} solicitud${fallidas.length === 1 ? "" : "es"} no se pudo${fallidas.length === 1 ? "" : "ieron"} aceptar`);

  return { ok, fallidas };
}
