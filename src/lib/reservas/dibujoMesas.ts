// ============================================================================
// DIBUJO DE MESAS POR PIEZAS Y UNIONES — geometría pura (sin React)
// ----------------------------------------------------------------------------
// Quejas del dueño (14/10/2026):
//   1. «si juntas mesas, el dibujo no cambia» y «las mesas que son dos mesas,
//      como la 3 y la 4, deberían verse como dos mesas».
//   2. Con la 3 y la 4 juntas salían dos mesas VERTICALES una al lado de la
//      otra (un bloque cuadrado): «así no son una mesa de ocho. Tienen que
//      ser horizontales» y «colocarse bien en el espacio».
//
//   · PIEZAS: una mesa de 2 piezas se pinta con una RAYA continua (que cruza
//     también el borde) entre pieza y pieza, para contar las mesas físicas.
//     `divisoresPiezas` da dónde van (fracción 0..1 del largo de la fila).
//   · UNIONES («Juntar con…», ajuste del servicio en `ajustes_mesa_servicio.
//     unida_a`): se pintan como UNA MESA LARGA. Todas las piezas en fila,
//     cabeza con cabeza por el lado largo (3 + 4 = 4 piezas seguidas = 8
//     plazas), no costado con costado. Cada mesa de la unión se gira si hace
//     falta para que sus piezas vayan a lo largo de la fila. Contorno común y
//     rótulo «3+4 · 8 plazas». «Separar» borra `unida_a` y cada mesa vuelve a
//     su sitio del plano.
//   · DÓNDE VA LA FILA (`colocarFila`):
//       - En HORIZONTAL siempre que se pueda (lo pide el dueño); si no cabe,
//         en vertical.
//       - Se ancla en la principal: la fila pasa por el centro de la
//         principal, que queda en una punta, y crece hacia el lado donde
//         estaban las unidas (si no cabe, hacia el otro).
//       - Tiene que quedar DENTRO de las paredes del plano (`paredesPlano` /
//         `limitesSala` de `grupoGrande.ts`; sin paredes, el rectángulo del
//         plano) dejando `HOLGURA_PARED_M` (0,6 m, sillas, como la mesa larga
//         de grupos grandes) y sin pisar otras mesas (`SEPARACION_MESAS_M`).
//       - Si en su sitio no cabe, se desplaza lo MENOS posible (pasos de 5 cm).
//   · Solo es dibujo: no cambia datos, plano base ni reglas de asignación.
//
// Unidades: como `mesas` → posición en METROS (esquina sup. izq. sin girar),
// tamaño en CM. El giro (`rotacion`) de la mesa no se tiene en cuenta.
// ============================================================================

import { mesasDeLaUnion, type EstadoServicio, type LadoCrecimiento } from "./piezasMesa";
import {
  MESA_LARGA_SALON,
  limitesSala,
  paredesPlano,
  seSolapan,
  type Limites,
  type PlanoSalaMin,
  type Rect,
  type TramoPared,
} from "./grupoGrande";

/** Hueco libre entre la fila y cada pared (sillas). Igual que la mesa larga de grupos grandes. */
export const HOLGURA_PARED_M = MESA_LARGA_SALON.holguraParedM;
/** Hueco mínimo entre la fila y cualquier otra mesa. */
export const SEPARACION_MESAS_M = 0.2;

/** Lo que hace falta de una mesa YA con la geometría del servicio. */
export interface CajaMesa {
  id: string;
  nombre: string;
  pos_x: number | null;
  pos_y: number | null;
  ancho: number | null;
  alto: number | null;
  capacidad: number | null;
  /**
   * Piezas apiladas en `alto` (`geometriaServicio().vertical`). Sin el dato,
   * el largo de la mesa es su lado mayor.
   */
  vertical?: boolean;
}

/** Una unión lista para pintar: contorno común y rótulo. */
export interface UnionDibujo {
  /** Principal primero, luego las unidas por número. */
  ids: string[];
  /** «3+4 · 8 plazas». */
  texto: string;
  plazas: number;
  /** Fila horizontal (o vertical si no cabía en horizontal). */
  horizontal: boolean;
  /** Caja que envuelve todas las mesas de la unión (m / cm, como `mesas`). */
  pos_x: number;
  pos_y: number;
  ancho: number;
  alto: number;
}

/** Cómo se pinta cada mesa de una unión. */
export interface MesaEnFila {
  pos_x: number;
  pos_y: number;
  ancho: number;
  alto: number;
}

