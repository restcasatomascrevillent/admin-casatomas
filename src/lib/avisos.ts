import { TrendingDown, Handshake, AlertTriangle, BadgePercent, Bot, Clock, CloudOff, FileQuestion, Info, KanbanSquare, LayoutGrid, PieChart, Receipt, ScanSearch, TrendingUp, UserPlus, XCircle } from "lucide-react";
import type { NotificacionDashboard } from "@/hooks/useNotificacionesDashboard";
import { rutaAlerta, TIPOS_ALERTA_FACTURAS } from "@/lib/facturas/alertas";

/** Adónde lleva un aviso (null = no tiene origen al que ir). Lo comparten la campana y la página «Avisos». */
export function rutaDeAviso(
  n: Pick<NotificacionDashboard, "tipo" | "referencia_tipo"> & { referencia_id?: string | null; datos?: NotificacionDashboard["datos"] },
): string | null {
  // Alertas de Facturas (20261107300000): cada una trae su enlace del panel (documento, proveedor, mes).
  if (n.referencia_tipo === "facturas_alerta") return rutaAlerta(n.datos) ?? "/facturas?tab=chat";
  // Reserva sin sala o mesa dentro de la ventana: pestaña «Asignación» de /reservas.
  if (n.tipo === "reserva_sin_asignar") return "/reservas?tab=asignacion";
  // Reserva nueva o cancelada (20261122160000): la lista de reservas.
  if (n.referencia_tipo === "reserva" && (n.tipo === "reserva_nueva" || n.tipo === "reserva_cancelada")) return "/reservas?tab=reservas";
  // Las solicitudes viven en la pestaña unificada «Reservas», filtradas por «Solicitudes sin resolver».
  if (n.referencia_tipo === "solicitud") return "/reservas?tab=reservas&status=solicitudes";
  if (n.referencia_tipo === "facturas_cargar") return "/facturas?tab=cargar";
  if (n.referencia_tipo === "facturas_productos") return "/facturas?tab=productos";
  // Original de una factura que no se ha podido subir a Drive (20261105193000).
  if (n.referencia_tipo === "facturas_original") return "/facturas?tab=compras";
  // Modelos de OpenAI nuevos, retirados o sin precio (20261107500000): solo super admin.
  if (n.referencia_tipo === "ia_modelos") return "/super-admin/servicios?tab=modelos";
  // Encargos de Instagram (20261110100000): la ficha del encargo.
  if (n.referencia_tipo === "instagram_encargo") {
    return n.referencia_id ? `/rrss?red=instagram&tab=encargos&encargo=${encodeURIComponent(n.referencia_id)}` : "/rrss?red=instagram&tab=encargos";
  }
  return null;
}

export type FiltroAvisos = "todos" | "sin_leer" | "reservas" | "facturas" | "otros";

export const TIPOS_POR_FILTRO: Record<"reservas" | "facturas", string[]> = {
  reservas: ["solicitud_pendiente", "reserva_nueva", "reserva_cancelada", "reserva_sin_asignar"],
  facturas: ["facturas_subida", "subida_precio", "original_sin_drive", ...TIPOS_ALERTA_FACTURAS.map((t) => t.tipo)],
};

export const FILTROS_AVISOS: { valor: FiltroAvisos; etiqueta: string }[] = [
  { valor: "todos", etiqueta: "Todos" },
  { valor: "sin_leer", etiqueta: "Sin leer" },
  { valor: "reservas", etiqueta: "Reservas" },
  { valor: "facturas", etiqueta: "Facturas" },
  { valor: "otros", etiqueta: "Otros" },
];

/** Etiqueta del día: «Hoy», «Ayer» o fecha larga. `ahora` inyectable para pruebas. */
export function etiquetaDia(iso: string, ahora: Date = new Date()): string {
  const d = new Date(iso);
  const inicio = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((inicio(ahora) - inicio(d)) / 86_400_000);
  if (dias === 0) return "Hoy";
  if (dias === 1) return "Ayer";
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
}

/** Agrupa (respetando el orden recibido) por día local. */
export function agruparPorDia(
  items: NotificacionDashboard[],
  ahora: Date = new Date(),
): { etiqueta: string; items: NotificacionDashboard[] }[] {
  const grupos: { clave: string; etiqueta: string; items: NotificacionDashboard[] }[] = [];
  for (const n of items) {
    const d = new Date(n.created_at);
    const clave = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.clave === clave) ultimo.items.push(n);
    else grupos.push({ clave, etiqueta: etiquetaDia(n.created_at, ahora), items: [n] });
  }
  return grupos.map(({ etiqueta, items: its }) => ({ etiqueta, items: its }));
}

