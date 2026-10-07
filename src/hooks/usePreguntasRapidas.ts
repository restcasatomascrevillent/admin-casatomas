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
import type { ContextoConsulta, LlamarRpc, PreguntaRapida } from "@/components/facturas/preguntas-rapidas/catalogo";
import { esErrorRpcInexistente, RpcNoDisponibleError } from "@/lib/facturas/preguntasRapidas";

export interface ResultadoRapido {
  id: string;
  preguntaId: string;
  /** `no_disponible`: la RPC aún no existe en la BD (migración sin aplicar). */
  estado: "cargando" | "ok" | "error" | "no_disponible";
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
  ) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
  const { data, error } = await rpc.call(supabase, funcion, args);
  if (esErrorRpcInexistente(error)) throw new RpcNoDisponibleError(funcion);
  if (error) throw new Error(error.message || "Error en la consulta");
  return data;
};

/**
 * Umbral de «subida de precio» configurado en Facturas › Productos
 * (`configuracion_facturas`, migración 20261007170000). null si no se puede
 * leer (tabla aún sin crear, sin fila o error): la pregunta usa el defecto.
 */
export const leerUmbralSubidaPrecio = async (): Promise<number | null> => {
  try {
    // types.ts (a mano) no conoce aún la tabla.
    const tabla = (supabase.from as unknown as (t: string) => {
      select: (c: string) => { limit: (n: number) => PromiseLike<{ data: unknown; error: unknown }> };
    })("configuracion_facturas");
    const { data, error } = await tabla.select("umbral_subida_precio_pct").limit(1);
    if (error || !Array.isArray(data) || data.length === 0) return null;
    const n = Number((data[0] as { umbral_subida_precio_pct?: unknown }).umbral_subida_precio_pct);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
};

const MAX_RESULTADOS = 20;

interface Opciones {
  catalogo: PreguntaRapida[];
  llamarRpc?: LlamarRpc;
  leerUmbral?: ContextoConsulta["umbralSubidaPrecio"];
  /** Inyectable en pruebas. */
  ahora?: () => Date;
}

export function usePreguntasRapidas({
  catalogo,
  llamarRpc = llamarRpcSupabase,
  leerUmbral = leerUmbralSubidaPrecio,
  ahora = () => new Date(),
}: Opciones) {
  const [resultados, setResultados] = useState<ResultadoRapido[]>([]);
  // Preguntas cuya RPC aún no existe: el botón se apaga hasta recargar.
  const [noDisponibles, setNoDisponibles] = useState<ReadonlySet<string>>(new Set());
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
        const datos = await pregunta.consultar(llamarRpc, ahora(), { umbralSubidaPrecio: leerUmbral });
        if (!montado.current) return;
        setResultados((prev) => prev.map((r) => (r.id === id ? { ...r, estado: "ok", datos } : r)));
      } catch (e) {
        if (!montado.current) return;
        if (e instanceof RpcNoDisponibleError) {
          setNoDisponibles((prev) => new Set(prev).add(preguntaId));
          setResultados((prev) => prev.map((r) => (r.id === id ? { ...r, estado: "no_disponible" } : r)));
          return;
        }
        const error = e instanceof Error ? e.message : String(e);
        console.error(`[preguntas-rapidas] ${preguntaId}:`, e);
        setResultados((prev) => prev.map((r) => (r.id === id ? { ...r, estado: "error", error } : r)));
      }
    },
    // `ahora` suele ser una flecha nueva en cada render; no hace falta como dependencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalogo, llamarRpc, leerUmbral],
  );

  const descartar = useCallback((id: string) => setResultados((prev) => prev.filter((r) => r.id !== id)), []);
  const limpiar = useCallback(() => setResultados([]), []);
  const cargando = (preguntaId: string) => resultados.some((r) => r.preguntaId === preguntaId && r.estado === "cargando");

  const noDisponible = (preguntaId: string) => noDisponibles.has(preguntaId);

  return { resultados, lanzar, descartar, limpiar, cargando, noDisponible };
}
