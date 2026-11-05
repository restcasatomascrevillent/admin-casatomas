import { AlertTriangle, Clock, Info, KanbanSquare, LayoutGrid, Receipt, TrendingUp } from "lucide-react";
import type { NotificacionDashboard } from "@/hooks/useNotificacionesDashboard";

/** Adónde lleva un aviso (null = no tiene origen al que ir). Lo comparten la campana y la página «Avisos». */
export function rutaDeAviso(n: Pick<NotificacionDashboard, "tipo" | "referencia_tipo"> & { referencia_id?: string | null }): string | null {
  // Reserva sin sala o mesa dentro de la ventana: pestaña «Asignación» de /reservas.
  if (n.tipo === "reserva_sin_asignar") return "/reservas?tab=asignacion";
  // Las solicitudes viven en la pestaña unificada «Reservas», filtradas por «Solicitudes sin resolver».
  if (n.referencia_tipo === "solicitud") return "/reservas?tab=reservas&status=solicitudes";
  if (n.referencia_tipo === "facturas_cargar") return "/facturas?tab=cargar";
  if (n.referencia_tipo === "facturas_productos") return "/facturas?tab=productos";
  // Encargos de Instagram (20261110100000): la ficha del encargo.
  if (n.referencia_tipo === "instagram_encargo") {
    return n.referencia_id ? `/instagram?tab=encargos&encargo=${encodeURIComponent(n.referencia_id)}` : "/instagram?tab=encargos";
  }
  return null;
}

export type FiltroAvisos = "todos" | "sin_leer" | "reservas" | "facturas" | "otros";

export const TIPOS_POR_FILTRO: Record<"reservas" | "facturas", string[]> = {
  reservas: ["solicitud_pendiente", "reserva_nueva", "reserva_sin_asignar"],
  facturas: ["facturas_subida", "subida_precio"],
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
  // Aviso del cron `reservas-aviso-sin-asignar`: reserva dentro de la ventana
  // de asignación que aún no tiene sala o mesa.
  reserva_sin_asignar: LayoutGrid,
  // Fin de una tanda de subida de facturas en segundo plano (ColaSubidaProvider).
  facturas_subida: Receipt,
  // Trigger de productos_factura (20261007170000): producto más caro que su referencia.
  subida_precio: TrendingUp,
  // Encargos de Instagram: aceptado, entregado, mensaje de Oficiosos…
  instagram_encargo: KanbanSquare,
  sistema: Info,
};
