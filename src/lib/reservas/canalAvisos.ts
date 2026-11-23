import { supabase } from "@/integrations/supabase/client";

/**
 * Por dónde quiere el cliente los avisos de su reserva (`reservas.canal_avisos`,
 * migración 20261215100000): 'email' o 'whatsapp'. Lo elige al reservar en la web
 * donde WhatsApp está activo (hoy, la demo); emails-reserva lo usa al avisar.
 *
 * Se lee aparte, en el momento de la acción, en vez de añadirlo a las consultas de
 * las listas: en un entorno sin la migración esas consultas fallarían enteras.
 * Aquí, si la columna no existe o la lectura falla, `null` = lo de siempre (correo).
 */
export type CanalAvisos = "email" | "whatsapp";

export async function leerCanalAvisos(reservaId: string): Promise<CanalAvisos | null> {
  try {
    const { data, error } = await supabase.from("reservas").select("canal_avisos").eq("id", reservaId).maybeSingle();
    if (error) return null;
    const canal = (data as { canal_avisos?: unknown } | null)?.canal_avisos;
    return canal === "whatsapp" || canal === "email" ? canal : null;
  } catch {
    return null;
  }
}
