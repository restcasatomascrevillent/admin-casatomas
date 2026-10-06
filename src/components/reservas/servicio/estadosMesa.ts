// ============================================================================
// CÓMO SE VE CADA ESTADO DE MESA DEL SERVICIO — compartido
// ----------------------------------------------------------------------------
// Sacado de `ModoServicioPlano.tsx` (06/10/2026) para que la vista «Plano» de
// «Hoy» pinte las mesas con los MISMOS nombres, iconos y colores que el modo
// servicio de una sala. Qué estado tiene cada mesa lo decide `estadoMesaServicio`
// (`src/lib/reservas/servicioSala.ts`, puro y testeado), con los umbrales de
// Configuración de reservas → «Tiempo de ocupación de mesa».
// ============================================================================

import { AlertTriangle, CircleDashed, Clock, TimerOff, Utensils } from "lucide-react";
import type { EstadoMesaServicio } from "@/lib/reservas/servicioSala";

export const CONFIG_ESTADO_MESA: Record<
  EstadoMesaServicio,
  { etiqueta: string; Icono: typeof Clock; clases: string; badge: string }
> = {
  libre: {
    etiqueta: "Libre",
    Icono: CircleDashed,
    clases: "border-slate-300 bg-slate-50 dark:bg-slate-900/30 dark:border-slate-700",
    badge: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
  reservada: {
    etiqueta: "Reservada",
    Icono: Clock,
    clases: "border-sky-400 bg-sky-50 dark:bg-sky-900/30 dark:border-sky-700",
    badge: "bg-sky-500 text-white",
  },
  retrasada: {
    etiqueta: "Retrasada",
    Icono: AlertTriangle,
    clases: "border-amber-400 bg-amber-50 dark:bg-amber-900/30 dark:border-amber-700",
    badge: "bg-amber-500 text-white",
  },
  ocupada: {
    etiqueta: "Ocupada",
    Icono: Utensils,
    clases: "border-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 dark:border-emerald-700",
    badge: "bg-emerald-600 text-white",
  },
  por_liberar: {
    etiqueta: "Por liberar",
    Icono: TimerOff,
    clases: "border-rose-400 bg-rose-50 dark:bg-rose-900/30 dark:border-rose-700",
    badge: "bg-rose-600 text-white",
  },
};

/** "45 min" / "retraso 10 min" / "quedan 5 min" — el chip de tiempo de cada tarjeta. */
export function textoMinutosMesa(estado: EstadoMesaServicio, minutos: number | null): string | null {
  if (minutos == null) return null;
  if (estado === "reservada") return minutos >= 0 ? `en ${minutos} min` : `dentro de ${Math.abs(minutos)} min`;
  if (estado === "retrasada") return `retraso ${minutos} min`;
  if (estado === "ocupada" || estado === "por_liberar") return `${minutos} min sentada`;
  return null;
}
