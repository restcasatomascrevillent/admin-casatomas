// ============================================================================
// CÓMO SE VE CADA ESTADO DE MESA DEL SERVICIO — compartido
// ----------------------------------------------------------------------------
// Lo usan la vista «Plano» de «Hoy» (`MapaSalaServicio`) y el modo servicio de
// una sala (`ModoServicioPlano`). Qué estado tiene cada mesa lo decide
// `estadoMesaServicio` (`src/lib/reservas/servicioSala.ts`), con los umbrales de
// Configuración de reservas → «Tiempo de ocupación de mesa».
//
// NUNCA SOLO EL COLOR (revisión de diseño, 07/10/2026): con deuteranopía
// «Ocupada» y «Por liberar» se veían iguales y en gris todas las mesas eran la
// misma. Cada estado tiene además su FORMA de pintar la mesa —contorno
// discontinuo, solo contorno, relleno— y su icono (`Icono`), que el plano pinta
// en una esquina de la mesa:
//   libre        contorno gris DISCONTINUO, sin relleno
//   reservada    contorno azul GRUESO, sin relleno            (reloj)
//   retrasada    contorno ámbar DISCONTINUO y grueso, relleno claro (aviso)
//   ocupada      RELLENA de verde, contorno fino               (cubiertos)
//   por_liberar  RELLENA de rojo, contorno DOBLE                (reloj tachado)
// Las insignias (`badge`) cumplen contraste AA (≥ 4,5:1) con texto blanco o
// muy oscuro: sky-700, amber-800, emerald-700, rose-700 y slate-200/800.
// ============================================================================

import { AlertTriangle, CircleDashed, Clock, TimerOff, Utensils } from "lucide-react";
import type { EstadoMesaServicio } from "@/lib/reservas/servicioSala";

export const CONFIG_ESTADO_MESA: Record<
  EstadoMesaServicio,
  {
    etiqueta: string;
    Icono: typeof Clock;
    /** Cómo se pinta la mesa (o la tarjeta del modo servicio): borde y relleno, distintos en cada estado. */
    clases: string;
    /** Insignia (leyenda, chips, carteles): texto con contraste AA. */
    badge: string;
    /** Color del icono de la esquina de la mesa (sobre su relleno). */
    icono: string;
  }
> = {
  libre: {
    etiqueta: "Libre",
    Icono: CircleDashed,
    clases: "border-2 border-dashed border-slate-400 bg-white dark:bg-slate-900/30 dark:border-slate-500",
    badge: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-100",
    icono: "text-slate-600 dark:text-slate-300",
  },
  reservada: {
    etiqueta: "Reservada",
    Icono: Clock,
    clases: "border-[3px] border-solid border-sky-600 bg-white dark:bg-sky-950/30 dark:border-sky-500",
    badge: "bg-sky-700 text-white",
    icono: "text-sky-700 dark:text-sky-300",
  },
  retrasada: {
    etiqueta: "Retrasada",
    Icono: AlertTriangle,
    clases: "border-[3px] border-dashed border-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:border-amber-500",
    badge: "bg-amber-800 text-white",
    icono: "text-amber-800 dark:text-amber-300",
  },
  ocupada: {
    etiqueta: "Ocupada",
    Icono: Utensils,
    clases: "border-2 border-solid border-emerald-700 bg-emerald-200 dark:bg-emerald-900/60 dark:border-emerald-500",
    badge: "bg-emerald-700 text-white",
    icono: "text-emerald-900 dark:text-emerald-200",
  },
  por_liberar: {
    etiqueta: "Por liberar",
    Icono: TimerOff,
    clases: "border-4 border-double border-rose-700 bg-rose-200 dark:bg-rose-900/60 dark:border-rose-500",
    badge: "bg-rose-700 text-white",
    icono: "text-rose-900 dark:text-rose-200",
  },
};

/**
 * El chip de tiempo de una mesa: «en 15 min» (aún no es su hora), «5 min tarde» (dentro del margen),
 * «retraso 20 min», «45 min sentada». `minutos` es ahora − hora de la reserva (negativo = falta).
 */
export function textoMinutosMesa(estado: EstadoMesaServicio, minutos: number | null): string | null {
  if (minutos == null) return null;
  if (estado === "reservada") {
    if (minutos < 0) return `en ${Math.abs(minutos)} min`;
    return minutos === 0 ? "es su hora" : `${minutos} min tarde`;
  }
  if (estado === "retrasada") return `retraso ${minutos} min`;
  if (estado === "ocupada" || estado === "por_liberar") return `${minutos} min sentada`;
  return null;
}
