/**
 * Helpers puros (sin dependencia de Fabric.js ni de Supabase) usados por
 * CanvasPlano.tsx y EditorPlanoEspacio.tsx. Se extraen aquí para poder
 * testearlos con vitest sin necesidad de montar un canvas real.
 */

// ---------------------------------------------------------------------------
// Fase 2 — escala global del editor (Fabric.js, en src/components/espacios/**).
//
// NOTA: src/components/reservas/PlanoEspacio2D.tsx (el visor read-only de
// reservas, fuera del alcance de este refactor) tiene su PROPIA constante
// `const PIXELS_PER_METER = plano?.pixels_per_meter || 50;` — usa el valor
// guardado en BD (con 50 de fallback) en vez de esta constante fija, así que
// NO se ha tocado ni centralizado ahí. Cuando se aborde ese componente en una
// fase posterior, unificar con estos mismos helpers.
// ---------------------------------------------------------------------------

/** Píxeles por metro del editor de plano (Fabric.js). Antes vivía duplicada
 *  como constante local en EditorPlanoEspacio.tsx; centralizada aquí para que
 *  cualquier futuro consumidor (p.ej. la migración a PlanoDocV2) use un único
 *  origen de verdad. Valor sin cambios: 50. */
export const PIXELS_PER_METER = 50;

/** Convierte metros a píxeles de escena, con el `pixelsPerMeter` vigente
 *  (por defecto el global `PIXELS_PER_METER`). */
export function mToPx(metros: number, pixelsPerMeter: number = PIXELS_PER_METER): number {
  return metros * pixelsPerMeter;
}

/** Convierte píxeles de escena a metros, con el `pixelsPerMeter` vigente
 *  (por defecto el global `PIXELS_PER_METER`). */
export function pxToM(pixeles: number, pixelsPerMeter: number = PIXELS_PER_METER): number {
  return pixeles / pixelsPerMeter;
}

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

// ---------------------------------------------------------------------------
// REJILLA PARA EL ALTA EN LOTE DE MESAS
// ---------------------------------------------------------------------------

/**
 * Rectángulo ya ocupado del plano, en METROS y con el mismo criterio que
 * `mesas.pos_x/pos_y` (esquina superior izquierda) — ver `rectanguloDeMesa`.
 */
export interface RectanguloOcupado {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Rectángulo (en metros) que ocupa una mesa del canvas, cuyo tamaño está en cm.
 *  Para una mesa circular es su caja envolvente, que es justo lo que hace falta
 *  para no colocar otra encima. */
export function rectanguloDeMesa(mesa: {
  posX: number;
  posY: number;
  ancho: number;
  alto: number;
}): RectanguloOcupado {
  return {
    x: mesa?.posX ?? 0,
    y: mesa?.posY ?? 0,
    width: Math.max(0, (mesa?.ancho ?? 80) / 100),
    height: Math.max(0, (mesa?.alto ?? 80) / 100),
  };
}

/** ¿Se pisan dos rectángulos (con `holgura` metros de aire obligatorio entre
 *  ellos)? Tocarse justo por el borde con holgura 0 NO cuenta como pisarse. */
export function rectangulosSolapan(
  a: RectanguloOcupado,
  b: RectanguloOcupado,
  holgura = 0,
): boolean {
  if (!a || !b) return false;
  return (
    a.x < b.x + b.width + holgura &&
    b.x < a.x + a.width + holgura &&
    a.y < b.y + b.height + holgura &&
    b.y < a.y + a.height + holgura
  );
}

// ---------------------------------------------------------------------------
// DIMENSIONES REALES DEL ESPACIO (ancho × alto en metros)
// ---------------------------------------------------------------------------

/** Lado mínimo admisible para un espacio, en metros. Por debajo de esto no cabe
 *  ni la mesa más pequeña (`MIN_LADO_MESA_CM` = 30cm) con su margen. */
export const MIN_LADO_ESPACIO_M = 0.5;

/** Lado máximo admisible, en metros. 200m de lado son 4 hectáreas: cualquier
 *  cosa por encima es un arrastre accidental con el zoom muy alejado, y a
 *  50px/m deja un lienzo de 10.000px de lado que solo sirve para colgar el
 *  navegador. */
export const MAX_LADO_ESPACIO_M = 200;

export interface DimensionesEspacio {
  width: number;
  height: number;
}

// `motivo?: undefined` / `dimensiones?: undefined` no son decorativos: el
// proyecto compila con `strict: false` y, sin ellos, TypeScript no estrecha la
// unión por el discriminante `ok` (mismo apaño que el tipo `Escritura` de
// `EditorPlanoEspacio.tsx`).
export type NormalizacionDimensiones =
  | { ok: true; dimensiones: DimensionesEspacio; motivo?: undefined }
  | { ok: false; motivo: string; dimensiones?: undefined };

/**
 * Valida un ancho×alto en metros antes de dejar que se convierta en las
 * dimensiones del espacio (y, de ahí, en `planos_espacio.ancho_metros/
 * alto_metros`). Devuelve el motivo en español, listo para un toast.
 *
 * Existe porque la herramienta "Sala rectangular" calcula las medidas
 * dividiendo píxeles arrastrados entre `pixelsPerMeter`: un
 * `pixelsPerMeter` a 0 (o un rect degenerado) produciría `Infinity`/`NaN` y
 * eso viaja tal cual hasta la columna numérica de la BD.
 */
export function normalizarDimensionesEspacio(
  width: number,
  height: number,
): NormalizacionDimensiones {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return { ok: false, motivo: "las medidas de la sala no son un número válido" };
  }
  if (width <= 0 || height <= 0) {
    return { ok: false, motivo: "una sala no puede medir 0 m (ni menos) de lado" };
  }
  if (width < MIN_LADO_ESPACIO_M || height < MIN_LADO_ESPACIO_M) {
    return {
      ok: false,
      motivo: `una sala no puede medir menos de ${MIN_LADO_ESPACIO_M} m de lado`,
    };
  }
  if (width > MAX_LADO_ESPACIO_M || height > MAX_LADO_ESPACIO_M) {
    return {
      ok: false,
      motivo: `una sala no puede medir más de ${MAX_LADO_ESPACIO_M} m de lado`,
    };
  }
  // A centímetros: es la precisión con la que se guardan `pos_x/pos_y` y la
  // que usa el snap de dibujo (5cm), así que más decimales solo son ruido.
  return {
    ok: true,
    dimensiones: {
      width: Math.round(width * 100) / 100,
      height: Math.round(height * 100) / 100,
    },
  };
}