/** Orientación de las piezas de una mesa de una unión (para las rayas y el pico). */
export interface GiroPiezas {
  vertical: boolean;
  /** Cabecera de la fila donde va su pico (si tiene). */
  ladoPico: LadoCrecimiento;
}

export interface DibujoUniones {
  /** Sitio y tamaño de cada mesa de una unión (las demás no están). */
  posiciones: Map<string, MesaEnFila>;
  /** Orientación de las piezas de cada mesa de una unión. */
  giros: Map<string, GiroPiezas>;
  uniones: UnionDibujo[];
}

export interface OpcionesDibujo {
  /** Plano de la sala: paredes (`configuracion.elementos`) y medidas. Sin plano, no hay paredes. */
  plano?: PlanoSalaMin | null;
}

/** Dónde van las ranuras entre piezas, como fracción (0..1) del largo de la fila. */
export function divisoresPiezas(piezas: number): number[] {
  const n = Math.floor(piezas);
  if (!Number.isFinite(n) || n < 2) return [];
  return Array.from({ length: n - 1 }, (_, i) => (i + 1) / n);
}

const rectDe = (m: CajaMesa): Rect => ({
  x: m.pos_x ?? 0,
  y: m.pos_y ?? 0,
  ancho: (m.ancho ?? 80) / 100,
  alto: (m.alto ?? 80) / 100,
});

const centro = (r: Rect) => ({ x: r.x + r.ancho / 2, y: r.y + r.alto / 2 });

function envolvente(rs: Rect[]): Rect {
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  const x2 = Math.max(...rs.map((r) => r.x + r.ancho));
  const y2 = Math.max(...rs.map((r) => r.y + r.alto));
  return { x, y, ancho: x2 - x, alto: y2 - y };
}

const ampliar = (r: Rect, m: number): Rect => ({ x: r.x - m, y: r.y - m, ancho: r.ancho + 2 * m, alto: r.alto + 2 * m });

const porNumero = (a: CajaMesa, b: CajaMesa) => a.nombre.localeCompare(b.nombre, "es", { numeric: true });

/** Largo (a lo largo de sus piezas) y fondo de una mesa, en metros. */
function largoYFondo(m: CajaMesa): { largo: number; fondo: number } {
  const r = rectDe(m);
  const vertical = m.vertical ?? r.alto > r.ancho;
  return vertical ? { largo: r.alto, fondo: r.ancho } : { largo: r.ancho, fondo: r.alto };
}

// ─── Sala: paredes y límites ─────────────────────────────────────────────────

export interface SalaDibujo {
  /** Paredes exteriores (m). `null` = sin límites (no hay plano). */
  limites: Limites | null;
  /** Tramos de pared (m): la fila no los cruza (salas en L). */
  paredes: TramoPared[];
}

/**
 * Paredes de la sala para colocar las filas: las dibujadas en el plano (como la
 * mesa larga de grupos grandes, `limitesSala`); si no hay paredes dibujadas, el
 * rectángulo del plano (`ancho_metros` × `alto_metros`); sin plano, sin límites.
 */
export function salaDibujo(plano: PlanoSalaMin | null | undefined): SalaDibujo {
  if (!plano) return { limites: null, paredes: [] };
  const paredes = paredesPlano(plano);
  const ancho = Number(plano.ancho_metros);
  const alto = Number(plano.alto_metros);
  const rectanguloPlano = ancho > 0 && alto > 0 ? { izquierda: 0, derecha: ancho, arriba: 0, abajo: alto } : null;
  const sinLimites = { izquierda: -Infinity, derecha: Infinity, arriba: -Infinity, abajo: Infinity };
  const limites = limitesSala(plano, { ...MESA_LARGA_SALON, paredesPorDefecto: rectanguloPlano ?? sinLimites });
  return { limites: Number.isFinite(limites.derecha) ? limites : null, paredes };
}

const EPS = 1e-6;

