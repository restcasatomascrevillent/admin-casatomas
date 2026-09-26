/**
 * Helpers puros (sin dependencia de Fabric.js ni de Supabase) usados por
 * CanvasPlano.tsx y EditorPlanoEspacio.tsx. Se extraen aquí para poder
 * testearlos con vitest sin necesidad de montar un canvas real.
 */

/** Matriz de transformación 2D de Fabric.js: [a, b, c, d, e, f]
 *  x' = a*x + c*y + e
 *  y' = b*x + d*y + f
 */
export type Matrix2D = [number, number, number, number, number, number];

export interface Punto {
  x: number;
  y: number;
}

/** Aplica una matriz de transformación 2D (convención de Fabric.js) a un punto. */
export function transformarPunto(punto: Punto, matriz: Matrix2D): Punto {
  const [a, b, c, d, e, f] = matriz;
  return {
    x: a * punto.x + c * punto.y + e,
    y: b * punto.x + d * punto.y + f,
  };
}

/**
 * Dado los puntos locales de una `Line` de Fabric (los que devuelve
 * `line.calcLinePoints()`, relativos al centro del objeto) y su matriz de
 * transformación (`line.calcTransformMatrix()`), calcula las coordenadas
 * absolutas x1,y1,x2,y2 en el espacio del canvas — necesarias para persistir
 * la pared tras moverla, rotarla o estirarla desde sus controles.
 */
export function calcularPuntosAbsolutosPared(
  matriz: Matrix2D,
  puntosLocales: { x1: number; y1: number; x2: number; y2: number }
): { x1: number; y1: number; x2: number; y2: number } {
  const p1 = transformarPunto({ x: puntosLocales.x1, y: puntosLocales.y1 }, matriz);
  const p2 = transformarPunto({ x: puntosLocales.x2, y: puntosLocales.y2 }, matriz);
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
}

/**
 * Calcula la geometría "horneada" (con la escala aplicada) de un Rect de
 * Fabric (área o puerta) tras un resize/rotate, para persistir width/height
 * reales en vez de width/height originales + scaleX/scaleY sueltos.
 */
export function calcularGeometriaRect(rect: {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  scaleX?: number;
  scaleY?: number;
  angle?: number;
}): { left: number; top: number; width: number; height: number; angle: number } {
  return {
    left: rect.left ?? 0,
    top: rect.top ?? 0,
    width: (rect.width ?? 0) * (rect.scaleX ?? 1),
    height: (rect.height ?? 0) * (rect.scaleY ?? 1),
    angle: rect.angle ?? 0,
  };
}

export interface AsignacionMesaRow {
  id: string;
  reserva_id: string;
  mesa_id: string;
}

/**
 * Decide qué hacer con cada asignación de la mesa ORIGEN al repuntarla hacia
 * la mesa DESTINO (fusión: originales -> mesa fusionada; desagrupar: mesa
 * fusionada eliminada -> primera mesa resultante):
 * - Si la reserva ya tiene una asignación en destino, la de origen es un
 *   duplicado: hay que ELIMINARLA (si no, violaría el UNIQUE(reserva_id, mesa_id)).
 * - Si no, se ACTUALIZA su mesa_id al destino.
 */
export function planRepuntarAsignaciones(
  asignacionesOrigen: AsignacionMesaRow[],
  reservaIdsYaEnDestino: Set<string>
): { aActualizar: string[]; aEliminar: string[] } {
  const aActualizar: string[] = [];
  const aEliminar: string[] = [];

  for (const asignacion of asignacionesOrigen) {
    if (reservaIdsYaEnDestino.has(asignacion.reserva_id)) {
      aEliminar.push(asignacion.id);
    } else {
      aActualizar.push(asignacion.id);
    }
  }

  return { aActualizar, aEliminar };
}

/** true si el id es un id temporal generado en el cliente (mesa suelta nueva o resultado de desagrupar). */
export function esMesaTemporal(id: string): boolean {
  return id.startsWith("mesa-temp-");
}

/** true si el id corresponde a una mesa fusionada aún no guardada en BBDD. */
export function esMesaGrupoNueva(id: string): boolean {
  return id.startsWith("mesa-grupo-");
}

/** true si el id no está persistido todavía (ni mesa suelta nueva ni grupo nuevo). */
export function esMesaNoPersistida(id: string): boolean {
  return esMesaTemporal(id) || esMesaGrupoNueva(id);
}
