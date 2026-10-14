// ============================================================================
// DIBUJO DE MESAS POR PIEZAS Y UNIONES — geometría pura (sin React)
// ----------------------------------------------------------------------------
// Queja del dueño (14/10/2026): «si juntas mesas, el dibujo no cambia» y «las
// mesas que son dos mesas, como la 3 y la 4, deberían verse como dos mesas».
//
//   · PIEZAS: una mesa de 2 piezas se pinta con una RAYA continua (que cruza
//     también el borde) entre pieza y pieza, para contar las mesas físicas.
//     `divisoresPiezas` da dónde van (fracción 0..1 del largo de la fila).
//   · UNIONES («Juntar con…», ajuste del servicio en `ajustes_mesa_servicio.
//     unida_a`): la principal se queda en su sitio y cada mesa unida se ARRIMA a
//     ella por el lado que la tiene más cerca, alineada al centro de la
//     principal (como se hace en la sala: se lleva la mesa hasta la otra). La
//     unión entera se rodea con un contorno común y un rótulo «3+4 · 8 plazas».
//     «Separar» borra `unida_a` y cada mesa vuelve a su sitio del plano.
//   · Solo es dibujo: no cambia datos, plano base ni reglas de asignación.
//
// Unidades: como `mesas` → posición en METROS (esquina sup. izq. sin girar),
// tamaño en CM. El giro de la mesa no se tiene en cuenta para arrimar.
// ============================================================================

import { mesasDeLaUnion, type EstadoServicio } from "./piezasMesa";

/** Lo que hace falta de una mesa YA con la geometría del servicio. */
export interface CajaMesa {
  id: string;
  nombre: string;
  pos_x: number | null;
  pos_y: number | null;
  ancho: number | null;
  alto: number | null;
  capacidad: number | null;
}

/** Una unión lista para pintar: contorno común y rótulo. */
export interface UnionDibujo {
  /** Principal primero, luego las unidas por número. */
  ids: string[];
  /** «3+4 · 8 plazas». */
  texto: string;
  plazas: number;
  /** Caja que envuelve todas las mesas de la unión (m / cm, como `mesas`). */
  pos_x: number;
  pos_y: number;
  ancho: number;
  alto: number;
}

export interface DibujoUniones {
  /** Posición (m) de las mesas que se han arrimado a su principal. */
  posiciones: Map<string, { pos_x: number; pos_y: number }>;
  uniones: UnionDibujo[];
}

/** Dónde van las ranuras entre piezas, como fracción (0..1) del largo de la fila. */
export function divisoresPiezas(piezas: number): number[] {
  const n = Math.floor(piezas);
  if (!Number.isFinite(n) || n < 2) return [];
  return Array.from({ length: n - 1 }, (_, i) => (i + 1) / n);
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const rectDe = (m: CajaMesa): Rect => ({
  x: m.pos_x ?? 0,
  y: m.pos_y ?? 0,
  w: (m.ancho ?? 80) / 100,
  h: (m.alto ?? 80) / 100,
});

const centro = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

function envolvente(rs: Rect[]): Rect {
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  const x2 = Math.max(...rs.map((r) => r.x + r.w));
  const y2 = Math.max(...rs.map((r) => r.y + r.h));
  return { x, y, w: x2 - x, h: y2 - y };
}

const porNumero = (a: CajaMesa, b: CajaMesa) => a.nombre.localeCompare(b.nombre, "es", { numeric: true });

/**
 * Arrima cada mesa unida a su fila: por el lado del bloque que la tiene más
 * cerca (eje dominante entre centros) y centrada con la principal en el otro
 * eje. Las unidas se colocan de la más cercana a la más lejana, así una fila
 * de tres queda 3‑4‑5 y no se pisan.
 */
export function dibujarUniones(mesas: CajaMesa[], estado: EstadoServicio): DibujoUniones {
  const porId = new Map(mesas.map((m) => [m.id, m]));
  const posiciones = new Map<string, { pos_x: number; pos_y: number }>();
  const uniones: UnionDibujo[] = [];
  const vistas = new Set<string>();

  for (const m of mesas) {
    if (vistas.has(m.id) || !estado.has(m.id)) continue;
    const ids = mesasDeLaUnion(estado, m.id).filter((id) => porId.has(id));
    for (const id of ids) vistas.add(id);
    if (ids.length < 2) continue;

    const principal = porId.get(ids[0])!;
    const base = rectDe(principal);
    const c0 = centro(base);
    const unidas = ids
      .slice(1)
      .map((id) => porId.get(id)!)
      .sort((a, b) => {
        const da = centro(rectDe(a));
        const db = centro(rectDe(b));
        return Math.hypot(da.x - c0.x, da.y - c0.y) - Math.hypot(db.x - c0.x, db.y - c0.y) || porNumero(a, b);
      });

    const colocadas: Rect[] = [base];
    for (const u of unidas) {
      const r = rectDe(u);
      const bloque = envolvente(colocadas);
      const cb = centro(bloque);
      const cu = centro(r);
      const dx = cu.x - cb.x;
      const dy = cu.y - cb.y;
      let nuevo: Rect;
      if (Math.abs(dx) >= Math.abs(dy)) {
        // Fila horizontal: a la derecha o a la izquierda del bloque, centrada con la principal.
        nuevo = { ...r, x: dx >= 0 ? bloque.x + bloque.w : bloque.x - r.w, y: c0.y - r.h / 2 };
      } else {
        nuevo = { ...r, y: dy >= 0 ? bloque.y + bloque.h : bloque.y - r.h, x: c0.x - r.w / 2 };
      }
      colocadas.push(nuevo);
      const redondeo = (v: number) => Math.round(v * 1000) / 1000;
      if (redondeo(nuevo.x) !== redondeo(r.x) || redondeo(nuevo.y) !== redondeo(r.y)) {
        posiciones.set(u.id, { pos_x: redondeo(nuevo.x), pos_y: redondeo(nuevo.y) });
      }
    }

    const caja = envolvente(colocadas);
    const miembros = [principal, ...unidas];
    const plazas = miembros.reduce((s, x) => s + (x.capacidad ?? 0), 0);
    const nombres = [...miembros].sort(porNumero).map((x) => x.nombre);
    uniones.push({
      ids: [principal.id, ...[...unidas].sort(porNumero).map((x) => x.id)],
      texto: `${nombres.join("+")} · ${plazas} plazas`,
      plazas,
      pos_x: caja.x,
      pos_y: caja.y,
      ancho: Math.round(caja.w * 100),
      alto: Math.round(caja.h * 100),
    });
  }
  return { posiciones, uniones };
}

/** Las mesas con la posición arrimada de su unión (las demás, igual). */
export function aplicarPosicionesUnion<T extends CajaMesa>(mesas: T[], dibujo: DibujoUniones): T[] {
  if (dibujo.posiciones.size === 0) return mesas;
  return mesas.map((m) => {
    const p = dibujo.posiciones.get(m.id);
    return p ? { ...m, ...p } : m;
  });
}
