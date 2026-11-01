import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Film, Loader2, X } from "lucide-react";
import type { Plato } from "@/hooks/usePlatos";
import {
  actualizarTrabajo,
  cancelarTrabajo,
  contenidoNotificacion,
  encolarTrabajo,
  reintentarTrabajo,
  rutaPlatoEnPanel,
  siguienteTrabajo,
  textoIndicador,
  trabajosActivos,
  type NuevoTrabajoVideo,
  type TrabajoVideo,
} from "./colaVideos";
import { ColaVideosContext, type ContextoColaVideos } from "./useColaVideos";
import { mantenerPantallaEncendida, vigilarSegundoPlano } from "./pantallaEncendida";
import { mostrarNotificacion, pedirPermisoNotificaciones, posterParaNotificacion } from "./notificarVideo";
import { descargarOriginalVideo, ErrorMigracionVideo, guardarOriginalVideo, guardarVideoPlato } from "./subirVideoPlato";
import { AVISO_PANTALLA_ENCENDIDA } from "./videoPlato";

export const AVISO_VUELTA_SEGUNDO_PLANO =
  "La pestaña ha estado en segundo plano y el vídeo se ha pausado; sigue ahora. Déjala abierta y con la pantalla encendida hasta que termine.";
export const MENSAJE_FALLO_SEGUNDO_PLANO = "La pestaña pasó a segundo plano mientras se procesaba";

// El procesado (onnxruntime, ffmpeg…) se carga solo al usarlo.
const cargarProcesado = () => import("./procesarVideoPlato");

let sigId = 1;

/**
 * Cola GLOBAL de «Vídeo del plato» (montada en App.tsx, por encima de las
 * rutas): tras elegir el vídeo se puede cerrar la ficha y seguir usando el
 * panel. Un vídeo cada vez; al terminar se GUARDA SOLO (sube el fichero y
 * escribe video_url; si falta la columna avisa con ErrorMigracionVideo) y
 * avisa con un toast y, si hay permiso, con una notificación del sistema
 * (pedido al empezar el primer vídeo) que al tocarla abre el panel en el plato.
 *
 * LIMITACIÓN (pestaña oculta): el navegador frena o congela las pestañas en
 * segundo plano. El procesado se PAUSA mientras la pestaña está oculta (no
 * busca fotogramas ni graba: el vídeo saldría mal) y sigue al volver. En PC
 * basta con no cerrar la pestaña. En Android/iPhone hay que volver a la
 * pestaña (o a la app instalada) para que continúe; la notificación llega al
 * terminar, aunque se esté en otra pestaña de la misma app.
 */
