/**
 * Datos de los encargos (TanStack Query). El panel usa sondeo, no realtime:
 * la lista se refresca cada minuto y la ficha abierta cada 20 s.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { CLAVE_AJUSTES, CLAVE_ENCARGOS, claveDetalle, claveHuecos, leerAjustes, leerDetalle, leerHuecos, listarEncargos } from "./api";
import { huecosPorDia, hoyMadrid, pendientes, type Roles } from "./logica";

/** Quién es el usuario para los encargos (misma regla que can_write_section: hoy basta «Ver»). */
export function useRolesEncargos(): Roles & { cargando: boolean } {
  const r = useCanAccessSection("marketing");
  const a = useCanAccessSection("instagram_agencia");
  return { restaurante: r.canAccess, agencia: a.canAccess, cargando: r.loading || a.loading };
}

export function useEncargos(activo = true) {
  return useQuery({
    queryKey: CLAVE_ENCARGOS,
    queryFn: listarEncargos,
    enabled: activo,
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
}

export function useDetalleEncargo(id: string | null) {
  return useQuery({
    queryKey: claveDetalle(id ?? ""),
    queryFn: () => leerDetalle(id as string),
    enabled: !!id,
    refetchInterval: 20_000,
  });
}

export function useAjustesEncargos() {
  return useQuery({ queryKey: CLAVE_AJUSTES, queryFn: leerAjustes, staleTime: 5 * 60_000 });
}

/** Número de la pestaña «Encargos»: lo que espera a quien mira. */
export function usePendientesEncargos(): number {
  const roles = useRolesEncargos();
  const { data } = useEncargos(!roles.cargando && (roles.restaurante || roles.agencia));
  const { restaurante, agencia } = roles;
  return useMemo(() => pendientes(data ?? [], { restaurante, agencia }), [data, restaurante, agencia]);
}

/** Huecos de encargo por día para el calendario (AAAA-MM-DD → huecos). Vacío si no hay migración o permiso. */
export function useHuecosEncargo(desde: Date, hasta: Date) {
  // Fechas de Madrid: el rango del calendario empieza y acaba a medianoche de Madrid.
  const d = hoyMadrid(desde);
  const h = hoyMadrid(hasta);
  const { data } = useQuery({ queryKey: claveHuecos(d, h), queryFn: () => leerHuecos(d, h), refetchInterval: 60_000, staleTime: 30_000 });
  return useMemo(() => huecosPorDia(data ?? [], hoyMadrid()), [data]);
}
