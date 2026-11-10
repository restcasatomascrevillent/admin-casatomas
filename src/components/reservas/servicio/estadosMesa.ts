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
//   libre        verde, contorno DISCONTINUO                   (círculo discontinuo)
//   reservada    azul, contorno GRUESO                         (reloj)
//   retrasada    rojo, contorno DISCONTINUO y grueso           (aviso)
//   ocupada      RELLENA de ámbar, contorno fino               (cubiertos)
//   por_liberar  RELLENA de violeta, contorno DOBLE            (reloj tachado)
// Los colores y formas viven en `src/lib/reservas/coloresMesa.ts` (10/11/2026: los
// mismos que el móvil; antes aquí la libre era gris y la ocupada verde).
// ============================================================================

import { AlertTriangle, CircleDashed, Clock, TimerOff, Utensils } from "lucide-react";
import type { EstadoMesaServicio } from "@/lib/reservas/servicioSala";
import { COLORES_MESA } from "@/lib/reservas/coloresMesa";

/** Icono de cada estado, en la esquina de la mesa y en la leyenda. */
const ICONO_ESTADO: Record<EstadoMesaServicio, typeof Clock> = {
  libre: CircleDashed,
  reservada: Clock,
  retrasada: AlertTriangle,
  ocupada: Utensils,
  por_liberar: TimerOff,
};

/**
 * Colores y forma: `COLORES_MESA` (`src/lib/reservas/coloresMesa.ts`), la MISMA tabla que el móvil (10/11/2026).
 */
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
> = Object.fromEntries(
  (Object.keys(ICONO_ESTADO) as EstadoMesaServicio[]).map((estado) => {
    const c = COLORES_MESA[estado];
    return [estado, { etiqueta: c.etiqueta, Icono: ICONO_ESTADO[estado], clases: c.mesa, badge: c.badge, icono: c.icono }];
  }),
) as Record<EstadoMesaServicio, { etiqueta: string; Icono: typeof Clock; clases: string; badge: string; icono: string }>;

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