/**
 * Mesas que se quedarían (total o parcialmente) FUERA del rectángulo del
 * espacio con las dimensiones dadas. No mueve nada: solo permite avisar de que
 * redibujar la sala ha dejado mesas colgando fuera, para que el dueño las
 * recoloque a mano (moverlas por él le cambiaría el plano sin pedirlo).
 */
export function mesasFueraDelPlano(
  mesas: readonly { nombre?: string; posX?: number; posY?: number; ancho?: number; alto?: number }[],
  dimensiones: DimensionesEspacio,
): string[] {
  const ancho = dimensiones?.width ?? 0;
  const alto = dimensiones?.height ?? 0;
  const fuera: string[] = [];
  for (const mesa of mesas ?? []) {
    if (!mesa) continue;
    const rect = rectanguloDeMesa({
      posX: mesa.posX ?? 0,
      posY: mesa.posY ?? 0,
      ancho: mesa.ancho ?? 80,
      alto: mesa.alto ?? 80,
    });
    // Tolerancia de 1cm: una mesa pegada justo al borde (x + ancho === ancho
    // del plano) no debe contarse como "fuera" por un redondeo de coma flotante.
    const TOLERANCIA_M = 0.01;
    const seSale =
      rect.x < -TOLERANCIA_M ||
      rect.y < -TOLERANCIA_M ||
      rect.x + rect.width > ancho + TOLERANCIA_M ||
      rect.y + rect.height > alto + TOLERANCIA_M;
    if (seSale) fuera.push(mesa.nombre ?? "sin número");
  }
  return fuera;
}

// ---------------------------------------------------------------------------
// PAREDES COMO OBSTÁCULO (para que la colocación automática no las atraviese)
// ---------------------------------------------------------------------------

/** Espesor de una pared en METROS. Mismo valor que `WALL_THICKNESS_METERS` de
 *  `CanvasPlano.tsx` y que `ESPESOR_MURO_DEFAULT_M` de `planoDocV2.ts`: es el
 *  grosor con el que se PINTA el muro, así que es el que hay que respetar para
 *  que una mesa no se vea montada encima del trazo. */
export const ESPESOR_PARED_M = 0.15;

/**
 * Pared como obstáculo de colocación, en METROS (no en píxeles como los
 * `ElementoCanvas` del editor). Es un segmento con espesor, no una caja: la
 * caja envolvente de una pared en diagonal taparía media sala.
 */
