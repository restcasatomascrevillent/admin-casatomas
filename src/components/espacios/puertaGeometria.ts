/**
 * Geometría de puertas (y, en general, de cualquier Rect de Fabric con
 * origen `left`/`top`).
 *
 * POR QUÉ EXISTE ESTE FICHERO
 * ---------------------------
 * Fabric v6 crea los `Rect` con `originX: "left"`, `originY: "top"`: el punto
 * (`left`, `top`) NO es el centro, es la esquina, y el objeto gira ALREDEDOR
 * DE ESA ESQUINA. Por tanto el centro real es
 *
 *     centro = (left, top) + R(θ) · (width/2, height/2)
 *
 * y no `(left + width/2, top + height/2)`, que solo coincide cuando θ = 0.
 * El código de las puertas usaba la versión ingenua en los dos sentidos
 * (al crear y al re-anclar), así que una puerta colocada sobre una pared
 * vertical (θ = 90°) o sobre la pared de abajo dibujada de derecha a
 * izquierda (θ = 180°) se quedaba flotando a 57 cm / 81 cm de su pared.
 *
 * Estas funciones son la conversión correcta en los dos sentidos y son
 * exactamente inversas entre sí para cualquier ángulo.
 *
 * OJO con `Rect.getCenterPoint()` de Fabric: devuelve el centro de la caja
 * CON el grosor del trazo incluido (`strokeWidth`), o sea desplazado
 * `strokeWidth/2` en cada eje local respecto del centro geométrico del
 * rectángulo. Como lo que se persiste en `planos_espacio.configuracion` es
 * el rectángulo SIN trazo (`{left, top, width, height, angle}`), mezclar las
 * dos convenciones haría que la puerta se desplazase ~1px en cada arrastre
 * (deriva acumulativa). Por eso aquí se calcula el centro geométrico a mano
 * en vez de tirar de `getCenterPoint()`.
 */
import type { Punto, SegmentoPared } from "./planoUtils";

const GRADOS_A_RAD = Math.PI / 180;

export interface RectFabric {
  left: number;
  top: number;
  width: number;
  height: number;
  angle: number;
}

/**
 * Centro geométrico real de un Rect de Fabric con origen `left`/`top`,
 * válido para cualquier ángulo.
 */
export function centroRectFabric(rect: RectFabric): Punto {
  const rad = rect.angle * GRADOS_A_RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hx = rect.width / 2;
  const hy = rect.height / 2;
  return {
    x: rect.left + hx * cos - hy * sin,
    y: rect.top + hx * sin + hy * cos,
  };
}

/**
 * Inversa exacta de `centroRectFabric`: dados el centro deseado, el tamaño y
 * el ángulo, devuelve el `left`/`top` que hay que darle al Rect de Fabric
 * para que su centro caiga justo ahí.
 */
export function topLeftRectFabric(
  centro: Punto,
  width: number,
  height: number,
  angle: number
): { left: number; top: number } {
  const rad = angle * GRADOS_A_RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hx = width / 2;
  const hy = height / 2;
  return {
    left: centro.x - hx * cos + hy * sin,
    top: centro.y - hx * sin - hy * cos,
  };
}

/**
 * Forma en que `planos_espacio.configuracion.elementos` guarda un elemento
 * rectangular. Hay DOS formas en circulación y las dos siguen vivas: la plana
 * (`{left, top, ...}`) y la anidada (`{props: {left, top, ...}}`).
 */
export interface ElementoRectPersistido {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  angle?: number;
  props?: Record<string, any> | null;
}

/**
 * Lee la geometría de un elemento persistido y la devuelve en la convención
 * de Fabric (`left`/`top` = esquina, giro alrededor de ella).
 *
 * `??` y NO `||`: un elemento en `x = 0` es una posición válida, no "sin
 * valor". Con `||`, un `props.left` de 0 se salta y se acaba leyendo
 * `elem.left`, que puede ser un valor completamente distinto; y un `width` de
 * 0 guardado se convierte en el de por defecto. Mismo criterio que
 * `CanvasPlano.tsx` ("OJO: usar ?? y no ||").
 */
