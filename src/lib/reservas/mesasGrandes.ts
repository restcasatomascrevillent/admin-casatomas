// ============================================================================
// MESAS GRANDES — cómo se colocan las tarjetas de mesa de «Hoy» de escritorio
// ----------------------------------------------------------------------------
// Dos modos (petición del dueño, 07/11/2026: «respétame un poco más el mapa para
// tenerlo claro en el plano, y si no, déjamelo para el turno simplemente
// ordenadas normal, sin plano»):
//
//   · PLANO (`planoFiel`): cada mesa en su sitio REAL, a escala. Se recorta el
//     rectángulo que ocupan las mesas (sin márgenes vacíos), se escala para
//     llenar el hueco respetando la proporción (si el hueco tiene otra forma que
//     la sala, el eje que sobra se estira como mucho ×1,8), se busca el tamaño de tarjeta más
//     grande con el que ninguna se pisa y, después, cada tarjeta crece todo lo que
//     le dejan sus vecinas. No se juntan ni se parten filas ni se reordena nada.
//   · ORDENADAS (`rejillaOrdenadas`): rejilla simple por número (el 10 después del
//     9), con las columnas que dan las tarjetas más grandes sin scroll.
//
// Unidades del plano: posición (esquina) en METROS, tamaño en CM. Las mesas juntas
// de una reserva (`uniones`) son UNA tarjeta, en la caja común.
// ============================================================================

