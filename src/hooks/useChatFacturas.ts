import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

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
  session_id: string;
  conversacion_id: string | null;
  created_at: string;
}

export function useChatFacturas() {
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([]);
  const [conversacionActiva, setConversacionActiva] = useState<Conversacion | null>(null);
  const [mensajes, setMensajes] = useState<MensajeChat[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const { toast } = useToast();

  // Cargar lista de conversaciones
  const cargarConversaciones = useCallback(async () => {
    const { data, error } = await supabase
      .from("conversaciones")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("Error cargando conversaciones:", error);
      return;
    }
    setConversaciones((data ?? []) as unknown as Conversacion[]);
  }, []);

  // Cargar mensajes de una conversación
  const cargarMensajes = useCallback(async (sessionId: string) => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("mensajes_chat")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error cargando mensajes:", error);
      setIsLoading(false);
      return;
    }

    const mapped: MensajeChat[] = (data ?? []).map((m: any) => ({
      id: m.id,
      contenido: m.content,
      rol: m.role as "user" | "assistant",
      session_id: m.session_id,
      conversacion_id: m.conversacion_id,
      created_at: m.created_at,
    }));

    setMensajes(mapped);
    setIsLoading(false);
  }, []);

  // Seleccionar conversación
  const seleccionarConversacion = useCallback(async (conv: Conversacion) => {
    setConversacionActiva(conv);
    await cargarMensajes(conv.session_id);
  }, [cargarMensajes]);

  // Crear nueva conversación
  const nuevaConversacion = useCallback(async (): Promise<Conversacion | null> => {
    const sessionId = crypto.randomUUID();
    const { data, error } = await supabase
      .from("conversaciones")
      .insert({ session_id: sessionId, titulo: "Nueva conversación" })
      .select()
      .single();

    if (error) {
      console.error("Error creando conversación:", error);
      toast({
        title: "Error",
        description: "No se pudo crear la conversación",
        variant: "destructive",
      });
      return null;
    }

    const conv = data as unknown as Conversacion;
    setConversacionActiva(conv);
    setMensajes([]);
    await cargarConversaciones();
    return conv;
  }, [cargarConversaciones, toast]);

  // Guardar mensaje en Supabase
  const guardarMensaje = useCallback(async (
    sessionId: string,
    contenido: string,
    rol: "user" | "assistant"
  ) => {
    const { data, error } = await supabase
      .from("mensajes_chat")
      .insert({
        session_id: sessionId,
        content: contenido,
        role: rol,
      })
      .select()
      .single();

    if (error) {
      console.error("Error guardando mensaje:", error);
      return null;
    }

    return data;
  }, []);

  // Actualizar título de conversación basado en primer mensaje
  const actualizarTitulo = useCallback(async (convId: string, primerMensaje: string) => {
    const titulo = primerMensaje.length > 50
      ? primerMensaje.substring(0, 50) + "..."
      : primerMensaje;

    await supabase
      .from("conversaciones")
      .update({ titulo })
      .eq("id", convId);

    await cargarConversaciones();
  }, [cargarConversaciones]);

  // Enviar mensaje al webhook via edge function
  const enviarMensaje = useCallback(async (texto: string) => {
    if (!texto.trim() || isSending) return;

    let conv = conversacionActiva;

    // Si no hay conversación activa, crear una nueva
    if (!conv) {
      conv = await nuevaConversacion();
      if (!conv) return;
    }

    setIsSending(true);

    // Guardar mensaje del usuario
    await guardarMensaje(conv.session_id, texto, "user");

    // Añadir mensaje localmente
    const msgUsuario: MensajeChat = {
      id: crypto.randomUUID(),
      contenido: texto,
      rol: "user",
      session_id: conv.session_id,
      conversacion_id: conv.id,
      created_at: new Date().toISOString(),
    };
    setMensajes((prev) => [...prev, msgUsuario]);

    // Actualizar título si es el primer mensaje
    if (mensajes.length === 0) {
      await actualizarTitulo(conv.id, texto);
    }

    try {
      // Enviar al edge function solo con session_id
      const { data, error } = await supabase.functions.invoke("chat-facturas", {
        body: {
          mensaje: texto,
          session_id: conv.session_id,
        },
      });

      if (error) throw new Error(error.message);

      const respuesta = data?.respuesta || "No pude obtener una respuesta.";

      // Guardar respuesta en Supabase
      await guardarMensaje(conv.session_id, respuesta, "assistant");

      // Añadir respuesta localmente
      const msgAsistente: MensajeChat = {
        id: crypto.randomUUID(),
        contenido: respuesta,
        rol: "assistant",
        session_id: conv.session_id,
        conversacion_id: conv.id,
        created_at: new Date().toISOString(),
      };
      setMensajes((prev) => [...prev, msgAsistente]);
    } catch (error) {
      console.error("Error en chat:", error);
      toast({
        title: "Error",
        description: "No se pudo enviar el mensaje.",
        variant: "destructive",
      });

      const msgError: MensajeChat = {
        id: crypto.randomUUID(),
        contenido: "⚠️ Hubo un problema al procesar tu consulta.",
        rol: "assistant",
        session_id: conv.session_id,
        conversacion_id: conv.id,
        created_at: new Date().toISOString(),
      };
      setMensajes((prev) => [...prev, msgError]);
    } finally {
      setIsSending(false);
    }
  }, [conversacionActiva, isSending, mensajes.length, nuevaConversacion, guardarMensaje, actualizarTitulo, toast]);

  // Eliminar conversación
  const eliminarConversacion = useCallback(async (convId: string, sessionId: string) => {
    // Borrar mensajes primero
    await supabase.from("mensajes_chat").delete().eq("session_id", sessionId);
    await supabase.from("conversaciones").delete().eq("id", convId);

    if (conversacionActiva?.id === convId) {
      setConversacionActiva(null);
      setMensajes([]);
    }

    await cargarConversaciones();
  }, [conversacionActiva, cargarConversaciones]);

  // Cargar conversaciones al montar
  useEffect(() => {
    cargarConversaciones();
  }, [cargarConversaciones]);

  return {
    conversaciones,
    conversacionActiva,
    mensajes,
    isLoading,
    isSending,
    seleccionarConversacion,
    nuevaConversacion,
    enviarMensaje,
    eliminarConversacion,
    cargarConversaciones,
  };
}