export interface ParedObstaculo {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Espesor del muro en metros. Si falta, `ESPESOR_PARED_M`. */
  espesor?: number;
}

/** Distancia de un punto al segmento `a`-`b`. */
function distanciaPuntoSegmento(p: Punto, a: Punto, b: Punto): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const largo2 = dx * dx + dy * dy;
  if (largo2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / largo2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Signo del producto vectorial (orientación de `c` respecto a la recta `a`-`b`). */
function orientacion(a: Punto, b: Punto, c: Punto): number {
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(v) < 1e-12) return 0;
  return v > 0 ? 1 : -1;
}

function puntoEnSegmentoColineal(p: Punto, a: Punto, b: Punto): boolean {
  return (
    Math.min(a.x, b.x) - 1e-12 <= p.x &&
    p.x <= Math.max(a.x, b.x) + 1e-12 &&
    Math.min(a.y, b.y) - 1e-12 <= p.y &&
    p.y <= Math.max(a.y, b.y) + 1e-12
  );
}

/** ¿Se cortan los segmentos `a1`-`a2` y `b1`-`b2`? (incluye los casos colineales). */
export function segmentosSeCortan(a1: Punto, a2: Punto, b1: Punto, b2: Punto): boolean {
  const o1 = orientacion(a1, a2, b1);
  const o2 = orientacion(a1, a2, b2);
  const o3 = orientacion(b1, b2, a1);
  const o4 = orientacion(b1, b2, a2);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && puntoEnSegmentoColineal(b1, a1, a2)) return true;
  if (o2 === 0 && puntoEnSegmentoColineal(b2, a1, a2)) return true;
  if (o3 === 0 && puntoEnSegmentoColineal(a1, b1, b2)) return true;
  if (o4 === 0 && puntoEnSegmentoColineal(a2, b1, b2)) return true;
  return false;
}

/** Distancia mínima entre dos segmentos (0 si se cortan). */
export function distanciaSegmentoSegmento(
  a1: Punto,
  a2: Punto,
  b1: Punto,
  b2: Punto,
): number {
  if (segmentosSeCortan(a1, a2, b1, b2)) return 0;
  return Math.min(
    distanciaPuntoSegmento(a1, b1, b2),
    distanciaPuntoSegmento(a2, b1, b2),
    distanciaPuntoSegmento(b1, a1, a2),
    distanciaPuntoSegmento(b2, a1, a2),
  );
}

/**
 * Distancia mínima entre el EJE de una pared (segmento sin espesor) y un
 * rectángulo eje-alineado. 0 si la pared lo cruza o queda dentro.
 */
export function distanciaSegmentoRectangulo(
  seg: { x1: number; y1: number; x2: number; y2: number },
  rect: RectanguloOcupado,
): number {
  const a1: Punto = { x: seg.x1, y: seg.y1 };
  const a2: Punto = { x: seg.x2, y: seg.y2 };
  const dentro = (p: Punto) =>
    p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height;
  // Segmento entero dentro del rectángulo: no corta ningún lado, pero la
  // distancia es 0 igualmente.
  if (dentro(a1) || dentro(a2)) return 0;

  const tl: Punto = { x: rect.x, y: rect.y };
  const tr: Punto = { x: rect.x + rect.width, y: rect.y };
  const br: Punto = { x: rect.x + rect.width, y: rect.y + rect.height };
  const bl: Punto = { x: rect.x, y: rect.y + rect.height };

  return Math.min(
    distanciaSegmentoSegmento(a1, a2, tl, tr),
    distanciaSegmentoSegmento(a1, a2, tr, br),
    distanciaSegmentoSegmento(a1, a2, br, bl),
    distanciaSegmentoSegmento(a1, a2, bl, tl),
  );
}

/**
 * ¿Una mesa (`rect`, en metros) pisa el trazo de una pared, o se le acerca a
 * menos de `holgura` metros?
 *
 * CRITERIO (ver informe): la pared NO es su caja envolvente —eso taparía media
 * sala en cuanto hubiera una diagonal— sino una "cápsula": el segmento con
 * `espesor` metros de grosor repartidos a ambos lados de su eje, que es
 * exactamente como se PINTA en el lienzo (`WALL_THICKNESS_METERS`). Hay choque
 * si la distancia del eje al rectángulo es menor que `espesor / 2 + holgura`.
 *
 * `holgura` es deliberadamente PEQUEÑA (5cm por defecto): en una sala real las
 * mesas van pegadas a la pared, así que exigir medio metro de aire dejaría la
 * colocación automática sin sitios válidos en los locales estrechos.
 */
