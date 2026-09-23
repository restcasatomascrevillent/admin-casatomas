import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

/**
 * Tráfico web (Vercel Web Analytics) + FDT ESTIMADO.
 *
 * Toda la estadística se calcula en las RPC `trafico_web_*` (migración
 * 20260923200000_trafico_web.sql, security invoker → aplica la RLS de la
 * sección `trafico_web`). Aquí solo se piden y se tipan; no se recalcula nada.
 *
 * Regla de oro: NULL = "sin datos", nunca 0. Un día sin sincronizar no es un
 * día sin visitas, así que los tipos conservan `number | null`.
 */

export const PROYECTOS_TRAFICO = ["casa-tomas-story", "touza-restaurant-website"] as const;
export type ProyectoTrafico = (typeof PROYECTOS_TRAFICO)[number];
/** "ambos" se envía a las RPC como p_proyecto = NULL (suma de las dos webs). */
export type FiltroProyecto = ProyectoTrafico | "ambos";
export type DimensionDesglose = "device" | "country" | "referrer";
export type OrdenTopPaginas = "visitas" | "bytes";

export const NOMBRE_PROYECTO: Record<ProyectoTrafico, string> = {
  "casa-tomas-story": "Casa Tomás",
  "touza-restaurant-website": "Touza",
};

/** Límite de Fast Data Transfer del plan Hobby: 100 GB decimales (así factura Vercel). */
export const LIMITE_FDT_BYTES = 100e9;

type Fns = Database["public"]["Functions"];
export type FilaSerie = Fns["trafico_web_serie"]["Returns"][number];
export type FilaTendenciaRaw = Fns["trafico_web_tendencia"]["Returns"][number];
export type FilaFdtMes = Fns["trafico_web_fdt_mes"]["Returns"][number];
export type FilaTopPagina = Fns["trafico_web_top_paginas"]["Returns"][number];
export type FilaDesglose = Fns["trafico_web_desglose_resumen"]["Returns"][number];
export type EstadoSync = Database["public"]["Tables"]["trafico_web_sync_estado"]["Row"];
export type PesoPagina = Database["public"]["Tables"]["peso_paginas"]["Row"];

export interface PuntoProyeccion {
  fecha: string;
  visitas: number;
}

export interface Tendencia extends Omit<FilaTendenciaRaw, "proyeccion"> {
  proyeccion: PuntoProyeccion[];
}

const STALE_TIME = 10 * 60 * 1000;
const RAIZ = "trafico-web";

const aParam = (proyecto: FiltroProyecto): string | null => (proyecto === "ambos" ? null : proyecto);

/**
 * PostgREST serializa `numeric` como número JSON, pero por si alguna versión
 * lo devuelve como string (precisión) lo normalizamos sin convertir NULL en 0.
 */
const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const parsearProyeccion = (json: Json | null): PuntoProyeccion[] => {
  if (!Array.isArray(json)) return [];
  const puntos: PuntoProyeccion[] = [];
  for (const item of json) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const fecha = item.fecha;
      const visitas = num(item.visitas);
      if (typeof fecha === "string" && visitas !== null) puntos.push({ fecha, visitas });
    }
  }
  return puntos;
};

// ─── Serie diaria (medias, bandas por día de semana, anomalías) ──────────────
export function useSerieTrafico(proyecto: FiltroProyecto, desde: string, hasta: string) {
  return useQuery({
    queryKey: [RAIZ, "trafico_web_serie", { proyecto, desde, hasta }],
    staleTime: STALE_TIME,
    queryFn: async (): Promise<FilaSerie[]> => {
      const { data, error } = await supabase.rpc("trafico_web_serie", {
        p_proyecto: aParam(proyecto),
        p_desde: desde,
        p_hasta: hasta,
      });
      if (error) throw error;
      return (data ?? []).map((f) => ({
        ...f,
        visitas: num(f.visitas),
        visitantes: num(f.visitantes),
        media_7: num(f.media_7),
        media_30: num(f.media_30),
        desv_30: num(f.desv_30),
        media_dow: num(f.media_dow),
        desv_dow: num(f.desv_dow),
        z_dow: num(f.z_dow),
        desviacion_pct: num(f.desviacion_pct),
      }));
    },
  });
}

// ─── Regresión lineal + proyección 30 días ───────────────────────────────────
export function useTendenciaTrafico(proyecto: FiltroProyecto, dias: number) {
  return useQuery({
    queryKey: [RAIZ, "trafico_web_tendencia", { proyecto, dias }],
    staleTime: STALE_TIME,
    queryFn: async (): Promise<Tendencia | null> => {
      const { data, error } = await supabase.rpc("trafico_web_tendencia", {
        p_proyecto: aParam(proyecto),
        p_dias: dias,
      });
      if (error) throw error;
      const fila = data?.[0];
      if (!fila) return null;
      return {
        ...fila,
        pendiente: num(fila.pendiente),
        intercepto: num(fila.intercepto),
        r2: num(fila.r2),
        total_30d: num(fila.total_30d),
        n: num(fila.n) ?? 0,
        proyeccion: parsearProyeccion(fila.proyeccion),
      };
    },
  });
}

