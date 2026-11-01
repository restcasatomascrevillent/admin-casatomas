import { useCallback, useEffect, useMemo, useState } from "react";
import type { NombreTema } from "../composicionCarta";
import type { ProgresoVideo } from "./videoPlato";
import type { DisponibilidadVideo } from "./procesarVideoPlato";
import { quitarVideoPlato } from "./subirVideoPlato";
import { estaActivo, trabajoCambioFondo, trabajoDePlato, type TrabajoVideo } from "./colaVideos";
import { useColaVideos } from "./useColaVideos";

export type EstadoVideo =
  | { fase: "nada" }
  /** Plato nuevo: el vídeo se pone en la cola al guardar el plato (aún no tiene id). */
  | { fase: "pendiente"; nombreArchivo: string }
  | { fase: "procesando"; progreso: ProgresoVideo | null; enCola: boolean; trabajo: TrabajoVideo }
  /** Generado y guardado solo (urlVista = vista previa local). */
  | { fase: "listo"; urlVista?: string; trabajo: TrabajoVideo }
  /** seOculto: la pestaña pasó a segundo plano durante el procesado. */
  | { fase: "fallo"; mensaje: string; seOculto?: boolean; trabajo: TrabajoVideo };

// El procesado (y onnxruntime) se carga solo al usarlo: no entra en el bundle del panel.
const cargarProcesado = () => import("./procesarVideoPlato");

export interface PlatoDelVideo {
  id: string;
  nombre: string | null;
  video_url?: string | null;
}

/**
 * «Vídeo del plato» en un formulario. El procesado va en la COLA GLOBAL
 * (ColaVideosProvider): se puede cerrar la ficha y seguir usando el panel, y
 * al terminar se guarda solo. Aquí queda:
 *   - plato existente: elegir vídeo → a la cola enseguida;
 *   - plato nuevo (sin id): el vídeo espera y entra en la cola al guardar;
 *   - «Quitar vídeo», que sí se aplica al pulsar «Guardar».
 */
export function useVideoPlato(plato?: PlatoDelVideo | null) {
  const cola = useColaVideos();
  const [pendiente, setPendiente] = useState<{ archivo: File; tema: NombreTema } | null>(null);
  const [quitar, setQuitar] = useState(false);
  const [disponible, setDisponible] = useState<DisponibilidadVideo | null>(null);

  useEffect(() => {
    let vivo = true;
    cargarProcesado()
      .then((m) => vivo && setDisponible(m.videoPlatoDisponible()))
      .catch(() => vivo && setDisponible({ ok: false, motivo: "No se pudo cargar el procesado de vídeo." }));
    return () => {
      vivo = false;
    };
  }, []);

  const platoId = plato?.id;
  const trabajo = platoId ? trabajoDePlato(cola.trabajos, platoId) : undefined;

  const estado: EstadoVideo = useMemo(() => {
    if (pendiente) return { fase: "pendiente", nombreArchivo: pendiente.archivo.name };
    if (!trabajo) return { fase: "nada" };
    if (estaActivo(trabajo)) return { fase: "procesando", progreso: trabajo.progreso, enCola: trabajo.estado === "esperando", trabajo };
    if (trabajo.estado === "listo") return { fase: "listo", urlVista: trabajo.urlVista, trabajo };
    if (trabajo.estado === "fallo") return { fase: "fallo", mensaje: trabajo.mensaje ?? "No se pudo generar el vídeo", seOculto: trabajo.seOculto, trabajo };
    return { fase: "nada" };
  }, [pendiente, trabajo]);

  const { encolar, cancelar: cancelarEnCola, reintentar: reintentarEnCola } = cola;
  const nombrePlato = plato?.nombre;
  const urlActual = plato?.video_url ?? null;

  const generar = useCallback(
    (archivo: File, tema: NombreTema) => {
      setQuitar(false);
      if (platoId) {
        setPendiente(null);
        encolar({ platoId, nombre: nombrePlato || "plato", archivo, tema, urlActual, guardarOriginal: true });
      } else setPendiente({ archivo, tema });
    },
    [platoId, nombrePlato, urlActual, encolar],
  );

  /**
   * Rehace el vídeo ya hecho con otro fondo (misma cola global, se guarda
   * solo). `original`: ruta del original guardado (o false/null si no hay).
   * Devuelve false si no hay de dónde sacar el vídeo.
   */
  const trabajoListo = trabajo?.estado === "listo" ? trabajo : null;
  const cambiarFondo = useCallback(
    (tema: NombreTema, original: string | false | null): boolean => {
      if (!platoId) return false;
      const n = trabajoCambioFondo({ platoId, nombre: nombrePlato || "plato", tema, urlActual, previo: trabajoListo, original });
      if (!n) return false;
      setQuitar(false);
      encolar(n);
      return true;
    },
    [platoId, nombrePlato, urlActual, trabajoListo, encolar],
  );

  const trabajoId = trabajo?.id;
  const reintentar = useCallback(() => {
    if (trabajoId) reintentarEnCola(trabajoId);
  }, [trabajoId, reintentarEnCola]);

  /** Cancela el vídeo en marcha/en cola de este plato, o descarta el pendiente. */
  const cancelar = useCallback(() => {
    setPendiente(null);
    if (trabajoId) cancelarEnCola(trabajoId);
  }, [trabajoId, cancelarEnCola]);

  /** Al cerrar la ficha: NO cancela la cola (el vídeo sigue y se guarda solo). */
  const limpiar = useCallback(() => {
    setPendiente(null);
    setQuitar(false);
  }, []);

  /**
   * Al guardar el plato: plato nuevo con vídeo elegido → a la cola (devuelve
   * false: aún no ha cambiado nada); «Quitar vídeo» → lo borra (true).
   */
  const guardar = useCallback(
    async (id: string, urlGuardada: string | null | undefined, nombre?: string | null): Promise<boolean> => {
      if (pendiente) {
        encolar({ platoId: id, nombre: nombre || nombrePlato || "plato", archivo: pendiente.archivo, tema: pendiente.tema, urlActual: urlGuardada ?? null, guardarOriginal: true });
        setPendiente(null);
        return false;
      }
      if (quitar && urlGuardada) {
        await quitarVideoPlato(id, urlGuardada);
        return true;
      }
      return false;
    },
    [pendiente, quitar, encolar, nombrePlato],
  );

  return useMemo(
    () => ({
      platoId,
      estado,
      disponible,
      quitar,
      setQuitar,
      generar,
      cambiarFondo,
      reintentar,
      puedeReintentar: estado.fase === "fallo",
      cancelar,
      limpiar,
      guardar,
      /** El procesado ya no bloquea «Guardar» (va en la cola global). */
      procesando: false,
      /** Hay algo que hacer al guardar (vídeo pendiente de un plato nuevo o quitar el guardado). */
      pendiente: !!pendiente || quitar,
    }),
    [platoId, estado, disponible, quitar, generar, cambiarFondo, reintentar, cancelar, limpiar, guardar, pendiente],
  );
}

export type VideoPlato = ReturnType<typeof useVideoPlato>;
