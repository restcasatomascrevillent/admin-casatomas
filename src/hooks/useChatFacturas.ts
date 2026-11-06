import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { normalizarAdjuntos, type AdjuntoChat } from "@/lib/facturas/seriePrecio";
import { componerMensaje } from "@/lib/facturas/graficasCopiloto";

// ─── Tipos alineados con las tablas reales de Supabase ───────────────────────
// Tablas: chat_facturas_conversaciones, chat_facturas_mensajes

export interface Conversacion {
  id: string;
  session_id: string;
  titulo: string | null;
  created_at: string;
  updated_at: string;
}

export interface MensajeChat {
  id: string;
  contenido: string;
  rol: "user" | "assistant";
  conversacion_id: string;
  created_at: string;
  /**
   * `false` cuando el mensaje se pinta en pantalla pero NO se pudo escribir en
   * la base de datos. Permite avisar al usuario de que esa parte del hilo se
   * perdera al recargar, en lugar de fingir que todo fue bien.
   */
  persistido?: boolean;
  /** Gráficas que acompañan a la respuesta (columna `adjuntos` de la BD). */
  adjuntos?: AdjuntoChat[];
}

/**
 * `activo` = false (quien no tiene «Editar» en Facturas: sin IA, 06/11/2026):
 * no se pide el historial de conversaciones.
 */
