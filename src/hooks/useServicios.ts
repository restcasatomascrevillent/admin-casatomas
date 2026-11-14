import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { CAMBIO_POR_DEFECTO, type LecturaServicio, type ServicioContratado } from "@/lib/servicios";
import { type FilaResumenMes, normalizarResumenMes } from "@/lib/informeServicios";

// Las consultas van sin tipar: estas tablas cambian de forma con
// 20261103160000 y la pantalla tiene que funcionar antes y después.
const sb = supabase as unknown as SupabaseClient;

export const CLAVE_SERVICIOS = ["super-admin", "servicios"] as const;
export const CLAVE_LECTURAS = ["super-admin", "servicios-uso"] as const;
export const CLAVE_CONFIG = ["super-admin", "servicios-config"] as const;
export const CLAVE_RESUMEN_MES = ["super-admin", "servicios-resumen-mes"] as const;

// `string` a secas: sin tipos generados, el analizador de supabase-js no infiere filas.
const COLUMNAS_BASE: string = "proveedor, nombre, plan, precio_mensual, moneda, ciclo, renovacion, cuenta, panel_url, limites, notas, actualizado_en";
/** Columnas de 20261103160000 (planes y coste). */
const COLUMNAS: string = `${COLUMNAS_BASE}, categoria, orden, activo, por_confirmar, precio_anual, fuente_precio`;
/** Columnas de 20261129153000 (para qué, precio confirmado y plan siguiente). */
const CAMPOS_INVENTARIO = ["para_que", "precio_confirmado_en", "plan_siguiente", "precio_siguiente", "si_se_pasa"] as const;
const COLUMNAS_INVENTARIO: string = `${COLUMNAS}, ${CAMPOS_INVENTARIO.join(", ")}`;

/** Columnas que el super admin puede cambiar (las mismas que conceden las migraciones). */
export type CambiosServicio = Partial<Pick<ServicioContratado,
  "nombre" | "plan" | "precio_mensual" | "moneda" | "ciclo" | "renovacion" | "cuenta" | "panel_url" | "limites" | "notas"
  | "categoria" | "orden" | "activo" | "por_confirmar" | "precio_anual" | "fuente_precio"
  | "para_que" | "precio_confirmado_en" | "plan_siguiente" | "precio_siguiente" | "si_se_pasa">>;

/**
 * `costes`: false si falta 20261103160000 (sin categorías, coste variable ni tipo de cambio).
 * `inventario`: false si falta 20261129153000 (sin «para qué», precio confirmado ni plan siguiente).
 */
export type ResultadoServicios = { disponible: true; costes: boolean; inventario: boolean; servicios: ServicioContratado[] } | { disponible: false };

/** Columna que no existe (base sin 20261103160000). */
const esColumnaNueva = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42703" || /column .* does not exist|could not find the .* column/i.test(e.message ?? ""));

const ORDEN_VIEJO: Record<string, number> = { vercel: 10, supabase: 20, github: 30, resend: 40, stripe: 50 };

export function esSinMigracionServicios(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  // Falta una COLUMNA (base sin 20261103160000), no la tabla: eso lo trata cargarServicios.
  if (esColumnaNueva(e)) return false;
  return e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST202" ||
    (/servicios_(contratados|uso)/.test(e.message ?? "") && /does not exist|could not find|schema cache/i.test(e.message ?? ""));
}

export async function cargarServicios(): Promise<ResultadoServicios> {
  let costes = true;
  let inventario = true;
  let { data, error } = await sb.from("servicios_contratados").select(COLUMNAS_INVENTARIO).order("proveedor");
  if (error && esColumnaNueva(error) && !esSinMigracionServicios(error)) {
    inventario = false;
    ({ data, error } = await sb.from("servicios_contratados").select(COLUMNAS).order("proveedor"));
  }
  if (error && esColumnaNueva(error) && !esSinMigracionServicios(error)) {
    costes = false;
    ({ data, error } = await sb.from("servicios_contratados").select(COLUMNAS_BASE).order("proveedor"));
  }
  if (error) {
    if (esSinMigracionServicios(error)) return { disponible: false };
    throw new Error(error.message || "No se pudieron cargar los servicios.");
  }
  const servicios = ((data ?? []) as unknown as Array<Partial<ServicioContratado> & Pick<ServicioContratado, "proveedor" | "nombre">>).map((s): ServicioContratado => ({
    ...(s as ServicioContratado),
    precio_mensual: s.precio_mensual == null ? null : Number(s.precio_mensual),
    precio_anual: s.precio_anual == null ? null : Number(s.precio_anual),
    limites: s.limites && typeof s.limites === "object" ? s.limites : {},
    categoria: s.categoria ?? "otros",
    orden: typeof s.orden === "number" ? s.orden : (ORDEN_VIEJO[s.proveedor] ?? 100),
    activo: s.activo !== false,
    por_confirmar: s.por_confirmar === true,
    fuente_precio: s.fuente_precio ?? null,
    para_que: s.para_que ?? null,
    precio_confirmado_en: typeof s.precio_confirmado_en === "string" ? s.precio_confirmado_en.slice(0, 10) : null,
    plan_siguiente: s.plan_siguiente ?? null,
    precio_siguiente: s.precio_siguiente == null ? null : Number(s.precio_siguiente),
    si_se_pasa: s.si_se_pasa ?? null,
  }));
  return { disponible: true, costes, inventario: costes && inventario, servicios };
}

