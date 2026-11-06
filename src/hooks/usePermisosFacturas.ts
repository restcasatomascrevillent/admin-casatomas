import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUsuarioIdOpcional } from "@/hooks/useAuth";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { permisosFacturas, puedeCorregirDocumento, type PermisosFacturas } from "@/lib/facturas/permisos";

/**
 * Qué puede hacer el usuario en Facturas (ver lib/facturas/permisos.ts): de
 * «Ver» y «Editar» en `facturas` y de «Facturas · Subida» (`facturas_subida`,
 * un solo interruptor guardado en can_view; se acepta también can_edit). El
 * super admin, todo.
 */
export function usePermisosFacturas(): PermisosFacturas & { cargando: boolean } {
  const ver = useCanAccessSection("facturas", "view");
  const editar = useCanAccessSection("facturas", "edit");
  const subidaVer = useCanAccessSection("facturas_subida", "view");
  const subidaEditar = useCanAccessSection("facturas_subida", "edit");
  return {
    ...permisosFacturas({ ver: ver.canAccess, editar: editar.canAccess, subida: subidaVer.canAccess || subidaEditar.canAccess }),
    cargando: ver.loading || editar.loading || subidaVer.loading || subidaEditar.loading,
  };
}

/**
 * ¿Puede corregir este documento? Con «Editar», sí sin preguntar nada. Con
 * Subida (sin Editar), se mira quién lo subió (`facturas.subido_por`, migración
 * 20261106510000): una consulta de una fila. Sin la columna o sin poder leerlo,
 * no (el servidor lo impediría igualmente).
 */
export function usePuedeCorregirDocumento(facturaId: number | null | undefined): boolean {
  return useCorreccionDocumento(facturaId).puede;
}

/** Lo mismo, con `comprobando` mientras se pregunta quién lo subió. */
export function useCorreccionDocumento(facturaId: number | null | undefined): { puede: boolean; comprobando: boolean } {
  const permisos = usePermisosFacturas();
  const usuarioId = useUsuarioIdOpcional();
  const preguntar = !permisos.editar && permisos.subir && !!usuarioId && !!facturaId;
  const { data: subidoPor, isLoading } = useQuery({
    queryKey: ["facturas", "subido_por", facturaId ?? 0],
    enabled: preguntar,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("facturas")
        .select("subido_por" as never)
        .eq("id", facturaId as number)
        .maybeSingle();
      if (error) return null;
      return ((data as { subido_por?: string | null } | null)?.subido_por ?? null) as string | null;
    },
  });
  return {
    puede: puedeCorregirDocumento(permisos, preguntar ? subidoPor : null, usuarioId),
    comprobando: permisos.cargando || (preguntar && isLoading),
  };
}
