// Estado de las PREGUNTAS RÁPIDAS del chat de facturas (sin IA).
//
// DECISIÓN (07/10/2026): los resultados viven SOLO en memoria del navegador.
//   · No se escriben en `chat_facturas_mensajes` ni en ninguna tabla.
//   · No entran en `mensajes` de useChatFacturas.
// La Edge Function `chat-facturas` reconstruye el contexto leyendo el
// historial de la BD por `session_id`, así que lo que no se guarda nunca le
// llega al modelo: la siguiente pregunta libre a la IA no carga con estos
// datos (0 tokens). Contrapartida: al recargar o cambiar de conversación
// desaparecen; se vuelven a pedir con un toque y son al instante.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { LlamarRpc, PreguntaRapida } from "@/components/facturas/preguntas-rapidas/catalogo";

export interface ResultadoRapido {
  id: string;
  preguntaId: string;
  estado: "cargando" | "ok" | "error";
  datos?: unknown;
  error?: string;
  /** ISO; solo para enseñar la hora. */
  creadoEn: string;
  /**
   * Nº de mensajes de la conversación que había al pedirlo: la tarjeta se
   * pinta justo después de ese mensaje (no depende del reloj del servidor).
   */
  despuesDe: number;
}

/** supabase.rpc sin los tipos generados (no todas las *_agente están en types.ts). */
export const llamarRpcSupabase: LlamarRpc = async (funcion, args) => {
  const rpc = supabase.rpc as unknown as (
    this: typeof supabase,
    fn: string,
    a?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
  const { data, error } = await rpc.call(supabase, funcion, args);
  if (error) throw new Error(error.message || "Error en la consulta");
  return data;
};

const MAX_RESULTADOS = 20;

interface Opciones {
  catalogo: PreguntaRapida[];
  llamarRpc?: LlamarRpc;
  /** Inyectable en pruebas. */
  ahora?: () => Date;
}

export function usePreguntasRapidas({ catalogo, llamarRpc = llamarRpcSupabase, ahora = () => new Date() }: Opciones) {
  const [resultados, setResultados] = useState<ResultadoRapido[]>([]);
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const lanzar = useCallback(
    async (preguntaId: string, despuesDe: number) => {
      const pregunta = catalogo.find((p) => p.id === preguntaId);
      if (!pregunta?.consultar || pregunta.proximamente) return;
      const id = crypto.randomUUID();
      setResultados((prev) =>
        [...prev, { id, preguntaId, estado: "cargando" as const, creadoEn: new Date().toISOString(), despuesDe }].slice(
          -MAX_RESULTADOS,
        ),
      );
      try {
        const datos = await pregunta.consultar(llamarRpc, ahora());
        if (!montado.current) return;
        setResultados((prev) => prev.map((r) => (r.id === id ? { ...r, estado: "ok", datos } : r)));
      } catch (e) {
        if (!montado.current) return;
        const error = e instanceof Error ? e.message : String(e);
        console.error(`[preguntas-rapidas] ${preguntaId}:`, e);
        setResultados((prev) => prev.map((r) => (r.id === id ? { ...r, estado: "error", error } : r)));
      }
    },
    // `ahora` suele ser una flecha nueva en cada render; no hace falta como dependencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalogo, llamarRpc],
  );

  const descartar = useCallback((id: string) => setResultados((prev) => prev.filter((r) => r.id !== id)), []);
  const limpiar = useCallback(() => setResultados([]), []);
  const cargando = (preguntaId: string) => resultados.some((r) => r.preguntaId === preguntaId && r.estado === "cargando");

  return { resultados, lanzar, descartar, limpiar, cargando };
}
