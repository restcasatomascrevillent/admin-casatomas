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

// ---------------------------------------------------------------------------
// Fase 1 — ergonomía de dibujo y geometría del plano (paredes, área real).
// ---------------------------------------------------------------------------

export interface SegmentoPared {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Redondea un punto a la rejilla de `gridMeters` (por defecto 10cm), en píxeles. */
export function snapPointToGrid(punto: Punto, pixelsPerMeter: number, gridMeters = 0.1): Punto {
  const gridPx = gridMeters * pixelsPerMeter;
  if (gridPx <= 0) return punto;
  return {
    x: Math.round(punto.x / gridPx) * gridPx,
    y: Math.round(punto.y / gridPx) * gridPx,
  };
}

/**
 * Ajusta el ángulo del segmento anchor->punto al múltiplo de `stepDeg` más
 * cercano (por defecto 15°, que cubre 0/45/90 con pasos finos), conservando
 * la longitud real. Con `freeform=true` (Shift pulsado) no ajusta nada.
 */
export function snapWallAngle(anchor: Punto, punto: Punto, freeform: boolean, stepDeg = 15): Punto {
  if (freeform) return punto;
  const dx = punto.x - anchor.x;
  const dy = punto.y - anchor.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) return punto;
  const angleRad = Math.atan2(dy, dx);
  const stepRad = (stepDeg * Math.PI) / 180;
  const snappedRad = Math.round(angleRad / stepRad) * stepRad;
  return {
    x: anchor.x + Math.cos(snappedRad) * length,
    y: anchor.y + Math.sin(snappedRad) * length,
  };
}

/**
 * Busca el extremo de pared existente más cercano a `punto` dentro de
 * `thresholdPx` (coordenadas de escena, ya con zoom/pan resuelto por el
 * caller). Sirve para el snapping magnético a esquinas al dibujar paredes.
 */
export function snapToWallEndpoint(
  punto: Punto,
  paredes: SegmentoPared[],
  thresholdPx: number
): Punto | null {
  let best: Punto | null = null;
  let bestDist = thresholdPx;
  for (const pared of paredes) {
    for (const candidato of [
      { x: pared.x1, y: pared.y1 },
      { x: pared.x2, y: pared.y2 },
    ]) {
      const dist = Math.hypot(candidato.x - punto.x, candidato.y - punto.y);
      if (dist <= bestDist) {
        bestDist = dist;
        best = candidato;
      }
    }
  }
  return best;
}

interface NodoGrafoParedes {
  x: number;
  y: number;
}

interface AristaGrafoParedes {
  a: number; // índice de nodo
  b: number; // índice de nodo
}

/**
 * Construye un grafo no dirigido a partir de los segmentos de pared,
 * fusionando extremos que caen dentro de `tolerance` px en un único nodo.
 * Esto es lo que permite representar un T-junction (partición interior que
 * arranca a mitad de un muro exterior) como UN nodo compartido por 3 aristas,
 * en vez de 2-3 puntos "casi iguales" pero distintos que el emparejamiento
 * greedy anterior no sabía conciliar.
 */
function construirGrafoParedes(
  paredes: SegmentoPared[],
  tolerance: number
): { nodos: NodoGrafoParedes[]; aristas: AristaGrafoParedes[] } {
  const nodos: NodoGrafoParedes[] = [];

  const indiceDeNodo = (punto: Punto): number => {
    for (let i = 0; i < nodos.length; i++) {
      if (Math.hypot(nodos[i].x - punto.x, nodos[i].y - punto.y) <= tolerance) {
        return i;
      }
    }
    nodos.push({ x: punto.x, y: punto.y });
    return nodos.length - 1;
  };

  const aristas: AristaGrafoParedes[] = [];
  for (const pared of paredes) {
    const a = indiceDeNodo({ x: pared.x1, y: pared.y1 });
    const b = indiceDeNodo({ x: pared.x2, y: pared.y2 });
    // Segmento degenerado tras fusionar extremos (pared de longitud ~0, o
    // ambos extremos cayeron en el mismo nodo): no aporta ninguna arista útil.
    if (a === b) continue;
    aristas.push({ a, b });
  }

  return { nodos, aristas };
}

// Límite de seguridad para la exploración de ciclos: en una planta real (unas
// pocas decenas de paredes como mucho) nunca se acerca a este número, pero
// evita que un grafo patológico (muchísimos huecos casi coincidentes) cuelgue
// el navegador con una búsqueda exponencial.
const MAX_CICLOS_EXPLORADOS = 20000;

