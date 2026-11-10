import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { nombreCanalUnico, programarSondeo, vigilarCanal } from "@/lib/realtimeCanal";

export interface NotificacionDashboard {
  id: string;
  tipo: string;
  titulo: string;
  mensaje: string | null;
  referencia_id: string | null;
  referencia_tipo: string | null;
  leida: boolean;
  created_at: string;
  /** Alertas de Facturas (20261107300000): prioridad, caducidad y datos (enlace del panel, cifras). */
  prioridad?: string | null;
  caduca_en?: string | null;
  datos?: { enlace?: string | null; [k: string]: unknown } | null;
  /** Clave de las alertas generadas por cron (no se duplican por ella). */
  clave?: string | null;
}

/**
 * Prefijo del canal realtime. El nombre lleva además un número propio de cada suscripción
 * (`nombreCanalUnico`): en el Dashboard en móvil hay DOS campanas montadas a la vez y con un
 * nombre fijo compartían canal, que se cerraba («mismatch») en cuanto se suscribía la segunda.
 */
/**
 * ¿Va a la campana? Las alertas de precio pequeñas (datos.campana = false, < 10 €
 * al mes: 20261115100000_facturas_decision) solo se ven en Facturas › Análisis.
 */
export const vaALaCampana = (n: Pick<NotificacionDashboard, "datos">): boolean => n.datos?.campana !== false;

/**
 * ¿Es una alerta diaria de Facturas (cron facturas-alertas, 20261107300000)? Se reconocen por su
 * `referencia_tipo` y su `clave` (la que el cron usa para no duplicarlas).
 */
export const esAlertaFacturas = (n: Pick<NotificacionDashboard, "tipo" | "referencia_tipo"> & { clave?: string | null }): boolean =>
  n.referencia_tipo === "facturas_alerta" || (n.tipo.startsWith("facturas_") && !!n.clave);

export const PREFIJO_CANAL_NOTIFICACIONES = "notificaciones_realtime";

const MAX_NOTIFICACIONES = 50;