export interface ConfigServicios {
  /** Euros por 1 dólar (editable por el super admin). */
  eurPorUsd: number;
  /** false si falta la tabla (sin 20261103160000): se usa 0,92 y no se puede editar. */
  guardada: boolean;
  actualizadoEn: string | null;
  /** Último cambio del BCE que guarda sincronizar-costes-openai (si se puede leer). */
  bce: { eurPorUsd: number; fecha: string } | null;
}

export async function cargarConfigServicios(): Promise<ConfigServicios> {
  const [config, bce] = await Promise.all([
    sb.from("servicios_config").select("eur_por_usd, actualizado_en").limit(1),
    sb.from("tipo_cambio_usd_eur").select("fecha, eur_por_usd").order("fecha", { ascending: false }).limit(1),
  ]);
  const fila = !config.error && Array.isArray(config.data) ? (config.data[0] as { eur_por_usd?: unknown; actualizado_en?: string } | undefined) : undefined;
  const cambio = Number(fila?.eur_por_usd);
  const filaBce = !bce.error && Array.isArray(bce.data) ? (bce.data[0] as { fecha?: string; eur_por_usd?: unknown } | undefined) : undefined;
  const cambioBce = Number(filaBce?.eur_por_usd);
  return {
    eurPorUsd: Number.isFinite(cambio) && cambio > 0 ? cambio : CAMBIO_POR_DEFECTO,
    guardada: !!fila,
    actualizadoEn: fila?.actualizado_en ?? null,
    bce: filaBce?.fecha && Number.isFinite(cambioBce) && cambioBce > 0 ? { eurPorUsd: cambioBce, fecha: filaBce.fecha } : null,
  };
}

export function useConfigServicios(habilitado = true) {
  return useQuery({ queryKey: CLAVE_CONFIG, queryFn: cargarConfigServicios, enabled: habilitado, staleTime: 60_000 });
}

/** Cambia el tipo de cambio (solo super admin; la RLS lo impide a los demás). */
export function useGuardarTipoCambio() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: async (eurPorUsd: number) => {
      const { data, error } = await sb.from("servicios_config").update({ eur_por_usd: eurPorUsd }).eq("id", true).select("eur_por_usd");
      if (error) throw new Error(/check constraint/i.test(error.message) ? "El tipo de cambio tiene que estar entre 0,2 y 5 euros por dólar." : error.message);
      if (!data || data.length === 0) throw new Error("No se ha guardado: solo un super admin puede cambiar el tipo de cambio.");
      return Number((data[0] as { eur_por_usd: unknown }).eur_por_usd);
    },
    onSuccess: () => cliente.invalidateQueries({ queryKey: CLAVE_CONFIG }),
  });
}

export interface ResultadoLecturas {
  lecturas: LecturaServicio[];
  /** Servicios en uso sin lectura automática (no hay API razonable): se miran en su panel. */
  sinLector: string[];
  generado_en: string | null;
  /** Texto para el dueño si la función no respondió (las lecturas son entonces las guardadas). */
  errorFuncion: string | null;
}

async function mensajeDeErrorFuncion(error: unknown): Promise<string> {
  const e = error as { name?: string; context?: { status?: number; json?: () => Promise<{ error?: string }> }; message?: string };
  if (e?.name === "FunctionsFetchError" || e?.name === "FunctionsRelayError") {
    return "No se pudo contactar con la función «servicios-uso» (¿está desplegada en este proyecto?).";
  }
  const cuerpo = await e?.context?.json?.().catch(() => null);
  if (cuerpo?.error === "sin_migracion") return "Falta aplicar la migración de Servicios en Supabase.";
  if (e?.context?.status === 403) return "Solo un super admin puede ver el consumo de los servicios.";
  if (e?.context?.status === 401) return "Tu sesión ha caducado: vuelve a entrar.";
  return "La función «servicios-uso» ha fallado. Se muestran las últimas lecturas guardadas.";
}

/**
 * Pide las lecturas a la Edge Function (que solo llama a las APIs si la última
 * lectura tiene más de 15 min, o siempre con `forzar`). Si la función falla,
 * enseña las últimas lecturas guardadas en la base de datos y lo dice.
 */
