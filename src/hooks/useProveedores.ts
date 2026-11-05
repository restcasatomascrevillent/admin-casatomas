// ============================================================================
//  Facturas › Proveedores unificados
// ----------------------------------------------------------------------------
//  Lectura con proveedores_listado() (SECURITY INVOKER: RLS de Facturas) y
//  cambios con las RPC SECURITY DEFINER de la migración 20261007180000, que
//  comprueban el permiso de edición dentro (can_write_section('facturas')).
//
//  Sin la migración aplicada, `useProveedores` no falla la pantalla: devuelve
//  `faltaMigracion = true` y la lista vacía (Productos sigue agrupando por el
//  texto del documento, como antes).
//
//  Cualquier cambio invalida ['proveedores'], ['productos'] (el filtro de
//  Productos) y ['facturas']/['albaranes'] (proveedor_normalizado cambia).
// ============================================================================
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { aProveedor, faltaMigracionProveedores, type Proveedor } from "@/lib/facturas/proveedores";

export const CLAVE_PROVEEDORES = "proveedores";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (fn: string, args?: Record<string, unknown>) => (supabase.rpc as any)(fn, args);

export interface ResultadoProveedores {
  proveedores: Proveedor[];
  faltaMigracion: boolean;
}

/** `enabled: false` deja la petición para luego (Compras la pide cuando ya tiene la lista). */
export const useProveedores = ({ enabled = true }: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: [CLAVE_PROVEEDORES, "listado"],
    enabled,
    queryFn: async (): Promise<ResultadoProveedores> => {
      const { data, error } = await rpc("proveedores_listado");
      if (error) {
        if (faltaMigracionProveedores(error)) return { proveedores: [], faltaMigracion: true };
        throw error;
      }
      return { proveedores: ((data ?? []) as Record<string, unknown>[]).map(aProveedor), faltaMigracion: false };
    },
    staleTime: 60_000,
    retry: false,
  });

function mensajeError(e: unknown): string {
  const err = e as { message?: string; code?: string } | null;
  if (err?.code === "42501") return "No tienes permiso de edición en Facturas.";
  return err?.message || "Error desconocido";
}

function useMutacionProveedores<A, R>(fn: (a: A) => Promise<R>, ok: (r: R) => string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: [CLAVE_PROVEEDORES] });
      qc.invalidateQueries({ queryKey: ["productos"] });
      qc.invalidateQueries({ queryKey: ["facturas"] });
      qc.invalidateQueries({ queryKey: ["albaranes"] });
      toast.success(ok(r));
    },
    onError: (e) => toast.error("No se ha guardado", { description: mensajeError(e) }),
  });
}

export interface EdicionProveedor {
  id: number;
  nombre: string;
  nombreComercial: string | null;
  cif: string | null;
}

export const useEditarProveedor = () =>
  useMutacionProveedores(
    async (e: EdicionProveedor) => {
      const { data, error } = await rpc("proveedores_editar", {
        p_id: e.id,
        p_nombre: e.nombre,
        p_nombre_comercial: e.nombreComercial,
        p_cif: e.cif,
      });
      if (error) throw error;
      return data as { nombre: string };
    },
    (r) => `Guardado: «${r?.nombre ?? ""}»`,
  );

export const useFusionarProveedores = () =>
  useMutacionProveedores(
    async ({ origenIds, destinoId }: { origenIds: number[]; destinoId: number }) => {
      const { data, error } = await rpc("proveedores_fusionar", { p_origen_ids: origenIds, p_destino_id: destinoId });
      if (error) throw error;
      return data as { documentos_movidos: number; proveedores_borrados: number };
    },
    (r) => `Fusionados: ${r?.proveedores_borrados ?? 0} proveedor(es) menos, ${r?.documentos_movidos ?? 0} documento(s) movidos`,
  );

/** proveedores.notas_ia por id (columna de 20261104150000; sin ella, mapa vacío). */
export const useNotasIaProveedores = () =>
  useQuery({
    queryKey: [CLAVE_PROVEEDORES, "notas_ia"],
    queryFn: async (): Promise<Record<number, string>> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).from("proveedores").select("id,notas_ia").not("notas_ia", "is", null);
      if (error) return {};
      const m: Record<number, string> = {};
      for (const f of (data ?? []) as { id: number; notas_ia: string }[]) m[Number(f.id)] = f.notas_ia;
      return m;
    },
    staleTime: 60_000,
    retry: false,
  });

export const useGuardarNotasIaProveedor = () =>
  useMutacionProveedores(
    async ({ id, notas }: { id: number; notas: string }) => {
      const { error } = await rpc("proveedores_notas_ia_guardar", { p_id: id, p_notas: notas });
      if (error) throw error;
      return null;
    },
    () => "Indicaciones para la IA guardadas",
  );