/**
 * Enumera los ciclos simples del grafo (cada uno como lista ordenada de
 * índices de nodo, sin repetir el primero al final) mediante DFS desde cada
 * nodo, restringiendo cada búsqueda a nodos de índice >= al de partida (así
 * cada ciclo se reporta una única vez, desde su nodo de índice mínimo, sin
 * depender de qué pared se "vio primero" — al contrario que el greedy
 * anterior). Contempla T-junctions de forma natural: en cada nodo se prueban
 * TODAS las aristas salientes, no solo "la siguiente pared que cuadra".
 */
function enumerarCiclosSimples(
  nodos: NodoGrafoParedes[],
  aristas: AristaGrafoParedes[]
): number[][] {
  const adyacencia: Array<Array<{ vecino: number; aristaIdx: number }>> = nodos.map(() => []);
  aristas.forEach((arista, idx) => {
    adyacencia[arista.a].push({ vecino: arista.b, aristaIdx: idx });
    adyacencia[arista.b].push({ vecino: arista.a, aristaIdx: idx });
  });

  const ciclos: number[][] = [];
  let explorados = 0;

  for (let inicio = 0; inicio < nodos.length; inicio++) {
    const pila: number[] = [inicio];
    const enPila = new Set<number>([inicio]);

    const dfs = (actual: number, aristaEntrada: number): boolean => {
      for (const { vecino, aristaIdx } of adyacencia[actual]) {
        if (aristaIdx === aristaEntrada) continue; // no desandar la misma arista
        if (vecino < inicio) continue; // ese ciclo se reporta desde su nodo de índice mínimo

        explorados++;
        if (explorados > MAX_CICLOS_EXPLORADOS) return false; // corte de seguridad

        if (vecino === inicio) {
          if (pila.length >= 3) ciclos.push([...pila]);
          continue;
        }

        if (enPila.has(vecino)) continue; // ya usado en este camino: no sería un ciclo simple

        pila.push(vecino);
        enPila.add(vecino);
        const seguir = dfs(vecino, aristaIdx);
        pila.pop();
        enPila.delete(vecino);
        if (!seguir) return false;
      }
      return true;
    };

    if (!dfs(inicio, -1)) break;
  }

  return ciclos;
}

/**
 * Encuentra, entre todos los polígonos cerrados que forman las paredes, el de
 * MAYOR área (el contorno exterior de la sala). A diferencia del emparejamiento
 * greedy nearest-neighbour anterior — que fallaba con T-junctions (particiones
 * interiores), paredes sueltas o topologías con más de un lazo — esto:
 * 1) fusiona extremos dentro de `tolerance` en nodos de un grafo,
 * 2) busca TODOS los ciclos simples del grafo (una pared interior que cuelga
 *    de un T-junction no rompe la detección: simplemente añade más ciclos,
 *    más pequeños, que se descartan por área),
 * 3) devuelve los vértices del ciclo de mayor área (shoelace), o null si no
 *    hay ningún ciclo (paredes sueltas / polilínea abierta).
 * Mantiene la misma firma/tipo de retorno que la versión anterior.
 */
export function detectarPoligonoCerrado(paredes: SegmentoPared[], tolerance = 5): Punto[] | null {
  if (paredes.length < 3) return null;

  const { nodos, aristas } = construirGrafoParedes(paredes, tolerance);
  if (nodos.length < 3 || aristas.length < 3) return null;

  const ciclos = enumerarCiclosSimples(nodos, aristas);
  if (ciclos.length === 0) return null;

  let mejorVertices: Punto[] | null = null;
  let mejorArea = -Infinity;

  for (const ciclo of ciclos) {
    const vertices = ciclo.map((i) => ({ x: nodos[i].x, y: nodos[i].y }));
    const area = areaShoelace(vertices);
    if (area > mejorArea) {
      mejorArea = area;
      mejorVertices = vertices;
    }
  }

  return mejorVertices;
}

/** Área de un polígono simple mediante la fórmula del shoelace (valor absoluto). */
export function areaShoelace(vertices: Punto[]): number {
  let suma = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    suma += a.x * b.y - b.x * a.y;
  }
  return Math.abs(suma) / 2;
}