export interface MesaPosicion {
  id: string;
  nombre?: string;
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

/** Una tarjeta: una mesa, o las de una unión (la principal primero), con su centro en la sala (metros). */
export interface UnidadMesas {
  ids: string[];
  cx: number;
  cy: number;
}

/** Caja de una tarjeta en px, dentro del hueco. */
export interface CajaTarjeta {
  ids: string[];
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Lado por defecto de una mesa sin tamaño (cm), como el plano (`MapaSalaServicio`). */
const LADO_POR_DEFECTO_CM = 80;
/** Relleno alrededor de las tarjetas (px). */
export const RELLENO_MESAS_GRANDES = 8;
/** Tamaño máximo de una tarjeta (px), para que con 3 mesas en una sala no salgan de medio metro. */
const MAX_ANCHO_TARJETA = 260;
const MAX_ALTO_TARJETA = 180;
/** Cuánto puede estirarse un eje respecto al otro en «Plano» si el hueco no tiene la forma de la sala. */
const ESTIRAMIENTO_MAX = 1.8;
/** Cuánto puede crecer una tarjeta sobre el tamaño común (para que no salgan unas enormes y otras mínimas). */
const CRECIMIENTO_MAX = 1.5;
/** Objetivo táctil mínimo (px): en «Plano», una tarjeta más pequeña hace pasar la sala a «Ordenadas». */
export const MINIMO_TACTIL = 44;

/** Las tarjetas de una sala: una por mesa suelta y una por unión. */
export function unidadesMesas(mesas: readonly MesaPosicion[], uniones: readonly UnionPosicion[] = []): UnidadMesas[] {
  const ids = new Set(mesas.map((m) => m.id));
  const enUnion = new Set<string>();
  const unidades: UnidadMesas[] = [];
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
  return unidades;
}

// ─── PLANO: fiel al mapa ─────────────────────────────────────────────────────

/** Centros en px para tarjetas de `w` × `h` en un hueco de `ancho` × `alto` (escala única, centrado). */
function centrosEscalados(unidades: readonly UnidadMesas[], ancho: number, alto: number, w: number, h: number) {
  const minX = Math.min(...unidades.map((u) => u.cx));
  const minY = Math.min(...unidades.map((u) => u.cy));
  const spanX = Math.max(...unidades.map((u) => u.cx)) - minX;
  const spanY = Math.max(...unidades.map((u) => u.cy)) - minY;
  const libreX = ancho - 2 * RELLENO_MESAS_GRANDES - w;
  const libreY = alto - 2 * RELLENO_MESAS_GRANDES - h;
  if (libreX < 0 || libreY < 0) return null;
  const ex = spanX > 0 ? libreX / spanX : Infinity;
  const ey = spanY > 0 ? libreY / spanY : Infinity;
  const comun = Number.isFinite(Math.min(ex, ey)) ? Math.min(ex, ey) : 0;
  // Misma escala en los dos ejes, salvo que el hueco tenga otra forma que la sala: entonces el eje que sobra
  // se estira como mucho ×1,8 (la sala se sigue reconociendo y las mesas no se quedan diminutas).
  const sx = Math.min(Number.isFinite(ex) ? ex : 0, comun * ESTIRAMIENTO_MAX);
  const sy = Math.min(Number.isFinite(ey) ? ey : 0, comun * ESTIRAMIENTO_MAX);
  const offX = RELLENO_MESAS_GRANDES + w / 2 + (libreX - spanX * sx) / 2;
  const offY = RELLENO_MESAS_GRANDES + h / 2 + (libreY - spanY * sy) / 2;
  return unidades.map((u) => ({ x: offX + (u.cx - minX) * sx, y: offY + (u.cy - minY) * sy }));
}

function sinSolapes(centros: Array<{ x: number; y: number }>, w: number, h: number, hueco: number): boolean {
  for (let i = 0; i < centros.length; i++) {
    for (let j = i + 1; j < centros.length; j++) {
      const dx = Math.abs(centros[i].x - centros[j].x);
      const dy = Math.abs(centros[i].y - centros[j].y);
      if (dx < w + hueco && dy < h + hueco) return false;
    }
  }
  return true;
}

/**
 * «Plano»: cada tarjeta en su sitio real, a escala, lo más grande posible sin pisarse ni salirse del hueco.
 * `minimo` es el lado más corto de la tarjeta más pequeña (px): por debajo de 44 la sala va «Ordenadas».
 */
export function planoFiel(
  unidades: readonly UnidadMesas[],
  ancho: number,
  alto: number,
  hueco = 8,
): { cajas: CajaTarjeta[]; minimo: number } {
  if (unidades.length === 0 || ancho <= 0 || alto <= 0) return { cajas: [], minimo: 0 };
  // 1) Tamaño común más grande (cuadrado o más ancho que alto) con el que ninguna se pisa.
  let mejor = { w: 0, h: 0, nota: -1 };
  for (const proporcion of [1, 1.2, 1.4, 1.6]) {
    let bajo = 0;
    let alto_ = Math.min(MAX_ALTO_TARJETA, MAX_ANCHO_TARJETA / proporcion);
    for (let k = 0; k < 30; k++) {
      const h = (bajo + alto_) / 2;
      const c = centrosEscalados(unidades, ancho, alto, h * proporcion, h);
      if (c && sinSolapes(c, h * proporcion, h, hueco)) bajo = h;
      else alto_ = h;
    }
    const nota = bajo * Math.min(bajo * proporcion, bajo * 1.5);
    if (nota > mejor.nota) mejor = { w: bajo * proporcion, h: bajo, nota };
  }
  const centros = centrosEscalados(unidades, ancho, alto, mejor.w, mejor.h) ?? unidades.map(() => ({ x: ancho / 2, y: alto / 2 }));
  const tam = unidades.map(() => ({ w: mejor.w, h: mejor.h }));

  // 2) Cada tarjeta crece lo que le dejan sus vecinas y el hueco: primero a lo ancho, luego a lo alto (sin
  //    pasar de cuadrada). Solo crece: con las demás ya fijadas, no puede pisar a ninguna.
  const limiteBorde = (c: number, total: number) => 2 * Math.min(c - RELLENO_MESAS_GRANDES, total - RELLENO_MESAS_GRANDES - c);
  for (let i = 0; i < unidades.length; i++) {
    let w = Math.min(MAX_ANCHO_TARJETA, mejor.w * CRECIMIENTO_MAX, limiteBorde(centros[i].x, ancho));
    for (let j = 0; j < unidades.length; j++) {
      if (j === i) continue;
      const dy = Math.abs(centros[i].y - centros[j].y);
      if (dy < (tam[i].h + tam[j].h) / 2 + hueco) {
        w = Math.min(w, 2 * (Math.abs(centros[i].x - centros[j].x) - tam[j].w / 2 - hueco));
      }
    }
    tam[i].w = Math.max(tam[i].w, w);
  }
  for (let i = 0; i < unidades.length; i++) {
    let h = Math.min(MAX_ALTO_TARJETA, mejor.h * CRECIMIENTO_MAX, tam[i].w, limiteBorde(centros[i].y, alto));
    for (let j = 0; j < unidades.length; j++) {
      if (j === i) continue;
      const dx = Math.abs(centros[i].x - centros[j].x);
      if (dx < (tam[i].w + tam[j].w) / 2 + hueco) {
        h = Math.min(h, 2 * (Math.abs(centros[i].y - centros[j].y) - tam[j].h / 2 - hueco));
      }
    }
    tam[i].h = Math.max(tam[i].h, h);
  }

  const cajas = unidades.map((u, i) => ({
    ids: u.ids,
    left: Math.round(centros[i].x - tam[i].w / 2),
    top: Math.round(centros[i].y - tam[i].h / 2),
    width: Math.floor(tam[i].w),
    height: Math.floor(tam[i].h),
  }));
  return { cajas, minimo: Math.min(...cajas.map((c) => Math.min(c.width, c.height))) };
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
