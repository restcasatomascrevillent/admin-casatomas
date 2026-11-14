// ============================================================================
//  Sección que se abre al iniciar sesión (11/11/2026)
// ----------------------------------------------------------------------------
//  Petición del dueño: «Que en Usuarios se pueda poner qué pestaña se le va a
//  abrir por defecto cuando inician sesión». La elige el super admin en el
//  diálogo «Permisos» de cada usuario (ListaUsuarios) y se guarda en
//  `user_roles.seccion_inicio` (migración 20261124134500): NULL = lo de siempre.
//
//  Al entrar (Auth lleva a /dashboard, o se abre el panel en «/») ProtectedRoute
//  pregunta aquí a dónde ir: a esa sección si el usuario puede verla; si no, o
//  sin ninguna elegida, lo de siempre (el Dashboard o, sin él, su primera sección).
// ============================================================================
import type { SectionKey } from "@/hooks/useUserRole";
import { SECCIONES_GESTOR_WEB } from "@/components/gestion-web/pestanasGestorWeb";

/** Marca (estado de la navegación) que pone Auth al llevar a /dashboard tras iniciar sesión. */
export const ESTADO_TRAS_LOGIN = { inicio: true } as const;

/**
 * ¿Es la entrada al panel, donde se abre la sección de inicio? «/» (el acceso directo del móvil
 * abre ahí) y /dashboard cuando llega desde Auth. Pulsar «Dashboard» en el menú no lo es.
 */
export function esEntradaAlPanel(pathname: string, estado: unknown): boolean {
  if (pathname === "/") return true;
  return pathname === "/dashboard" && (estado as { inicio?: unknown } | null)?.inicio === true;
}

/** Valor del desplegable para «Lo de siempre» (en la BD, NULL). */
export const INICIO_DE_SIEMPRE = "siempre";

export interface OpcionInicio {
  /** Lo que se guarda en `user_roles.seccion_inicio`. */
  clave: string;
  titulo: string;
  ruta: string;
  /** Basta con ver una. Sin secciones (Ayuda): la ve todo el mundo. */
  secciones?: SectionKey[];
  /** Solo con el permiso guardado: el super admin no la ve por serlo (como en el menú). */
  soloConPermiso?: boolean;
}

/**
 * Las entradas del menú lateral (módulos del catálogo `lib/modulosPanel.ts` con `enMenu`), en su orden y
 * con los mismos permisos (lo comprueba `modulosPanel.test.ts`). Si cambia el menú, cambiar también esta
 * lista. «Nueva petición» no está a propósito: no es una sección de trabajo para abrir al entrar.
 */
export const OPCIONES_INICIO: readonly OpcionInicio[] = [
  { clave: "dashboard", titulo: "Dashboard", ruta: "/dashboard", secciones: ["dashboard"] },
  { clave: "reservas", titulo: "Reservas", ruta: "/reservas", secciones: ["reservas"] },
  { clave: "gestion_web", titulo: "Gestor Web", ruta: "/gestion-web", secciones: SECCIONES_GESTOR_WEB },
  { clave: "newsletter", titulo: "Newsletter", ruta: "/marketing", secciones: ["marketing"] },
  { clave: "rrss", titulo: "RRSS", ruta: "/rrss", secciones: ["marketing", "instagram_agencia"] },
  { clave: "cheques", titulo: "Cheques", ruta: "/cheques", secciones: ["cheques"] },
  { clave: "tienda", titulo: "Tienda", ruta: "/tienda", secciones: ["tienda"] },
  { clave: "facturas", titulo: "Facturas", ruta: "/facturas", secciones: ["facturas", "facturas_subida"] },
  { clave: "albaranes", titulo: "Subir albaranes", ruta: "/albaranes", secciones: ["facturas_albaranes"], soloConPermiso: true },
  { clave: "usuarios", titulo: "Usuarios", ruta: "/usuarios", secciones: ["usuarios"] },
  { clave: "ayuda", titulo: "Ayuda", ruta: "/ayuda" },
];

type Permiso = { section_key: string; can_view?: boolean | null };

/** ¿Ve esa entrada del menú quien tiene estos permisos? */
function puedeVer(opcion: OpcionInicio, permisos: ReadonlyArray<Permiso>, esSuperAdmin: boolean): boolean {
  if (!opcion.secciones) return true;
  if (esSuperAdmin && !opcion.soloConPermiso) return true;
  return opcion.secciones.some((s) => permisos.some((p) => p.section_key === s && p.can_view));
}

/** Las secciones del menú que ve quien tiene estos permisos (las del desplegable «Al iniciar sesión, abrir»). */
export function opcionesInicio(permisos: ReadonlyArray<Permiso>, esSuperAdmin = false): OpcionInicio[] {
  return OPCIONES_INICIO.filter((o) => puedeVer(o, permisos, esSuperAdmin));
}

/** La opción guardada con esa clave, o undefined (NULL, «Lo de siempre» o una clave que ya no existe). */
export function opcionInicio(clave: string | null | undefined): OpcionInicio | undefined {
  return clave ? OPCIONES_INICIO.find((o) => o.clave === clave) : undefined;
}

/**
 * A dónde ir al iniciar sesión: la ruta de la sección elegida si el usuario puede verla, o
 * null para hacer lo de siempre (sin elegir, una clave que ya no existe o sin permiso).
 */
export function rutaDeInicio(
  seccionInicio: string | null | undefined,
  permisos: ReadonlyArray<Permiso>,
  esSuperAdmin = false,
): string | null {
  const opcion = opcionInicio(seccionInicio);
  return opcion && puedeVer(opcion, permisos, esSuperAdmin) ? opcion.ruta : null;
}
