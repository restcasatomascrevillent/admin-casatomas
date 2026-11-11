// ============================================================================
//  Rol, permisos y «super admin» recordados en el dispositivo (09/11/2026)
// ----------------------------------------------------------------------------
//  Con mala cobertura, al abrir el panel se esperaba un viaje más a Supabase
//  (user_roles + user_permissions + super_admins) antes de pintar NADA, aunque
//  la copia de «Hoy» (`cacheOffline.ts`) ya estuviera en el dispositivo. Ahora
//  lo último que se leyó para ESTE usuario se usa al momento y se vuelve a
//  leer igualmente en segundo plano (UserRoleProvider, SuperAdminProvider): si
//  ha cambiado, la pantalla se corrige sola en cuanto llega (ProtectedRoute
//  saca de la sección a quien ya no puede verla).
//
//  No abre nada que el servidor no permita: los datos los sigue filtrando la
//  RLS de Supabase; esto solo decide qué pantallas se pintan mientras tanto.
//
//  Reglas: por usuario (otra cuenta no la lee), como mucho de hace 24 h, y se
//  borra al cerrar sesión o cambiar de usuario (useAuth → vaciarCache). Todo
//  en try/catch: sin almacén o con JSON roto se sigue sin copia.
// ============================================================================

export const CLAVE_PERMISOS = "panel:permisos-recordados";
export const VERSION_PERMISOS = 1;
export const CADUCIDAD_PERMISOS_MS = 24 * 60 * 60 * 1000;

export interface PermisoRecordado {
  section_key: string;
  can_view: boolean;
  can_edit: boolean;
}

export interface PermisosRecordados {
  role: "admin" | "manager" | "staff" | null;
  /** `undefined` = aún no se sabe (cada proveedor guarda su parte: UserRoleProvider y SuperAdminProvider). */
  permissions?: PermisoRecordado[];
  /** `undefined` = aún no se sabe. */
  superAdmin?: boolean;
  /** Sección que se abre al iniciar sesión (11/11/2026, `lib/seccionInicio.ts`). `undefined` = aún no se sabe. */
  seccionInicio?: string | null;
}

interface Copia extends PermisosRecordados {
  v: number;
  usuario: string;
  guardado: number;
}

const almacen = (): Storage | null => {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
};

/** Lo recordado de `usuario` (24 h, versión actual) o null. Una copia inválida o de otro usuario se borra. */
export function leerPermisosRecordados(usuario: string | null, ahora: number = Date.now()): PermisosRecordados | null {
  const ls = almacen();
  if (!ls || !usuario) return null;
  try {
    const bruto = ls.getItem(CLAVE_PERMISOS);
    if (!bruto) return null;
    const c = JSON.parse(bruto) as Partial<Copia>;
    const valida =
      c.v === VERSION_PERMISOS &&
      c.usuario === usuario &&
      typeof c.guardado === "number" &&
      ahora - c.guardado >= 0 &&
      ahora - c.guardado <= CADUCIDAD_PERMISOS_MS &&
      (c.permissions === undefined || Array.isArray(c.permissions));
    if (!valida) {
      ls.removeItem(CLAVE_PERMISOS);
      return null;
    }
    return { role: c.role ?? null, permissions: c.permissions, superAdmin: c.superAdmin, seccionInicio: c.seccionInicio };
  } catch {
    return null;
  }
}

/** Guarda (mezclando con lo que ya hubiera de este usuario) lo que se acaba de leer del servidor. */
export function guardarPermisosRecordados(usuario: string, parte: Partial<PermisosRecordados>, ahora: number = Date.now()): void {
  const ls = almacen();
  if (!ls || !usuario) return;
  try {
    const previo = leerPermisosRecordados(usuario, ahora);
    const copia: Copia = {
      v: VERSION_PERMISOS,
      usuario,
      guardado: ahora,
      role: parte.role !== undefined ? parte.role : (previo?.role ?? null),
      permissions: parte.permissions ?? previo?.permissions,
      superAdmin: parte.superAdmin !== undefined ? parte.superAdmin : previo?.superAdmin,
      seccionInicio: parte.seccionInicio !== undefined ? parte.seccionInicio : previo?.seccionInicio,
    };
    ls.setItem(CLAVE_PERMISOS, JSON.stringify(copia));
  } catch {
    /* sin sitio o modo privado: sin copia */
  }
}

/** Borra lo recordado (cerrar sesión, cambiar de usuario). */
export function borrarPermisosRecordados(): void {
  try {
    almacen()?.removeItem(CLAVE_PERMISOS);
  } catch {
    /* nada */
  }
}