export function useNotificacionesDashboard() {
  const [notificaciones, setNotificaciones] = useState<NotificacionDashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [countNoLeidas, setCountNoLeidas] = useState(0);
  // Las lecturas se pueden cruzar (la del montaje y la de cada SUBSCRIBED): solo aplica su
  // resultado la ÚLTIMA que se lanzó, así una respuesta vieja no pisa a una nueva.
  const ultimaLectura = useRef(0);
  const leyendo = useRef(false);
  // Ids que hay en la lista: una notificación que trae la relectura y TAMBIÉN llega por realtime
  // (pasa justo al suscribirse o al reconectar) no se pinta dos veces ni suma dos al contador.
  const idsEnLista = useRef<Set<string>>(new Set());
  // Notificaciones llegadas por realtime mientras había una lectura en vuelo: si esa lectura se
  // hizo justo antes de que se insertaran no las trae, y al aplicarla se perderían.
  const llegadasDuranteLectura = useRef<NotificacionDashboard[]>([]);

  /** `silencioso`: la relectura al (re)suscribirse no vuelve a poner `loading`. */
  const fetchNotificaciones = useCallback(async (opciones?: { silencioso?: boolean }) => {
    const lectura = ++ultimaLectura.current;
    leyendo.current = true;
    llegadasDuranteLectura.current = [];
    if (!opciones?.silencioso) setLoading(true);
    const { data, error } = await supabase
      .from("notificaciones_dashboard")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(MAX_NOTIFICACIONES);

    if (lectura !== ultimaLectura.current) return; // hay otra lectura más nueva: manda esa
    leyendo.current = false;

    if (error) {
      console.error("Error cargando notificaciones:", error);
    } else {
      // Las alertas de Facturas caducadas (ya no se cumplen) no se enseñan.
      const ahora = Date.now();
      const leidas = ((data || []) as NotificacionDashboard[]).filter((n) => (!n.caduca_en || Date.parse(n.caduca_en) > ahora) && vaALaCampana(n));
      const idsLeidas = new Set(leidas.map((n) => n.id));
      const items = [
        ...llegadasDuranteLectura.current.filter((n) => !idsLeidas.has(n.id)),
        ...leidas,
      ].slice(0, MAX_NOTIFICACIONES);
      idsEnLista.current = new Set(items.map((n) => n.id));
      setNotificaciones(items);
      setCountNoLeidas(items.filter((n) => !n.leida).length);
    }
    llegadasDuranteLectura.current = [];
    setLoading(false);
  }, []);

  // Optimista: refleja el cambio al instante y solo revierte si Supabase falla,
  // para que marcar como leída / eliminar se sienta inmediato en el popover.
  const marcarLeida = async (id: string) => {
    const notif = notificaciones.find((n) => n.id === id);
    if (!notif || notif.leida) return;

    setNotificaciones((prev) =>
      prev.map((n) => (n.id === id ? { ...n, leida: true } : n))
    );
    setCountNoLeidas((prev) => Math.max(0, prev - 1));

    const { error } = await supabase
      .from("notificaciones_dashboard")
      .update({ leida: true })
      .eq("id", id);

    if (error) {
      console.error("Error marcando notificación como leída:", error);
      toast.error("No se pudo marcar la notificación como leída");
      fetchNotificaciones();
    }
  };

  const marcarTodasLeidas = async () => {
    if (countNoLeidas === 0) return;

    setNotificaciones((prev) => prev.map((n) => ({ ...n, leida: true })));
    setCountNoLeidas(0);

    const { error } = await supabase
      .from("notificaciones_dashboard")
      .update({ leida: true })
      .eq("leida", false);

    if (error) {
      console.error("Error marcando todas las notificaciones como leídas:", error);
      toast.error("No se pudieron marcar las notificaciones como leídas");
      fetchNotificaciones();
    }
  };

  const eliminarNotificacion = async (id: string) => {
    const notif = notificaciones.find((n) => n.id === id);
    if (!notif) return;

    setNotificaciones((prev) => prev.filter((n) => n.id !== id));
    if (!notif.leida) {
      setCountNoLeidas((prev) => Math.max(0, prev - 1));
    }

    // Las alertas diarias de Facturas (cron facturas-alertas) NO se borran: de ellas salen las cifras de
    // Facturas › Análisis («Puedes ahorrar», «Precios que han subido»…), que se quedaban a 0 € hasta que el
    // cron las volvía a crear a la mañana siguiente (10/11/2026). Se quitan de la campana (leídas y con
    // `datos.campana = false`, como las subidas pequeñas) y siguen contando en Análisis.
    const { error } = esAlertaFacturas(notif)
      ? await supabase
          .from("notificaciones_dashboard")
          .update({ leida: true, datos: { ...(notif.datos ?? {}), campana: false } })
          .eq("id", id)
      : await supabase
          .from("notificaciones_dashboard")
          .delete()
          .eq("id", id);

    if (error) {
      console.error("Error eliminando notificación:", error);
      toast.error("No se pudo eliminar la notificación");
      fetchNotificaciones();
    }
  };

  useEffect(() => {
    fetchNotificaciones();

    // Suscripción en tiempo real para nuevas notificaciones. Hasta que la tabla esté en la
    // publicación `supabase_realtime` (migración 20261001200000) no llega ningún evento: el aviso
    // `[realtime]` de la consola lo dice, y la campana se pone al día con el sondeo de abajo, al
    // montarse y al reconectar.
    // Solo INSERT a propósito: marcar leída o borrar en OTRO dispositivo no se refleja aquí hasta
    // la siguiente relectura (el sondeo, como mucho un minuto).
    const nombre = nombreCanalUnico(PREFIJO_CANAL_NOTIFICACIONES);
    // Cada SUBSCRIBED (el primero y cada vez que el canal se recupera tras una caída de red o una
    // tablet dormida) relee en silencio: Realtime no reenvía lo que pasó mientras estaba caído.
    const vigilancia = vigilarCanal(nombre, {
      tabla: "notificaciones_dashboard",
      alSuscribirse: () => void fetchNotificaciones({ silencioso: true }),
    });
    const channel = supabase
      .channel(nombre)
      .on("system", {}, vigilancia.alMensajeSistema)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notificaciones_dashboard" },
        (payload) => {
          const nueva = payload.new as NotificacionDashboard;
          if (nueva?.id) {
            if (idsEnLista.current.has(nueva.id)) return; // ya la trajo la relectura
            if (!vaALaCampana(nueva)) return; // alerta pequeña: solo en Análisis
            idsEnLista.current.add(nueva.id);
          }
          if (leyendo.current) llegadasDuranteLectura.current.unshift(nueva);
          setNotificaciones((prev) => [nueva, ...prev].slice(0, MAX_NOTIFICACIONES));
          setCountNoLeidas((prev) => prev + 1);
        }
      )
      .subscribe(vigilancia.alCambiarEstado);

    // Respaldo sin realtime, el mismo que las solicitudes: relectura silenciosa cada minuto, solo
    // con la pestaña a la vista y nunca encima de otra lectura en curso.
    const pararSondeo = programarSondeo(() => {
      if (leyendo.current) return;
      void fetchNotificaciones({ silencioso: true });
    });

    return () => {
      pararSondeo();
      vigilancia.cerrar();
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
    eliminarNotificacion,
  };
}
