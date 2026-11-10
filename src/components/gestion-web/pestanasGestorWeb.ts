import type { SectionKey, UserPermissions } from "@/hooks/useUserRole";

export type PestanaGestorWeb = "carta" | "novedades" | "menus" | "tapas" | "tienda";

/**
 * Pestañas del Gestor Web, en orden. `seccion` es la sección de permisos que
 * ya protegía la página antigua de la que viene cada pestaña: se conserva
 * para no ampliar el acceso de nadie al unificar las tres páginas.
 * Bot web se retiró de aquí: ahora vive solo en /super-admin/bot-web.
 *
 * «Tienda» (10/11/2026, petición del dueño: encender o apagar la sección
 * Tienda de la web) usa el permiso de Tienda, el mismo que exige la base de
 * datos para cambiarla. `abreElGestor: false`: ese permiso por sí solo no da
 * entrada al Gestor Web (ni al menú lateral); la pestaña sale a quien ya entra
 * por Carta o Gestión web y además puede ver la Tienda.
 */
export const PESTANAS_GESTOR_WEB: { id: PestanaGestorWeb; label: string; seccion: SectionKey; abreElGestor?: false }[] = [
  { id: "carta", label: "Carta", seccion: "gestor_carta" },
  { id: "novedades", label: "Novedades", seccion: "gestion_web" },
  { id: "menus", label: "Menús diarios", seccion: "gestion_web" },
  { id: "tapas", label: "Tapas", seccion: "gestion_web" },
  { id: "tienda", label: "Tienda", seccion: "tienda", abreElGestor: false },
];

/** Secciones de permisos que dan acceso (al menos a una pestaña) al Gestor Web. */
export const SECCIONES_GESTOR_WEB: SectionKey[] = Array.from(
  new Set(PESTANAS_GESTOR_WEB.filter((p) => p.abreElGestor !== false).map((p) => p.seccion)),
);

export const esPestanaGestorWeb = (valor: string | null | undefined): valor is PestanaGestorWeb =>
  PESTANAS_GESTOR_WEB.some((p) => p.id === valor);

export const puedeVerSeccion = (seccion: SectionKey, isAdmin: boolean, permissions: UserPermissions[]) =>
  isAdmin || permissions.some((p) => p.section_key === seccion && p.can_view);