export function ColaVideosProvider({ children }: { children: ReactNode }) {
  const [trabajos, setTrabajos] = useState<TrabajoVideo[]>([]);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const controles = useRef(new Map<string, AbortController>());
  const enMarcha = useRef(false);
  const vistas = useRef(new Set<string>());

  const actualizar = useCallback((id: string, cambios: Partial<TrabajoVideo>) => setTrabajos((l) => actualizarTrabajo(l, id, cambios)), []);

  const encolar = useCallback((nuevo: NuevoTrabajoVideo) => {
    pedirPermisoNotificaciones();
    const id = `video-${Date.now().toString(36)}-${sigId++}`;
    setTrabajos((l) => {
      const r = encolarTrabajo(l, nuevo, id);
      r.cancelados.forEach((c) => controles.current.get(c)?.abort());
      return r.lista;
    });
    return id;
  }, []);

  const cancelar = useCallback((id: string) => {
    controles.current.get(id)?.abort();
    setTrabajos((l) => cancelarTrabajo(l, id));
  }, []);

  const reintentar = useCallback((id: string) => setTrabajos((l) => reintentarTrabajo(l, id)), []);

  // Toque en la notificación (sw.js manda un mensaje en vez de recargar, para no perder la cola).
  useEffect(() => {
    const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
    if (!sw) return;
    const alMensaje = (ev: MessageEvent) => {
      const d = ev.data as { tipo?: string; url?: string } | null;
      if (d?.tipo === "abrir-url" && typeof d.url === "string" && d.url.startsWith("/")) navigate(d.url);
    };
    sw.addEventListener("message", alMensaje);
    sw.startMessages?.();
    return () => sw.removeEventListener("message", alMensaje);
  }, [navigate]);

  // Liberar las vistas previas de los trabajos que ya no están.
  useEffect(() => {
    const vivas = new Set(trabajos.map((t) => t.urlVista).filter(Boolean) as string[]);
    for (const u of vistas.current) {
      if (!vivas.has(u)) {
        URL.revokeObjectURL(u);
        vistas.current.delete(u);
      }
    }
  }, [trabajos]);

  const procesar = useCallback(
    async (t: TrabajoVideo) => {
      const control = new AbortController();
      controles.current.set(t.id, control);
      actualizar(t.id, { estado: "procesando", progreso: null });
      const soltarPantalla = await mantenerPantallaEncendida();
      const vigia = vigilarSegundoPlano(() => {
        if (!control.signal.aborted) toast.info(AVISO_VUELTA_SEGUNDO_PLANO, { duration: 10000 });
      });
      const ruta = rutaPlatoEnPanel(t.platoId);
      try {
        const { procesarVideoPlato } = await cargarProcesado();
        // Cambio de fondo sin el archivo en memoria: se rehace desde el original guardado.
        const archivo = t.archivo ?? (t.rutaOriginal ? await descargarOriginalVideo(t.rutaOriginal) : null);
        if (!archivo) throw new Error("No hay vídeo que procesar");
        if (control.signal.aborted) throw new DOMException("Cancelado", "AbortError");
        const r = await procesarVideoPlato(archivo, {
          tema: t.tema,
          signal: control.signal,
          onProgreso: (p) => actualizar(t.id, { progreso: p }),
        });
        if (control.signal.aborted) throw new DOMException("Cancelado", "AbortError");
        actualizar(t.id, { estado: "guardando" });
        // La URL actual más fresca (la ficha pudo cambiar mientras tanto) para borrar el fichero viejo.
        const enCache = queryClient.getQueryData<Plato[]>(["platos"])?.find((p) => p.id === t.platoId);
        await guardarVideoPlato(t.platoId, r.blob, enCache ? (enCache.video_url ?? null) : t.urlActual, t.tema);
        // Conservar el original para poder cambiar el fondo luego (si falla, el vídeo ya está guardado).
        if (t.guardarOriginal) {
          try {
            const rutaOriginal = await guardarOriginalVideo(t.platoId, archivo);
            actualizar(t.id, { rutaOriginal });
          } catch (e) {
            console.warn("[video-plato] no se pudo guardar el original", e);
          }
        }
        await queryClient.invalidateQueries({ queryKey: ["platos"] });
        const urlVista = URL.createObjectURL(r.blob);
        vistas.current.add(urlVista);
        actualizar(t.id, { estado: "listo", progreso: null, urlVista });
        const n = contenidoNotificacion(t.nombre, "listo");
        toast.success(n.titulo, { action: { label: "Ver", onClick: () => navigate(ruta) } });
        void mostrarNotificacion(
          { titulo: n.titulo, cuerpo: n.cuerpo, url: ruta, imagen: await posterParaNotificacion(r.poster), tag: `video-${t.platoId}` },
          (u) => navigate(u),
        );
      } catch (e) {
        if ((e as Error)?.name === "AbortError" || control.signal.aborted) {
          setTrabajos((l) => cancelarTrabajo(l, t.id));
          return;
        }
        console.warn("[video-plato]", e);
        const base = e instanceof ErrorMigracionVideo ? e.message : (e as Error)?.message || "No se pudo generar el vídeo";
        const seOculto = vigia.seOculto();
        const mensaje = seOculto ? `${MENSAJE_FALLO_SEGUNDO_PLANO}: ${base}` : base;
        actualizar(t.id, { estado: "fallo", progreso: null, mensaje, seOculto });
        const n = contenidoNotificacion(t.nombre, "fallo", base);
        toast.error(n.titulo, { description: mensaje, action: { label: "Ver", onClick: () => navigate(ruta) } });
        void mostrarNotificacion({ titulo: n.titulo, cuerpo: n.cuerpo, url: ruta, tag: `video-${t.platoId}` }, (u) => navigate(u));
      } finally {
        vigia.parar();
        soltarPantalla();
        controles.current.delete(t.id);
      }
    },
    [actualizar, navigate, queryClient],
  );

  // Motor: un trabajo cada vez.
  useEffect(() => {
    if (enMarcha.current) return;
    const t = siguienteTrabajo(trabajos);
    if (!t) return;
    enMarcha.current = true;
    void procesar(t).finally(() => {
      enMarcha.current = false;
      setTrabajos((l) => [...l]); // vuelve a mirar si hay otro esperando
    });
  }, [trabajos, procesar]);

  // Avisar antes de cerrar la pestaña con vídeos a medias.
  const activos = trabajosActivos(trabajos);
  const hayActivos = activos.length > 0;
  useEffect(() => {
    if (!hayActivos) return;
    const antes = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", antes);
    return () => window.removeEventListener("beforeunload", antes);
  }, [hayActivos]);

  const valor = useMemo<ContextoColaVideos>(
    () => ({ trabajos, encolar, cancelar, reintentar, disponible: true }),
    [trabajos, encolar, cancelar, reintentar],
  );

  return (
    <ColaVideosContext.Provider value={valor}>
      {children}
      {hayActivos && <IndicadorVideos activos={activos} onCancelar={cancelar} onAbrir={(t) => navigate(rutaPlatoEnPanel(t.platoId))} />}
    </ColaVideosContext.Provider>
  );
}

/** Indicador pequeño y global (abajo a la derecha) mientras hay vídeos en marcha o en cola. */
function IndicadorVideos({
  activos,
  onCancelar,
  onAbrir,
}: {
  activos: TrabajoVideo[];
  onCancelar: (id: string) => void;
  onAbrir: (t: TrabajoVideo) => void;
}) {
  const actual = activos.find((t) => t.estado !== "esperando") ?? activos[0];
  const enCola = activos.length - 1;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border bg-card px-3 py-2 text-sm shadow-lg"
      title={AVISO_PANTALLA_ENCENDIDA}
    >
      {actual.estado === "esperando" ? <Film className="h-4 w-4 shrink-0" /> : <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
      <button type="button" className="min-w-0 truncate text-left hover:underline" onClick={() => onAbrir(actual)}>
        {textoIndicador(actual)}
        {enCola > 0 ? ` (+${enCola} en cola)` : ""}
      </button>
      <button
        type="button"
        className="-mr-1 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={`Cancelar el vídeo de ${actual.nombre}`}
        onClick={() => onCancelar(actual.id)}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
