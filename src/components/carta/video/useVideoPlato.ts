import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NombreTema } from "../composicionCarta";
import type { ProgresoVideo } from "./videoPlato";
import type { DisponibilidadVideo, ResultadoVideoPlato } from "./procesarVideoPlato";
import { guardarVideoPlato, quitarVideoPlato } from "./subirVideoPlato";
import { toast } from "sonner";
import { mantenerPantallaEncendida, vigilarSegundoPlano } from "./pantallaEncendida";

export const AVISO_VUELTA_SEGUNDO_PLANO =
  "La pestaña ha estado en segundo plano: el vídeo puede haberse parado mientras tanto. Déjala abierta y con la pantalla encendida hasta que termine.";
export const MENSAJE_FALLO_SEGUNDO_PLANO = "La pestaña pasó a segundo plano mientras se procesaba y el vídeo no salió bien.";

export type EstadoVideo =
  | { fase: "nada" }
  | { fase: "procesando"; progreso: ProgresoVideo | null }
  | { fase: "listo"; r: ResultadoVideoPlato; url: string; tema: NombreTema }
  /** seOculto: la pestaña pasó a segundo plano durante el procesado (se ofrece reintentar). */
  | { fase: "fallo"; mensaje: string; seOculto?: boolean };

// El procesado (y onnxruntime) se carga solo al usarlo: no entra en el bundle del panel.
const cargarProcesado = () => import("./procesarVideoPlato");

/**
 * Estado del «Vídeo del plato» en un formulario: generar (en el navegador),
 * cancelar, descartar, marcar para quitar el guardado y, al guardar el plato,
 * `guardar(id, urlActual)` (sube o borra; lanza ErrorMigracionVideo si falta
 * la columna).
 */
export function useVideoPlato() {
  const [estado, setEstado] = useState<EstadoVideo>({ fase: "nada" });
  const [quitar, setQuitar] = useState(false);
  const [disponible, setDisponible] = useState<DisponibilidadVideo | null>(null);
  const control = useRef<AbortController | null>(null);
  /** Último vídeo elegido, para «Reintentar». */
  const ultimo = useRef<{ archivo: File; tema: NombreTema } | null>(null);

  useEffect(() => {
    let vivo = true;
    cargarProcesado()
      .then((m) => vivo && setDisponible(m.videoPlatoDisponible()))
      .catch(() => vivo && setDisponible({ ok: false, motivo: "No se pudo cargar el procesado de vídeo." }));
    return () => {
      vivo = false;
      control.current?.abort();
    };
  }, []);

  // Liberar la URL de la vista previa.
  const urlPrevia = estado.fase === "listo" ? estado.url : null;
  useEffect(() => () => {
    if (urlPrevia) URL.revokeObjectURL(urlPrevia);
  }, [urlPrevia]);

  const generar = useCallback(async (archivo: File, tema: NombreTema) => {
    control.current?.abort();
    const yo = new AbortController();
    control.current = yo;
    ultimo.current = { archivo, tema };
    setQuitar(false);
    setEstado({ fase: "procesando", progreso: null });
    const soltarPantalla = await mantenerPantallaEncendida();
    const vigia = vigilarSegundoPlano(() => {
      if (control.current === yo) toast.info(AVISO_VUELTA_SEGUNDO_PLANO, { duration: 10000 });
    });
    try {
      const { procesarVideoPlato } = await cargarProcesado();
      const r = await procesarVideoPlato(archivo, {
        tema,
        signal: yo.signal,
        onProgreso: (p) => {
          if (control.current === yo) setEstado({ fase: "procesando", progreso: p });
        },
      });
      if (control.current !== yo) return;
      setEstado({ fase: "listo", r, url: URL.createObjectURL(r.blob), tema });
    } catch (e) {
      if (control.current !== yo) return;
      if ((e as Error)?.name === "AbortError") setEstado({ fase: "nada" });
      else {
        console.warn("[video-plato]", e);
        const mensaje = (e as Error)?.message || "No se pudo generar el vídeo";
        const seOculto = vigia.seOculto();
        setEstado({ fase: "fallo", mensaje: seOculto ? `${MENSAJE_FALLO_SEGUNDO_PLANO} (${mensaje})` : mensaje, seOculto });
      }
    } finally {
      vigia.parar();
      soltarPantalla();
      if (control.current === yo) control.current = null;
    }
  }, []);

  const reintentar = useCallback(() => {
    if (ultimo.current) void generar(ultimo.current.archivo, ultimo.current.tema);
  }, [generar]);

  const cancelar = useCallback(() => {
    control.current?.abort();
    control.current = null;
    setEstado({ fase: "nada" });
  }, []);

  const limpiar = useCallback(() => {
    cancelar();
    setQuitar(false);
  }, [cancelar]);

  /** Sube el vídeo nuevo o borra el guardado (si se marcó «Quitar vídeo»). true si cambió algo. */
  const guardar = useCallback(
    async (id: string, urlActual: string | null | undefined): Promise<boolean> => {
      if (estado.fase === "listo") {
        await guardarVideoPlato(id, estado.r.blob, urlActual);
        return true;
      }
      if (quitar && urlActual) {
        await quitarVideoPlato(id, urlActual);
        return true;
      }
      return false;
    },
    [estado, quitar],
  );

  return useMemo(
    () => ({
      estado,
      disponible,
      quitar,
      setQuitar,
      generar,
      reintentar,
      puedeReintentar: !!ultimo.current,
      cancelar,
      limpiar,
      guardar,
      procesando: estado.fase === "procesando",
      /** Hay algo que guardar (vídeo nuevo o quitar el guardado). */
      pendiente: estado.fase === "listo" || quitar,
    }),
    [estado, disponible, quitar, generar, reintentar, cancelar, limpiar, guardar],
  );
}

export type VideoPlato = ReturnType<typeof useVideoPlato>;
