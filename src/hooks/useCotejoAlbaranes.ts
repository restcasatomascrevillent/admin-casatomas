import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { leerCotejo, num, type Cotejo } from "@/lib/facturas/cotejo";

/**
 * Albarán ↔ factura (migración 20261010110000_albaranes_factura_cotejo):
 * candidatos, vincular/desvincular a mano y el cotejo por producto.
 * Mientras la migración no esté aplicada, las consultas devuelven
 * `{ disponible: false }` y la ficha se queda con lo que ya sabía
 * (facturado_en_id) en vez de romperse.
 */

type Fns = Database["public"]["Functions"];
export type AlbaranCandidato = Fns["albaranes_candidatos"]["Returns"][number];
export type FacturaCandidata = Fns["facturas_candidatas"]["Returns"][number];

const STALE_TIME = 60 * 1000;
export const CLAVE_COTEJO = "cotejo-albaranes";
const CLAVE_CANDIDATOS = "albaranes-candidatos";
const CLAVE_FACTURAS_CAND = "facturas-candidatas";

/** La RPC no existe todavía (migración sin aplicar). */
export const faltaRpc = (e: { code?: string; message?: string } | null | undefined): boolean =>
  !!e && (e.code === "PGRST202" || e.code === "42883" || /could not find the function|does not exist/i.test(e.message ?? ""));

export type ResultadoCotejo = { disponible: false } | { disponible: true; cotejo: Cotejo | null };

export function useCotejoFactura(facturaId: number | null, albaranId: number | null = null) {
  return useQuery({
    queryKey: [CLAVE_COTEJO, facturaId, albaranId],
    enabled: facturaId !== null,
    staleTime: STALE_TIME,
    queryFn: async (): Promise<ResultadoCotejo> => {
      const { data, error } = await supabase.rpc("cotejo_factura_albaranes", {
        p_factura_id: facturaId as number,
        p_albaran_id: albaranId,
      });
      if (error) {
        if (faltaRpc(error)) return { disponible: false };
        throw error;
      }
      return { disponible: true, cotejo: leerCotejo(data) };
    },
  });
}

const normalizarCandidato = (c: AlbaranCandidato): AlbaranCandidato => ({
  ...c,
  id: Number(c.id),
  total: num(c.total),
  base: num(c.base),
  lineas: num(c.lineas) ?? 0,
  dias: num(c.dias),
});

export function useAlbaranesCandidatos(facturaId: number, textoBuscado: string, enabled: boolean) {
  const t = textoBuscado.trim();
  return useQuery({
    queryKey: [CLAVE_CANDIDATOS, facturaId, t],
    enabled,
    staleTime: STALE_TIME,
    queryFn: async (): Promise<AlbaranCandidato[]> => {
      const { data, error } = await supabase.rpc("albaranes_candidatos", {
        p_factura_id: facturaId,
        p_texto: t === "" ? null : t,
      });
      if (error) throw error;
      return (data ?? []).map(normalizarCandidato);
    },
  });
}

export function useFacturasCandidatas(albaranId: number, enabled: boolean) {
  return useQuery({
    queryKey: [CLAVE_FACTURAS_CAND, albaranId],
    enabled,
    staleTime: STALE_TIME,
    queryFn: async (): Promise<FacturaCandidata[]> => {
      const { data, error } = await supabase.rpc("facturas_candidatas", { p_albaran_id: albaranId });
      if (error) throw error;
      return (data ?? []).map((f) => ({ ...f, id: Number(f.id), total: num(f.total), base: num(f.base), lineas: num(f.lineas) ?? 0, dias: num(f.dias) }));
    },
  });
}

/** Mensaje legible de un error de las RPC de vínculo. */
export function mensajeErrorVinculo(e: unknown): string {
  const err = e as { code?: string; message?: string; hint?: string } | null;
  if (faltaRpc(err)) return "Falta aplicar la migración del cotejo de albaranes (20261010110000).";
  if (err?.code === "42501") return "No tienes permiso para editar facturas.";
  if (err?.hint === "proveedor_distinto") return "El albarán y la factura son de proveedores distintos.";
  return err?.message || "No se ha podido guardar el vínculo.";
}

function useInvalidarVinculos() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      [["facturas"], ["albaranes"], [CLAVE_COTEJO], [CLAVE_CANDIDATOS], [CLAVE_FACTURAS_CAND]].map((queryKey) =>
        qc.invalidateQueries({ queryKey }),
      ),
    );
}

export function useVincularAlbaran() {
  const invalidar = useInvalidarVinculos();
  return useMutation({
    mutationFn: async (v: { albaranId: number; facturaId: number; forzar?: boolean }) => {
      const { data, error } = await supabase.rpc("vincular_albaran_factura", {
        p_albaran_id: v.albaranId,
        p_factura_id: v.facturaId,
        p_forzar: v.forzar ?? false,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidar(),
    onError: (e) => toast.error(mensajeErrorVinculo(e)),
  });
}

export function useDesvincularAlbaran() {
  const invalidar = useInvalidarVinculos();
  return useMutation({
    mutationFn: async (albaranId: number) => {
      const { data, error } = await supabase.rpc("desvincular_albaran", { p_albaran_id: albaranId });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidar(),
    onError: (e) => toast.error(mensajeErrorVinculo(e)),
  });
}
