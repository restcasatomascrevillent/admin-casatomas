import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/**
 * Costes del sistema: lo que CUESTA mantenerlo (la otra cara de Gestor de
 * Gasto, que es lo que se factura al restaurante).
 *
 * Dos mitades que no se mezclan:
 *  - IA (variable, USD): sale de las RPC `ia_coste_*`, que cruzan los tokens
 *    registrados con el tarifario `ia_precios`. Si un modelo no está tarifado,
 *    su coste es NULL — no 0.
 *  - Fijos (EUR): tabla `costes_fijos`, declarada A MANO. Nadie la sincroniza,
 *    así que `eur_mes = NULL` significa "todavía sin verificar".
 *
 * Toda la estadística (medias, desviaciones, anomalías, proyecciones, %) se
 * calcula en SQL (`security invoker` → aplica la RLS de super admin). Aquí solo
 * se pide y se tipa; no se recalcula nada.
 *
 * Regla de oro: NULL = "sin datos", nunca 0. Un día sin filas registradas no es
 * un día que costó 0 $: lo más probable es que la función aún no registre su
 * consumo (ver `ia_funciones_sin_registro`).
 */

type Fns = Database["public"]["Functions"];
export type FilaCosteSerie = Fns["ia_coste_serie"]["Returns"][number];
export type FilaCostePorFuncion = Fns["ia_coste_por_funcion"]["Returns"][number];
export type FilaCostePorModelo = Fns["ia_coste_por_modelo"]["Returns"][number];
export type FilaCosteMes = Fns["ia_coste_mes"]["Returns"][number];
export type FilaCosteAlternativa = Fns["ia_coste_alternativa"]["Returns"][number];
export type FilaFuncionSinRegistro = Fns["ia_funciones_sin_registro"]["Returns"][number];

export type CosteFijo = Database["public"]["Tables"]["costes_fijos"]["Row"];
export type IaFuncion = Database["public"]["Tables"]["ia_funciones"]["Row"];
export type IaCosteEstimado = Database["public"]["Tables"]["ia_coste_estimado"]["Row"];
export type IaPrecio = Database["public"]["Tables"]["ia_precios"]["Row"];

/** "todas" se envía a las RPC como p_funcion = NULL (suma de todas las funciones). */
export type FiltroFuncion = string;
export const FUNCION_TODAS = "todas";

const STALE_TIME = 10 * 60 * 1000;
const RAIZ = "costes";

const aParam = (funcion: FiltroFuncion): string | null => (funcion === FUNCION_TODAS ? null : funcion);

/**
 * PostgREST serializa `numeric` como número JSON, pero por si alguna versión lo
 * devuelve como string (precisión) lo normalizamos sin convertir NULL en 0.
 */
const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

// ─── Serie diaria de coste (medias, desviación, anomalías) ───────────────────
export function useCosteSerie(desde: string, hasta: string, funcion: FiltroFuncion) {
  return useQuery({
    queryKey: [RAIZ, "ia_coste_serie", { desde, hasta, funcion }],
    staleTime: STALE_TIME,
    queryFn: async (): Promise<FilaCosteSerie[]> => {
      const { data, error } = await supabase.rpc("ia_coste_serie", {
        p_desde: desde,
        p_hasta: hasta,
        p_funcion: aParam(funcion),
      });
      if (error) throw error;
      return (data ?? []).map((f) => ({
        ...f,
        coste_usd: num(f.coste_usd),
        llamadas: num(f.llamadas),
        peticiones: num(f.peticiones),
        errores: num(f.errores),
        prompt_tokens: num(f.prompt_tokens),
        completion_tokens: num(f.completion_tokens),
        razonamiento_tokens: num(f.razonamiento_tokens),
        media_7: num(f.media_7),
        media_30: num(f.media_30),
        desv_30: num(f.desv_30),
        z_30: num(f.z_30),
        desviacion_pct: num(f.desviacion_pct),
      }));
    },
  });
}

// ─── Desglose por función (qué parte del sistema gasta) ──────────────────────
export function useCostePorFuncion(desde: string, hasta: string) {
  return useQuery({
    queryKey: [RAIZ, "ia_coste_por_funcion", { desde, hasta }],
    staleTime: STALE_TIME,
    queryFn: async (): Promise<FilaCostePorFuncion[]> => {
      const { data, error } = await supabase.rpc("ia_coste_por_funcion", { p_desde: desde, p_hasta: hasta });
      if (error) throw error;
      return (data ?? []).map((f) => ({
        ...f,
        llamadas: num(f.llamadas) ?? 0,
        peticiones: num(f.peticiones) ?? 0,
        errores: num(f.errores) ?? 0,
        prompt_tokens: num(f.prompt_tokens) ?? 0,
        completion_tokens: num(f.completion_tokens) ?? 0,
        razonamiento_tokens: num(f.razonamiento_tokens) ?? 0,
        coste_usd: num(f.coste_usd),
        pct: num(f.pct),
        usd_por_peticion: num(f.usd_por_peticion),
      }));
    },
  });
}

