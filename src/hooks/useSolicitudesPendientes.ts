import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface SolicitudPendiente {
  id: string;
  nombre: string | null;
  telefono: string | null;
  email: string | null;
  fecha_solicitada: string | null;
  hora_solicitada: string | null;
  numero_comensales: number | null;
  notas_cliente: string | null;
  motivo_rechazo: string;
  descripcion_rechazo: string | null;
  estado: string;
  notas_internas: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export function useSolicitudesPendientes() {
  const [solicitudes, setSolicitudes] = useState<SolicitudPendiente[]>([]);
  const [loading, setLoading] = useState(true);
  const [countPendientes, setCountPendientes] = useState(0);

  const fetchSolicitudes = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("solicitudes_pendientes")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error cargando solicitudes:", error);
      toast.error("Error al cargar solicitudes pendientes");
    } else {
      const items = (data || []) as SolicitudPendiente[];
      setSolicitudes(items);
      setCountPendientes(items.filter((s) => s.estado === "pendiente").length);
    }
    setLoading(false);
  }, []);

  const updateEstado = async (id: string, nuevoEstado: string) => {
    const { error } = await supabase
      .from("solicitudes_pendientes")
      .update({ estado: nuevoEstado, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      toast.error("Error al actualizar estado");
      return false;
    }
    toast.success(`Solicitud marcada como "${nuevoEstado}"`);
    await fetchSolicitudes();
    return true;
  };

  const updateNotasInternas = async (id: string, notas: string) => {
    const { error } = await supabase
      .from("solicitudes_pendientes")
      .update({ notas_internas: notas, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      toast.error("Error al guardar notas");
      return false;
    }
    toast.success("Notas guardadas");
    await fetchSolicitudes();
    return true;
  };

  /**
   * Guarda la propuesta del personal (día/hora/comensales + la línea de
   * "Petición original" en notas internas). Los cambios los calcula
   * `actualizacionPropuesta` en src/lib/reservas/solicitudPropuesta.ts.
   */
  const updatePropuesta = async (
    id: string,
    cambios: Pick<SolicitudPendiente, "fecha_solicitada" | "hora_solicitada" | "numero_comensales" | "notas_internas">,
    opciones?: { silencioso?: boolean },
  ) => {
    const { error } = await supabase
      .from("solicitudes_pendientes")
      .update({ ...cambios, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      toast.error("Error al guardar los cambios de la solicitud");
      return false;
    }
    if (!opciones?.silencioso) toast.success("Cambios de la solicitud guardados");
    await fetchSolicitudes();
    return true;
  };

  useEffect(() => {
    fetchSolicitudes();

    // Suscripción en tiempo real. "*" y no solo INSERT (sesión 2026-09-23):
    // las solicitudes viven ahora dentro de la lista de reservas y, si un
    // compañero la marca resuelta/descartada en otro dispositivo, tiene que
    // desaparecer también aquí sin recargar.
    // Ojo: montar este hook DOS veces a la vez rompe el realtime (realtime-js
    // devuelve el MISMO canal para el mismo nombre y el primer desmontaje lo
    // cierra para ambos). En /reservas lo instancia solo `Reservas.tsx` y lo
    // pasa hacia abajo.
    const channel = supabase
      .channel("solicitudes_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "solicitudes_pendientes" },
        () => {
          fetchSolicitudes();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchSolicitudes]);

  return {
    solicitudes,
    loading,
    countPendientes,
    fetchSolicitudes,
    updateEstado,
    updateNotasInternas,
    updatePropuesta,
  };
}