export function horaAviso(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

export const TIPO_ICON: Record<string, typeof AlertTriangle> = {
  solicitud_pendiente: AlertTriangle,
  reserva_nueva: Clock,
  reserva_cancelada: XCircle,
  // Aviso del cron `reservas-aviso-sin-asignar`: reserva dentro de la ventana
  // de asignación que aún no tiene sala o mesa.
  reserva_sin_asignar: LayoutGrid,
  // Fin de una tanda de subida de facturas en segundo plano (ColaSubidaProvider).
  facturas_subida: Receipt,
  // Trigger de productos_factura (20261007170000): producto más caro que su referencia.
  subida_precio: TrendingUp,
  // facturas_original_drive_fallo (20261105193000): 5 fallos seguidos subiendo un original a Drive.
  original_sin_drive: CloudOff,
  // Encargos de Instagram: aceptado, entregado, mensaje de Oficiosos…
  instagram_encargo: KanbanSquare,
  // Alertas diarias de Facturas (cron facturas-alertas, 20261107300000).
  facturas_precio_sube: TrendingUp,
  facturas_precio_mejor: BadgePercent,
  facturas_familia_gasto: PieChart,
  facturas_albaran_sin_factura: FileQuestion,
  facturas_proveedor_nuevo: UserPlus,
  facturas_importe_inusual: AlertTriangle,
  facturas_revision: ScanSearch,
  // 20261115100000_facturas_decision
  facturas_precio_baja: TrendingDown,
  facturas_precio_proveedor: TrendingUp,
  facturas_precio_pactado: Handshake,
  // Centro de modelos de IA (cron diario ia-modelos-openai, 20261107500000).
  ia_modelo_nuevo: Bot,
  ia_modelo_retirado: AlertTriangle,
  ia_modelo_sin_precio: Bot,
  sistema: Info,
};

/**
 * Avisos de cada sección, para el botón rojo «Avisos» de Reservas y Facturas (06/11/2026, petición
 * del dueño: «avisos en vez de ser una pestaña de la barra lateral, que sean botones en sus
 * secciones»). Los tipos son los mismos que el filtro de la página /avisos (`TIPOS_POR_FILTRO`).
 */
export type SeccionAvisos = "reservas" | "facturas";

export const SECCIONES_AVISOS: Record<SeccionAvisos, { titulo: string; tipos: { tipo: string; etiqueta: string }[] }> = {
  reservas: {
    titulo: "Avisos de reservas",
    tipos: [
      // 10/11/2026, petición del dueño: el botón «Avisos» de Reservas es solo para reservas nuevas y
      // canceladas (trigger 20261122160000). Solicitudes y «Sin sala o mesa» ya no salen aquí.
      { tipo: "reserva_nueva", etiqueta: "Reservas nuevas" },
      { tipo: "reserva_cancelada", etiqueta: "Canceladas" },
    ],
  },
  facturas: {
    titulo: "Avisos de facturas",
    tipos: [
      { tipo: "facturas_subida", etiqueta: "Subidas de facturas" },
      { tipo: "subida_precio", etiqueta: "Subidas de precio" },
      { tipo: "original_sin_drive", etiqueta: "Originales sin Drive" },
      ...TIPOS_ALERTA_FACTURAS,
    ],
  },
};

export const tiposDeSeccion = (seccion: SeccionAvisos) => SECCIONES_AVISOS[seccion].tipos.map((t) => t.tipo);

/** Avisos con caducidad (alertas de Facturas) ya pasada: no se enseñan. `ahora` inyectable para pruebas. */
export function avisoCaducado(n: Pick<NotificacionDashboard, "caduca_en">, ahora: number = Date.now()): boolean {
  if (!n.caduca_en) return false;
  const t = Date.parse(n.caduca_en);
  return Number.isFinite(t) && t <= ahora;
}

/** Evento para abrir el modal «Avisos» de una sección desde otro sitio («Ver todas» de Análisis). */
export const EVENTO_ABRIR_AVISOS = "abrir-avisos-seccion";
export function abrirAvisosSeccion(seccion: SeccionAvisos) {
  window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_AVISOS, { detail: { seccion } }));
}
