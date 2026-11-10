// ============================================================================
// COLORES DE LAS MESAS — UNA sola fuente para móvil, escritorio y leyendas
// ----------------------------------------------------------------------------
// 10/11/2026, petición del dueño: «hay que unificar los códigos de colores de las mesas porque no son iguales
// entre vista móvil y ordenador». Antes el móvil pintaba la mesa LIBRE en verde y la sentada en ámbar, y el
// plano de escritorio la libre en gris y la OCUPADA en verde: el mismo verde significaba lo contrario.
//
// Paleta (la del móvil, que es la que se entiende de un vistazo), igual en claro y en oscuro:
//   libre        VERDE (emerald)   contorno discontinuo, relleno muy claro
//   reservada    AZUL  (sky)       contorno grueso, relleno muy claro       — en el móvil, «prevista»
//   retrasada    ROJO  (rose)      contorno grueso discontinuo              — llega tarde
//   ocupada      ÁMBAR (amber)     RELLENA, contorno fino                   — en el móvil, «sentada»
//   por_liberar  VIOLETA (violet)  RELLENA, contorno doble                  — ya pasó su tiempo
// El candado (fijada) va aparte, como icono, en cualquier estado.
//
// NUNCA SOLO EL COLOR (revisión de diseño, 07/10/2026): cada estado tiene además su forma de contorno (y en el
// plano su icono, `servicio/estadosMesa.ts`), así que con daltonismo se siguen distinguiendo.
// Las insignias (`badge`) llevan texto blanco sobre un tono 700/800: contraste AA (≥ 4,5:1).
// 10/11/2026 (dueño: «pon más fuertes los colores para tener contraste»): rellenos un tono más
// fuertes (100-300) y bordes 700, para distinguirse bien en la tablet y el móvil.
// ============================================================================

export type EstadoColorMesa = "libre" | "reservada" | "retrasada" | "ocupada" | "por_liberar";

export interface ColorMesa {
  /** Nombre del estado (leyendas, chips). */
  etiqueta: string;
  /** Cómo se pinta la mesa (plano, tarjeta, casilla del móvil): grosor y forma del borde, color y relleno. */
  mesa: string;
  /** Insignia de la leyenda o de un chip: fondo de color con texto blanco. */
  badge: string;
  /** Color del icono sobre la mesa. */
  icono: string;
}

export const ESTADOS_COLOR_MESA: readonly EstadoColorMesa[] = ["libre", "reservada", "retrasada", "ocupada", "por_liberar"];

export const COLORES_MESA: Record<EstadoColorMesa, ColorMesa> = {
  libre: {
    etiqueta: "Libre",
    mesa: "border-2 border-dashed border-emerald-700 bg-emerald-100 dark:border-emerald-400 dark:bg-emerald-900/60",
    badge: "bg-emerald-700 text-white",
    icono: "text-emerald-700 dark:text-emerald-300",
  },
  reservada: {
    etiqueta: "Reservada",
    mesa: "border-[3px] border-solid border-sky-700 bg-sky-200 dark:border-sky-400 dark:bg-sky-900/60",
    badge: "bg-sky-700 text-white",
    icono: "text-sky-700 dark:text-sky-300",
  },
  retrasada: {
    etiqueta: "Retrasada",
    mesa: "border-[3px] border-dashed border-rose-700 bg-rose-200 dark:border-rose-400 dark:bg-rose-900/60",
    badge: "bg-rose-700 text-white",
    icono: "text-rose-700 dark:text-rose-300",
  },
  ocupada: {
    etiqueta: "Ocupada",
    mesa: "border-2 border-solid border-amber-700 bg-amber-300 dark:border-amber-400 dark:bg-amber-800/70",
    badge: "bg-amber-800 text-white",
    icono: "text-amber-900 dark:text-amber-200",
  },
  por_liberar: {
    etiqueta: "Por liberar",
    mesa: "border-4 border-double border-violet-800 bg-violet-300 dark:border-violet-400 dark:bg-violet-800/70",
    badge: "bg-violet-700 text-white",
    icono: "text-violet-900 dark:text-violet-200",
  },
};

/** Los tres estados de la cuadrícula del móvil (`estadoMesasHoy`), en los colores de arriba. */
export function estadoColorMovil(tipo: "libre" | "reservada" | "sentada"): EstadoColorMesa {
  return tipo === "sentada" ? "ocupada" : tipo;
}
