import type { SectionKey, UserPermissions } from "@/hooks/useUserRole";

export type PestanaGestorWeb = "carta" | "novedades" | "menus" | "tapas" | "bot";

/**
 * Pestañas del Gestor Web, en orden. `seccion` es la sección de permisos que
 * ya protegía la página antigua de la que viene cada pestaña: se conserva
 * para no ampliar el acceso de nadie al unificar las tres páginas.
 */
export const PESTANAS_GESTOR_WEB: { id: PestanaGestorWeb; label: string; seccion: SectionKey }[] = [
  { id: "carta", label: "Carta", seccion: "gestor_carta" },
  { id: "novedades", label: "Novedades", seccion: "gestion_web" },
  { id: "menus", label: "Menús diarios", seccion: "gestion_web" },
  { id: "tapas", label: "Tapas", seccion: "gestion_web" },
  { id: "bot", label: "Bot web", seccion: "gestion_bot" },
];

/** Secciones de permisos que dan acceso (al menos a una pestaña) al Gestor Web. */
export const SECCIONES_GESTOR_WEB: SectionKey[] = Array.from(new Set(PESTANAS_GESTOR_WEB.map((p) => p.seccion)));

export const esPestanaGestorWeb = (valor: string | null | undefined): valor is PestanaGestorWeb =>
  PESTANAS_GESTOR_WEB.some((p) => p.id === valor);

export const puedeVerSeccion = (seccion: SectionKey, isAdmin: boolean, permissions: UserPermissions[]) =>
  isAdmin || permissions.some((p) => p.section_key === seccion && p.can_view);
