import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { facturaSchema, mensualFactura, type Factura } from "@/components/facturacion/modelo";

export interface FacturaGuardada {
  id: string; numero: string; documento: Factura; creado_en: string; actualizado_en: string;
}
export interface BorradorGuardado extends FacturaGuardada { factura_id: string | null }
export interface ConfigFacturacion { documento: Factura; actualizado_en: string }
export interface DatosFacturacion { config: ConfigFacturacion | null; facturas: FacturaGuardada[]; borradores?: BorradorGuardado[] }
interface RespuestaGuardado { config: ConfigFacturacion; factura: FacturaGuardada | null; borrador?: BorradorGuardado | null; borrador_eliminado?: string | null }
// Contrato aislado para las RPC nuevas, hasta regenerar los tipos de Supabase.
interface RpcFacturacion {
  rpc(nombre: string, params?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}
const db = supabase as unknown as RpcFacturacion;
export const FACTURACION_KEY = ["oficiososia-facturacion"] as const;
function validarDatos(data: unknown): DatosFacturacion {
  const d = data as DatosFacturacion;
  if (!d || !Array.isArray(d.facturas)) throw new Error("Respuesta de facturación inválida.");
  if (d.config) facturaSchema.parse(d.config.documento);
  d.facturas.forEach(f => facturaSchema.parse(f.documento));
  (d.borradores ?? []).forEach(b => facturaSchema.parse(b.documento));
  return d;
}
export function useFacturacionOficiososia() {
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: FACTURACION_KEY, staleTime: 60000,
    queryFn: async () => {
      const { data, error } = await db.rpc("oficiososia_facturacion_leer");
      if (error) throw new Error(error.message);
      return validarDatos(data);
    },
  });
  async function guardar(documento: Factura, versionConfig: string | null, factura?: { id: string; version: string | null }, borrador?: {id:string;version:string|null;facturaId?:string|null}) {
    facturaSchema.parse(documento);
    const { data, error } = await db.rpc("oficiososia_facturacion_guardar_v2", {
      p_documento: documento, p_version_config: versionConfig,
      p_id: factura?.id ?? null, p_version_factura: factura?.version ?? null,
      p_emitir: !!factura, p_borrador_id:borrador?.id ?? null, p_version_borrador:borrador?.version ?? null, p_factura_origen:borrador?.facturaId ?? null,
    });
    if (error) throw new Error(error.code === "23505" ? "Ya existe una factura con ese número." : error.message);
    const result = data as RespuestaGuardado;
    facturaSchema.parse(result.config.documento);
    cache.setQueryData<DatosFacturacion>(FACTURACION_KEY, previo => ({
      config: result.config,
      borradores: result.borrador ? [result.borrador,...(previo?.borradores ?? []).filter(b=>b.id!==result.borrador?.id)] : (previo?.borradores ?? []).filter(b=>b.id!==result.borrador_eliminado),
      facturas: result.factura
        ? [result.factura, ...(previo?.facturas ?? []).filter(f => f.id !== result.factura?.id)]
        : previo?.facturas ?? [],
    }));
    return result;
  }
  return { ...query, guardar };
}
export function useMensualFacturado() {
  const q = useFacturacionOficiososia();
  return q.data?.config ? mensualFactura(q.data.config.documento) : null;
}
