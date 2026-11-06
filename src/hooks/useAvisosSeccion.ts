import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { NotificacionDashboard } from "@/hooks/useNotificacionesDashboard";
import { tiposDeSeccion, type SeccionAvisos } from "@/lib/avisos";

export const TAMANO_PAGINA_AVISOS_SECCION = 30;
/** Evento para que los contadores se relean al marcar avisos (en el modal o donde sea). */
const EVENTO_AVISOS_CAMBIADOS = "avisos-seccion-cambiados";
export const avisarAvisosCambiados = () => window.dispatchEvent(new Event(EVENTO_AVISOS_CAMBIADOS));

/**
 * Avisos sin revisar (leida = false) de una sección: el número del botón rojo. Se relee cada
 * minuto, al volver a la pestaña y cuando se marcan avisos. Sin React Query a propósito: el botón
 * vive en la cabecera de páginas que se prueban sin su proveedor.
 */
export function useContadorAvisosSeccion(seccion: SeccionAvisos) {
  const [pendientes, setPendientes] = useState(0);
  useEffect(() => {
    let vigente = true;
    const leer = async () => {
      const { count, error } = await supabase
        .from("notificaciones_dashboard")
        .select("id", { count: "exact", head: true })
        .eq("leida", false)
        .in("tipo", tiposDeSeccion(seccion));
      if (vigente && !error) setPendientes(count ?? 0);
    };
    void leer();
    const intervalo = window.setInterval(() => void leer(), 60_000);
    const alVolver = () => { if (document.visibilityState === "visible") void leer(); };
    const alCambiar = () => void leer();
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener(EVENTO_AVISOS_CAMBIADOS, alCambiar);
    return () => {
      vigente = false;
      window.clearInterval(intervalo);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener(EVENTO_AVISOS_CAMBIADOS, alCambiar);
    };
  }, [seccion]);
  return pendientes;
}

export interface FiltrosAvisosSeccion {
  /** «sin_revisar» = leida false; «todos» = también los revisados. */
  estado: "sin_revisar" | "todos";
  /** Un tipo de la sección, o «todos». */
  tipo: string;
}

/** Lista paginada de los avisos de una sección con sus filtros, y marcar como revisados. */
export function useAvisosSeccion(seccion: SeccionAvisos, filtros: FiltrosAvisosSeccion, activo: boolean) {
  const [avisos, setAvisos] = useState<NotificacionDashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [hayMas, setHayMas] = useState(false);
  const [error, setError] = useState(false);
  const peticion = useRef(0);
  const { estado, tipo } = filtros;

  const leer = useCallback(
    (desde: number) => {
      let q = supabase.from("notificaciones_dashboard").select("*").order("created_at", { ascending: false });
      q = tipo === "todos" ? q.in("tipo", tiposDeSeccion(seccion)) : q.eq("tipo", tipo);
      if (estado === "sin_revisar") q = q.eq("leida", false);
      return q.range(desde, desde + TAMANO_PAGINA_AVISOS_SECCION - 1);
    },
    [seccion, estado, tipo],
  );

  const actualizarContador = avisarAvisosCambiados;

  useEffect(() => {
    if (!activo) return;
    const mia = ++peticion.current;
    setLoading(true);
    setError(false);
    void leer(0).then(({ data, error: err }) => {
      if (mia !== peticion.current) return;
      if (err) {
        console.error("Error cargando avisos de la sección:", err);
        setError(true);
        setAvisos([]);
        setHayMas(false);
      } else {
        const filas = (data || []) as NotificacionDashboard[];
        setAvisos(filas);
        setHayMas(filas.length === TAMANO_PAGINA_AVISOS_SECCION);
      }
      setLoading(false);
    });
  }, [leer, activo]);

  const cargarMas = async () => {
    if (cargandoMas || !hayMas) return;
    const mia = peticion.current;
    setCargandoMas(true);
    const { data, error: err } = await leer(avisos.length);
    if (mia !== peticion.current) return;
    setCargandoMas(false);
    if (err) {
      toast.error("No se pudieron cargar más avisos");
      return;
    }
    const filas = (data || []) as NotificacionDashboard[];
    setAvisos((prev) => {
      const ids = new Set(prev.map((n) => n.id));
      return [...prev, ...filas.filter((n) => !ids.has(n.id))];
    });
    setHayMas(filas.length === TAMANO_PAGINA_AVISOS_SECCION);
  };

  const marcarRevisado = async (id: string) => {
    const aviso = avisos.find((n) => n.id === id);
    if (!aviso || aviso.leida) return;
    setAvisos((prev) => prev.map((n) => (n.id === id ? { ...n, leida: true } : n)));
    const { error: err } = await supabase.from("notificaciones_dashboard").update({ leida: true }).eq("id", id);
    if (err) {
      toast.error("No se pudo marcar el aviso como revisado");
      setAvisos((prev) => prev.map((n) => (n.id === id ? { ...n, leida: false } : n)));
    }
    void actualizarContador();
  };

  /** Solo los de ESTA sección (no toca los avisos de otras). */
  const marcarTodosRevisados = async () => {
    const previos = avisos;
    setAvisos((prev) => prev.map((n) => ({ ...n, leida: true })));
    const { error: err } = await supabase
      .from("notificaciones_dashboard")
      .update({ leida: true })
      .eq("leida", false)
      .in("tipo", tiposDeSeccion(seccion));
    if (err) {
      toast.error("No se pudieron marcar los avisos como revisados");
      setAvisos(previos);
    }
    void actualizarContador();
  };

  return { avisos, loading, cargandoMas, hayMas, error, cargarMas, marcarRevisado, marcarTodosRevisados };
}
