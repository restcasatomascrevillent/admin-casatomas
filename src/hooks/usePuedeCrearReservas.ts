import { useCanAccessSection } from "@/hooks/useUserRole";

/**
 * ¿Puede dar de alta reservas? (10/11/2026, tipo de usuario «Reservas»).
 *
 *   · «Editar» en Reservas → sí, y todo lo demás (`soloCrear: false`).
 *   · «Ver» en Reservas + «Reservas · Crear» → sí, SOLO crear (`soloCrear: true`): el formulario de
 *     alta sin «Ocupa la sala entera» y el resto de la sección en solo lectura.
 *   · El super admin, siempre (useCanAccessSection ya da true).
 *
 * Lo mismo que reservas_puede_crear() en la BD (migración 20261122143500), que es la que manda.
 */
export function usePuedeCrearReservas(): { puedeCrear: boolean; soloCrear: boolean; loading: boolean } {
  const ver = useCanAccessSection("reservas");
  const editar = useCanAccessSection("reservas", "edit");
  const crearVer = useCanAccessSection("reservas_crear");
  const crearEditar = useCanAccessSection("reservas_crear", "edit");
  const loading = ver.loading || editar.loading || crearVer.loading || crearEditar.loading;
  if (loading) return { puedeCrear: false, soloCrear: false, loading: true };
  const soloCrear = !editar.canAccess && ver.canAccess && (crearVer.canAccess || crearEditar.canAccess);
  return { puedeCrear: editar.canAccess || soloCrear, soloCrear, loading: false };
}
