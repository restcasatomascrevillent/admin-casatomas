import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { NotificacionDashboard } from "@/hooks/useNotificacionesDashboard";
import { TIPOS_POR_FILTRO, type FiltroAvisos } from "@/lib/avisos";
import { marcarAvisosRevisados, TIPOS_AVISO_RETIRADOS } from "@/lib/avisosRevisados";

export const TAMANO_PAGINA_AVISOS = 30;

/** Historial completo de `notificaciones_dashboard` (lo que permita la RLS), paginado con «cargar más». */
export function useHistorialAvisos(filtro: FiltroAvisos) {
  const [avisos, setAvisos] = useState<NotificacionDashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [hayMas, setHayMas] = useState(false);
  const [error, setError] = useState(false);
  // Solo vale la última petición: cambiar de filtro rápido no mezcla resultados.
  const peticion = useRef(0);

  const leer = useCallback(
    async (desde: number) => {
      let q = supabase
        .from("notificaciones_dashboard")
        .select("*")
        // Los retirados («Reserva sin sala / sin mesas», 11/11/2026) tampoco salen en el historial.
        .not("tipo", "in", `(${TIPOS_AVISO_RETIRADOS.join(",")})`)
        .order("created_at", { ascending: false });
      if (filtro === "sin_leer") q = q.eq("leida", false);
      else if (filtro === "reservas" || filtro === "facturas") q = q.in("tipo", TIPOS_POR_FILTRO[filtro]);
      else if (filtro === "otros") {
        const conocidos = [...TIPOS_POR_FILTRO.reservas, ...TIPOS_POR_FILTRO.facturas];
        q = q.not("tipo", "in", `(${conocidos.join(",")})`);
      }
      return q.range(desde, desde + TAMANO_PAGINA_AVISOS - 1);
    },
    [filtro],
  );

  useEffect(() => {
    const mia = ++peticion.current;
    setLoading(true);
    setError(false);
    void leer(0).then(({ data, error: err }) => {
      if (mia !== peticion.current) return;
      if (err) {
        console.error("Error cargando avisos:", err);
        setError(true);
        setAvisos([]);
        setHayMas(false);
      } else {
        const filas = (data || []) as NotificacionDashboard[];
        setAvisos(filas);
        setHayMas(filas.length === TAMANO_PAGINA_AVISOS);
      }
      setLoading(false);
    });
  }, [leer]);

  const cargarMas = async () => {
    if (cargandoMas || !hayMas) return;
    const mia = peticion.current;
    setCargandoMas(true);
    const { data, error: err } = await leer(avisos.length);
    if (mia !== peticion.current) return;
    setCargandoMas(false);
    if (err) {
      console.error("Error cargando más avisos:", err);
      toast.error("No se pudieron cargar más avisos");
      return;
    }
    const filas = (data || []) as NotificacionDashboard[];
    setAvisos((prev) => {
      const ids = new Set(prev.map((n) => n.id));
      return [...prev, ...filas.filter((n) => !ids.has(n.id))];
    });
    setHayMas(filas.length === TAMANO_PAGINA_AVISOS);
  };

  const marcarLeida = async (id: string) => {
    const aviso = avisos.find((n) => n.id === id);
    if (!aviso || aviso.leida) return;
    setAvisos((prev) => prev.map((n) => (n.id === id ? { ...n, leida: true } : n)));
    const { error: err } = await marcarAvisosRevisados({ ids: [id] });
    if (err) {
      console.error("Error marcando aviso como leído:", err);
      toast.error("No se pudo marcar el aviso como leído");
      setAvisos((prev) => prev.map((n) => (n.id === id ? { ...n, leida: false } : n)));
    }
  };

  const marcarTodasLeidas = async () => {
    const previas = avisos;
    if (!previas.some((n) => !n.leida)) return;
    setAvisos((prev) => prev.map((n) => ({ ...n, leida: true })));
    const { error: err } = await marcarAvisosRevisados();
    if (err) {
      console.error("Error marcando todos los avisos como leídos:", err);
      toast.error("No se pudieron marcar los avisos como leídos");
      setAvisos(previas);
    }
  };

  return { avisos, loading, cargandoMas, hayMas, error, cargarMas, marcarLeida, marcarTodasLeidas };
}