/** ¿Cabe la fila aquí? Dentro de las paredes con holgura, sin cruzar paredes ni pisar mesas. */
function filaCabe(caja: Rect, sala: SalaDibujo, obstaculos: Rect[]): boolean {
  const h = HOLGURA_PARED_M;
  const l = sala.limites;
  if (l) {
    if (caja.x - h < l.izquierda - EPS || caja.x + caja.ancho + h > l.derecha + EPS) return false;
    if (caja.y - h < l.arriba - EPS || caja.y + caja.alto + h > l.abajo + EPS) return false;
  }
  const conSillas = ampliar(caja, h - EPS);
  for (const t of sala.paredes) {
    const pared: Rect = {
      x: Math.min(t.x1, t.x2),
      y: Math.min(t.y1, t.y2),
      ancho: Math.abs(t.x2 - t.x1),
      alto: Math.abs(t.y2 - t.y1),
    };
    // Una pared es una línea (ancho o alto 0): se pisa si cruza el rectángulo por dentro.
    const cruza =
      pared.x <= conSillas.x + conSillas.ancho &&
      conSillas.x <= pared.x + pared.ancho &&
      pared.y <= conSillas.y + conSillas.alto &&
      conSillas.y <= pared.y + pared.alto;
    if (cruza) return false;
  }
  const conHueco = ampliar(caja, SEPARACION_MESAS_M - EPS);
  return !obstaculos.some((o) => seSolapan(conHueco, o));
}

/** Desplazamientos (m) en pasos de `paso`, del más corto al más largo. */
const cacheDesplazamientos = new Map<string, Array<[number, number]>>();
function desplazamientos(max: number, paso: number): Array<[number, number]> {
  const clave = `${max}/${paso}`;
  const guardado = cacheDesplazamientos.get(clave);
  if (guardado) return guardado;
  const n = Math.round(max / paso);
  const lista: Array<[number, number]> = [];
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) lista.push([i * paso, j * paso]);
  lista.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]) || Math.abs(a[1]) - Math.abs(b[1]));
  cacheDesplazamientos.set(clave, lista);
  return lista;
}

interface FilaColocada {
  horizontal: boolean;
  /** Mesas en el orden de la fila (de izquierda a derecha o de arriba abajo). */
  orden: CajaMesa[];
  rects: Map<string, Rect>;
}

/**
 * Coloca la unión como una fila de piezas. `principal` queda en una punta; la
 * fila pasa por su centro y crece hacia donde estaban las unidas. Si ahí no
 * cabe, se prueba el otro lado y luego se desplaza lo menos posible; primero
 * en horizontal y, si no cabe, en vertical.
 */
export function colocarFila(
  principal: CajaMesa,
  unidas: CajaMesa[],
  sala: SalaDibujo,
  obstaculos: Rect[],
): FilaColocada {
  const c0 = centro(rectDe(principal));
  const miembros = [principal, ...unidas];
  const medidas = new Map(miembros.map((m) => [m.id, largoYFondo(m)]));
  const fondo = Math.max(...miembros.map((m) => medidas.get(m.id)!.fondo));
  const largoTotal = miembros.reduce((s, m) => s + medidas.get(m.id)!.largo, 0);
  const largoPrincipal = medidas.get(principal.id)!.largo;

  /** Las dos maneras de poner la fila (principal al principio o al final), la preferida primero. */
  const variantes = (horizontal: boolean) => {
    const eje = (m: CajaMesa) => (horizontal ? centro(rectDe(m)).x : centro(rectDe(m)).y);
    const ordenadas = [...unidas].sort((a, b) => eje(a) - eje(b) || porNumero(a, b));
    const media = unidas.reduce((s, m) => s + eje(m), 0) / Math.max(1, unidas.length);
    const alFinal = media >= (horizontal ? c0.x : c0.y);
    const inicio = (horizontal ? c0.x : c0.y) - largoPrincipal / 2;
    const conPrincipalPrimero = { orden: [principal, ...ordenadas], inicio };
    const conPrincipalUltima = { orden: [...ordenadas, principal], inicio: inicio + largoPrincipal - largoTotal };
    return alFinal ? [conPrincipalPrimero, conPrincipalUltima] : [conPrincipalUltima, conPrincipalPrimero];
  };

  const cajaDe = (horizontal: boolean, inicio: number): Rect =>
    horizontal
      ? { x: inicio, y: c0.y - fondo / 2, ancho: largoTotal, alto: fondo }
      : { x: c0.x - fondo / 2, y: inicio, ancho: fondo, alto: largoTotal };

  const montar = (horizontal: boolean, orden: CajaMesa[], caja: Rect): FilaColocada => {
    const rects = new Map<string, Rect>();
    let a = horizontal ? caja.x : caja.y;
    for (const m of orden) {
      const { largo, fondo: f } = medidas.get(m.id)!;
      rects.set(
        m.id,
        horizontal
          ? { x: a, y: caja.y + (fondo - f) / 2, ancho: largo, alto: f }
          : { x: caja.x + (fondo - f) / 2, y: a, ancho: f, alto: largo },
      );
      a += largo;
    }
    return { horizontal, orden, rects };
  };

  const buscar = (horizontal: boolean, max: number, paso: number): FilaColocada | null => {
    const opciones = variantes(horizontal).map((v) => ({ ...v, caja: cajaDe(horizontal, v.inicio) }));
    for (const [dx, dy] of desplazamientos(max, paso)) {
      for (const o of opciones) {
        const caja = { ...o.caja, x: o.caja.x + dx, y: o.caja.y + dy };
        if (filaCabe(caja, sala, obstaculos)) return montar(horizontal, o.orden, caja);
      }
    }
    return null;
  };

  return (
    buscar(true, 1.5, 0.05) ??
    buscar(false, 1.5, 0.05) ??
    buscar(true, 6, 0.1) ??
    buscar(false, 6, 0.1) ??
    // No cabe en ningún sitio: horizontal, en su sitio, metida entre las paredes si se puede.
    (() => {
      const [v] = variantes(true);
      const caja = cajaDe(true, v.inicio);
      const l = sala.limites;
      if (l) {
        const h = HOLGURA_PARED_M;
        caja.x = Math.max(l.izquierda + h, Math.min(caja.x, l.derecha - h - caja.ancho));
        caja.y = Math.max(l.arriba + h, Math.min(caja.y, l.abajo - h - caja.alto));
      }
      return montar(true, v.orden, caja);
    })()
  );
}

