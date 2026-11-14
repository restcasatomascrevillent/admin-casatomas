// «Qué decidir hoy» › plato o vino con poco margen (14/11/2026).
// Los avisos «Margen bajo» vigentes (notificaciones_dashboard, tipo facturas_margen_bajo,
// 20261125110000) con el precio de carta sugerido de cada uno (avisos_precio_sugerido,
// 20261130160000: redondeado a 0,50 €, con IVA). «Cambiar precio en carta» usa la misma
// RPC que /aplicar-precio (avisos_aplicar_precio_sugerido: cambia el precio, lo apunta en
// historial_ajustes_precios y marca el aviso) y después pide publicar la web (rebuild-webs).
// Sin permiso de editar la carta, el aviso sale igual pero sin precio sugerido ni botón.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { notificarGuardadoYPublicacion } from "@/lib/rebuild-webs";
import type { MargenDecision } from "@/lib/facturas/vistasAnalisis";

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
const rpc: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc).call(supabase, fn, args);

export const CLAVE_MARGENES_DECIDIR = "facturas-decidir-margen";

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** Una fila del aviso + la sugerencia (o null sin permiso) → lo que pinta «Qué decidir hoy». */
export function margenDeAviso(fila: { id: string; datos: unknown }, sug: Record<string, unknown> | null): MargenDecision | null {
  const d = (fila.datos && typeof fila.datos === "object" ? fila.datos : {}) as Record<string, unknown>;
  const canal = d.canal === "plato" || d.canal === "vino" ? d.canal : null;
  const nombre = txt(sug?.nombre) ?? txt(d.nombre);
  if (!canal || !nombre) return null;
  const aplicado = !!(d.precio_aplicado || (sug && sug.aplicado));
  return {
    id: fila.id,
    canal,
    nombre,
    valor: num(d.valor) ?? num(sug?.valor),
    limite: num(d.limite) ?? num(sug?.limite),
    coste: num(sug?.coste) ?? num(d.coste),
    fecha: txt(d.fecha) ?? txt(d.hasta),
    local: d.local === "touza" ? "touza" : d.local === "casa_tomas" ? "casa_tomas" : null,
    precioActual: num(sug?.precio_actual),
    precioSugerido: num(sug?.precio_sugerido),
    aplicado,
    enlaceMargenes: txt(d.enlace_margenes),
  };
}

/** Avisos «Margen bajo» vigentes de platos y vinos (solo Casa Tomás: Touza no tiene carta en Márgenes). */
export function useMargenesDecidir(activo: boolean) {
  return useQuery({
    queryKey: [CLAVE_MARGENES_DECIDIR],
    enabled: activo,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async (): Promise<MargenDecision[]> => {
      const { data, error } = await supabase
        .from("notificaciones_dashboard")
        .select("id, datos, caduca_en, created_at")
        .eq("tipo", "facturas_margen_bajo")
        .or(`caduca_en.is.null,caduca_en.gt.${new Date().toISOString()}`)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) return [];
      const filas = (data ?? []) as unknown as { id: string; datos: unknown }[];
      const out = await Promise.all(
        filas.map(async (f) => {
          const { data: s, error: e } = await rpc("avisos_precio_sugerido", { p_aviso: f.id });
          return margenDeAviso(f, e || !s || typeof s !== "object" ? null : (s as Record<string, unknown>));
        }),
      );
      return out.filter((m): m is MargenDecision => m !== null);
    },
  });
}

const ERRORES: Record<string, string> = {
  sin_permiso: "No tienes permiso para cambiar la carta.",
  ya_aplicado: "Este precio ya se cambió antes.",
  sin_sugerencia: "Este aviso ya no sugiere ningún precio.",
  precio_fuera_de_rango: "El precio tiene que estar entre 0,50 € y 9.999 €.",
};

const eur = (v: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(v);

/** «Cambiar precio en carta»: cambia el precio (con registro), y publica la web. */
export function useCambiarPrecioCarta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (m: MargenDecision) => {
      const { data, error } = await rpc("avisos_aplicar_precio_sugerido", { p_aviso: m.id, p_precio: m.precioSugerido });
      if (error) {
        const clave = Object.keys(ERRORES).find((k) => error.message?.includes(k));
        throw new Error(clave ? ERRORES[clave] : error.message || "No se ha podido cambiar el precio");
      }
      return { m, r: (data ?? {}) as { nombre?: string; precio?: number } };
    },
    onSuccess: ({ m, r }) => {
      notificarGuardadoYPublicacion(m.canal === "vino" ? "vino" : "plato", `«${r.nombre ?? m.nombre}» ya cuesta ${eur(r.precio ?? m.precioSugerido ?? 0)} en la carta`);
      void qc.invalidateQueries({ queryKey: [CLAVE_MARGENES_DECIDIR] });
      void qc.invalidateQueries({ queryKey: ["aviso-precio-sugerido", m.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