export function rectFabricDesdeElemento(
  elem: ElementoRectPersistido,
  anchoPorDefecto: number,
  altoPorDefecto: number
): RectFabric {
  const props = elem.props ?? elem;
  return {
    left: props.left ?? elem.left ?? 0,
    top: props.top ?? elem.top ?? 0,
    width: props.width ?? elem.width ?? anchoPorDefecto,
    height: props.height ?? elem.height ?? altoPorDefecto,
    angle: props.angle ?? elem.angle ?? 0,
  };
}

/**
 * Los 4 vértices del rectángulo en orden TL, TR, BR, BL, con la MISMA
 * convención que `centroRectFabric`: `(left, top)` es la esquina TL y el
 * rectángulo gira alrededor de ella.
 *
 * OJO: `planoDocV2.ts` tiene un `verticesRectRotado` privado que parece lo
 * mismo pero NO lo es — gira alrededor del centro (`cx = left + width/2`),
 * que es justo la convención equivocada que arregló el commit 1e77baf. Allí
 * se compensa porque su inversa arrastra el mismo error; aquí no se puede
 * reusar.
 */
export function verticesRectFabric(rect: RectFabric): [Punto, Punto, Punto, Punto] {
  const rad = rect.angle * GRADOS_A_RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const locales: Array<[number, number]> = [
    [0, 0], // TL — es el pivote
    [rect.width, 0], // TR
    [rect.width, rect.height], // BR
    [0, rect.height], // BL
  ];
  return locales.map(([lx, ly]) => ({
    x: rect.left + lx * cos - ly * sin,
    y: rect.top + lx * sin + ly * cos,
  })) as [Punto, Punto, Punto, Punto];
}

/**
 * Caja alineada a los ejes que contiene al rectángulo YA ROTADO.
 *
 * Con `angle = 0` devuelve exactamente `left..left+width` / `top..top+height`,
 * así que sustituir la caja ingenua por esta no cambia nada de lo que no
 * estuviera girado. Con ángulo sí: una puerta de 70x12 a 90° ocupa 12 de ancho
 * y 70 de alto, y su esquina queda a la IZQUIERDA de `left`.
 */
export function aabbRectFabric(rect: RectFabric): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const vertices = verticesRectFabric(rect);
  const xs = vertices.map((v) => v.x);
  const ys = vertices.map((v) => v.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/** Punto más cercano a `punto` sobre el segmento (clampado a sus extremos). */
export function proyectarPuntoEnSegmento(punto: Punto, seg: SegmentoPared): Punto {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: seg.x1, y: seg.y1 };
  let t = ((punto.x - seg.x1) * dx + (punto.y - seg.y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: seg.x1 + t * dx, y: seg.y1 + t * dy };
}

/** Ángulo del segmento en grados, en la convención de Fabric (x→derecha, y→abajo). */
export function anguloSegmentoDeg(seg: SegmentoPared): number {
  return Math.atan2(seg.y2 - seg.y1, seg.x2 - seg.x1) * (180 / Math.PI);
}

export interface PuertaCalculada extends RectFabric {
  /** true si se ha enganchado a una pared; false si se queda donde se pidió. */
  anclada: boolean;
  /** Centro geométrico resultante (sobre la pared si `anclada`). */
  centro: Punto;
}

/**
 * Coloca una puerta de `width` x `height` px centrada en `centroDeseado`,
 * enganchándola a la pared más cercana si hay alguna a menos de `umbral`
 * (en unidades de escena). El resultado ya viene en la convención que se
 * persiste: `left`/`top` de esquina + `angle`.
 *
 * La misma función la usan la creación (clic con la herramienta puerta) y el
 * re-anclaje al mover/rotar/redimensionar, para que las dos no puedan
 * divergir nunca más.
 */
export function calcularPuertaEnMuro(
  centroDeseado: Punto,
  segmentos: SegmentoPared[],
  width: number,
  height: number,
  umbral: number
): PuertaCalculada {
  let mejorDist = umbral;
  let centro = centroDeseado;
  let angle = 0;
  let anclada = false;

  for (const seg of segmentos) {
    const proyeccion = proyectarPuntoEnSegmento(centroDeseado, seg);
    const dist = Math.hypot(proyeccion.x - centroDeseado.x, proyeccion.y - centroDeseado.y);
    if (dist <= mejorDist) {
      mejorDist = dist;
      centro = proyeccion;
      angle = anguloSegmentoDeg(seg);
      anclada = true;
    }
  }

  const { left, top } = topLeftRectFabric(centro, width, height, angle);
  return { left, top, width, height, angle, anclada, centro };
}
