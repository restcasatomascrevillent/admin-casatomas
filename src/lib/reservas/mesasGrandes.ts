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
 * La rejilla de tarjetas de una sala (rehecha el 07/11/2026 tras ver el Salón en la demo: salían columnas
 * vacías, huecos y scroll). Reglas:
 *   · FILAS: los centros cercanos en vertical forman una fila; si hay más filas de las que caben
 *     (`maxFilas`), se juntan las dos más próximas hasta que quepan.
 *   · COLUMNAS: tantas como mesas tiene la fila más larga (ninguna columna vacía). Cada fila conserva su orden
 *     de izquierda a derecha y, si tiene menos mesas, cada una cae en la columna que le toca por su X.
 * Las mesas de `uniones` van juntas en UNA casilla. Sin mesas, rejilla vacía (0 × 0).
 */
export function rejillaMesasGrandes(
  mesas: readonly MesaPosicion[],
  uniones: readonly UnionPosicion[] = [],
  /** Como mucho estas filas de la sala: se juntan las más próximas. */
  maxFilas = Number.POSITIVE_INFINITY,
  /** Como mucho estas columnas: una fila más larga sigue en la fila de debajo (en orden). */
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

  // Filas: media mesa de hueco, mesa y media de tramo (a partir del tamaño típico de mesa de la sala).
  const lado = mediana(mesas.map((m) => Math.min(m.ancho || LADO_POR_DEFECTO_CM, m.alto || LADO_POR_DEFECTO_CM) / 100));
  const filaDe = agruparCercanos(unidades.map((u) => u.cy), Math.max(0.3, lado * 0.6), Math.max(0.6, lado * 1.5));
  let filas: number[][] = [];
  unidades.forEach((_, i) => (filas[filaDe[i]] ??= []).push(i));
  filas = filas.filter(Boolean);
  const media = (f: number[]) => f.reduce((s, i) => s + unidades[i].cy, 0) / f.length;
  const tope = Math.max(1, Math.floor(maxFilas));
  while (filas.length > tope) {
    let mejor = 0;
    for (let k = 1; k < filas.length - 1; k++) {
      if (media(filas[k + 1]) - media(filas[k]) < media(filas[mejor + 1]) - media(filas[mejor])) mejor = k;
    }
    filas.splice(mejor, 2, [...filas[mejor], ...filas[mejor + 1]]);
  }

  // Filas más largas que `maxColumnas`: se parten en trozos seguidos (de izquierda a derecha).
  const anchoMax = Math.max(1, Math.floor(maxColumnas));
  filas = filas.flatMap((f) => {
    const orden = [...f].sort((a, b) => unidades[a].cx - unidades[b].cx);
    const trozos: number[][] = [];
    for (let k = 0; k < orden.length; k += anchoMax) trozos.push(orden.slice(k, k + anchoMax));
    return trozos;
  });
  const columnas = Math.max(...filas.map((f) => f.length));
  const xs = unidades.map((u) => u.cx);
  const minX = Math.min(...xs);
  const rangoX = Math.max(...xs) - minX;
  const celdas: CeldaMesas[] = [];
  filas.forEach((indices, f) => {
    indices.sort((a, b) => unidades[a].cx - unidades[b].cx || unidades[a].ids[0].localeCompare(unidades[b].ids[0]));
    // Columna por su X; sin pisarse (cada una a la derecha de la anterior) y sin salirse (las del final
    // empujan hacia la izquierda).
    const cols: number[] = [];
    let ultima = -1;
    for (const i of indices) {
      const porX = rangoX > 0 ? Math.round(((unidades[i].cx - minX) / rangoX) * (columnas - 1)) : 0;
      ultima = Math.max(porX, ultima + 1);
      cols.push(ultima);
    }
    for (let k = cols.length - 1, max = columnas - 1; k >= 0; k--, max--) cols[k] = Math.min(cols[k], max);
    indices.forEach((i, k) => celdas.push({ ids: unidades[i].ids, fila: f + 1, columna: cols[k] + 1 }));
  });
  return { filas: filas.length, columnas, celdas };
}

/** Relleno alrededor de la rejilla de tarjetas (px). */
export const RELLENO_MESAS_GRANDES = 8;
/** Tamaño máximo de una tarjeta (px), para que con 3 mesas en una sala no salgan de medio metro. */
const MAX_ANCHO_TARJETA = 260;
const MAX_ALTO_TARJETA = 180;

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
 * La rejilla que mejor aprovecha un hueco de `ancho` × `alto` px: prueba a juntar filas de la sala y a partir
 * las filas largas, y se queda con la que da tarjetas más grandes (sin contar lo ancho de más: una tarjeta
 * plana no se lee). Cada cambio respecto a la sala tal cual
 * resta un poco (juntar filas un 5 %, cada fila partida un 8 %), para no desordenarla por poca ganancia.
 */
export function rejillaAjustada(
  mesas: readonly MesaPosicion[],
  uniones: readonly UnionPosicion[],
  ancho: number,
  alto: number,
): RejillaMesas {
  const base = rejillaMesasGrandes(mesas, uniones);
  let mejor = base;
  let mejorNota = -1;
  for (let filas = base.filas; filas >= 1; filas--) {
    const juntas = filas === base.filas ? base : rejillaMesasGrandes(mesas, uniones, filas);
    for (let cols = juntas.columnas; cols >= 1; cols--) {
      const r = cols === juntas.columnas ? juntas : rejillaMesasGrandes(mesas, uniones, filas, cols);
      const { tarjetaAncho, tarjetaAlto } = medidasTarjetas(ancho, alto, r.filas, r.columnas);
      // Tamaño útil: lo ancho solo cuenta hasta 1,5 veces el alto (tarjetas planas no se leen).
      const nota = tarjetaAlto * Math.min(tarjetaAncho, tarjetaAlto * 1.5) * 0.95 ** (base.filas - filas) * 0.92 ** (r.filas - juntas.filas);
      if (nota > mejorNota) {
        mejor = r;
        mejorNota = nota;
      }
    }
  }
  return mejor;
}