export function rectanguloChocaConPared(
  rect: RectanguloOcupado,
  pared: ParedObstaculo,
  holgura = 0,
): boolean {
  if (!rect || !pared) return false;
  const espesor = Number.isFinite(pared.espesor as number)
    ? Math.max(0, pared.espesor as number)
    : ESPESOR_PARED_M;
  const distancia = distanciaSegmentoRectangulo(pared, rect);
  return distancia < espesor / 2 + Math.max(0, holgura);
}

/**
 * Convierte los `ElementoCanvas` del editor (formato V1, en PÍXELES) en
 * paredes-obstáculo en METROS.
 *
 * Solo se traducen los elementos `wall`. Las `area` (zonas con nombre) NO son
 * obstáculo a propósito: son justo los trozos de sala donde se QUIEREN las
 * mesas. Las `door` tampoco: una puerta está dibujada ENCIMA de su muro, así
 * que el propio muro ya reserva ese hueco.
 */
export function paredesDesdeElementos(
  elementos: readonly { tipo?: string; props?: Record<string, any> }[] | null | undefined,
  pixelsPerMeter: number = PIXELS_PER_METER,
): ParedObstaculo[] {
  const ppm = Number.isFinite(pixelsPerMeter) && pixelsPerMeter > 0 ? pixelsPerMeter : PIXELS_PER_METER;
  const paredes: ParedObstaculo[] = [];
  for (const elemento of elementos ?? []) {
    if (!elemento || elemento.tipo !== "wall") continue;
    const x1 = pxToM(elemento.props?.x1 ?? 0, ppm);
    const y1 = pxToM(elemento.props?.y1 ?? 0, ppm);
    const x2 = pxToM(elemento.props?.x2 ?? 0, ppm);
    const y2 = pxToM(elemento.props?.y2 ?? 0, ppm);
    if (![x1, y1, x2, y2].every((v) => Number.isFinite(v))) continue;
    // Pared de longitud cero: no se ve ni se puede chocar con ella de forma
    // significativa, y como obstáculo puntual solo serviría para bloquear
    // huecos sin motivo visible.
    if (x1 === x2 && y1 === y2) continue;
    const espesorRaw = elemento.props?.espesor;
    paredes.push({
      x1,
      y1,
      x2,
      y2,
      espesor: Number.isFinite(espesorRaw) ? Math.max(0, espesorRaw as number) : ESPESOR_PARED_M,
    });
  }
  return paredes;
}

export interface OpcionesRejillaMesas {
  /** Cuántas mesas hay que colocar. */
  cantidad: number;
  /** Ancho de cada mesa en CENTÍMETROS (como en `mesas.ancho`). */
  anchoCm: number;
  /** Alto/largo de cada mesa en CENTÍMETROS (como en `mesas.alto`). */
  altoCm: number;
  /** Dimensiones del espacio en METROS (las del editor: `realDimensions`). */
  espacio: { width: number; height: number };
  /** Separación entre mesas en metros (se reduce sola si no caben). */
  separacion?: number;
  /** Margen respecto al borde del plano, en metros. */
  margen?: number;
  /**
   * Trozos del plano que YA están ocupados, en METROS: las mesas que el dueño
   * ya ha colocado (`rectanguloDeMesa`). Los huecos de la rejilla que caigan
   * encima se saltan, así un segundo lote no aterriza sobre el primero.
   *
   * Es deliberadamente una lista de rectángulos y no "las mesas". Las paredes
   * NO van aquí: un muro en diagonal tiene una caja envolvente enorme que
   * taparía media sala, así que van aparte en `paredes` como segmentos con
   * espesor.
   */
  ocupadas?: readonly RectanguloOcupado[];
  /** Aire mínimo, en metros, entre una mesa nueva y algo ya ocupado. */
  holgura?: number;
  /**
   * Paredes dibujadas en el plano, en METROS (`paredesDesdeElementos`). Los
   * huecos de la rejilla que pisen el trazo de un muro se saltan: antes la
   * rejilla solo miraba las otras mesas y plantaba mesas ATRAVESANDO las
   * paredes (una mesa a caballo entre el comedor y la calle).
   */
  paredes?: readonly ParedObstaculo[];
  /** Aire mínimo, en metros, entre una mesa nueva y el trazo de una pared.
   *  Pequeño a propósito: en una sala real las mesas van pegadas al muro. */
  holguraParedes?: number;
  /**
   * `true`: las mesas que no encuentren un hueco libre NO se colocan —
   * `posiciones` devuelve menos de `cantidad` y `sinSitio` dice cuántas se han
   * quedado fuera, para que el llamador lo cuente en su resumen en vez de
   * apilarlas mal. `false` (por defecto): comportamiento de siempre, se apilan
   * sobre la rejilla y solo se marca `desborda`.
   */
  omitirSinSitio?: boolean;
}