export function useChatFacturas({ activo = true }: { activo?: boolean } = {}) {
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([]);
  const [conversacionActiva, setConversacionActiva] = useState<Conversacion | null>(null);
  const [mensajes, setMensajes] = useState<MensajeChat[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);

  // ─── Cargar lista de conversaciones ──────────────────────────────────────────
  const cargarConversaciones = useCallback(async () => {
    const { data, error } = await supabase
      .from("chat_facturas_conversaciones")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("Error cargando conversaciones:", error);
      return;
    }
    setConversaciones((data ?? []) as unknown as Conversacion[]);
  }, []);

  // ─── Cargar mensajes de una conversación ─────────────────────────────────────
  const cargarMensajes = useCallback(async (conversacionId: string) => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("chat_facturas_mensajes")
      .select("*")
      .eq("conversacion_id", conversacionId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error cargando mensajes:", error);
      setIsLoading(false);
      return;
    }

    // Columnas reales: id, conversacion_id, rol, contenido, created_at
    const filas = (data ?? []) as unknown as { id: string; contenido: string; rol: string; conversacion_id: string; created_at: string; adjuntos?: unknown }[];
    const mapped: MensajeChat[] = filas.map((m) => ({
      id: m.id,
      contenido: m.contenido,
      rol: m.rol as "user" | "assistant",
      conversacion_id: m.conversacion_id,
      created_at: m.created_at,
      persistido: true,
      adjuntos: normalizarAdjuntos(m.adjuntos),
    }));

    setMensajes(mapped);
    setIsLoading(false);
  }, []);

  // ─── Seleccionar conversación ─────────────────────────────────────────────────
  const seleccionarConversacion = useCallback(async (conv: Conversacion) => {
    setConversacionActiva(conv);
    await cargarMensajes(conv.id);
  }, [cargarMensajes]);

  // ─── Abrir una conversación por su id (`/facturas/ia?c=<id>`) ────────────────
  // La del historial ya cargado o, si aún no ha llegado, la de la base de datos.
  // false si no existe (borrada, o de otra cuenta: RLS no la devuelve).
  const abrirConversacionPorId = useCallback(async (id: string): Promise<boolean> => {
    let conv: Conversacion | null = conversaciones.find((c) => c.id === id) ?? null;
    if (!conv) {
      const { data, error } = await supabase.from("chat_facturas_conversaciones").select("*").eq("id", id).maybeSingle();
      if (error) {
        console.error("Error abriendo la conversación:", error);
        return false;
      }
      const fila = (Array.isArray(data) ? data[0] : data) as unknown as Conversacion | undefined;
      conv = fila?.id === id ? fila : null;
    }
    if (!conv) return false;
    await seleccionarConversacion(conv);
    return true;
  }, [conversaciones, seleccionarConversacion]);

  // ─── Crear nueva conversación ─────────────────────────────────────────────────
  const nuevaConversacion = useCallback(async (): Promise<Conversacion | null> => {
    const sessionId = crypto.randomUUID();
    const { data, error } = await supabase
      .from("chat_facturas_conversaciones")
      .insert({ session_id: sessionId, titulo: "Nueva conversación" })
      .select()
      .single();

    if (error) {
      console.error("Error creando conversación:", error);
      toast.error("No se pudo crear la conversación");
      return null;
    }

    const conv = data as unknown as Conversacion;
    setConversacionActiva(conv);
    setMensajes([]);
    await cargarConversaciones();
    return conv;
  }, [cargarConversaciones]);

  // ─── Guardar mensaje en Supabase ──────────────────────────────────────────────
  // `chat_facturas_mensajes` es una VISTA sobre la tabla `mensajes_chat`, cuya
  // columna `session_id` es NOT NULL. Omitirla hacia que TODOS los INSERT
  // fallasen con 23502 y, como el error solo iba a console.error, el chat
  // parecia funcionar mientras no guardaba ni un mensaje desde marzo de 2026.
  // Por eso `guardarMensaje` recibe la conversacion completa: necesita su
  // `session_id`, no solo el id.
  const guardarMensaje = useCallback(async (
    conversacion: Pick<Conversacion, "id" | "session_id">,
    contenido: string,
    rol: "user" | "assistant",
    adjuntos: AdjuntoChat[] = []
  ) => {
    const fila = {
      conversacion_id: conversacion.id,
      session_id: conversacion.session_id,
      contenido,
      rol,
    };
    const insertar = (extra: Record<string, unknown>) =>
      supabase
        .from("chat_facturas_mensajes")
        .insert({ ...fila, ...extra } as typeof fila)
        .select()
        .single();

    let { data, error } = await insertar(adjuntos.length > 0 ? { adjuntos } : {});
    if (error && adjuntos.length > 0) {
      // Columna `adjuntos` aún sin crear (migración sin aplicar): se guarda el
      // texto igualmente; la gráfica se ve ahora y se pierde al recargar.
      console.warn("[chat-facturas] Guardado con adjuntos fallido, se reintenta sin ellos:", error);
      ({ data, error } = await insertar({}));
    }

    if (error) {
      // Fallo VISIBLE: sin persistencia no hay memoria conversacional, asi que
      // el usuario tiene que enterarse en vez de descubrirlo al recargar.
      console.error("[chat-facturas] Error guardando mensaje:", error);
      toast.error("El mensaje no se ha guardado", {
        description:
          "La respuesta se muestra aqui, pero no quedara en el historial ni el asistente la recordara. " +
          (error.message || "Error desconocido"),
      });
      return null;
    }
    return data;
  }, []);

  // ─── Actualizar título de conversación ────────────────────────────────────────
  const actualizarTitulo = useCallback(async (convId: string, primerMensaje: string) => {
    // Limpiar prefijo automático del botón "Analizar con IA"
    let textoTitulo = primerMensaje
      .replace(/^Hola,\s*quiero hacerte una consulta sobre\s+/i, "")
      .trim();

    if (textoTitulo.length < 5) textoTitulo = primerMensaje;

    const titulo = textoTitulo.length > 55
      ? textoTitulo.substring(0, 55) + "…"
      : textoTitulo;

    await supabase
      .from("chat_facturas_conversaciones")
      .update({ titulo, updated_at: new Date().toISOString() })
      .eq("id", convId);

    await cargarConversaciones();
  }, [cargarConversaciones]);

  // ─── Enviar mensaje al chatbot (Edge Function `chat-facturas`) ───────────────
  // `contexto`: una gráfica sobre la que se pregunta (ver graficasCopiloto.ts).
  // Viaja al final del texto del mensaje: se guarda y se manda tal cual, así
  // que el modelo la ve sin cambiar la Edge Function. El título de la
  // conversación sale solo de la pregunta.
  const enviarMensaje = useCallback(async (pregunta: string, opciones?: { contexto?: string | null }) => {
    if (!pregunta.trim() || isSending) return;
    const texto = componerMensaje(pregunta, opciones?.contexto);

    let conv = conversacionActiva;

    if (!conv) {
      conv = await nuevaConversacion();
      if (!conv) return;
    }

    setIsSending(true);

    // Guardar mensaje del usuario en Supabase y usar el ID real de la BD
    const savedUserMsg = await guardarMensaje(conv, texto, "user");

    const msgUsuario: MensajeChat = {
      id: savedUserMsg?.id ?? crypto.randomUUID(),
      contenido: texto,
      rol: "user",
      conversacion_id: conv.id,
      created_at: savedUserMsg?.created_at ?? new Date().toISOString(),
      persistido: !!savedUserMsg,
    };
    setMensajes((prev) => [...prev, msgUsuario]);

    // Actualizar título si es el primer mensaje
    if (mensajes.length === 0) {
      await actualizarTitulo(conv.id, pregunta.trim());
    }

    try {
      // Llamar a la edge function con session_id = conv.session_id
      const { data, error } = await supabase.functions.invoke("chat-facturas", {
        body: {
          mensaje: texto,
          session_id: conv.session_id,
        },
      });

      if (error) throw new Error(error.message);

      const respuesta = data?.respuesta || "No pude obtener una respuesta.";
      const adjuntos = normalizarAdjuntos(data?.adjuntos);

      // Guardar respuesta del asistente en Supabase y usar el ID real
      const savedAssistantMsg = await guardarMensaje(conv, respuesta, "assistant", adjuntos);

      // Actualizar updated_at de la conversación
      await supabase
        .from("chat_facturas_conversaciones")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conv.id);

      const msgAsistente: MensajeChat = {
        id: savedAssistantMsg?.id ?? crypto.randomUUID(),
        contenido: respuesta,
        rol: "assistant",
        conversacion_id: conv.id,
        created_at: savedAssistantMsg?.created_at ?? new Date().toISOString(),
        persistido: !!savedAssistantMsg,
        adjuntos,
      };
      setMensajes((prev) => [...prev, msgAsistente]);
    } catch (error) {
      console.error("Error en chat:", error);
      toast.error("No se pudo enviar el mensaje");

      const msgError: MensajeChat = {
        id: crypto.randomUUID(),
        contenido: "⚠️ Hubo un problema al procesar tu consulta.",
        rol: "assistant",
        conversacion_id: conv.id,
        created_at: new Date().toISOString(),
      };
      setMensajes((prev) => [...prev, msgError]);
    } finally {
      setIsSending(false);
    }
  }, [conversacionActiva, isSending, mensajes.length, nuevaConversacion, guardarMensaje, actualizarTitulo]);

  // ─── Eliminar conversación ────────────────────────────────────────────────────
  const eliminarConversacion = useCallback(async (convId: string) => {
    // Borrar mensajes de la conversación primero (FK)
    const { error: msgErr } = await supabase.from("chat_facturas_mensajes").delete().eq("conversacion_id", convId);
    if (msgErr) {
      console.error("Error borrando mensajes:", msgErr);
      toast.error("No se pudieron borrar los mensajes");
      return;
    }
    const { error: convErr } = await supabase.from("chat_facturas_conversaciones").delete().eq("id", convId);
    if (convErr) {
      console.error("Error borrando conversación:", convErr);
      toast.error("No se pudo borrar la conversación");
      return;
    }

    if (conversacionActiva?.id === convId) {
      setConversacionActiva(null);
      setMensajes([]);
    }

    await cargarConversaciones();
  }, [conversacionActiva, cargarConversaciones]);

  // ─── Regenerar última respuesta del asistente ─────────────────────────────
  const regenerarRespuesta = useCallback(async () => {
    if (isSending || mensajes.length === 0) return;

    // Buscar el último mensaje del usuario anterior al último mensaje del asistente
    const lastUserMsg = [...mensajes].reverse().find((m) => m.rol === "user");
    if (!lastUserMsg) return;

    // Eliminar el último mensaje del asistente del estado local y de la BD
    const lastAssistantMsg = [...mensajes].reverse().find((m) => m.rol === "assistant");
    if (lastAssistantMsg) {
      setMensajes((prev) => prev.filter((m) => m.id !== lastAssistantMsg.id));
      // Solo tiene sentido borrar en BD lo que llego a escribirse en BD.
      if (lastAssistantMsg.persistido) {
        await supabase
          .from("chat_facturas_mensajes")
          .delete()
          .eq("id", lastAssistantMsg.id)
          .eq("conversacion_id", conversacionActiva?.id ?? "");
      }
    }

    // Reenviar el mensaje del usuario (sin guardarlo de nuevo en DB ni en el estado)
    if (!conversacionActiva) return;
    setIsSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("chat-facturas", {
        body: { mensaje: lastUserMsg.contenido, session_id: conversacionActiva.session_id, tipo_interaccion: "regeneracion" },
      });
      if (error) throw new Error(error.message);
      const respuesta = data?.respuesta || "No pude obtener una respuesta.";
      const adjuntos = normalizarAdjuntos(data?.adjuntos);
      const savedMsg = await guardarMensaje(conversacionActiva, respuesta, "assistant", adjuntos);
      // Mantener la conversacion arriba en la lista tras regenerar.
      await supabase
        .from("chat_facturas_conversaciones")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversacionActiva.id);
      setMensajes((prev) => [
        ...prev,
        {
          id: savedMsg?.id ?? crypto.randomUUID(),
          contenido: respuesta,
          rol: "assistant",
          conversacion_id: conversacionActiva.id,
          created_at: savedMsg?.created_at ?? new Date().toISOString(),
          persistido: !!savedMsg,
          adjuntos,
        },
      ]);
    } catch {
      toast.error("No se pudo regenerar la respuesta");
    } finally {
      setIsSending(false);
    }
  }, [isSending, mensajes, conversacionActiva, guardarMensaje]);

  // ─── Cargar conversaciones al montar ─────────────────────────────────────
  useEffect(() => {
    if (!activo) return;
    cargarConversaciones();
  }, [cargarConversaciones, activo]);

  return {
    conversaciones,
    conversacionActiva,
    mensajes,
    isLoading,
    isSending,
    seleccionarConversacion,
    abrirConversacionPorId,
    nuevaConversacion,
    enviarMensaje,
    regenerarRespuesta,
    eliminarConversacion,
    cargarConversaciones,
  };
}

