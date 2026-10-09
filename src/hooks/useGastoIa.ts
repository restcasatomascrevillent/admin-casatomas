import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  DIAS_GASTO_IA,
  FUNCIONES_GASTO_IA,
  type FilaGastoIa,
  type GastoReal,
  TOPE_IA_POR_DEFECTO,
  diaDelMes,
  diasEntre,
  hoyIso,
  normalizarFilas,
  normalizarGastoReal,
  primerDiaMesAnteriorIso,
  primerDiaMesIso,
  restarGastoReal,
  sinRealCerrado,
  ultimoDiaDe,
} from "@/lib/facturas/gastoIa";

type ClienteRpc = { rpc: unknown };

/**
 * Llama a la RPC y normaliza las filas. `rpc` es un método de SupabaseClient
 * que usa `this`: se invoca con `.call(cliente, …)`. Sacarlo a una constante y
 * llamarlo suelto lanza «Cannot read properties of undefined» (el monitor se
 * quedaba en «sin datos todavía» aunque la RPC respondiera bien).
 */
export async function cargarGastoIa(cliente: ClienteRpc, dias: number = DIAS_GASTO_IA): Promise<FilaGastoIa[]> {
  // La RPC no está en types.ts (se actualiza a mano): llamada sin tipar.
  const rpc = cliente.rpc as (
    this: ClienteRpc,
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
  const { data, error } = await rpc.call(cliente, "gasto_ia_resumen", {
    p_funciones: [...FUNCIONES_GASTO_IA],
    p_dias: dias,
  });
  if (error) {
    console.warn("[gasto-ia] sin resumen:", error.message ?? error);
    return [];
  }
  return normalizarFilas(data);
}

/**
 * Gasto de IA de Facturas del MES EN CURSO (`gasto_ia_resumen`, solo
 * agregados; basta con poder ver Facturas): ventana de tantos días como lleva
 * el mes. Una sola consulta para las dos pestañas (IA y Cargar): la misma
 * clave de caché.
 *
 * Si la RPC aún no existe (migración 20261008110000 sin aplicar) o no hay
 * permiso, devuelve [] y el monitor dice «sin datos todavía»: un dato de coste
 * nunca puede romper la pantalla de Facturas.
 */
export function useGastoIa(habilitado = true) {
  const dias = diaDelMes(new Date());
  return useQuery({
    queryKey: ["facturas", "gasto_ia_resumen", dias],
    enabled: habilitado,
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: () => cargarGastoIa(supabase, dias),
  });
}

type RespuestaRpc = { data: unknown; error: { message?: string } | null };
type RpcFn = (this: ClienteRpc, fn: string, args?: Record<string, unknown>) => PromiseLike<RespuestaRpc>;

/** Datos crudos de `gasto_ia_real_resumen` para una ventana; null si falla o no existe. */
async function pedirReal(cliente: ClienteRpc, dias: number): Promise<unknown[] | null> {
  const rpc = cliente.rpc as RpcFn;
  try {
    const { data, error } = await rpc.call(cliente, "gasto_ia_real_resumen", { p_dias: dias });
    return error || !Array.isArray(data) ? null : data;
  } catch {
    return null;
  }
}

/** Datos crudos de `tipo_cambio_usd_eur_actual`; null si falla (se usa el 0,92 por defecto). */
async function pedirTipo(cliente: ClienteRpc): Promise<unknown> {
  const rpc = cliente.rpc as RpcFn;
  try {
    const t = await rpc.call(cliente, "tipo_cambio_usd_eur_actual");
    return t.error ? null : t.data;
  } catch {
    return null;
  }
}

/**
 * Gasto REAL de OpenAI por proceso + tipo de cambio del BCE
 * (`gasto_ia_real_resumen` y `tipo_cambio_usd_eur_actual`, migración
 * 20261008150000). Devuelve null si la RPC no existe todavía, falla o aún no
 * hay datos reales: entonces el monitor sigue con el estimado de `ia_uso`.
 * Si solo falla el tipo de cambio, se usa el 0,92 por defecto.
 * `rpc` se invoca con `.call(cliente, …)` (usa `this`; suelto se rompe).
 */
export async function cargarGastoIaReal(cliente: ClienteRpc, dias: number = DIAS_GASTO_IA): Promise<GastoReal | null> {
  const datos = await pedirReal(cliente, dias);
  if (!datos) return null;
  return normalizarGastoReal(datos, await pedirTipo(cliente));
}

export interface GastoRealMes {
  /** Mes en curso: real hasta el último día cerrado + estimado de hoy. */
  actual: GastoReal;
  /** Mes anterior (aproximado, ver `restarGastoReal`); null si no se pidió o no hay datos. */
  anterior: GastoReal | null;
}

/**
 * Gasto real del MES EN CURSO (y, si se pide, del mes anterior). La RPC mide la
 * ventana hacia atrás desde el último día cerrado, así que:
 *   1. `p_dias = 1` da el último día cerrado (`ultimo_dia_real`);
 *   2. el mes en curso es `p_dias` = día del mes de ese último día (0 si el
 *      último cierre es del mes anterior: queda solo el estimado de hoy);
 *   3. el mes anterior = ventana(1 del mes anterior … último día) − mes en curso.
 * null si no hay datos reales (entonces manda el estimado de `ia_uso`).
 */
export async function cargarGastoIaRealMes(
  cliente: ClienteRpc,
  hoy: Date = new Date(),
  conAnterior = false,
): Promise<GastoRealMes | null> {
  const [crudoA, tipo] = await Promise.all([pedirReal(cliente, 1), pedirTipo(cliente)]);
  if (!crudoA) return null;
  const a = normalizarGastoReal(crudoA, tipo);
  const corte = a ? ultimoDiaDe(a) : null;
  if (!a || !corte) return null;

  const diasMes = corte >= primerDiaMesIso(hoy) ? diasEntre(primerDiaMesIso(hoy), corte) : 0;
  let actual: GastoReal;
  if (diasMes === 0) actual = sinRealCerrado(a);
  else if (diasMes === 1) actual = a;
  else {
    const crudo = await pedirReal(cliente, diasMes);
    actual = (crudo && normalizarGastoReal(crudo, tipo)) || a;
  }

  let anterior: GastoReal | null = null;
  if (conAnterior) {
    const diasVentana = Math.min(90, diasEntre(primerDiaMesAnteriorIso(hoy), corte));
    const crudo = diasVentana > diasMes ? await pedirReal(cliente, diasVentana) : null;
    const grande = crudo ? normalizarGastoReal(crudo, tipo) : null;
    anterior = grande ? restarGastoReal(grande, diasMes === 0 ? sinRealCerrado(grande) : actual) : null;
  }
  return { actual, anterior };
}

/** Gasto real del mes en curso (Facturas) y, con `conAnterior`, del anterior (Costes). null = usar el estimado. */
export function useGastoIaRealMes(conAnterior = false, habilitado = true) {
  const hoy = new Date();
  return useQuery({
    queryKey: ["facturas", "gasto_ia_real_mes", conAnterior, hoyIso(hoy)],
    enabled: habilitado,
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: () => cargarGastoIaRealMes(supabase, hoy, conAnterior),
  });
}

const CLAVE_TOPE = ["facturas", "tope_ia_mes_eur"] as const;

/**
 * Tope mensual del gasto de IA (€) de `configuracion_facturas.tope_ia_mes_eur`
 * (migración 20261009110000). Sin migración, sin fila o sin permiso: 5 €.
 */
export async function leerTopeIaMes(cliente: unknown = supabase): Promise<number> {
  try {
    const desde = (cliente as { from: (t: string) => unknown }).from;
    const tabla = desde.call(cliente, "configuracion_facturas") as {
      select: (c: string) => { limit: (n: number) => PromiseLike<{ data: unknown; error: unknown }> };
    };
    const { data, error } = await tabla.select("tope_ia_mes_eur").limit(1);
    if (error || !Array.isArray(data) || data.length === 0) return TOPE_IA_POR_DEFECTO;
    const n = Number((data[0] as { tope_ia_mes_eur?: unknown }).tope_ia_mes_eur);
    return Number.isFinite(n) && n > 0 ? n : TOPE_IA_POR_DEFECTO;
  } catch {
    return TOPE_IA_POR_DEFECTO;
  }
}

export function useTopeIaMes() {
  return useQuery({
    queryKey: CLAVE_TOPE,
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: () => leerTopeIaMes(supabase),
  });
}

/** Cambia el tope (RPC `fijar_tope_ia_mes`, solo super admin). */
export function useFijarTopeIa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (eur: number): Promise<number> => {
      const rpc = supabase.rpc as unknown as RpcFn;
      const { data, error } = await rpc.call(supabase, "fijar_tope_ia_mes", { p_eur: eur });
      if (error) throw new Error(error.message || "No se ha podido guardar el tope");
      return Number(data) || eur;
    },
    onSuccess: (eur) => qc.setQueryData(CLAVE_TOPE, eur),
  });
}

/** «Sincronizar ahora» (RPC `openai_sincronizar_ahora`, solo super admin, 1 por minuto). Devuelve true si la lanzó. */
export function useSincronizarCostes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<boolean> => {
      const rpc = supabase.rpc as unknown as RpcFn;
      const { data, error } = await rpc.call(supabase, "openai_sincronizar_ahora");
      if (error) throw new Error(error.message || "No se ha podido lanzar la sincronización");
      return Number(data) === 1;
    },
    // La sincronización tarda unos segundos: se refresca al volver a mirar.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["facturas", "gasto_ia_real_mes"] });
    },
  });
}
