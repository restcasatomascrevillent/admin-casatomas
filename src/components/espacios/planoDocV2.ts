/**
 * Fase 2 (refactor) — documento de plano versionado ("PlanoDocV2").
 *
 * Hoy `planos_espacio.configuracion.elementos` guarda un array plano de
 * `ElementoCanvas` en PÍXELES (formato "V1", ver `EditorPlanoEspacio.tsx`):
 *   { id, tipo: "wall" | "area" | "door", props: { ...según tipo } }
 * con paredes como segmento x1,y1,x2,y2, áreas como rect left/top/width/height
 * (+ángulo opcional) y puertas como rect left/top/width/height/angle
 * independiente (NO anclado explícitamente a ninguna pared: solo queda
 * visualmente pegado porque al crearlo se hizo snap contra el muro más
 * cercano — ver DOOR_WALL_SNAP_PX en CanvasPlano.tsx).
 *
 * Este módulo define un formato V2 más semántico (muros con espesor,
 * aberturas ancladas a un muro por offset, zonas con nombre/color) y las
 * funciones puras de migración en ambas direcciones. SOLO estas funciones
 * cambian aquí: el renderer (CanvasPlano.tsx) y el guardado en BD
 * (EditorPlanoEspacio.tsx / usePlanosEspacio) siguen usando el formato V1
 * tal cual, sin ningún cambio de comportamiento para el usuario.
 *
 * IMPORTANTE — alcance deliberadamente limitado de este PR:
 * - `migrarPlanoV1aV2` / `planoV2aElementosV1` NO se usan todavía en el
 *   camino de guardado/carga real (`usePlanosEspacio`, `EditorPlanoEspacio`).
 *   Cambiar qué se persiste en `planos_espacio` es un PR posterior que
 *   requiere actualizar también `PlanoEspacio2D.tsx` (visor de reservas, que
 *   sigue leyendo el formato V1 en píxeles) — tocar eso ahora rompería ese
 *   componente, que está fuera de scope (otro agente trabaja en
 *   src/components/reservas/**).
 * - Por ahora estas funciones solo están cableadas donde es inocuo: en los
 *   tests, y disponibles para que un futuro cálculo derivado (p.ej. un
 *   resumen en metros para un panel, o el futuro renderer SVG) las use sin
 *   tener que re-inventar la conversión.
 *
 * Redondeo de ida y vuelta (round-trip): `planoV2aElementosV1` está pensado
 * para reproducir el mismo array de `ElementoCanvas` (en píxeles, listo para
 * el renderer actual) que produjo `migrarPlanoV1aV2`, dentro de la precisión
 * de coma flotante — no textualmente idéntico bit a bit, pero geométricamente
 * equivalente (mismas coordenadas, con tolerancia de redondeo).
 */

import { PIXELS_PER_METER, mToPx, pxToM, type Punto } from "./planoUtils";

// ---------------------------------------------------------------------------
// Tipos V1 (formato actual, tal cual lo define EditorPlanoEspacio.tsx). Se
// redeclaran aquí (en vez de importar desde EditorPlanoEspacio.tsx) para que
// planoDocV2.ts no dependa de un componente React y se pueda testear/usar de
// forma completamente aislada.
// ---------------------------------------------------------------------------

