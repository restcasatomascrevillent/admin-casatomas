// Gráficas de decisión de Facturas › Análisis (RPC `facturas_decision`,
// migración 20261115100000) y sus acciones: «Visto», «Es normal» y precio
// pactado. Una petición por periodo y local; las acciones invalidan esta
// consulta y las alertas (las marcas de las gráficas). Si la migración no está
// aplicada, no hay tarjetas (null) y no es un error que enseñar.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { esErrorRpcInexistente } from "@/lib/facturas/preguntasRapidas";
import { normalizarDecision, type DecisionFacturas } from "@/lib/facturas/decision";

async function rpc(funcion: string, args: Record<string, unknown>) {
  const llamar = supabase.rpc as unknown as (
    this: typeof supabase,
    fn: string,
    a?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
  return llamar.call(supabase, funcion, args);
}

export const CLAVE_DECISION = "facturas-decision";

export function consultaDecision(desde: string | null, hasta: string | null, local: "casa_tomas" | "touza" | null) {
  return {
    queryKey: [CLAVE_DECISION, desde, hasta, local] as const,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<DecisionFacturas | null> => {
      const { data, error } = await rpc("facturas_decision", { p_desde: desde, p_hasta: hasta, p_local: local });
      if (esErrorRpcInexistente(error)) return null;
      if (error) throw new Error(error.message || "No se han podido cargar las gráficas de decisión");
      return normalizarDecision(data);
    },
  };
}

export function useDecisionFacturas(desde: string | null, hasta: string | null, local: "casa_tomas" | "touza" | null) {
  return useQuery({ ...consultaDecision(desde, hasta, local), retry: 1, placeholderData: (prev) => prev });
}

export type AccionDecision =
  | { tipo: "visto"; id: string }
  | { tipo: "es_normal"; id: string; dias?: number }
  | { tipo: "pactar"; proveedorId: number; nombreNormalizado: string; precio: number; unidad: string | null; producto: string }
  | { tipo: "quitar_pacto"; proveedorId: number; nombreNormalizado: string };

const MENSAJE: Record<AccionDecision["tipo"], string> = {
  visto: "Aviso archivado",
  es_normal: "No volverá a avisar de esto en 90 días",
  pactar: "Precio pactado guardado: avisará si una factura lo cambia",
  quitar_pacto: "Precio pactado quitado",
};

/** Las acciones de las tarjetas (piden «Editar» en Facturas: lo comprueba la RPC). */
export function useAccionDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: AccionDecision) => {
      const { error } =
        a.tipo === "visto"
          ? await rpc("facturas_alerta_visto", { p_id: a.id })
          : a.tipo === "es_normal"
            ? await rpc("facturas_alerta_es_normal", { p_id: a.id, p_dias: a.dias ?? null })
            : a.tipo === "pactar"
              ? await rpc("facturas_precio_pactado_marcar", {
                  p_proveedor_id: a.proveedorId,
                  p_nombre_normalizado: a.nombreNormalizado,
                  p_precio: a.precio,
                  p_unidad: a.unidad,
                  p_producto: a.producto,
                })
              : await rpc("facturas_precio_pactado_quitar", { p_proveedor_id: a.proveedorId, p_nombre_normalizado: a.nombreNormalizado });
      if (error) throw new Error(error.code === "42501" ? "Hace falta permiso de «Editar» en Facturas" : error.message || "No se ha podido guardar");
      return a;
    },
    onSuccess: (a) => {
      toast.success(MENSAJE[a.tipo]);
      void qc.invalidateQueries({ queryKey: [CLAVE_DECISION] });
      void qc.invalidateQueries({ queryKey: ["facturas-alertas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
