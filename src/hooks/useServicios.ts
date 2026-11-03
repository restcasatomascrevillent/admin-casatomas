import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { LecturaServicio, ServicioContratado } from "@/lib/servicios";

// servicios_contratados / servicios_uso aún no están en types.ts (generado).
const sb = supabase as unknown as SupabaseClient;

export const CLAVE_SERVICIOS = ["super-admin", "servicios"] as const;
export const CLAVE_LECTURAS = ["super-admin", "servicios-uso"] as const;

const COLUMNAS = "proveedor, nombre, plan, precio_mensual, moneda, ciclo, renovacion, cuenta, panel_url, limites, notas, actualizado_en";

/** Columnas que el super admin puede cambiar (las mismas que concede la migración). */
export type CambiosServicio = Partial<Pick<ServicioContratado,
  "nombre" | "plan" | "precio_mensual" | "moneda" | "ciclo" | "renovacion" | "cuenta" | "panel_url" | "limites" | "notas">>;

export type ResultadoServicios = { disponible: true; servicios: ServicioContratado[] } | { disponible: false };

export function esSinMigracionServicios(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  return e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST202" ||
    (/servicios_(contratados|uso)/.test(e.message ?? "") && /does not exist|could not find|schema cache/i.test(e.message ?? ""));
}

export async function cargarServicios(): Promise<ResultadoServicios> {
  const { data, error } = await sb.from("servicios_contratados").select(COLUMNAS).order("proveedor");
  if (error) {
    if (esSinMigracionServicios(error)) return { disponible: false };
    throw new Error(error.message || "No se pudieron cargar los servicios.");
  }
  const servicios = ((data ?? []) as ServicioContratado[]).map((s) => ({
    ...s,
    precio_mensual: s.precio_mensual == null ? null : Number(s.precio_mensual),
    limites: s.limites && typeof s.limites === "object" ? s.limites : {},
  }));
  return { disponible: true, servicios };
}

export interface ResultadoLecturas {
  lecturas: LecturaServicio[];
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
  const { data, error } = await supabase.functions.invoke<{ lecturas?: LecturaServicio[]; generado_en?: string }>("servicios-uso", {
    body: proveedor ? { forzar, proveedor } : { forzar },
  });
  if (!error && data && Array.isArray(data.lecturas)) {
    return { lecturas: data.lecturas, generado_en: data.generado_en ?? null, errorFuncion: null };
  }
  const errorFuncion = error ? await mensajeDeErrorFuncion(error) : "La función «servicios-uso» ha devuelto una respuesta inesperada.";
  const guardadas = await sb.rpc("servicios_uso_ultimas");
  return {
    lecturas: guardadas.error || !Array.isArray(guardadas.data) ? [] : (guardadas.data as LecturaServicio[]),
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
    mutationFn: async ({ proveedor, cambios }: { proveedor: string; cambios: CambiosServicio }) => {
      const { data, error } = await sb.from("servicios_contratados").update(cambios).eq("proveedor", proveedor).select(COLUMNAS);
      if (error) throw new Error(/check constraint/i.test(error.message) ? "Algún dato no es válido (revisa los enlaces, que empiecen por https://, y los números)." : error.message);
      if (!data || data.length === 0) throw new Error("No se ha guardado: solo un super admin puede cambiar los servicios.");
      return data[0] as ServicioContratado;
    },
    onSuccess: () => cliente.invalidateQueries({ queryKey: CLAVE_SERVICIOS }),
  });
}
