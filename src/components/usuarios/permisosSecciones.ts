/**
 * Permisos por sección de la pantalla Usuarios: «Ver» y «Puede editar».
 *
 * Lógica compartida por el diálogo «Permisos» (ListaUsuarios), el alta
 * (InvitarUsuario) y los roles preconfigurados (ConfigurarRolesModal). Hasta el
 * 2026-10-01 las tres forzaban `can_edit: false` al cargar y en cada cambio: el
 * permiso de edición no se podía dar desde el panel y cualquier guardado borraba
 * el que se hubiera puesto por SQL.
 *
 * Reglas:
 *   - «Puede editar» solo se activa si la sección tiene «Ver», y quitar «Ver»
 *     quita también «Puede editar» (editar implica ver, como en el resto del panel).
 *   - Se muestra y se guarda el valor real; lo nuevo empieza sin edición.
 *   - Quién puede CONCEDER la edición no se decide aquí: solo un super admin
 *     (`puedeConcederEdicion` en los componentes; en la BD, la RLS de
 *     user_permissions solo deja escribir a super admins).
 */
import { SECTIONS } from "@/hooks/useUserRole";

export interface PermisoSeccion {
  section_key: string;
  can_view: boolean;
  can_edit: boolean;
}

type Seccion = (typeof SECTIONS)[number];
type SeccionConfigurable = Exclude<Seccion, { key: "usuarios" }>;

/**
 * Secciones que se configuran desde Usuarios. «usuarios» no: esa sección va por
 * rol admin, no por permisos (ProtectedRoute / AppSidebar).
 */
export const SECCIONES_CONFIGURABLES: SeccionConfigurable[] = SECTIONS.filter(
  (seccion): seccion is SeccionConfigurable => seccion.key !== "usuarios",
);

/**
 * Qué desbloquea «Puede editar» en cada sección, tal como está HOY el panel: solo
 * Reservas mira el permiso de edición (`useCanAccessSection("reservas", "edit")`);
 * en el resto basta con «Ver». Si una sección empieza a exigir edición, cambiar su
 * texto aquí. Se muestra detrás de «Editar: ».
 */
export const AYUDA_EDICION: Record<SeccionConfigurable["key"], string> = {
  dashboard: "sin efecto aquí; las reservas del día dependen de «Reservas».",
  reservas: "crear y modificar reservas, aceptarlas o cancelarlas, marcar llegadas y mover de sala.",
  gestor_carta: "aún no se usa; con «Ver» ya se puede modificar todo en esta sección.",
  gestion_web: "aún no se usa; con «Ver» ya se puede modificar todo en esta sección.",
  marketing: "aún no se usa; con «Ver» ya se puede modificar todo en esta sección.",
  facturas: "aún no se usa; con «Ver» ya se puede modificar todo en esta sección.",
};

/**
 * Por qué el diálogo «Permisos» sale en solo lectura a quien no es super admin: la RLS de
 * user_permissions solo deja escribir a un super admin (cualquier otro guardado no hace nada).
 */
export const SOLO_SUPER_ADMIN_CAMBIA_PERMISOS = "Solo un super admin puede cambiar permisos.";

type PermisoGuardado = { section_key: string; can_view?: boolean | null; can_edit?: boolean | null };

/**
 * Estado editable de TODAS las secciones configurables a partir de lo guardado
 * (los permisos de un usuario o los de una plantilla). Conserva el can_edit real;
 * las secciones que no aparecen salen sin «Ver» ni «Puede editar».
 */
export function permisosParaEditar(origen: ReadonlyArray<PermisoGuardado>): PermisoSeccion[] {
  return SECCIONES_CONFIGURABLES.map((seccion) => {
    const guardado = origen.find((p) => p.section_key === seccion.key);
    const can_edit = Boolean(guardado?.can_edit);
    return { section_key: seccion.key, can_view: Boolean(guardado?.can_view) || can_edit, can_edit };
  });
}

/** Cambia «Ver» de una sección; al quitarlo se quita también «Puede editar». */
export function cambiarVer(permisos: PermisoSeccion[], sectionKey: string, ver: boolean): PermisoSeccion[] {
  return permisos.map((p) =>
    p.section_key === sectionKey ? { ...p, can_view: ver, can_edit: ver && p.can_edit } : p,
  );
}

/** Cambia «Puede editar» de una sección; sin «Ver» no se puede activar. */
export function cambiarEditar(permisos: PermisoSeccion[], sectionKey: string, editar: boolean): PermisoSeccion[] {
  return permisos.map((p) => (p.section_key === sectionKey ? { ...p, can_edit: editar && p.can_view } : p));
}

/** Los mismos permisos sin edición en ninguna sección (para quien no puede concederla). */
export function sinEdicion(permisos: PermisoSeccion[]): PermisoSeccion[] {
  return permisos.map((p) => (p.can_edit ? { ...p, can_edit: false } : p));
}

/** ¿Coinciden «Ver» y «Puede editar» en todas las secciones configurables? */
export function mismosPermisos(a: ReadonlyArray<PermisoGuardado>, b: ReadonlyArray<PermisoGuardado>): boolean {
  const pb = permisosParaEditar(b);
  return permisosParaEditar(a).every(
    (p, i) => p.can_view === pb[i].can_view && p.can_edit === pb[i].can_edit,
  );
}
