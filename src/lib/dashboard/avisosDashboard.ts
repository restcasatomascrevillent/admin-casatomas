// Dashboard › «Avisos» (10/11/2026, petición del dueño). Los avisos que ya hay
// en el panel —los de la campana y la página Avisos (tabla
// notificaciones_dashboard): reservas, alertas diarias de Facturas, subidas de
// precio de líneas de factura, originales sin Drive, encargos de Instagram,
// modelos de IA…— con su enlace (`rutaDeAviso`). Cada uno se enseña solo a
// quien puede ver su sección. Lo decide la RLS (`seccion_aviso`, migración
// 20261212100000: hasta el 18/11/2026 quien veía «Dashboard» leía TODOS y el
// camarero veía los de Facturas en la campana); aquí se repite la misma lista
// para las etiquetas y como segunda barrera. Sin React: se prueba suelto.
import type { NotificacionDashboard } from "@/hooks/useNotificacionesDashboard";
import { avisoCaducado, TIPOS_POR_FILTRO, tiposDeSeccion } from "@/lib/avisos";

export type SeccionAviso = "reservas" | "facturas" | "rrss" | "super_admin";

export interface PermisosAvisos {
  reservas: boolean;
  facturas: boolean;
  /** Newsletter y RRSS (sección «marketing»). */
  rrss: boolean;
  superAdmin: boolean;
}

export const ETIQUETA_SECCION_AVISO: Record<SeccionAviso, string> = {
  reservas: "Reservas",
  facturas: "Facturas",
  rrss: "RRSS",
  super_admin: "Super Admin",
};

// TIPOS_POR_FILTRO y no tiposDeSeccion: el botón «Avisos» de Reservas solo enseña nuevas y canceladas (10/11/2026),
// pero solicitudes y «sin sala» siguen siendo avisos de Reservas (solo para quien ve Reservas). Además, las
// propuestas de espacios, los correos de reserva que no salen y las mesas borradas con reservas.
const RESERVAS = new Set([
  ...TIPOS_POR_FILTRO.reservas,
  "propuesta_aceptada",
  "propuesta_rechazada",
  "propuesta_fallida",
  "email_fallido",
  "mesa_borrada_con_asignaciones",
]);
const FACTURAS = new Set(tiposDeSeccion("facturas"));

/**
 * De qué sección es un aviso (decide quién lo ve). La misma lista que `public.seccion_aviso`
 * (supabase/migrations/20261212100000_avisos_solo_su_seccion.sql): si se añade un tipo, en los dos sitios.
 * Lo que no es de Reservas, Facturas ni RRSS (sistema, modelos de IA, peticiones, llamadas y cualquier
 * tipo nuevo) es solo del super admin.
 */
export function seccionDeAviso(n: Pick<NotificacionDashboard, "tipo" | "referencia_tipo">): SeccionAviso {
  if (RESERVAS.has(n.tipo)) return "reservas";
  if (FACTURAS.has(n.tipo) || n.tipo.startsWith("facturas_")) return "facturas";
  if (n.tipo.startsWith("instagram_")) return "rrss";
  return "super_admin";
}

export function puedeVerAviso(n: Pick<NotificacionDashboard, "tipo" | "referencia_tipo">, p: PermisosAvisos): boolean {
  const s = seccionDeAviso(n);
  if (s === "super_admin") return p.superAdmin;
  return p[s];
}

/**
 * Lo que enseña el módulo: los avisos que puede ver, sin los caducados ni los
 * que no van a la campana (subidas pequeñas: `datos.campana = false`), sin
 * leer primero y, dentro, del más nuevo al más viejo.
 */
export function avisosParaDashboard(
  lista: NotificacionDashboard[],
  permisos: PermisosAvisos,
  ahora: number = Date.now(),
): NotificacionDashboard[] {
  return lista
    .filter((n) => n.datos?.campana !== false && !avisoCaducado(n, ahora) && puedeVerAviso(n, permisos))
    .sort((a, b) => Number(a.leida) - Number(b.leida) || Date.parse(b.created_at) - Date.parse(a.created_at));
}

/** Sin leer por sección (las fichas de arriba), en el orden del menú. */
export function sinLeerPorSeccion(lista: NotificacionDashboard[]): { seccion: SeccionAviso; n: number }[] {
  const orden: SeccionAviso[] = ["reservas", "facturas", "rrss", "super_admin"];
  const cuenta = new Map<SeccionAviso, number>();
  for (const a of lista) if (!a.leida) cuenta.set(seccionDeAviso(a), (cuenta.get(seccionDeAviso(a)) ?? 0) + 1);
  return orden.flatMap((seccion) => (cuenta.get(seccion) ? [{ seccion, n: cuenta.get(seccion) as number }] : []));
}