export async function pedirLecturas(forzar: boolean, proveedor?: string): Promise<ResultadoLecturas> {
  const { data, error } = await supabase.functions.invoke<{ lecturas?: LecturaServicio[]; sin_lector?: string[]; generado_en?: string }>("servicios-uso", {
    body: proveedor ? { forzar, proveedor } : { forzar },
  });
  if (!error && data && Array.isArray(data.lecturas)) {
    const sinLector = Array.isArray(data.sin_lector) ? data.sin_lector.filter((p): p is string => typeof p === "string") : [];
    return { lecturas: data.lecturas, sinLector, generado_en: data.generado_en ?? null, errorFuncion: null };
  }
  const errorFuncion = error ? await mensajeDeErrorFuncion(error) : "La función «servicios-uso» ha devuelto una respuesta inesperada.";
  const guardadas = await sb.rpc("servicios_uso_ultimas");
  return {
    lecturas: guardadas.error || !Array.isArray(guardadas.data) ? [] : (guardadas.data as LecturaServicio[]),
    sinLector: [],
    generado_en: null,
    errorFuncion,
  };
}

export function useServiciosContratados(habilitado = true) {
  return useQuery({ queryKey: CLAVE_SERVICIOS, queryFn: cargarServicios, enabled: habilitado, staleTime: 60_000 });
}

export function useLecturasServicios(habilitado = true) {
  return useQuery({
    queryKey: CLAVE_LECTURAS,
    queryFn: () => pedirLecturas(false),
    enabled: habilitado,
    // La función ya cachea 15 min: no hace falta volver a pedir al cambiar de pestaña.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

/** «Actualizar ahora»: todos (sin proveedor) o solo el de una tarjeta. */
export function useActualizarLecturas() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (proveedor?: string) => pedirLecturas(true, proveedor),
    onSuccess: (resultado) => cliente.setQueryData(CLAVE_LECTURAS, resultado),
  });
}

export function useGuardarServicio() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: async ({ proveedor, cambios, costes = true, inventario = true }: { proveedor: string; cambios: CambiosServicio; costes?: boolean; inventario?: boolean }) => {
      // Sin 20261129153000 no existen las columnas del inventario: no se mandan.
      const sinInventario = (c: CambiosServicio): CambiosServicio =>
        inventario && costes ? c : Object.fromEntries(Object.entries(c).filter(([k]) => !(CAMPOS_INVENTARIO as readonly string[]).includes(k)));
      // Sin 20261103160000 solo existen las columnas de la primera migración.
      // El precio al año se guarda entonces como precio al mes (pago anual).
      const enviar: CambiosServicio = costes ? sinInventario(cambios) : {
        ...Object.fromEntries(
          Object.entries(sinInventario(cambios)).filter(([k]) => !["categoria", "orden", "activo", "por_confirmar", "precio_anual", "fuente_precio"].includes(k)),
        ),
        ...(cambios.precio_anual != null ? { precio_mensual: Math.round((cambios.precio_anual / 12) * 100) / 100 } : {}),
      };
      const { data, error } = await sb.from("servicios_contratados").update(enviar).eq("proveedor", proveedor).select(costes ? COLUMNAS : COLUMNAS_BASE);
      if (error) throw new Error(/check constraint/i.test(error.message) ? "Algún dato no es válido (revisa los enlaces, que empiecen por https://, y los números)." : error.message);
      if (!data || data.length === 0) throw new Error("No se ha guardado: solo un super admin puede cambiar los servicios.");
      return data[0] as unknown as ServicioContratado;
    },
    onSuccess: () => cliente.invalidateQueries({ queryKey: CLAVE_SERVICIOS }),
  });
}

/** Falta 20261104121000 (sin permiso de alta o de borrado) o no es super admin. */
function mensajeAltaBaja(error: { code?: string; message?: string }, accion: "añadir" | "borrar"): string {
  const texto = error.message ?? "";
  if (/row-level security/i.test(texto)) return `Solo un super admin puede ${accion} servicios.`;
  if (error.code === "42501" || /permission denied/i.test(texto)) {
    return `Para ${accion} servicios falta aplicar en Supabase la migración 20261104121000_servicios_configurables.`;
  }
  if (error.code === "23505" || /duplicate key/i.test(texto)) return "Ya hay un servicio con ese nombre: ponle otro.";
  if (/check constraint/i.test(texto)) return "Algún dato no es válido (revisa los enlaces, que empiecen por https://, y los números).";
  return texto || `No se ha podido ${accion} el servicio.`;
}