export interface RejillaMesas {
  /** Esquina superior izquierda de cada mesa, en METROS (como `mesas.pos_x/pos_y`). */
  posiciones: Punto[];
  /** Columnas que ha usado la rejilla. */
  columnas: number;
  /** Filas que ha usado la rejilla (las que ocuparían las mesas sin esquivar nada). */
  filas: number;
  /** `true` si no caben todas dentro del plano sin solaparse (el dueño tendrá que recolocar). */
  desborda: boolean;
  /** `true` si se ha saltado algún hueco por estar ocupado por otra mesa. */
  esquivoOcupadas: boolean;
  /** `true` si se ha saltado algún hueco por pisar el trazo de una pared. */
  esquivoParedes: boolean;
  /** Cuántas mesas se han quedado SIN colocar (siempre 0 salvo `omitirSinSitio`). */
  sinSitio: number;
}

/**
 * Coloca `cantidad` mesas en una rejilla sencilla dentro del plano.
 *
 * Existe para el alta en lote del panel lateral: `handleAddMesa` (alta de una
 * en una) metía todas las mesas en `pos_x: 1, pos_y: 1`, así que dar de alta 12
 * seguidas las apilaba una encima de otra y había que separarlas a mano antes
 * de poder distinguirlas. Las posiciones se recortan para no salirse del
 * plano; si ni reduciendo la separación caben todas, `desborda` avisa de que
 * quedarán solapadas y habrá que arrastrarlas.
 *
 * Con `ocupadas` (las mesas que ya están colocadas) la rejilla SALTA los huecos
 * pisados: antes, el segundo lote de una sala empezaba otra vez en (0,3 · 0,3)
 * y caía justo encima del primero. Con `paredes` salta además los huecos que
 * pisan el trazo de un muro (ver `rectanguloChocaConPared`): antes la rejilla
 * esquivaba las otras mesas pero ATRAVESABA las paredes tan tranquila. Sin
 * `ocupadas` ni `paredes` el resultado es exactamente el de siempre, para no
 * cambiarle el sitio a nadie.
 */
