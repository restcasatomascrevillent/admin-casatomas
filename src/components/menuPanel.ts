import {
  LayoutDashboard,
  UtensilsCrossed,
  Globe,
  Megaphone,
  Receipt,
  Gift,
  Shield,
  HelpCircle,
  Share2,
  Camera,
  ShoppingBag,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import type { SectionKey } from "@/hooks/useUserRole";
import { SECCIONES_GESTOR_WEB } from "@/components/gestion-web/pestanasGestorWeb";

/**
 * Pestañas del menú lateral y quién ve cada una (11/11/2026: salen de AppSidebar para que la
 * «Pestaña al iniciar sesión» de Usuarios use EXACTAMENTE la misma regla que el menú).
 *
 * `sectionKey` puede ser una lista: el item se ve si el usuario puede ver
 * cualquiera de ellas (el Gestor Web agrupa carta, contenido web y bot).
 * `toggleKey` es la clave que usa el Super Admin para activar/desactivar el
 * item en el sidebar (independiente del permiso por sección): por defecto es
 * el propio sectionKey cuando es uno solo, o se declara aparte cuando el item
 * agrupa varias secciones o comparte permiso con otro item.
 * Sin `sectionKey` (Ayuda): lo ve todo el mundo, sin permisos ni interruptor.
 */
export interface ItemMenuPanel {
  title: string;
  url: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  sectionKey?: SectionKey | SectionKey[];
  toggleKey?: string;
  /** Solo con el permiso guardado (el super admin no lo ve por serlo). */
  soloConPermiso?: boolean;
}

export const MENU_PANEL: ItemMenuPanel[] = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: LayoutDashboard,
    sectionKey: "dashboard",
  },
  {
    title: "Reservas",
    url: "/reservas",
    icon: UtensilsCrossed,
    sectionKey: "reservas",
    toggleKey: "reservas",
  },
  // Sección "Personal" retirada el 2026-09-23 (decisión del dueño). Ver
  // docs/funcionalidades/10-retirada-seccion-personal.md.
  // Ecommerce, Asistente Tel., Gestor Gasto, Reseñas Google, Tráfico web y
  // Espacios se gestionan exclusivamente desde el Super Admin y ya no forman
  // parte del Admin Panel normal (ver /super-admin). Plantillas Email está en
  // Reservas › Configuración desde el 04/11/2026.
  {
    title: "Gestor Web",
    url: "/gestion-web",
    icon: Globe,
    sectionKey: SECCIONES_GESTOR_WEB,
    toggleKey: "gestion_web",
  },
  {
    title: "Newsletter",
    url: "/marketing",
    icon: Megaphone,
    sectionKey: "marketing",
    toggleKey: "marketing",
  },
  // RRSS (08/11/2026, antes «Instagram», sección propia desde el 05/11/2026): Instagram, Facebook y el
  // editor IA de fotos y vídeos. Mismo permiso y mismo interruptor del Super Admin que Newsletter («marketing»).
  {
    title: "RRSS",
    url: "/rrss",
    icon: Share2,
    // La agencia (Oficiosos) también entra, solo a «Encargos» (docs/instagram-encargos.md).
    sectionKey: ["marketing", "instagram_agencia"],
    toggleKey: "marketing",
  },
  {
    title: "Cheques",
    url: "/cheques",
    icon: Gift,
    sectionKey: "cheques",
    toggleKey: "cheques",
  },
  {
    title: "Tienda",
    url: "/tienda",
    icon: ShoppingBag,
    sectionKey: "tienda",
    toggleKey: "tienda",
  },
  {
    title: "Facturas",
    url: "/facturas",
    icon: Receipt,
    // Con solo «Facturas · Subida» también sale (entra a la pestaña Cargar, 06/11/2026).
    sectionKey: ["facturas", "facturas_subida"],
    toggleKey: "facturas",
  },
  // «Subir albaranes» (10/11/2026): la pantalla del tipo de usuario «Albaranes» (solo fotos). No la ve el super
  // admin (tiene Cargar en Facturas): solo quien tiene el permiso. Interruptor del Super Admin: el de Facturas.
  {
    title: "Subir albaranes",
    url: "/albaranes",
    icon: Camera,
    sectionKey: "facturas_albaranes",
    toggleKey: "facturas",
    soloConPermiso: true,
  },
  // «Análisis general» (07/11/2026) ya no va aquí: desde el 10/11/2026 es la pestaña «Márgenes» de Facturas
  // (petición del dueño). /analisis lleva a ella.
  {
    title: "Usuarios",
    url: "/usuarios",
    icon: Shield,
    sectionKey: "usuarios",
    toggleKey: "usuarios",
  },
  // «Avisos» ya no va aquí (06/11/2026, petición del dueño): cada sección tiene su botón rojo (BotonAvisosSeccion)
  // y la campana de arriba enlaza a /avisos con todos.
  { title: "Ayuda", url: "/ayuda", icon: HelpCircle },
];

/** Lo que decide qué pestañas ve un usuario. */
export interface ContextoMenuPanel {
  permisos: ReadonlyArray<{ section_key: string; can_view: boolean }>;
  esSuperAdmin: boolean;
  /** Interruptores del Super Admin (useAdminFeatureToggles): sin registro, activado. */
  isEnabled: (toggleKey: string) => boolean;
}

/** ¿Ve este usuario la pestaña en el menú lateral? */
export function itemMenuVisible(item: ItemMenuPanel, ctx: ContextoMenuPanel): boolean {
  if (!item.sectionKey) return true;
  if (item.toggleKey && !ctx.isEnabled(item.toggleKey)) return false;
  const keys = Array.isArray(item.sectionKey) ? item.sectionKey : [item.sectionKey];
  // Usuarios se configura por permisos como las demás desde el 06/11/2026 (antes, rol admin).
  // Ser "admin" ya no da acceso a todo lo demás: solo un super admin lo ve
  // todo pase lo que pase en la tabla de permisos.
  if (ctx.esSuperAdmin && !item.soloConPermiso) return true;
  return keys.some((key) => ctx.permisos.find((p) => p.section_key === key)?.can_view);
}

/** Pestañas del menú que ve el usuario, en el orden del menú. */
export function pestanasVisibles(ctx: ContextoMenuPanel): ItemMenuPanel[] {
  return MENU_PANEL.filter((item) => itemMenuVisible(item, ctx));
}

/**
 * Pestaña a abrir al iniciar sesión: la guardada si el usuario aún la ve en el menú; si no hay
 * elección o ya no la ve, `null` (= se entra como siempre).
 */
export function elegirPestanaInicial(guardada: string | null | undefined, ctx: ContextoMenuPanel): string | null {
  if (!guardada) return null;
  return pestanasVisibles(ctx).some((item) => item.url === guardada) ? guardada : null;
}