/** Configurar › «Añadir servicio» (solo super admin; 20261104121000). */
export function useCrearServicio() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: async ({ inventario = true, ...nuevo }: CambiosServicio & Pick<ServicioContratado, "proveedor" | "nombre"> & { inventario?: boolean }) => {
      const fila = inventario ? nuevo : Object.fromEntries(Object.entries(nuevo).filter(([k]) => !(CAMPOS_INVENTARIO as readonly string[]).includes(k)));
      const { data, error } = await sb.from("servicios_contratados").insert(fila).select(COLUMNAS);
      if (error) throw new Error(mensajeAltaBaja(error, "añadir"));
      if (!data || data.length === 0) throw new Error("No se ha guardado: solo un super admin puede añadir servicios.");
      return data[0] as unknown as ServicioContratado;
    },
    onSuccess: () => cliente.invalidateQueries({ queryKey: CLAVE_SERVICIOS }),
  });
}

/**
 * Configurar › «Borrar del todo»: solo un servicio ya quitado («no lo usamos»);
 * la base de datos también lo exige y borra sus lecturas (20261104121000).
 */
export function useBorrarServicio() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: async (proveedor: string) => {
      const { data, error } = await sb.from("servicios_contratados").delete().eq("proveedor", proveedor).eq("activo", false).select("proveedor");
      if (error) throw new Error(mensajeAltaBaja(error, "borrar"));
      if (!data || data.length === 0) throw new Error("No se ha borrado: solo se puede borrar un servicio quitado, y solo un super admin.");
      return proveedor;
    },
    onSuccess: () => cliente.invalidateQueries({ queryKey: CLAVE_SERVICIOS }),
  });
}

// ─── Costes de cada mes e informe mensual (20261122153000) ──────────────────

/** `disponible: false` si falta la migración 20261122153000 (sin costes por mes). */
export type ResultadoResumenMes = { disponible: true; filas: FilaResumenMes[] } | { disponible: false };

const esSinMigracionCostesMes = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42P01" || e.code === "PGRST202" || e.code === "PGRST205" || e.code === "42883" ||
    /servicios_(resumen_mes|costes_mes)/.test(e.message ?? ""));

/** Lo metido a mano y el coste por uso de cada servicio en un mes («AAAA-MM-01»). */
export async function cargarResumenMes(mes: string): Promise<ResultadoResumenMes> {
  const { data, error } = await sb.rpc("servicios_resumen_mes", { p_mes: mes });
  if (error) {
    if (esSinMigracionCostesMes(error)) return { disponible: false };
    throw new Error(error.message || "No se pudo cargar el resumen del mes.");
  }
  return { disponible: true, filas: normalizarResumenMes(data) };
}

/** Un resumen por mes (en el mismo orden que `meses`). */
export function useResumenesMes(meses: string[], habilitado = true) {
  return useQueries({
    queries: meses.map((mes) => ({
      queryKey: [...CLAVE_RESUMEN_MES, mes],
      queryFn: () => cargarResumenMes(mes),
      enabled: habilitado,
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    })),
  });
}

export interface CosteMesNuevo {
  proveedor: string;
  mes: string;
  importe: number;
  moneda: string;
  nota: string | null;
}

function mensajeCosteMes(error: { code?: string; message?: string }): string {
  const texto = error.message ?? "";
  if (esSinMigracionCostesMes(error)) return "Falta aplicar en Supabase la migración 20261122153000_servicios_costes_mes.";
  if (/row-level security/i.test(texto) || error.code === "42501") return "Solo un super admin puede meter costes.";
  if (/check constraint/i.test(texto)) return "El importe no es válido (tiene que ser 0 o más) o la nota es demasiado larga.";
  return texto || "No se ha podido guardar el coste.";
}

/** Mete (o cambia) el coste de un servicio en un mes. */
export function useGuardarCosteMes() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: async (c: CosteMesNuevo) => {
      const { data, error } = await sb
        .from("servicios_costes_mes")
        .upsert({ proveedor: c.proveedor, mes: c.mes, importe: c.importe, moneda: c.moneda, nota: c.nota }, { onConflict: "proveedor,mes" })
        .select("proveedor");
      if (error) throw new Error(mensajeCosteMes(error));
      if (!data || data.length === 0) throw new Error("No se ha guardado: solo un super admin puede meter costes.");
      return c;
    },
    onSuccess: (c) => cliente.invalidateQueries({ queryKey: [...CLAVE_RESUMEN_MES, c.mes] }),
  });
}

/** Quita el coste metido a mano de un servicio en un mes (vuelve a la estimación). */
export function useBorrarCosteMes() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: async ({ proveedor, mes }: { proveedor: string; mes: string }) => {
      const { error } = await sb.from("servicios_costes_mes").delete().eq("proveedor", proveedor).eq("mes", mes);
      if (error) throw new Error(mensajeCosteMes(error));
      return { proveedor, mes };
    },
    onSuccess: (c) => cliente.invalidateQueries({ queryKey: [...CLAVE_RESUMEN_MES, c.mes] }),
  });
}
