/**
 * Disparadores del automático de la story del jueves de tapas (12/11/2026).
 * Se llaman SIN esperar (void) desde Gestión web: guardar las tapas no espera
 * al render ni a Instagram. Avisan con un toast solo de lo que importa
 * (programada, rehecha, error, «Tapas» apagado en la web); lo demás (sin
 * permiso de Marketing, automático apagado, día pasado) en silencio.
 */
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { hoyEnMadrid } from "@/lib/instagram/tapas";
import { textoInstante } from "@/components/instagram/programar/logica";
import { DEPS_STORY_TAPAS } from "./api";
import { asegurarStoryTapas, type DepsStoryTapas, type ResultadoStoryTapas } from "./storyTapas";

export function avisarResultado(r: ResultadoStoryTapas, deIniciativaPropia = true): void {
  if (r.estado === "programada") {
    toast.success(r.mensaje, { description: `Se publicará en Instagram el ${textoInstante(r.programadaPara)}. Puedes cambiarla desde el aviso de la campana.`, duration: 10_000 });
  } else if (r.estado === "publicada" || r.estado === "en_proceso") {
    toast.success(r.mensaje);
  } else if (r.estado === "error") {
    toast.error(r.mensaje, { duration: 12_000 });
  } else if (!deIniciativaPropia || r.motivo === "web-apagada") {
    toast.info(r.mensaje);
  }
}

/** Al guardar unas tapas en Gestión web. */
export async function storyTapasAlGuardar(fecha: string, tapas: readonly string[], deps: DepsStoryTapas = DEPS_STORY_TAPAS): Promise<ResultadoStoryTapas> {
  const r = await asegurarStoryTapas({ fecha, tapas }, deps);
  avisarResultado(r);
  return r;
}

/** Al encender «Tapas» en la web: la de hoy o la siguiente guardada. */
export async function storyTapasAlActivar(deps: DepsStoryTapas = DEPS_STORY_TAPAS): Promise<ResultadoStoryTapas | null> {
  const { data, error } = await supabase
    .from("tapas")
    .select("fecha, tapas")
    .eq("idiom", "es")
    .gte("fecha", hoyEnMadrid(deps.ahora()))
    .order("fecha", { ascending: true })
    .limit(1);
  const fila = !error ? data?.[0] : null;
  if (!fila || !Array.isArray(fila.tapas)) return null;
  const tapas = (fila.tapas as unknown[]).filter((t): t is string => typeof t === "string");
  return storyTapasAlGuardar(fila.fecha, tapas, deps);
}