/** Ancho/alto del rectángulo que envuelve el polígono (mismas unidades que los vértices). */
export function bboxPoligono(vertices: Punto[]): { width: number; height: number } {
  const xs = vertices.map((v) => v.x);
  const ys = vertices.map((v) => v.y);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

/** Redondea un ángulo (grados) al múltiplo de `stepDeg` más cercano (rotación de mesas/puertas). */
export function snapRotationDeg(angle: number, stepDeg = 15): number {
  return Math.round(angle / stepDeg) * stepDeg;
}

/** Posición de una silla relativa al CENTRO de la mesa, sin rotar (el llamador
 * rota estas coordenadas si la mesa tiene `rotacion`). Unidades: las mismas
 * que ancho/alto (cm o px, es indiferente). */
export interface PosicionSilla {
  x: number;
  y: number;
  /** Ángulo (grados) al que debería mirar la silla — hacia el centro de la mesa. */
  anguloDeg: number;
}

function repartirEnSegmento(cantidad: number, desde: number, hasta: number): number[] {
  if (cantidad <= 0) return [];
  if (cantidad === 1) return [(desde + hasta) / 2];
  const paso = (hasta - desde) / (cantidad + 1);
  const posiciones: number[] = [];
  for (let i = 1; i <= cantidad; i++) posiciones.push(desde + paso * i);
  return posiciones;
}

/**
 * Reparte `capacidad` sillas alrededor de una mesa rectangular de
 * ancho x alto: primero en los lados largos (a partes iguales entre los
 * dos), y solo si no caben todas ahí, el resto en los lados cortos.
 */
export function distribuirSillasRectangular(capacidad: number, ancho: number, alto: number): PosicionSilla[] {
  if (capacidad <= 0 || ancho <= 0 || alto <= 0) return [];

  const horizontal = ancho >= alto;
  const largo = horizontal ? ancho : alto;
  const corto = horizontal ? alto : ancho;
  const separacionMinima = Math.max(10, Math.min(largo, corto) * 0.2);

  const capPorLadoLargo = Math.max(1, Math.floor(largo / separacionMinima));
  const capPorLadoCorto = Math.max(1, Math.floor(corto / separacionMinima));

  let restantes = capacidad;
  const enLado1 = Math.min(capPorLadoLargo, Math.ceil(restantes / 2));
  restantes -= enLado1;
  const enLado2 = Math.min(capPorLadoLargo, restantes);
  restantes -= enLado2;
  const enExtremo1 = Math.min(capPorLadoCorto, Math.ceil(restantes / 2));
  restantes -= enExtremo1;
  const enExtremo2 = Math.min(capPorLadoCorto, restantes);
  restantes -= enExtremo2;
  // Si aún sobran (mesa pequeña para su capacidad), se apilan en los lados
  // largos igualmente: mejor una silla algo apretada que perderla del dibujo.
  const extraLado1 = Math.ceil(restantes / 2);
  const extraLado2 = restantes - extraLado1;

  const halfLargo = largo / 2;
  const halfCorto = corto / 2;
  const distanciaBorde = 14;
  const sillas: PosicionSilla[] = [];

  repartirEnSegmento(enLado1 + extraLado1, -halfLargo, halfLargo).forEach((p) => {
    sillas.push(
      horizontal
        ? { x: p, y: -halfCorto - distanciaBorde, anguloDeg: 180 }
        : { x: -halfCorto - distanciaBorde, y: p, anguloDeg: 90 }
    );
  });
  repartirEnSegmento(enLado2 + extraLado2, -halfLargo, halfLargo).forEach((p) => {
    sillas.push(
      horizontal
        ? { x: p, y: halfCorto + distanciaBorde, anguloDeg: 0 }
        : { x: halfCorto + distanciaBorde, y: p, anguloDeg: -90 }
    );
  });
  repartirEnSegmento(enExtremo1, -halfCorto, halfCorto).forEach((p) => {
    sillas.push(
      horizontal
        ? { x: -halfLargo - distanciaBorde, y: p, anguloDeg: 90 }
        : { x: p, y: -halfLargo - distanciaBorde, anguloDeg: 180 }
    );
  });
  repartirEnSegmento(enExtremo2, -halfCorto, halfCorto).forEach((p) => {
    sillas.push(
      horizontal
        ? { x: halfLargo + distanciaBorde, y: p, anguloDeg: -90 }
        : { x: p, y: halfLargo + distanciaBorde, anguloDeg: 0 }
    );
  });

  return sillas;
}

/** Reparte `capacidad` sillas uniformemente alrededor de una mesa circular de `diametro`. */
export function distribuirSillasCirculo(capacidad: number, diametro: number): PosicionSilla[] {
  if (capacidad <= 0 || diametro <= 0) return [];
  const radio = diametro / 2 + 14;
  const sillas: PosicionSilla[] = [];
  for (let i = 0; i < capacidad; i++) {
    const anguloRad = (2 * Math.PI * i) / capacidad - Math.PI / 2; // primera silla arriba
    sillas.push({
      x: Math.cos(anguloRad) * radio,
      y: Math.sin(anguloRad) * radio,
      anguloDeg: (anguloRad * 180) / Math.PI + 90,
    });
  }
  return sillas;
}
