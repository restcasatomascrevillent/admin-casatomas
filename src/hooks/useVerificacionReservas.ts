// ============================================================================
// VERIFICACIÓN DE RESERVAS
// ============================================================================
// Piezas de la pantalla "Verificar solicitud" (Lista/Hoy + ModalVerificacionReserva):
// el cliente pide una hora y el restaurante le devuelve la hora que puede
// darle, o rechaza la solicitud. NO hay negociación ni ida y vuelta: una sola
// respuesta (decisión del dueño, 2026-09-29).
//
// QUÉ HAY AQUÍ Y QUÉ YA NO (paso 2 del refactor de acciones de reservas)
// ----------------------------------------------------------------------------
// Las FUNCIONES QUE ESCRIBÍAN en `reservas` (`aceptarComoSolicitado`,
// `verificarConHoraYSala`, `rechazarReserva`, `aceptarVariasComoSolicitado`) ya no
// están aquí: son acciones del único ejecutor de acciones sobre una reserva,
// `useAccionesServicioReserva` (`aceptar`, `verificar`, `rechazar`, `aceptarVarias`), que
// comprueba que la escritura de verdad se ha guardado (con RLS una denegación NO da
// error, da 0 filas), la condiciona al estado de partida, refresca la caché y avisa al
// cliente con UNA sola forma de llamar a `notify-reservation-change`. Qué hace cada una
// está declarado en `src/lib/reservas/accionesEjecutables.ts`.
//
// Lo que sigue aquí:
//   · los tipos y las piezas PURAS (`src/lib/reservas/verificacion.ts`), reexportados para
//     que el modal, la lista y los tests sigan importando de este módulo;
//   · `difiereSolicitudDeOferta`, que lee la regla del correo real (no la copia);
//   · `notificarCambioReserva`, que usa también el alta del panel (FormularioReserva) para
//     mandar «Confirma tu reserva».
//
// Contrato con el backend: ver `src/lib/reservas/verificacion.ts` y
// supabase/functions/emails-reserva/index.ts (NO tocado por este encargo — es de otro
// agente). LA SALA NO SALE EN EL CORREO DEL CLIENTE (punto 7 del contrato de
// `emails-reserva/plantillas.ts`, decisión del dueño 2026-09-28): es una asignación
// INTERNA del restaurante. Por eso `difiereSolicitudDeOferta` reutiliza
// `hayContraoferta()` de esa misma Edge Function en vez de tener su propia copia de la
// regla — ver su docstring.
// ============================================================================
import { notificarYAvisarSiFalla } from "@/lib/reservas/notificarCliente";
// Misma regla que decide el correo real, importada — no copiada. El panel ya
// importa de `supabase/functions/` en 10 sitios (`_shared/disponibilidad`,
// `emails-reserva/plantillas` desde la vista previa de correos); estos
// ficheros son puros por contrato y no tocan `Deno.*` ni red.
import { hayContraoferta } from "../../supabase/functions/emails-reserva/plantillas";
import type { ReservaParaVerificar } from "@/lib/reservas/verificacion";

export {
  MENSAJE_MIGRACION_PENDIENTE,
  avisoAlCliente,
  esErrorMigracionReservasFaltante,
  objetivoAceptarComoSolicitado,
  type CambiosVerificacion,
  type ReservaParaVerificar,
} from "@/lib/reservas/verificacion";

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

/**
 * Notifica el cambio de estado (dispara el correo que toque). No espera la respuesta
 * —devuelve `void` al momento—, pero SÍ la comprueba: si el correo no sale, avisa al
 * personal (la reserva ya está guardada y eso no se toca). Es la misma llamada que hacen
 * todas las acciones de reserva (`src/lib/reservas/notificarCliente.ts`). También la usa
 * el alta del panel (FormularioReserva) para mandar «Confirma tu reserva».
 */
export function notificarCambioReserva<T extends object>(reservaId: string, cambios: T): void {
  void notificarYAvisarSiFalla(reservaId, cambios);
}