// ─── Desglose por modelo (aquí se decide si un modelo merece la pena) ────────
export function useCostePorModelo(desde: string, hasta: string) {
  return useQuery({
    queryKey: [RAIZ, "ia_coste_por_modelo", { desde, hasta }],
    staleTime: STALE_TIME,
    queryFn: async (): Promise<FilaCostePorModelo[]> => {
      const { data, error } = await supabase.rpc("ia_coste_por_modelo", { p_desde: desde, p_hasta: hasta });
      if (error) throw error;
      return (data ?? []).map((f) => ({
        ...f,
        llamadas: num(f.llamadas) ?? 0,
        peticiones: num(f.peticiones) ?? 0,
        prompt_tokens: num(f.prompt_tokens) ?? 0,
        cached_tokens: num(f.cached_tokens) ?? 0,
        completion_tokens: num(f.completion_tokens) ?? 0,
        razonamiento_tokens: num(f.razonamiento_tokens) ?? 0,
        pct_razonamiento: num(f.pct_razonamiento),
        coste_usd: num(f.coste_usd),
        pct: num(f.pct),
        usd_por_peticion: num(f.usd_por_peticion),
      }));
    },
  });
}

// ─── Mes en curso: acumulado, proyecciones, fijos y estimación inicial ───────
export function useCosteMes() {
  return useQuery({
    queryKey: [RAIZ, "ia_coste_mes"],
    staleTime: STALE_TIME,
    queryFn: async (): Promise<FilaCosteMes | null> => {
      const { data, error } = await supabase.rpc("ia_coste_mes");
      if (error) throw error;
      const fila = data?.[0];
      if (!fila) return null;
      return {
        ...fila,
        coste_acumulado_usd: num(fila.coste_acumulado_usd),
        peticiones: num(fila.peticiones),
        dias_con_dato: num(fila.dias_con_dato) ?? 0,
        dias_mes: num(fila.dias_mes) ?? 0,
        dias_restantes: num(fila.dias_restantes) ?? 0,
        usd_medio_dia: num(fila.usd_medio_dia),
        proy_lineal_usd: num(fila.proy_lineal_usd),
        proy_media7_usd: num(fila.proy_media7_usd),
        fijos_eur_mes: num(fila.fijos_eur_mes),
        fijos_sin_verificar: num(fila.fijos_sin_verificar) ?? 0,
        estimado_ia_usd_mes: num(fila.estimado_ia_usd_mes),
      };
    },
  });
}

// ─── Funciones que no registran su consumo (el aviso más importante) ─────────
export function useFuncionesSinRegistro(dias: number) {
  return useQuery({
    queryKey: [RAIZ, "ia_funciones_sin_registro", { dias }],
    staleTime: STALE_TIME,
    queryFn: async (): Promise<FilaFuncionSinRegistro[]> => {
      const { data, error } = await supabase.rpc("ia_funciones_sin_registro", { p_dias: dias });
      if (error) throw error;
      return (data ?? []).map((f) => ({ ...f, dias_sin_registro: num(f.dias_sin_registro) }));
    },
  });
}

/**
 * Reprecia los MISMOS tokens ya registrados contra la tarifa de otro modelo.
 * Es la respuesta a "¿me sale más barato cambiar de modelo?".
 *
 * Todavía sin UI (esta primera pasada solo informa del coste real); se deja
 * tipado y listo para que el comparador se monte encima sin tocar SQL.
 */
export function useCosteAlternativa(modeloAlternativo: string | null, desde: string, hasta: string) {
  return useQuery({
    queryKey: [RAIZ, "ia_coste_alternativa", { modeloAlternativo, desde, hasta }],
    staleTime: STALE_TIME,
    enabled: !!modeloAlternativo,
    queryFn: async (): Promise<FilaCosteAlternativa[]> => {
      const { data, error } = await supabase.rpc("ia_coste_alternativa", {
        p_modelo_alternativo: modeloAlternativo ?? "",
        p_desde: desde,
        p_hasta: hasta,
      });
      if (error) throw error;
      return (data ?? []).map((f) => ({
        ...f,
        peticiones: num(f.peticiones) ?? 0,
        coste_real_usd: num(f.coste_real_usd),
        coste_alternativo_usd: num(f.coste_alternativo_usd),
        diferencia_usd: num(f.diferencia_usd),
        diferencia_pct: num(f.diferencia_pct),
      }));
    },
  });
}

// ─── Catálogos declarados a mano ─────────────────────────────────────────────

/** Catálogo de funciones de IA. Alimenta el selector del filtro. */
export function useIaFunciones() {
  return useQuery({
    queryKey: [RAIZ, "ia_funciones"],
    staleTime: STALE_TIME,
    queryFn: async (): Promise<IaFuncion[]> => {
      const { data, error } = await supabase.from("ia_funciones").select("*").order("orden").order("funcion");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Costes fijos. De solo lectura en esta pasada: se declaran a mano en SQL y
 * aquí solo se enseñan (con su fecha de verificación, que es lo que dice si
 * hay que fiarse del número o no).
 */
export function useCostesFijos() {
  return useQuery({
    queryKey: [RAIZ, "costes_fijos"],
    staleTime: STALE_TIME,
    queryFn: async (): Promise<CosteFijo[]> => {
      const { data, error } = await supabase.from("costes_fijos").select("*").order("orden").order("concepto");
      if (error) throw error;
      return (data ?? []).map((f) => ({ ...f, eur_mes: num(f.eur_mes) }));
    },
  });
}

/** Estimación medida a mano el día 1, para las funciones que aún no registran. */
export function useIaCosteEstimado() {
  return useQuery({
    queryKey: [RAIZ, "ia_coste_estimado"],
    staleTime: STALE_TIME,
    queryFn: async (): Promise<IaCosteEstimado[]> => {
      const { data, error } = await supabase.from("ia_coste_estimado").select("*").order("funcion");
      if (error) throw error;
      return (data ?? []).map((f) => ({
        ...f,
        usd_por_unidad: num(f.usd_por_unidad) ?? 0,
        unidades_mes_estimadas: num(f.unidades_mes_estimadas) ?? 0,
      }));
    },
  });
}
