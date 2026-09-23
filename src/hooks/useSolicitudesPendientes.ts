import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { ActualizacionSolicitud } from "@/lib/reservas/solicitudPropuesta";
import { esErrorEsquemaPendiente, mensajeErrorPropuesta } from "@/lib/reservas/propuestaCliente";
import type { ContactoReserva } from "@/lib/reservas/altaPanel";

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
  // Migración 20260923210000_solicitud_propuesta_espacio.sql. Opcionales:
  // se lee con select("*") y, sin la migración, no vienen en la fila.
  espacio_propuesto_id?: string | null;
  propuesta_estado?: string;
  propuesta_enviada_at?: string | null;
  propuesta_respondida_at?: string | null;
  propuesta_respuesta_via?: string | null;
  propuesta_error?: string | null;
  reserva_id?: string | null;
}

/** Resultado de fn_aceptar_propuesta_solicitud / fn_rechazar_propuesta_solicitud. */
export interface ResultadoPropuesta {
  ok: boolean;
  error?: string;
  mensaje?: string;
  reserva_id?: string;
  estado?: string;
  ya_aceptada?: boolean;
  en_blacklist?: boolean;
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
    cambios: ActualizacionSolicitud,
    opciones?: { silencioso?: boolean },
  ) => {
    const escribir = (valores: Partial<ActualizacionSolicitud>) =>
      supabase
        .from("solicitudes_pendientes")
        .update({ ...valores, updated_at: new Date().toISOString() } as never)
        .eq("id", id);

    let { error } = await escribir(cambios);
    // Sin la migración 20260923210000 no existen espacio_propuesto_id ni
    // propuesta_estado: se guarda lo demás y se avisa de que la sala no.
    if (error && esErrorEsquemaPendiente(error) && ("espacio_propuesto_id" in cambios || "propuesta_estado" in cambios)) {
      const { espacio_propuesto_id: _sala, propuesta_estado: _estado, ...resto } = cambios;
      ({ error } = await escribir(resto));
      if (!error) toast.warning("La sala no se ha guardado: falta aplicar la migración de propuestas.");
    }

    if (error) {
      toast.error("Error al guardar los cambios de la solicitud");
      return false;
    }
    if (!opciones?.silencioso) toast.success("Cambios de la solicitud guardados");
    await fetchSolicitudes();
    return true;
  };

  /**
   * Manda al cliente el correo de propuesta con lo GUARDADO en la solicitud
   * (Edge Function emails-reserva/enviar-propuesta-solicitud).
   */
  const enviarPropuesta = async (id: string) => {
    const { data, error } = await supabase.functions.invoke("emails-reserva/enviar-propuesta-solicitud", {
      body: { solicitud_id: id },
    });
    const res = (data ?? null) as { ok?: boolean; message?: string; destinatario?: string } | null;
    if (error || !res?.ok) {
      toast.error(res?.message || "No se pudo enviar la propuesta. ¿Está desplegada la función emails-reserva?");
      await fetchSolicitudes();
      return false;
    }
    toast.success(`Propuesta enviada a ${res.destinatario ?? "el cliente"}`);
    await fetchSolicitudes();
    return true;
  };

  const llamarRpcPropuesta = async (
    fn: "fn_aceptar_propuesta_solicitud" | "fn_rechazar_propuesta_solicitud",
    id: string,
  ): Promise<ResultadoPropuesta> => {
    const { data, error } = await supabase.rpc(fn, { p_solicitud_id: id, p_via: "telefono" });
    if (error) {
      return {
        ok: false,
        error: esErrorEsquemaPendiente(error) ? "sin_migracion" : "error_rpc",
        mensaje: esErrorEsquemaPendiente(error)
          ? "Falta aplicar la migración 20260923210000 en Supabase."
          : error.message,
      };
    }
    return (data ?? { ok: false }) as unknown as ResultadoPropuesta;
  };

  /**
   * El cliente aceptó por teléfono: crea la reserva con lo guardado en la
   * solicitud (misma función que usa el enlace del correo) y dispara
   * notify-reservation-change. Decisión del dueño (2026-09-23): igual que un
   * alta manual, la reserva nace 'verificada' (migración 20260923220000) y el
   * cliente recibe "Confirma tu reserva"; sin esa migración nace 'confirmada'
   * y le llega la confirmación. El correo lo elige emails-reserva por estado.
   *
   * `contacto` (teléfono + email ya validados, obligatorios): se guarda antes
   * en la solicitud, que es de donde la RPC copia los datos a la reserva.
   */
  const aceptarPropuestaTelefono = async (id: string, contacto?: ContactoReserva): Promise<ResultadoPropuesta> => {
    if (contacto) {
      const { error } = await supabase
        .from("solicitudes_pendientes")
        .update({ telefono: contacto.telefono, email: contacto.email, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) {
        toast.error(`No se pudo guardar el teléfono/email del cliente: ${error.message}`);
        return { ok: false, error: "error_contacto", mensaje: error.message };
      }
    }
    const res = await llamarRpcPropuesta("fn_aceptar_propuesta_solicitud", id);
    if (!res.ok) {
      toast.error(res.error === "sin_migracion" || res.error === "error_rpc" ? res.mensaje ?? "Error" : mensajeErrorPropuesta(res.error, res.mensaje));
      await fetchSolicitudes();
      return res;
    }
    if (res.reserva_id && !res.ya_aceptada) {
      supabase.functions
        .invoke("notify-reservation-change", { body: { reserva_id: res.reserva_id } })
        .catch((err) => console.error("Error notificando la reserva nueva:", err));
    }
    if (res.ya_aceptada) toast.info("Ya estaba aceptada: la reserva existía.");
    else if (res.estado === "pendiente") toast.info("Reserva creada como pendiente de revisión (cliente en lista negra).");
    else if (res.estado === "verificada")
      toast.success("Reserva creada. Se ha enviado al cliente un correo para que la confirme. Solicitud resuelta.");
    else toast.success("Reserva creada y confirmada. Solicitud resuelta.");
    await fetchSolicitudes();
    return res;
  };

  const rechazarPropuestaTelefono = async (id: string): Promise<ResultadoPropuesta> => {
    const res = await llamarRpcPropuesta("fn_rechazar_propuesta_solicitud", id);
    if (!res.ok) toast.error(res.mensaje && res.error !== "ya_aceptada" ? res.mensaje : mensajeErrorPropuesta(res.error));
    else toast.success("Registrado: el cliente rechazó la propuesta.");
    await fetchSolicitudes();
    return res;
  };

  /** Tras convertir desde el formulario: enlaza la reserva y cierra la propuesta. */
  const marcarConvertida = async (id: string, reservaId: string | null) => {
    const ahora = new Date().toISOString();
    const base = { estado: "resuelta", updated_at: ahora };
    const conPropuesta = {
      ...base,
      propuesta_estado: "aceptada",
      propuesta_respondida_at: ahora,
      propuesta_respuesta_via: "telefono",
      propuesta_error: null,
      reserva_id: reservaId,
    };
    let { error } = await supabase.from("solicitudes_pendientes").update(conPropuesta as never).eq("id", id);
    if (error && esErrorEsquemaPendiente(error)) {
      ({ error } = await supabase.from("solicitudes_pendientes").update(base).eq("id", id));
    }
    if (error) {
      toast.error("La reserva se creó, pero no se pudo marcar la solicitud como resuelta");
      return false;
    }
    toast.success('Solicitud marcada como "resuelta"');
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
    enviarPropuesta,
    aceptarPropuestaTelefono,
    rechazarPropuestaTelefono,
    marcarConvertida,
  };
}