const redondeo = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Las uniones del servicio como mesas largas: cada unión, una fila de piezas
 * colocada con `colocarFila`. Las uniones se colocan una tras otra: la
 * segunda ya esquiva la fila de la primera.
 */
export function dibujarUniones(mesas: CajaMesa[], estado: EstadoServicio, opciones: OpcionesDibujo = {}): DibujoUniones {
  const porId = new Map(mesas.map((m) => [m.id, m]));
  const posiciones = new Map<string, MesaEnFila>();
  const giros = new Map<string, GiroPiezas>();
  const uniones: UnionDibujo[] = [];
  const vistas = new Set<string>();
  let sala: SalaDibujo | null = null;

  for (const m of mesas) {
    if (vistas.has(m.id) || !estado.has(m.id)) continue;
    const ids = mesasDeLaUnion(estado, m.id).filter((id) => porId.has(id));
    for (const id of ids) vistas.add(id);
    if (ids.length < 2) continue;

    sala ??= salaDibujo(opciones.plano);
    const principal = porId.get(ids[0])!;
    const unidas = ids.slice(1).map((id) => porId.get(id)!);
    const enLaUnion = new Set(ids);
    const obstaculos = mesas
      .filter((x) => !enLaUnion.has(x.id))
      .map((x) => {
        const p = posiciones.get(x.id);
        return p ? { x: p.pos_x, y: p.pos_y, ancho: p.ancho / 100, alto: p.alto / 100 } : rectDe(x);
      });

    const fila = colocarFila(principal, unidas, sala, obstaculos);
    fila.orden.forEach((x, i) => {
      const r = fila.rects.get(x.id)!;
      posiciones.set(x.id, {
        pos_x: redondeo(r.x),
        pos_y: redondeo(r.y),
        ancho: Math.round(r.ancho * 100),
        alto: Math.round(r.alto * 100),
      });
      const primera = i === 0 && fila.orden.length > 1;
      giros.set(x.id, {
        vertical: !fila.horizontal,
        ladoPico: fila.horizontal ? (primera ? "izquierda" : "derecha") : primera ? "arriba" : "abajo",
      });
    });

    const caja = envolvente([...fila.rects.values()]);
    const miembros = [principal, ...unidas];
    const plazas = miembros.reduce((s, x) => s + (x.capacidad ?? 0), 0);
    const nombres = [...miembros].sort(porNumero).map((x) => x.nombre);
    uniones.push({
      ids: [principal.id, ...[...unidas].sort(porNumero).map((x) => x.id)],
      texto: `${nombres.join("+")} · ${plazas} plazas`,
      plazas,
      horizontal: fila.horizontal,
      pos_x: redondeo(caja.x),
      pos_y: redondeo(caja.y),
      ancho: Math.round(caja.ancho * 100),
      alto: Math.round(caja.alto * 100),
    });
  }
  return { posiciones, giros, uniones };
}

/** Las mesas con el sitio y tamaño de su fila (las que no están juntas, igual). */
export function aplicarPosicionesUnion<T extends CajaMesa>(mesas: T[], dibujo: DibujoUniones): T[] {
  if (dibujo.posiciones.size === 0) return mesas;
  return mesas.map((m) => {
    const p = dibujo.posiciones.get(m.id);
    return p ? { ...m, ...p } : m;
  });
}
