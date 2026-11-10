/**
 * Datos de RRSS › Métricas (panel global e informe mensual), leídos COMO EL
 * USUARIO con su RLS:
 *   · Instagram: instagram_metricas_cuenta e instagram_metricas_publicacion_ultima
 *     (can_read_section('marketing'), migración 20261106100000). Las escribe la
 *     Edge Function instagram-metricas; aquí solo se leen.
 *   · Visitas a la web desde redes: la RPC trafico_web_desglose_resumen
 *     (procedencias) de Tráfico web, que exige can_read_section('trafico_web').
 *     Solo se pide si el usuario tiene ese permiso (`conWeb`).
 * Facebook no está conectado: no hay nada que leer.
 */
import { useQuery } from "@tanstack/react-query";
import { addDays, format, parseISO, subDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { resumirRedes, type DatosInformeRrss, type FilaCuentaIg, type FilaProcedencia, type PublicacionIg } from "./informe/modelo";

const ISO = "yyyy-MM-dd";
const RAIZ = ["rrss", "metricas"] as const;
const STALE_TIME = 5 * 60_000;
/** Procedencias que se piden a Tráfico web (las redes pueden venir de varios dominios: l.instagram.com, m.facebook.com…). */
const LIMITE_PROCEDENCIAS = 200;
const MAX_PUBLICACIONES = 1000;

const COLUMNAS_CUENTA = "fecha, ig_user_id, seguidores, alcance, visualizaciones, interacciones, cuentas_interaccion, visitas_perfil, toques_enlaces";
const COLUMNAS_PUBLICACION =
  "media_id, ig_user_id, publicado_at, producto, tipo_medio, caption, permalink, alcance, me_gusta, comentarios, guardados, compartidos, visualizaciones, interacciones";

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function pedirCuentaIg(desde: string, hasta: string): Promise<FilaCuentaIg[]> {
  const { data, error } = await supabase.from("instagram_metricas_cuenta").select(COLUMNAS_CUENTA).gte("fecha", desde).lte("fecha", hasta).order("fecha");
  if (error) throw error;
  return (data ?? []) as FilaCuentaIg[];
}

/**
 * Publicaciones con fecha de publicación entre `desde` y `hasta` (días de
 * Madrid). Se pide con un día de margen por cada lado (UTC) y el modelo filtra
 * por el día de Madrid exacto.
 */
export async function pedirPublicacionesIg(desde: string, hasta: string): Promise<PublicacionIg[]> {
  const ini = `${format(subDays(parseISO(desde), 1), ISO)}T00:00:00Z`;
  const fin = `${format(addDays(parseISO(hasta), 2), ISO)}T00:00:00Z`;
  const { data, error } = await supabase
    .from("instagram_metricas_publicacion_ultima")
    .select(COLUMNAS_PUBLICACION)
    .gte("publicado_at", ini)
    .lt("publicado_at", fin)
    .order("publicado_at", { ascending: false })
    .limit(MAX_PUBLICACIONES);
  if (error) throw error;
  return (data ?? []).filter((p): p is PublicacionIg => typeof p.media_id === "string" && typeof p.ig_user_id === "string") as PublicacionIg[];
}

/** Procedencias de las dos webs (Casa Tomás y Touza) entre dos días. */
export async function pedirProcedencias(desde: string, hasta: string): Promise<FilaProcedencia[]> {
  const { data, error } = await supabase.rpc("trafico_web_desglose_resumen", {
    p_proyecto: null,
    p_dimension: "referrer",
    p_desde: desde,
    p_hasta: hasta,
    p_limite: LIMITE_PROCEDENCIAS,
  });
  if (error) throw error;
  return (data ?? []).map((f) => ({ valor: String(f.valor ?? ""), visitas: num(f.visitas) ?? 0, pct: num(f.pct) }));
}

export interface RangoDatosRrss {
  desdeAnterior: string;
  hastaAnterior: string;
  desde: string;
  hasta: string;
}

/** Todo lo que necesita el informe mensual. La forma final la calcula `construirInformeRrss`. */
export function useDatosInformeRrss(rango: RangoDatosRrss | null, conWeb: boolean) {
  return useQuery({
    queryKey: [...RAIZ, "informe", { ...rango, conWeb }],
    enabled: rango !== null,
    staleTime: STALE_TIME,
    queryFn: async (): Promise<DatosInformeRrss> => {
      if (!rango) throw new Error("Sin rango de fechas para el informe.");
      const [cuentas, publicaciones, web] = await Promise.all([
        pedirCuentaIg(rango.desdeAnterior, rango.hasta),
        pedirPublicacionesIg(rango.desdeAnterior, rango.hasta),
        conWeb
          ? Promise.all([pedirProcedencias(rango.desde, rango.hasta), pedirProcedencias(rango.desdeAnterior, rango.hastaAnterior)])
              .then(([actual, anterior]) => ({ actual, anterior }))
              // Sin permiso o sin la RPC: el informe sale igual, sin la diapositiva de la web.
              .catch(() => null)
          : Promise.resolve(null),
      ]);
      return { cuentas, publicaciones, web };
    },
  });
}

// ─── Panel: visitas a la web desde redes (últimos 28 días) ───────────────────
export const DIAS_PANEL = 28;

export interface WebDesdeRedes {
  dias: number;
  desde: string;
  hasta: string;
  total: number;
  anterior: number;
  /** % frente a los 28 días anteriores; null sin base. */
  variacion: number | null;
  /** % de todas las visitas a las webs. */
  cuota: number | null;
  redes: { nombre: string; visitas: number }[];
}

/** Visitas a la web desde redes de los últimos 28 días cerrados (hasta ayer) frente a los 28 anteriores. */
export function useWebDesdeRedes(activo: boolean, hoy: string = format(new Date(), ISO)) {
  const hasta = format(subDays(parseISO(hoy), 1), ISO);
  const desde = format(subDays(parseISO(hasta), DIAS_PANEL - 1), ISO);
  const hastaAnt = format(subDays(parseISO(desde), 1), ISO);
  const desdeAnt = format(subDays(parseISO(hastaAnt), DIAS_PANEL - 1), ISO);
  return useQuery({
    queryKey: [...RAIZ, "web-desde-redes", { desde, hasta }],
    enabled: activo,
    staleTime: STALE_TIME,
    retry: 1,
    queryFn: async (): Promise<WebDesdeRedes> => {
      const [actual, anterior] = await Promise.all([pedirProcedencias(desde, hasta), pedirProcedencias(desdeAnt, hastaAnt)]);
      const a = resumirRedes(actual);
      const b = resumirRedes(anterior);
      return {
        dias: DIAS_PANEL,
        desde,
        hasta,
        total: a.total,
        anterior: b.total,
        variacion: b.total > 0 ? Math.round((1000 * (a.total - b.total)) / b.total) / 10 : null,
        cuota: a.cuota,
        redes: a.redes,
      };
    },
  });
}
