/**
 * Puente entre «procesar un trabajo remoto» (que necesita una promesa) y la
 * cola de procesado de vídeo de la app (ColaVideosProvider), que va por
 * estado de React: se encola el bruto y se espera a que su trabajo en la cola
 * llegue a listo / fallo / cancelado.
 */
import type { ProcesarYGuardar } from "./procesarTrabajoRemoto";

export interface TrabajoColaMinimo {
  id: string;
  estado: string;
  mensaje?: string;
}

type Espera = { ok: () => void; ko: (e: Error) => void };

export class EsperasCola {
  private esperas = new Map<string, Espera>();

  esperar(id: string): Promise<void> {
    return new Promise<void>((ok, ko) => this.esperas.set(id, { ok, ko }));
  }

  /** Llamar cada vez que cambia la lista de la cola. */
  actualizar(trabajos: readonly TrabajoColaMinimo[]): void {
    for (const [id, w] of this.esperas) {
      const t = trabajos.find((x) => x.id === id);
      if (!t) continue;
      if (t.estado === "listo") {
        this.esperas.delete(id);
        w.ok();
      } else if (t.estado === "fallo") {
        this.esperas.delete(id);
        w.ko(new Error(t.mensaje || "No se pudo generar el vídeo"));
      } else if (t.estado === "cancelado") {
        this.esperas.delete(id);
        w.ko(new DOMException("Cancelado", "AbortError"));
      }
    }
  }

  get pendientes(): number {
    return this.esperas.size;
  }
}

/** Nombre de fichero para el bruto descargado (la cola espera un File). */
export function archivoDesdeBruto(bruto: Blob, platoId: string): File {
  const tipo = bruto.type || "video/mp4";
  const ext = /quicktime/.test(tipo) ? "mov" : /webm/.test(tipo) ? "webm" : "mp4";
  return new File([bruto], `remoto-${platoId}.${ext}`, { type: tipo });
}

/**
 * ProcesarYGuardar que mete el trabajo en la cola de la app (que procesa y
 * guarda `video_url` sola) y resuelve cuando termina. Devuelve la URL leída
 * después del plato (`leerUrl`).
 */
export function procesarConCola(
  encolar: (n: { platoId: string; nombre: string; archivo: File; tema: string; urlActual: string | null }) => string,
  esperas: EsperasCola,
  leerUrl: (platoId: string) => Promise<string | null>,
): ProcesarYGuardar {
  return async ({ platoId, nombrePlato, bruto, tema }) => {
    const urlActual = await leerUrl(platoId);
    const id = encolar({ platoId, nombre: nombrePlato || "Plato", archivo: archivoDesdeBruto(bruto, platoId), tema, urlActual });
    if (!id) throw new Error("La cola de vídeo no está disponible");
    await esperas.esperar(id);
    return (await leerUrl(platoId)) ?? "";
  };
}
