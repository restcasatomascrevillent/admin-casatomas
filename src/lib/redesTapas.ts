/**
 * Tapas → Redes (rrss), 26/11/2026. Sustituye a la historia automática antigua cuando Redes
 * está configurada (VITE_RRSS_URL): al guardar las tapas (o encender «Tapas» en la web), el
 * panel pide a su servidor (`rrss-menu`) que mande a rrss las tapas GUARDADAS de ese día; rrss
 * monta la historia con su plantilla y la programa. Como rrss dibuja la pieza en el navegador,
 * después se abre rrss en un iframe oculto (`PreparadorRedes`) para que la prepare en ese
 * momento; si no se puede, la prepara la próxima vez que alguien abra Redes.
 * Diseño: docs/redes-rrss.md.
 */
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { tapasPorRedes } from "@/lib/redes";

export { tapasPorRedes };

/** Evento que abre el iframe oculto de Redes para preparar lo recibido. */
export const EVENTO_PREPARAR_REDES = "panel:redes-preparar";

export type ResultadoTapasRedes =
  | { estado: "enviada" | "sin-cambios"; programadaPara: string | null }
  | { estado: "desactivada" | "web-apagada" | "pasada" | "sin-permiso" }
  | { estado: "error"; mensaje: string };

const TEXTOS: Record<"desactivada" | "web-apagada", string> = {
  desactivada: "La historia automática del jueves de tapas está apagada: no se ha mandado a Redes.",
  "web-apagada": "«Tapas» no está activo en la web: la historia se mandará a Redes al activarlo.",
};

function hora(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("es-ES", { timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

/** Manda las tapas de ese día a Redes. No lanza: avisa con un toast y devuelve qué ha pasado. */
export async function enviarTapasARedes(fecha: string): Promise<ResultadoTapasRedes> {
  let r: ResultadoTapasRedes;
  const { data, error } = await supabase.functions.invoke("rrss-menu", { method: "POST", body: { fecha } });
  if (error) {
    const contexto = (error as { context?: unknown }).context;
    const cuerpo =
      contexto instanceof Response ? ((await contexto.clone().json().catch(() => null)) as { error?: unknown } | null) : null;
    const status = contexto instanceof Response ? contexto.status : 0;
    r =
      status === 403
        ? { estado: "sin-permiso" }
        : { estado: "error", mensaje: typeof cuerpo?.error === "string" ? cuerpo.error : "No se ha podido mandar las tapas a Redes." };
  } else {
    const d = (data ?? {}) as { estado?: string; programadaPara?: string };
    if (d.estado === "enviada" || d.estado === "sin-cambios") r = { estado: d.estado, programadaPara: d.programadaPara ?? null };
    else if (d.estado === "desactivada" || d.estado === "web-apagada" || d.estado === "pasada") r = { estado: d.estado };
    else r = { estado: "error", mensaje: "Respuesta inesperada de Redes." };
  }
  if (r.estado === "enviada") {
    toast.success("Tapas mandadas a Redes: se está preparando la historia.", {
      description: r.programadaPara ? `Saldrá el ${hora(r.programadaPara)} (cuando esté aprobada). Se ve en Redes › Calendario.` : undefined,
      duration: 10_000,
    });
    window.dispatchEvent(new Event(EVENTO_PREPARAR_REDES));
  } else if (r.estado === "sin-cambios") {
    window.dispatchEvent(new Event(EVENTO_PREPARAR_REDES));
  } else if (r.estado === "error") {
    toast.error(`Historia de tapas: ${r.mensaje}`, { duration: 12_000 });
  } else if (r.estado === "desactivada" || r.estado === "web-apagada") {
    toast.info(TEXTOS[r.estado]);
  }
  return r;
}

/** Al encender «Tapas» en la web: la de hoy o la siguiente guardada. */
export async function enviarTapasARedesAlActivar(
  hoy: string = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date()),
): Promise<ResultadoTapasRedes | null> {
  const { data, error } = await supabase.from("tapas").select("fecha").eq("idiom", "es").gte("fecha", hoy).order("fecha", { ascending: true }).limit(1);
  const fecha = !error ? data?.[0]?.fecha : null;
  return fecha ? enviarTapasARedes(fecha) : null;
}