export function calcularRejillaMesas(opts: OpcionesRejillaMesas): RejillaMesas {
  const cantidad = Math.max(0, Math.floor(opts.cantidad || 0));
  if (cantidad === 0) {
    return {
      posiciones: [],
      columnas: 0,
      filas: 0,
      desborda: false,
      esquivoOcupadas: false,
      esquivoParedes: false,
      sinSitio: 0,
    };
  }

  const anchoM = Math.max(0.1, (opts.anchoCm || 80) / 100);
  const altoM = Math.max(0.1, (opts.altoCm || 80) / 100);
  const margen = opts.margen ?? 0.3;
  const anchoPlano = Math.max(anchoM, opts.espacio?.width || anchoM);
  const altoPlano = Math.max(altoM, opts.espacio?.height || altoM);

  const utilAncho = Math.max(anchoM, anchoPlano - margen * 2);
  const utilAlto = Math.max(altoM, altoPlano - margen * 2);

  const disponer = (separacion: number) => {
    const columnas = Math.max(1, Math.floor((utilAncho + separacion) / (anchoM + separacion)));
    const filas = Math.ceil(cantidad / columnas);
    const altoNecesario = filas * altoM + (filas - 1) * separacion;
    return { columnas, filas, separacion, cabe: altoNecesario <= utilAlto };
  };

  // Primero con la separación pedida; si no caben en alto, se aprieta la
  // rejilla antes de darse por vencido.
  let disposicion = disponer(opts.separacion ?? 0.3);
  if (!disposicion.cabe) {
    const apretada = disponer(0.1);
    if (apretada.cabe || apretada.columnas > disposicion.columnas) disposicion = apretada;
  }

  const { columnas, filas, separacion } = disposicion;
  const maxX = Math.max(0, anchoPlano - anchoM);
  const maxY = Math.max(0, altoPlano - altoM);

  /** Esquina superior izquierda del hueco `indice` de la rejilla, ya recortada
   *  al plano y redondeada a centímetros. */
  const hueco = (indice: number): Punto => {
    const col = indice % columnas;
    const fila = Math.floor(indice / columnas);
    const x = margen + col * (anchoM + separacion);
    const y = margen + fila * (altoM + separacion);
    return {
      x: Math.round(Math.min(Math.max(0, x), maxX) * 100) / 100,
      y: Math.round(Math.min(Math.max(0, y), maxY) * 100) / 100,
    };
  };

  const ocupadas = (opts.ocupadas ?? []).filter(
    (r) =>
      !!r &&
      Number.isFinite(r.x) &&
      Number.isFinite(r.y) &&
      Number.isFinite(r.width) &&
      Number.isFinite(r.height) &&
      r.width > 0 &&
      r.height > 0,
  );

  const paredes = (opts.paredes ?? []).filter(
    (p) =>
      !!p &&
      Number.isFinite(p.x1) &&
      Number.isFinite(p.y1) &&
      Number.isFinite(p.x2) &&
      Number.isFinite(p.y2),
  );

  const omitirSinSitio = opts.omitirSinSitio === true;

  // Sin nada que esquivar (y sin que importe la capacidad real del plano): el
  // comportamiento de toda la vida, hueco a hueco.
  if (ocupadas.length === 0 && paredes.length === 0 && !omitirSinSitio) {
    const posiciones: Punto[] = [];
    for (let i = 0; i < cantidad; i += 1) posiciones.push(hueco(i));
    return {
      posiciones,
      columnas,
      filas,
      desborda: !disposicion.cabe,
      esquivoOcupadas: false,
      esquivoParedes: false,
      sinSitio: 0,
    };
  }

  // Con mesas ya colocadas (o paredes que esquivar) hay que mirar MÁS huecos
  // que mesas por colocar, así que se recorre la rejilla entera del plano (no
  // solo las `filas` que ocuparían las mesas nuevas si estuviera vacío).
  // Filas que de verdad CABEN en el plano (siempre >= 1, porque `utilAlto`
  // nunca baja de `altoM`).
  const filasQueCaben = Math.floor((utilAlto + separacion) / (altoM + separacion));
  // Con `omitirSinSitio` la capacidad del plano es la que es. En el camino
  // clásico se infla (hasta `filas`/`cantidad`) para poder seguir devolviendo
  // una posición por mesa y apilar las que sobran sobre la rejilla; aquí eso
  // haría que nunca se llegase a declarar "no cabe".
  const filasDelPlano = omitirSinSitio ? filasQueCaben : Math.max(filas, filasQueCaben);
  const huecosDelPlano = omitirSinSitio
    ? columnas * filasDelPlano
    : Math.max(cantidad, columnas * filasDelPlano);
  const holgura = Math.max(0, opts.holgura ?? 0.05);
  const holguraParedes = Math.max(0, opts.holguraParedes ?? 0.05);

  const posiciones: Punto[] = [];
  let esquivoOcupadas = false;
  let esquivoParedes = false;
  let desborda = !disposicion.cabe;
  let sinSitio = 0;
  let indice = 0;

  while (posiciones.length < cantidad) {
    const esHuecoReal = indice < huecosDelPlano;

    if (!esHuecoReal && omitirSinSitio) {
      // Se ha recorrido la rejilla entera del plano y no queda ni un hueco
      // libre: mejor NO colocar (y que el llamador lo diga en su resumen) que
      // dejar mesas encima de otras o partidas por un muro.
      sinSitio = cantidad - posiciones.length;
      desborda = true;
      break;
    }

    const punto = hueco(indice);
    indice += 1;

    if (esHuecoReal) {
      const rect: RectanguloOcupado = { x: punto.x, y: punto.y, width: anchoM, height: altoM };
      if (ocupadas.some((o) => rectangulosSolapan(rect, o, holgura))) {
        esquivoOcupadas = true;
        continue;
      }
      if (paredes.some((p) => rectanguloChocaConPared(rect, p, holguraParedes))) {
        esquivoParedes = true;
        continue;
      }
    } else {
      // Se han acabado los huecos libres del plano: las que quedan se apilan
      // sobre la rejilla y el dueño tendrá que arrastrarlas.
      desborda = true;
    }

    posiciones.push(punto);
  }

  return { posiciones, columnas, filas, desborda, esquivoOcupadas, esquivoParedes, sinSitio };
}