export interface ElementoV1 {
  id: string;
  tipo: "wall" | "area" | "door" | string;
  props: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Tipos V2
// ---------------------------------------------------------------------------

export interface MuroV2 {
  id: string;
  /** Polilínea del muro, en metros. Un muro V1 es siempre un segmento (2 puntos). */
  puntos: [Punto, Punto];
  /** Espesor del muro, en metros. V1 no lo guarda por muro (es un valor global
   *  fijo en CanvasPlano.tsx); se usa el default salvo que el elemento V1 ya
   *  tuviera un `props.espesor` explícito (futuro-proofing). */
  espesor: number;
}

export type TipoAbertura = "puerta";
export type SentidoApertura = "dentro" | "fuera";

export interface AberturaV2 {
  id: string;
  /** Id del `MuroV2` al que está anclada esta abertura. */
  muroId: string;
  /** Distancia en metros, desde `muro.puntos[0]`, hasta el CENTRO de la
   *  abertura, proyectado sobre la recta del muro. */
  offset: number;
  /** Ancho de la abertura (hueco de paso), en metros. */
  ancho: number;
  tipo: TipoAbertura;
  /** Sentido de apertura. V1 no lo modela explícitamente; se preserva vía
   *  `anguloRelativoDeg` y este campo queda como valor por defecto informativo
   *  hasta que exista una UI para elegirlo. */
  abre: SentidoApertura;
  /** Grosor de la hoja de la puerta (perpendicular al muro), en metros.
   *  Campo extra (no listado en el diseño original) necesario para
   *  reconstruir exactamente el rect V1 sin inventar un valor. */
  alto: number;
  /** Ángulo (grados) de la puerta relativo al ángulo del propio muro.
   *  0 = perfectamente alineada con el muro (caso normal). Campo extra
   *  necesario para el round-trip exacto cuando el ángulo dibujado no es
   *  perfecto (redondeos, drag manual, etc.). */
  anguloRelativoDeg: number;
}

export interface ZonaV2 {
  id: string;
  nombre: string;
  color: string;
  /** Vértices del rectángulo (orden TL,TR,BR,BL tras rotar), en metros. */
  puntos: [Punto, Punto, Punto, Punto];
}

/**
 * Elemento V1 que no se pudo migrar de forma fiel a un tipo V2 conocido:
 * - `tipo` desconocido (ni wall/area/door), o
 * - una puerta demasiado lejos de cualquier muro para anclarla con confianza.
 * Se preserva el elemento ORIGINAL íntegro (nunca se pierden datos) más el
 * motivo, para poder depurar por qué quedó fuera del modelo.
 */
export interface ElementoV2Extra {
  motivo: "tipo_desconocido" | "puerta_sin_muro_cercano";
  elemento: ElementoV1;
}

export interface PlanoDocV2 {
  version: 2;
  unidad: "m";
  muros: MuroV2[];
  aberturas: AberturaV2[];
  zonas: ZonaV2[];
  extras: ElementoV2Extra[];
}

// ---------------------------------------------------------------------------
// Defaults / parámetros de migración
// ---------------------------------------------------------------------------

/** Espesor de muro por defecto, en metros (coincide con WALL_THICKNESS_METERS
 *  de CanvasPlano.tsx — no se importa desde ahí para no acoplar este módulo
 *  puro a Fabric.js; si ese valor cambia algún día, actualizar aquí también). */
export const ESPESOR_MURO_DEFAULT_M = 0.15;

/** Grosor de hoja de puerta por defecto, en metros (coincide con
 *  DOOR_LEAF_THICKNESS_PX=6 de CanvasPlano.tsx a 50px/m = 0.12m). */
export const ALTO_PUERTA_DEFAULT_M = 0.12;

/** Distancia máxima (metros) entre el centro de una puerta y la recta de un
 *  muro para considerarla anclada a ese muro. A 50px/m equivale a 25px, el
 *  mismo umbral que usa el snapping de creación (DOOR_WALL_SNAP_PX). */
export const TOLERANCIA_ANCLAJE_PUERTA_M = 0.5;

export interface OpcionesMigracionV1aV2 {
  pixelsPerMeter?: number;
  espesorMuroDefaultM?: number;
  toleranciaAnclajePuertaM?: number;
}

// ---------------------------------------------------------------------------
// Geometría auxiliar (rectángulo rotado <-> 4 vértices), usada por zonas.
// ---------------------------------------------------------------------------

function verticesRectRotado(
  left: number,
  top: number,
  width: number,
  height: number,
  angleDeg: number
): [Punto, Punto, Punto, Punto] {
  const cx = left + width / 2;
  const cy = top + height / 2;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const locales: [number, number][] = [
    [-width / 2, -height / 2], // TL
    [width / 2, -height / 2], // TR
    [width / 2, height / 2], // BR
    [-width / 2, height / 2], // BL
  ];
  return locales.map(([lx, ly]) => ({
    x: cx + lx * cos - ly * sin,
    y: cy + lx * sin + ly * cos,
  })) as [Punto, Punto, Punto, Punto];
}

/** Inversa de `verticesRectRotado`: recupera left/top/width/height/angle
 *  exactos (hasta coma flotante) a partir de los 4 vértices TL,TR,BR,BL. */
function rectDesdeVertices(vertices: [Punto, Punto, Punto, Punto]): {
  left: number;
  top: number;
  width: number;
  height: number;
  angle: number;
} {
  const [tl, tr, , bl] = vertices;
  const cx = (vertices[0].x + vertices[1].x + vertices[2].x + vertices[3].x) / 4;
  const cy = (vertices[0].y + vertices[1].y + vertices[2].y + vertices[3].y) / 4;
  const width = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const height = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const angleRad = Math.atan2(tr.y - tl.y, tr.x - tl.x);
  const angle = (angleRad * 180) / Math.PI;
  return {
    left: cx - width / 2,
    top: cy - height / 2,
    width,
    height,
    angle,
  };
}

// ---------------------------------------------------------------------------
// V1 -> V2
// ---------------------------------------------------------------------------

export function migrarPlanoV1aV2(
  elementosPx: ElementoV1[],
  opciones: OpcionesMigracionV1aV2 = {}
): PlanoDocV2 {
  const ppm = opciones.pixelsPerMeter ?? PIXELS_PER_METER;
  const espesorDefault = opciones.espesorMuroDefaultM ?? ESPESOR_MURO_DEFAULT_M;
  const toleranciaM = opciones.toleranciaAnclajePuertaM ?? TOLERANCIA_ANCLAJE_PUERTA_M;

  const muros: MuroV2[] = [];
  const zonas: ZonaV2[] = [];
  const puertasV1: ElementoV1[] = [];
  const extras: ElementoV2Extra[] = [];

  for (const elem of elementosPx) {
    if (elem.tipo === "wall") {
      const x1 = elem.props?.x1 ?? 0;
      const y1 = elem.props?.y1 ?? 0;
      const x2 = elem.props?.x2 ?? 0;
      const y2 = elem.props?.y2 ?? 0;
      muros.push({
        id: elem.id,
        puntos: [
          { x: pxToM(x1, ppm), y: pxToM(y1, ppm) },
          { x: pxToM(x2, ppm), y: pxToM(y2, ppm) },
        ],
        espesor: elem.props?.espesor ?? espesorDefault,
      });
    } else if (elem.tipo === "area") {
      const left = elem.props?.left ?? 0;
      const top = elem.props?.top ?? 0;
      const width = elem.props?.width ?? 0;
      const height = elem.props?.height ?? 0;
      const angle = elem.props?.angle ?? 0;
      const verticesPx = verticesRectRotado(left, top, width, height, angle);
      zonas.push({
        id: elem.id,
        nombre: elem.props?.nombre ?? "Zona",
        color: elem.props?.color ?? "#3b82f6",
        puntos: verticesPx.map((p) => ({ x: pxToM(p.x, ppm), y: pxToM(p.y, ppm) })) as [
          Punto,
          Punto,
          Punto,
          Punto
        ],
      });
    } else if (elem.tipo === "door") {
      puertasV1.push(elem);
    } else {
      extras.push({ motivo: "tipo_desconocido", elemento: elem });
    }
  }

  const aberturas: AberturaV2[] = [];
  for (const puerta of puertasV1) {
    const left = puerta.props?.left ?? 0;
    const top = puerta.props?.top ?? 0;
    const width = puerta.props?.width ?? 0;
    const height = puerta.props?.height ?? 0;
    const angle = puerta.props?.angle ?? 0;
    const cx = left + width / 2;
    const cy = top + height / 2;

    let mejorMuro: MuroV2 | null = null;
    let mejorOffsetPx = 0;
    let mejorPerpPx = Infinity;

    for (const muro of muros) {
      const p1 = { x: mToPx(muro.puntos[0].x, ppm), y: mToPx(muro.puntos[0].y, ppm) };
      const p2 = { x: mToPx(muro.puntos[1].x, ppm), y: mToPx(muro.puntos[1].y, ppm) };
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const largo = Math.hypot(dx, dy);
      if (largo === 0) continue;
      const ux = dx / largo;
      const uy = dy / largo;
      const t = (cx - p1.x) * ux + (cy - p1.y) * uy; // offset a lo largo del muro, px
      const perp = Math.abs((cx - p1.x) * uy - (cy - p1.y) * ux); // distancia perpendicular, px

      if (perp < mejorPerpPx) {
        mejorPerpPx = perp;
        mejorMuro = muro;
        mejorOffsetPx = t;
      }
    }

    if (mejorMuro && pxToM(mejorPerpPx, ppm) <= toleranciaM) {
      const p1 = { x: mToPx(mejorMuro.puntos[0].x, ppm), y: mToPx(mejorMuro.puntos[0].y, ppm) };
      const p2 = { x: mToPx(mejorMuro.puntos[1].x, ppm), y: mToPx(mejorMuro.puntos[1].y, ppm) };
      const anguloMuroDeg = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;

      aberturas.push({
        id: puerta.id,
        muroId: mejorMuro.id,
        offset: pxToM(mejorOffsetPx, ppm),
        ancho: pxToM(width, ppm),
        tipo: "puerta",
        abre: "dentro",
        alto: pxToM(height, ppm),
        anguloRelativoDeg: angle - anguloMuroDeg,
      });
    } else {
      extras.push({ motivo: "puerta_sin_muro_cercano", elemento: puerta });
    }
  }

  return { version: 2, unidad: "m", muros, aberturas, zonas, extras };
}

// ---------------------------------------------------------------------------
// V2 -> V1 (elementos en píxeles, listos para el renderer actual)
// ---------------------------------------------------------------------------

export function planoV2aElementosV1(
  doc: PlanoDocV2,
  pixelsPerMeter: number = PIXELS_PER_METER
): ElementoV1[] {
  const ppm = pixelsPerMeter;
  const elementos: ElementoV1[] = [];

  const muroPorId = new Map(doc.muros.map((m) => [m.id, m]));

  for (const muro of doc.muros) {
    elementos.push({
      id: muro.id,
      tipo: "wall",
      props: {
        x1: mToPx(muro.puntos[0].x, ppm),
        y1: mToPx(muro.puntos[0].y, ppm),
        x2: mToPx(muro.puntos[1].x, ppm),
        y2: mToPx(muro.puntos[1].y, ppm),
      },
    });
  }

  for (const zona of doc.zonas) {
    const verticesPx = zona.puntos.map((p) => ({ x: mToPx(p.x, ppm), y: mToPx(p.y, ppm) })) as [
      Punto,
      Punto,
      Punto,
      Punto
    ];
    const { left, top, width, height, angle } = rectDesdeVertices(verticesPx);
    elementos.push({
      id: zona.id,
      tipo: "area",
      props: { left, top, width, height, angle },
    });
  }

  for (const abertura of doc.aberturas) {
    const muro = muroPorId.get(abertura.muroId);
    if (!muro) continue; // muro referenciado inexistente: no se puede reconstruir, se omite.

    const p1 = { x: mToPx(muro.puntos[0].x, ppm), y: mToPx(muro.puntos[0].y, ppm) };
    const p2 = { x: mToPx(muro.puntos[1].x, ppm), y: mToPx(muro.puntos[1].y, ppm) };
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const largo = Math.hypot(dx, dy);
    const ux = largo === 0 ? 0 : dx / largo;
    const uy = largo === 0 ? 0 : dy / largo;
    const anguloMuroDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

    const offsetPx = mToPx(abertura.offset, ppm);
    const cx = p1.x + offsetPx * ux;
    const cy = p1.y + offsetPx * uy;
    const widthPx = mToPx(abertura.ancho, ppm);
    const heightPx = mToPx(abertura.alto, ppm);

    elementos.push({
      id: abertura.id,
      tipo: "door",
      props: {
        left: cx - widthPx / 2,
        top: cy - heightPx / 2,
        width: widthPx,
        height: heightPx,
        angle: anguloMuroDeg + abertura.anguloRelativoDeg,
      },
    });
  }

  for (const extra of doc.extras) {
    elementos.push(extra.elemento);
  }

  return elementos;
}
