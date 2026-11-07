// ============================================================================
// MESAS GRANDES — de las posiciones del plano a una rejilla de tarjetas
// ----------------------------------------------------------------------------
// «Hoy» de escritorio (07/11/2026, petición del dueño): el plano deja de ser
// realista (paredes, mesas pequeñas redondas) y pasa a ser como el de un programa
// de gestión de restaurante: cada mesa es una TARJETA grande, fácil de clicar, y
// las tarjetas conservan más o menos dónde está cada mesa en la sala.
//
// Cómo: se toma el centro de cada mesa (posición en METROS, tamaño en CM, como en
// todo el plano: `pos_x`/`pos_y` es la esquina) y se agrupan los centros cercanos
// en filas (por la Y) y en columnas (por la X). Dos mesas que caen en la misma
// casilla se reparten: la segunda pasa a la columna siguiente de esa fila. Las
// mesas juntas de una misma reserva (`uniones`) son UNA tarjeta, en el centro de
// su caja común.
// ============================================================================

export interface MesaPosicion {
  id: string;
  /** Esquina superior izquierda, en metros. */
  pos_x: number | null;
  pos_y: number | null;
  /** Tamaño en centímetros. */
  ancho: number | null;
  alto: number | null;
}

export interface UnionPosicion {
  /** Mesas de la unión (la principal primero). */
  ids: readonly string[];
  pos_x: number;
  pos_y: number;
  ancho: number;
  alto: number;
}

export interface CeldaMesas {
  /** Una mesa, o las de una unión (la principal primero). */
  ids: string[];
  /** Fila y columna de la rejilla, desde 1 (como `grid-row` / `grid-column`). */
  fila: number;
  columna: number;
}

export interface RejillaMesas {
  filas: number;
  columnas: number;
  celdas: CeldaMesas[];
}

/** Lado por defecto de una mesa sin tamaño (cm), como el plano (`MapaSalaServicio`). */
const LADO_POR_DEFECTO_CM = 80;

function mediana(valores: number[]): number {
  if (valores.length === 0) return LADO_POR_DEFECTO_CM / 100;
  const v = [...valores].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Agrupa valores cercanos (en metros). Un grupo nuevo empieza cuando el hueco con el anterior pasa de
 * `hueco` o cuando el grupo ya abarca más de `tramo` (para que una hilera de mesas muy juntas no acabe en una
 * sola fila). Devuelve el índice de grupo de cada valor, en el orden original.
 */
export function agruparCercanos(valores: readonly number[], hueco: number, tramo: number): number[] {
  const orden = valores.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const grupo = new Array<number>(valores.length).fill(0);
  let actual = -1;
  let inicio = 0;
  let anterior = Number.NEGATIVE_INFINITY;
  for (const { v, i } of orden) {
    if (actual < 0 || v - anterior > hueco || v - inicio > tramo) {
      actual += 1;
      inicio = v;
    }
    grupo[i] = actual;
    anterior = v;
  }
  return grupo;
}

/**
 * La rejilla de tarjetas de una sala: filas y columnas derivadas de dónde está cada mesa, sin casillas
 * repetidas. Las mesas de `uniones` van juntas en UNA casilla. Sin mesas, rejilla vacía (0 × 0).
 */
export function rejillaMesasGrandes(
  mesas: readonly MesaPosicion[],
  uniones: readonly UnionPosicion[] = [],
  /**
   * Columnas que caben en el hueco (con el ancho mínimo de tarjeta). Si la sala pide más, las columnas se
   * comprimen en proporción (cada fila conserva su orden de izquierda a derecha) para no tener que desplazar.
   */
  maxColumnas = Number.POSITIVE_INFINITY,
): RejillaMesas {
  const ids = new Set(mesas.map((m) => m.id));
  const enUnion = new Set<string>();
  const unidades: Array<{ ids: string[]; cx: number; cy: number }> = [];
  for (const u of uniones) {
    const suyas = u.ids.filter((id) => ids.has(id) && !enUnion.has(id));
    if (suyas.length === 0) continue;
    suyas.forEach((id) => enUnion.add(id));
    unidades.push({ ids: suyas, cx: u.pos_x + u.ancho / 200, cy: u.pos_y + u.alto / 200 });
  }
  for (const m of mesas) {
    if (enUnion.has(m.id)) continue;
    const ancho = (m.ancho || LADO_POR_DEFECTO_CM) / 100;
    const alto = (m.alto || LADO_POR_DEFECTO_CM) / 100;
    unidades.push({ ids: [m.id], cx: (m.pos_x || 0) + ancho / 2, cy: (m.pos_y || 0) + alto / 2 });
  }
  if (unidades.length === 0) return { filas: 0, columnas: 0, celdas: [] };

  // Umbrales a partir del tamaño típico de mesa de la sala: media mesa de hueco, mesa y media de tramo.
  const lado = mediana(mesas.map((m) => Math.min(m.ancho || LADO_POR_DEFECTO_CM, m.alto || LADO_POR_DEFECTO_CM) / 100));
  const hueco = Math.max(0.3, lado * 0.6);
  const tramo = Math.max(0.6, lado * 1.5);
  const filaDe = agruparCercanos(unidades.map((u) => u.cy), hueco, tramo);
  let colDe = agruparCercanos(unidades.map((u) => u.cx), hueco, tramo);
  const totalCols = Math.max(...colDe) + 1;
  const porFilaCuenta = new Map<number, number>();
  filaDe.forEach((f) => porFilaCuenta.set(f, (porFilaCuenta.get(f) ?? 0) + 1));
  const filaMasLarga = Math.max(...porFilaCuenta.values());
  const objetivo = Math.max(filaMasLarga, Math.floor(maxColumnas));
  if (totalCols > objetivo && objetivo >= 1) {
    // Compresión proporcional: la columna 0 sigue a la izquierda y la última a la derecha.
    colDe = colDe.map((c) => (totalCols > 1 ? Math.round((c * (objetivo - 1)) / (totalCols - 1)) : 0));
  }

  const porFila = new Map<number, number[]>();
  unidades.forEach((_, i) => porFila.set(filaDe[i], [...(porFila.get(filaDe[i]) ?? []), i]));
  const celdas: CeldaMesas[] = [];
  let columnas = 0;
  for (const [fila, indices] of [...porFila].sort((a, b) => a[0] - b[0])) {
    indices.sort((a, b) => unidades[a].cx - unidades[b].cx || unidades[a].ids[0].localeCompare(unidades[b].ids[0]));
    // Sin pisarse: cada tarjeta, como poco, a la derecha de la anterior; y sin pasarse del ancho si hay sitio
    // (las que no caben empujan hacia la izquierda a las de su fila).
    const cols: number[] = [];
    let ultima = -1;
    for (const i of indices) {
      ultima = Math.max(colDe[i], ultima + 1);
      cols.push(ultima);
    }
    const tope = Math.max(objetivo, indices.length) - 1;
    for (let k = cols.length - 1, max = tope; k >= 0; k--, max--) cols[k] = Math.min(cols[k], max);
    indices.forEach((i, k) => celdas.push({ ids: unidades[i].ids, fila: fila + 1, columna: cols[k] + 1 }));
    ultima = cols[cols.length - 1];
    columnas = Math.max(columnas, ultima + 1);
  }
  return { filas: porFila.size, columnas, celdas };
}
