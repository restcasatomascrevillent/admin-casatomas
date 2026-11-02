/**
 * Cuando el móvil no puede recortar una foto ya guardada (falla, se queda sin
 * memoria, la pestaña muere o el móvil está marcado), se crea un trabajo para
 * que la recorte un ORDENADOR con el panel abierto (trabajos_recorte,
 * potente/AvisoTrabajosRecorte.tsx) y se avisa por push al acabar. Sin la
 * migración aplicada, se avisa como antes («Quitar fondo» desde un ordenador).
 * Lo engancha GestorRecortes con configurarAlNoRecortar.
 */
import { toast } from "sonner";
import { crearTrabajoRecorte } from "../potente/trabajosRecorte";
import { avisarSinRecorte, MS_AVISO_SIN_RECORTE } from "./recorteEnSegundoPlano";
import type { DatosRecorte } from "./recorteMovil";

const ID_TOAST = "recorte-movil";

async function accionAvisos(): Promise<{ label: string; onClick: () => void } | undefined> {
  try {
    const { activarAvisosPush, permisoNotificaciones, pushDisponible } = await import("../potente/pushVideo");
    if (!pushDisponible().ok || permisoNotificaciones() === "granted") return undefined;
    return {
      label: "Avisarme",
      // Desde el toque (iOS exige un gesto del usuario para pedir permiso).
      onClick: () =>
        void activarAvisosPush().then((r) =>
          "motivo" in r ? toast.error("No se han podido activar los avisos", { description: r.motivo }) : toast.success("Te avisaremos cuando esté lista"),
        ),
    };
  } catch {
    return undefined;
  }
}

export async function mandarRecorteAOrdenador(d: DatosRecorte, motivo: string): Promise<void> {
  let creado = false;
  try {
    creado = (await crearTrabajoRecorte(d)).creado;
  } catch (e) {
    console.warn("[recorte] no se pudo crear el trabajo para un ordenador", e);
  }
  if (!creado) {
    avisarSinRecorte(d, motivo);
    return;
  }
  toast.warning(`Guardado con la foto normal${d.nombre ? `: ${d.nombre}` : ""}`, {
    id: ID_TOAST,
    description: "Se recortará en un ordenador con el panel abierto y te avisaremos.",
    duration: MS_AVISO_SIN_RECORTE,
    action: await accionAvisos(),
  });
}
