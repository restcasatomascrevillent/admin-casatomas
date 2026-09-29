// ============================================================================
// VERIFICACIÓN DE RESERVAS
// ============================================================================
// Operaciones de la pantalla "Verificar solicitud" (Lista/Hoy + ModalVerificacionReserva):
// el cliente pide una hora y el restaurante le devuelve la hora que puede
// darle, o rechaza la solicitud. NO hay negociación ni ida y vuelta: una sola
// respuesta (decisión del dueño, 2026-09-29).
//
// Contrato con el backend (ver supabase/functions/emails-reserva/index.ts,
// NO tocado por este encargo — es de otro agente):
//   - `reservas.hora` / `reservas.espacio_id`           = lo VIGENTE.
//   - `reservas.hora_solicitada` / `espacio_solicitado_id` = snapshot INMUTABLE
//     de lo que pidió el cliente (lo rellena un trigger BEFORE INSERT, nunca
//     se escribe desde aquí). Los nombres de columna siguen hablando de
//     "solicitado" y la función del correo sigue llamándose `hayContraoferta`:
//     son nombres de base de datos y de Edge Function, no texto de pantalla.
//   - `tipoEmailParaEstado`: pendiente->solicitud_recibida, verificada->propuesta,
//     confirmada->confirmada, cancelada->rechazada. Por eso basta con cambiar
//     `estado` (+ hora/espacio_id) y avisar a `notify-reservation-change`: el
//     correo con la comparación "pediste X, te damos Y" lo arma esa función a
//     partir de estas mismas columnas.
//
// LA SALA NO SALE EN EL CORREO DEL CLIENTE (punto 7 del contrato de
// `emails-reserva/plantillas.ts`, decisión del dueño 2026-09-28): es una
// asignación INTERNA del restaurante. Por eso `difiereSolicitudDeOferta`
// reutiliza `hayContraoferta()` de esa misma Edge Function en vez de tener su
// propia copia de la regla — ver su docstring.
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
// Misma regla que decide el correo real, importada — no copiada. El panel ya
// importa de `supabase/functions/` en 10 sitios (`_shared/disponibilidad`,
// `emails-reserva/plantillas` desde la vista previa de correos); estos
// ficheros son puros por contrato y no tocan `Deno.*` ni red.
import { hayContraoferta } from "../../supabase/functions/emails-reserva/plantillas";

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

const MENSAJE_MIGRACION_PENDIENTE =
  "No se pudo guardar: falta aplicar en la base de datos la migración pendiente (hora_solicitada/espacio_solicitado_id). Pide que se aplique y vuelve a intentarlo.";

/**
 * ¿El error viene de que la migración de hora_solicitada no está aplicada?
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
 * ¿La hora vigente difiere de la que pidió el cliente? Es decir: ¿el cliente
 * va a VER una diferencia?
 *
 * MISMO CRITERIO QUE EL CORREO, LITERALMENTE LA MISMA FUNCIÓN. Hasta el
 * 2026-09-29 esto miraba `hora || espacio` mientras `hayContraoferta()` (que
 * decide lo que se pinta en el correo) ya solo miraba la hora: asignarle el
 * Salón a una solicitud de las 14:00 pintaba el panel en ámbar avisando de
 * una diferencia que el cliente no iba a ver por ningún lado, porque la sala
 * no sale en su correo. El panel no puede afirmar algo que el correo no dice.
 *
 * Por eso delega en vez de reimplementar: si mañana el dueño vuelve a enseñar
 * la sala al cliente, cambia `hayContraoferta()` y el panel la sigue sin que
 * nadie tenga que acordarse de este fichero.
 *
 * Si `hora_solicitada` no existe todavía (migración sin aplicar, o fila
 * anterior a ella) no hay diferencia que afirmar — lo resuelve ya la propia
 * `hayContraoferta()`, que devuelve false con `horaSolicitada` null/undefined.
 */
