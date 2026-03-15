import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface NotificacionDashboard {
  id: string;
  tipo: string;
  titulo: string;
  mensaje: string | null;
  referencia_id: string | null;
  referencia_tipo: string | null;
  leida: boolean;
  created_at: string;
}

export function useNotificacionesDashboard() {
  const [notificaciones, setNotificaciones] = useState<NotificacionDashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [countNoLeidas, setCountNoLeidas] = useState(0);

  const fetchNotificaciones = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("notificaciones_dashboard")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Error cargando notificaciones:", error);
    } else {
      const items = (data || []) as NotificacionDashboard[];
      setNotificaciones(items);
      setCountNoLeidas(items.filter((n) => !n.leida).length);
    }
    setLoading(false);
  }, []);

  const marcarLeida = async (id: string) => {
    const { error } = await supabase
      .from("notificaciones_dashboard")
      .update({ leida: true })
      .eq("id", id);

    if (!error) {
      setNotificaciones((prev) =>
        prev.map((n) => (n.id === id ? { ...n, leida: true } : n))
      );
      setCountNoLeidas((prev) => Math.max(0, prev - 1));
    }
  };

  const marcarTodasLeidas = async () => {
    const { error } = await supabase
      .from("notificaciones_dashboard")
      .update({ leida: true })
      .eq("leida", false);

    if (!error) {
      setNotificaciones((prev) => prev.map((n) => ({ ...n, leida: true })));
      setCountNoLeidas(0);
    }
  };

  useEffect(() => {
    fetchNotificaciones();

    // Suscripción en tiempo real para nuevas notificaciones
    const channel = supabase
      .channel("notificaciones_realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notificaciones_dashboard" },
        (payload) => {
          const nueva = payload.new as NotificacionDashboard;
          setNotificaciones((prev) => [nueva, ...prev].slice(0, 50));
          setCountNoLeidas((prev) => prev + 1);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchNotificaciones]);

  return {
    notificaciones,
    loading,
    countNoLeidas,
    fetchNotificaciones,
    marcarLeida,
    marcarTodasLeidas,
  };
}
