/**
 * Informe de cheques regalo, separado de la pantalla para que lo pueda llamar cualquiera:
 * Cheques › Stripe › «Generar informe» y el módulo «Informes» del Super Admin.
 *
 *   const informe = await generarInformeCheques("2026-10");          // mes (o "2026" para un año)
 *   if (!informe.vacio) <DiapositivasInformeCheques informe={informe} />
 *
 * Lee la RPC `informe_cheques_regalo` (migración 20261122093700, permiso «Ver» en Cheques), que devuelve los cheques
 * sin datos personales, y calcula el informe en el navegador con `construirInformeCheques` (función pura).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { construirInformeCheques, type InformeCheques, type InformeChequesVacio, type RespuestaInformeCheques } from "./modelo";
import { periodoInforme, type PeriodoInforme } from "./periodo";

export * from "./modelo";
export * from "./periodo";

export interface OpcionesGenerarInformeCheques {
  /** Día de referencia `yyyy-MM-dd` (por defecto, hoy en el reloj del navegador). */
  hoy?: string;
  /** Cliente de Supabase (por defecto, el del panel). */
  cliente?: SupabaseClient;
}

/** Pide a Supabase los cheques que necesita el periodo (y su comparación). Lanza con un mensaje para el usuario. */
export async function cargarDatosInformeCheques(periodo: PeriodoInforme, cliente: SupabaseClient = supabase as unknown as SupabaseClient): Promise<RespuestaInformeCheques> {
  const { data, error } = await cliente.rpc("informe_cheques_regalo", { p_desde: periodo.desdeAnterior, p_hasta: periodo.hasta });
  if (error) {
    const codigo = (error as { code?: string }).code;
    if (codigo === "PGRST202" || codigo === "42883") throw new Error("Falta instalar el informe de cheques en Supabase (migración 20261122093700).");
    if (codigo === "42501") throw new Error("Tu usuario no tiene permiso para ver los cheques.");
    throw new Error(error.message || "No se pudieron cargar los datos del informe.");
  }
  const respuesta = (data ?? { cheques: [] }) as RespuestaInformeCheques;
  return { ...respuesta, cheques: Array.isArray(respuesta.cheques) ? respuesta.cheques : [] };
}

/** Genera el informe de un periodo (`yyyy-MM` o `yyyy`, o un `PeriodoInforme` ya calculado). */
export async function generarInformeCheques(
  periodo: string | PeriodoInforme,
  { hoy = format(new Date(), "yyyy-MM-dd"), cliente }: OpcionesGenerarInformeCheques = {},
): Promise<InformeCheques | InformeChequesVacio> {
  const p = typeof periodo === "string" ? periodoInforme(periodo, hoy) : periodo;
  return construirInformeCheques(await cargarDatosInformeCheques(p, cliente), p);
}