export function difiereSolicitudDeOferta(reserva: ReservaParaVerificar): boolean {
  return hayContraoferta({
    hora: reserva.hora ?? "",
    horaSolicitada: reserva.hora_solicitada,
    // El resto de `DatosReservaParaCorreo` son campos obligatorios del tipo
    // que `hayContraoferta` NO lee (solo compara hora vs horaSolicitada). Se
    // rellenan con lo que tenemos o con valores neutros: es el precio de
    // reutilizar la función en vez de duplicar la regla, y sale mucho más
    // barato que la copia que acabamos de quitar.
    nombre: reserva.nombre ?? "",
    fecha: reserva.fecha ?? "",
    comensales: reserva.numero_comensales ?? 0,
    espacio: null,
  });
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

/**
 * Línea de detalle de los avisos: lo ÚNICO que el camarero no puede
 * comprobar mirando la pantalla es si al cliente le llega el correo. Que
 * acaba de pulsar "Verificar" ya lo sabe; que este cliente no tiene correo y
 * hay que llamarle, no. Sin correo no se manda nada (`emails-reserva` no
 * tiene a dónde enviarlo), así que decirlo aquí evita el fallo de creer que
 * al cliente ya se le ha avisado.
 */
export function avisoAlCliente(reserva: ReservaParaVerificar): string {
  const email = (reserva.email ?? "").trim();
  return email ? `Se le manda el correo a ${email}` : "No tiene correo: hay que avisarle por teléfono";
}

/** Un clic: verifica la reserva con la hora y la sala que ya trae. */
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

  // Título corto (un nombre largo lo partía en dos líneas y quedaba
  // desmañado) + el efecto de verdad debajo, en `description`.
  if (!opciones.silencioso) {
    toast.success(`Reserva verificada para las ${horaCorta(cambios.hora)}`, { description: avisoAlCliente(reserva) });
  }
  notificarCambioReserva(reserva.id, cambios);
  return { ok: true, cambios };
}

/**
 * Verifica la reserva con la hora que se le da al cliente y la sala que se
 * le asigna por dentro. Es el ÚNICO camino de guardado del modal: dé o no dé
 * la hora que pidió, la respuesta del restaurante es una sola (no hay dos
 * botones "aceptar" y "proponer" porque no hay negociación).
 */
export async function verificarConHoraYSala(
  reserva: ReservaParaVerificar,
  decidido: { hora: string; espacio_id: string | null },
  opciones: OpcionesAccion = {},
): Promise<{ ok: boolean; cambios?: CambiosVerificacion }> {
  const cambios: CambiosVerificacion = { ...decidido, estado: "verificada" };
  const resultado = await actualizarReserva(reserva.id, cambios);

  if (!resultado.ok) {
    if (!opciones.silencioso) toast.error(resultado.error ?? "No se pudo guardar la reserva");
    return { ok: false };
  }

  if (!opciones.silencioso) {
    toast.success(`Reserva verificada para las ${horaCorta(cambios.hora)}`, { description: avisoAlCliente(reserva) });
  }
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

  if (!opciones.silencioso) toast.success("Solicitud rechazada", { description: avisoAlCliente(reserva) });
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

  if (ok.size > 0) {
    // Mismo criterio que el aviso individual: lo que hay que contarle es a
    // quién NO se le puede mandar el correo, que es a quien habrá que llamar.
    const sinCorreo = reservas.filter((r) => ok.has(r.id) && !(r.email ?? "").trim()).length;
    toast.success(`${ok.size} solicitud${ok.size === 1 ? "" : "es"} verificada${ok.size === 1 ? "" : "s"}`, {
      description:
        sinCorreo === 0
          ? "Se les manda el correo a todos"
          : `${sinCorreo} sin correo: hay que avisarles por teléfono`,
    });
  }
  if (fallidas.length > 0) {
    toast.error(
      `${fallidas.length} solicitud${fallidas.length === 1 ? "" : "es"} sin verificar`,
      { description: "No se pudieron guardar. Inténtalo otra vez." },
    );
  }

  return { ok, fallidas };
}
