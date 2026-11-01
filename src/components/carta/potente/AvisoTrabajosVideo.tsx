import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { hayQueAvisar, MS_SONDEO, nombrePlato, pendientesReclamables, textoAviso, type TrabajoVideo } from "./colaPendientes";
import { leerMedidaCacheada, medirDispositivoPotente } from "./dispositivoPotente";
import { procesarTrabajoRemoto, type ProcesarYGuardar } from "./procesarTrabajoRemoto";
import { trabajosVivos } from "./trabajosVideo";

const ID_AVISO = "trabajos-video-pendientes";
const ID_PROCESO = "trabajos-video-proceso";
/** Espera inicial antes de medir: deja que la precarga del modelo del panel arranque. */
const MS_ESPERA_INICIAL = 15_000;

interface Props {
  /**
   * Cómo procesar y guardar cada trabajo. Por defecto, el pipeline directo;
   * la app puede pasar uno que lo meta en su cola de procesado de vídeo.
   */
  procesarYGuardar?: ProcesarYGuardar;
}

/**
 * En los dispositivos POTENTES con el panel abierto: sondea cada 60 s los
 * vídeos mandados desde un móvil y ofrece «¿Procesarlo aquí?» con un aviso
 * persistente. Al aceptar los procesa de uno en uno (reclamar → descargar →
 * procesar → guardar → listo → push al móvil). En los demás dispositivos no
 * hace nada. Sin la migración aplicada, tampoco.
 */
export function AvisoTrabajosVideo({ procesarYGuardar }: Props) {
  const { user } = useAuth();
  const { canAccess } = useCanAccessSection("gestor_carta");
  const queryClient = useQueryClient();
  const potente = useRef<boolean | null>(leerMedidaCacheada()?.potente ?? null);
  const descartados = useRef(new Set<string>());
  const procesando = useRef(false);
  const sinMigracion = useRef(false);
  const procesarRef = useRef(procesarYGuardar);
  procesarRef.current = procesarYGuardar;

  const procesarTodos = useCallback(
    async (lista: TrabajoVideo[]) => {
      if (procesando.current) return;
      procesando.current = true;
      toast.dismiss(ID_AVISO);
      const alSalir = (e: BeforeUnloadEvent) => {
        e.preventDefault();
        e.returnValue = "";
      };
      window.addEventListener("beforeunload", alSalir);
      try {
        for (const [i, t] of lista.entries()) {
          const nombre = nombrePlato(t);
          const prefijo = lista.length > 1 ? `(${i + 1}/${lista.length}) ` : "";
          toast.loading(`${prefijo}Procesando el vídeo de ${nombre}…`, { id: ID_PROCESO, duration: Infinity });
          const { textoProgresoVideo } = await import("../video/videoPlato");
          const r = await procesarTrabajoRemoto(t, {
            procesarYGuardar: procesarRef.current,
            onProgreso: (p) =>
              toast.loading(`${prefijo}Vídeo de ${nombre}`, { id: ID_PROCESO, description: textoProgresoVideo(p), duration: Infinity }),
          });
          if (r.estado === "listo") toast.success(`Vídeo guardado: ${nombre}`, { id: ID_PROCESO, description: "Se ha avisado al móvil que lo grabó.", duration: 6000 });
          else if (r.estado === "cogido") toast.info(r.mensaje, { id: ID_PROCESO, duration: 5000 });
          else if (r.estado === "cancelado") toast.info(`Vídeo de ${nombre} devuelto a pendientes`, { id: ID_PROCESO, duration: 5000 });
          else toast.error(`No se pudo hacer el vídeo de ${nombre}`, { id: ID_PROCESO, description: r.mensaje, duration: 10000 });
        }
        void queryClient.invalidateQueries({ queryKey: ["platos"] });
      } finally {
        window.removeEventListener("beforeunload", alSalir);
        procesando.current = false;
      }
    },
    [queryClient],
  );

  const sondear = useCallback(async () => {
    if (procesando.current || sinMigracion.current) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    if (potente.current !== true) {
      const m = await medirDispositivoPotente();
      potente.current = m.potente;
      if (!m.potente) return;
    }
    let lista: TrabajoVideo[];
    try {
      const r = await trabajosVivos();
      if (!r.disponible) {
        sinMigracion.current = true;
        return;
      }
      lista = pendientesReclamables(r.trabajos);
    } catch {
      return; // red caída: se reintenta en el siguiente sondeo
    }
    if (lista.length === 0) {
      toast.dismiss(ID_AVISO);
      return;
    }
    if (!hayQueAvisar(lista, descartados.current)) return;
    toast(textoAviso(lista), {
      id: ID_AVISO,
      duration: Infinity,
      description: "Se procesan aquí con el ordenador y se avisa al móvil que lo grabó.",
      action: { label: lista.length === 1 ? "Procesarlo aquí" : "Procesarlos aquí", onClick: () => void procesarTodos(lista) },
      cancel: {
        label: "Ahora no",
        onClick: () => {
          for (const t of lista) descartados.current.add(t.id);
        },
      },
    });
  }, [procesarTodos]);

  useEffect(() => {
    if (!user || !canAccess) return;
    // Un dispositivo que ya sabemos que no es potente no sondea nada.
    if (potente.current === false && leerMedidaCacheada()) return;
    let id: ReturnType<typeof setInterval> | undefined;
    const arranque = setTimeout(() => {
      void sondear();
      id = setInterval(() => void sondear(), MS_SONDEO);
    }, MS_ESPERA_INICIAL);
    return () => {
      clearTimeout(arranque);
      if (id) clearInterval(id);
    };
  }, [user, canAccess, sondear]);

  return null;
}
