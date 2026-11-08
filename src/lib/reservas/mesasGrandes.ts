// ============================================================================
// MESAS GRANDES — cómo se colocan las tarjetas de mesa de «Hoy» de escritorio
// ----------------------------------------------------------------------------
// Rejilla por número (el 10 después del 9) con las tarjetas más grandes que caben
// en el hueco, sin scroll. (El modo «Plano», cada mesa en su sitio real, se quitó
// el 08/11/2026 por decisión del dueño: «elimina el plano; solo se queda la vista
// Ordenadas».) Las mesas juntas de una reserva (`uniones`) son UNA tarjeta.
// ============================================================================

export interface MesaPosicion {
  id: string;
}

export interface UnionPosicion {
  /** Mesas de la unión (la principal primero). */
  ids: readonly string[];
}

/** Una tarjeta: una mesa, o las de una unión (la principal primero). */
export interface UnidadMesas {
  ids: string[];
}

/** Relleno alrededor de las tarjetas (px). */
export const RELLENO_MESAS_GRANDES = 8;
/** Tamaño máximo de una tarjeta (px), para que con 3 mesas en una sala no salgan de medio metro. */
const MAX_ANCHO_TARJETA = 260;
const MAX_ALTO_TARJETA = 180;

/** Las tarjetas de una sala: una por mesa suelta y una por unión. */
export function unidadesMesas(mesas: readonly MesaPosicion[], uniones: readonly UnionPosicion[] = []): UnidadMesas[] {
  const ids = new Set(mesas.map((m) => m.id));
  const enUnion = new Set<string>();
  const unidades: UnidadMesas[] = [];
  for (const u of uniones) {
    const suyas = u.ids.filter((id) => ids.has(id) && !enUnion.has(id));
    if (suyas.length === 0) continue;
    suyas.forEach((id) => enUnion.add(id));
    unidades.push({ ids: suyas });
  }
  for (const m of mesas) {
    if (!enUnion.has(m.id)) unidades.push({ ids: [m.id] });
  }
  return unidades;
}

// ─── ORDENADAS: rejilla por número ───────────────────────────────────────────

/** Orden natural por número de mesa (el 10 después del 9). */
export function compararNombreMesa(a: string, b: string): number {
  return a.localeCompare(b, "es", { numeric: true, sensitivity: "base" });
}

/**
 * Medidas de cada tarjeta para un hueco de `ancho` × `alto` px con `filas` × `columnas`: entran SIEMPRE
 * enteras (sin scroll), cuadradas o más anchas que altas y como mucho 260 × 180.
 */
export function medidasTarjetas(ancho: number, alto: number, filas: number, columnas: number) {
  const hueco = Math.min(ancho, alto) < 500 ? 6 : 10;
  const celdaAncho = (ancho - 2 * RELLENO_MESAS_GRANDES - (columnas - 1) * hueco) / columnas;
  const celdaAlto = (alto - 2 * RELLENO_MESAS_GRANDES - (filas - 1) * hueco) / filas;
  const tarjetaAncho = Math.max(0, Math.floor(Math.min(celdaAncho, MAX_ANCHO_TARJETA)));
  const tarjetaAlto = Math.max(0, Math.floor(Math.min(celdaAlto, tarjetaAncho, MAX_ALTO_TARJETA)));
  return { tarjetaAncho, tarjetaAlto, hueco };
}

/**
 * «Ordenadas»: cuántas columnas y filas para `n` tarjetas en un hueco de `ancho` × `alto` px, con las tarjetas
 * más grandes posible (lo ancho solo cuenta hasta 1,5 veces el alto: una tarjeta plana no se lee).
 */
export function rejillaOrdenadas(n: number, ancho: number, alto: number) {
  let mejor = { columnas: 1, filas: Math.max(1, n), ...medidasTarjetas(ancho, alto, Math.max(1, n), 1) };
  let mejorNota = -1;
  for (let columnas = 1; columnas <= Math.max(1, n); columnas++) {
    const filas = Math.ceil(n / columnas);
    const m = medidasTarjetas(ancho, alto, filas, columnas);
    const nota = m.tarjetaAlto * Math.min(m.tarjetaAncho, m.tarjetaAlto * 1.5);
    if (nota > mejorNota) {
      mejor = { columnas, filas, ...m };
      mejorNota = nota;
    }
  }
  return mejor;
}
