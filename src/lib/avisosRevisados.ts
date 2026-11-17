// Marcar avisos como revisados y tipos de aviso retirados (11/11/2026, petición del dueño: «cuando
// le das a revisado no va… se llenan de mierda con reserva sin mesa (ese aviso no tiene que salir)»).
import { supabase } from "@/integrations/supabase/client";

/**
 * Tipos de aviso que ya no se crean ni se enseñan. «Reserva sin sala / sin mesas» (el cron
 * `reservas-aviso-sin-asignar`) se quita en 20261124100000; mientras esa migración no esté aplicada
 * en un entorno, el panel ya no los pinta.
 */
export const TIPOS_AVISO_RETIRADOS: readonly string[] = ["reserva_sin_asignar"];
export const avisoRetirado = (tipo: string | null | undefined): boolean => !!tipo && TIPOS_AVISO_RETIRADOS.includes(tipo);

/**
 * Marca avisos como revisados con la RPC `marcar_avisos_revisados` (20261124100000). Antes se hacía
 * con un UPDATE directo, que la RLS solo deja a quien EDITA el panel principal: con Reservas y el
 * panel en «Ver», «Revisado» no cambiaba nada y no daba error. La RPC exige VER la sección de cada
 * aviso y solo cambia `leida`.
 *
 * - `ids`: esos avisos. - `tipos`: todos los sin revisar de esos tipos. - Nada: todos los que se ven.
 * Devuelve cuántos ha marcado (0 si ya estaban revisados).
 */
export async function marcarAvisosRevisados(filtro: { ids?: string[]; tipos?: readonly string[] } = {}) {
  const llamar = supabase.rpc as unknown as (
    this: typeof supabase,
    fn: string,
    a: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
  const { data, error } = await llamar.call(supabase, "marcar_avisos_revisados", {
    p_ids: filtro.ids ?? null,
    p_tipos: filtro.tipos ? [...filtro.tipos] : null,
  });
  return { marcados: typeof data === "number" ? data : 0, error };
}

/** Tipos de aviso que se dan por revisados al responder a la reserva (verificarla o rechazarla). */
export const TIPOS_AVISO_AL_RESPONDER_RESERVA: readonly string[] = ["reserva_nueva"];

/**
 * Da por revisados los avisos sin revisar de UNA reserva (CAS-9, 17/11/2026, petición del dueño: «tenemos
 * que darle a los dos botones para que se quite»). Al verificar o rechazar una reserva desde cualquier sitio
 * (ficha, Lista, avisos), su aviso «Reserva nueva» deja de contar: ya está atendida. Nunca falla: es un
 * extra de la acción, no debe estropearla. Devuelve cuántos ha marcado.
 */
export async function marcarAvisosDeReserva(reservaId: string, tipos: readonly string[] = TIPOS_AVISO_AL_RESPONDER_RESERVA): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("notificaciones_dashboard")
      .select("id")
      .eq("referencia_tipo", "reserva")
      .eq("referencia_id", reservaId)
      .eq("leida", false)
      .in("tipo", [...tipos]);
    const ids = ((data ?? []) as Array<{ id: string }>).map((n) => n.id);
    if (error || !ids.length) return 0;
    const r = await marcarAvisosRevisados({ ids });
    return r.error ? 0 : r.marcados;
  } catch {
    return 0;
  }
}