// ─── FDT estimado del mes en curso ───────────────────────────────────────────
export function useFdtMes() {
  return useQuery({
    queryKey: [RAIZ, "trafico_web_fdt_mes"],
    staleTime: STALE_TIME,
    queryFn: async (): Promise<FilaFdtMes[]> => {
      const { data, error } = await supabase.rpc("trafico_web_fdt_mes", {});
      if (error) throw error;
      return (data ?? []).map((f) => ({
        ...f,
        visitas_mes: num(f.visitas_mes),
        bytes_acumulados: num(f.bytes_acumulados),
        bytes_medios_por_visita: num(f.bytes_medios_por_visita),
        bytes_proy_lineal: num(f.bytes_proy_lineal),
        bytes_proy_regresion: num(f.bytes_proy_regresion),
        limite_bytes: num(f.limite_bytes) ?? LIMITE_FDT_BYTES,
        pct_limite: num(f.pct_limite),
        pct_proyectado: num(f.pct_proyectado),
      }));
    },
  });
}

// ─── Top páginas por visitas o por bytes estimados ───────────────────────────
export function useTopPaginas(
  proyecto: FiltroProyecto,
  desde: string,
  hasta: string,
  orden: OrdenTopPaginas,
  limite = 15,
) {
  return useQuery({
    queryKey: [RAIZ, "trafico_web_top_paginas", { proyecto, desde, hasta, orden, limite }],
    staleTime: STALE_TIME,
    queryFn: async (): Promise<FilaTopPagina[]> => {
      const { data, error } = await supabase.rpc("trafico_web_top_paginas", {
        p_proyecto: aParam(proyecto),
        p_desde: desde,
        p_hasta: hasta,
        p_limite: limite,
        p_orden: orden,
      });
      if (error) throw error;
      return (data ?? []).map((f) => ({
        ...f,
        visitas: num(f.visitas) ?? 0,
        bytes_estimados: num(f.bytes_estimados),
        pct_visitas: num(f.pct_visitas),
        pct_bytes: num(f.pct_bytes),
      }));
    },
  });
}

// ─── Desgloses device / country / referrer ───────────────────────────────────
export function useDesgloseTrafico(
  proyecto: FiltroProyecto,
  dimension: DimensionDesglose,
  desde: string,
  hasta: string,
  limite = 8,
) {
  return useQuery({
    queryKey: [RAIZ, "trafico_web_desglose_resumen", { proyecto, dimension, desde, hasta, limite }],
    staleTime: STALE_TIME,
    queryFn: async (): Promise<FilaDesglose[]> => {
      const { data, error } = await supabase.rpc("trafico_web_desglose_resumen", {
        p_proyecto: aParam(proyecto),
        p_dimension: dimension,
        p_desde: desde,
        p_hasta: hasta,
        p_limite: limite,
      });
      if (error) throw error;
      return (data ?? []).map((f) => ({
        ...f,
        visitas: num(f.visitas) ?? 0,
        visitantes: num(f.visitantes),
        pct: num(f.pct),
      }));
    },
  });
}

// ─── Estado de la sincronización (aviso de sync obsoleto / error) ────────────
export function useEstadoSyncTrafico() {
  return useQuery({
    queryKey: [RAIZ, "sync_estado"],
    staleTime: STALE_TIME,
    queryFn: async (): Promise<EstadoSync[]> => {
      const { data, error } = await supabase
        .from("trafico_web_sync_estado")
        .select("*")
        .order("proyecto");
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ─── Pesos por página (editor) ───────────────────────────────────────────────
export function usePesoPaginas() {
  return useQuery({
    queryKey: [RAIZ, "peso_paginas"],
    staleTime: STALE_TIME,
    queryFn: async (): Promise<PesoPagina[]> => {
      const { data, error } = await supabase
        .from("peso_paginas")
        .select("*")
        .order("proyecto")
        .order("ruta");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface GuardarPesoInput {
  proyecto: ProyectoTrafico;
  ruta: string;
  bytes_por_visita: number;
  nota: string | null;
}

/**
 * Upsert por PK (proyecto, ruta). No hay trigger en la tabla, así que
 * `actualizado_en` se fija aquí explícitamente. Invalida todo `trafico-web`
 * porque el peso cambia el FDT y el top por bytes.
 */
export function useGuardarPesoPagina() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: GuardarPesoInput) => {
      const { error } = await supabase.from("peso_paginas").upsert(
        {
          proyecto: input.proyecto,
          ruta: input.ruta,
          bytes_por_visita: Math.round(input.bytes_por_visita),
          nota: input.nota,
          actualizado_en: new Date().toISOString(),
        },
        { onConflict: "proyecto,ruta" },
      );
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [RAIZ] }),
  });
}

export function useBorrarPesoPagina() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ proyecto, ruta }: { proyecto: ProyectoTrafico; ruta: string }) => {
      if (ruta === "*") throw new Error("El peso medio del proyecto ('*') no se puede borrar: es el fallback del FDT.");
      const { error } = await supabase.from("peso_paginas").delete().eq("proyecto", proyecto).eq("ruta", ruta);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [RAIZ] }),
  });
}
