import { describe, it, expect } from "vitest";
import {
  transformarPunto,
  calcularPuntosAbsolutosPared,
  calcularGeometriaRect,
  planRepuntarAsignaciones,
  esMesaTemporal,
  esMesaGrupoNueva,
  esMesaNoPersistida,
  snapPointToGrid,
  snapWallAngle,
  snapToWallEndpoint,
  detectarPoligonoCerrado,
  areaShoelace,
  bboxPoligono,
  snapRotationDeg,
  distribuirSillasRectangular,
  distribuirSillasCirculo,
  calcularRejillaMesas,
  rectanguloDeMesa,
  rectangulosSolapan,
  normalizarDimensionesEspacio,
  mesasFueraDelPlano,
  paredesDesdeElementos,
  rectanguloChocaConPared,
  distanciaSegmentoRectangulo,
  distanciaSegmentoSegmento,
  segmentosSeCortan,
  ESPESOR_PARED_M,
  MAX_LADO_ESPACIO_M,
  MIN_LADO_ESPACIO_M,
  PIXELS_PER_METER,
  type Matrix2D,
  type ParedObstaculo,
  type RectanguloOcupado,
} from "../planoUtils";

describe("transformarPunto", () => {
  it("aplica la identidad sin cambios", () => {
    const identidad: Matrix2D = [1, 0, 0, 1, 0, 0];
    expect(transformarPunto({ x: 10, y: 20 }, identidad)).toEqual({ x: 10, y: 20 });
  });

  it("aplica una traslación", () => {
    const traslacion: Matrix2D = [1, 0, 0, 1, 50, -30];
    expect(transformarPunto({ x: 10, y: 20 }, traslacion)).toEqual({ x: 60, y: -10 });
  });

  it("aplica escala", () => {
    const escala: Matrix2D = [2, 0, 0, 3, 0, 0];
    expect(transformarPunto({ x: 5, y: 5 }, escala)).toEqual({ x: 10, y: 15 });
  });

  it("aplica una rotación de 90 grados", () => {
    // cos(90)=0, sin(90)=1 -> matriz [0, 1, -1, 0, 0, 0]
    const rot90: Matrix2D = [0, 1, -1, 0, 0, 0];
    const resultado = transformarPunto({ x: 10, y: 0 }, rot90);
    expect(resultado.x).toBeCloseTo(0);
    expect(resultado.y).toBeCloseTo(10);
  });
});

describe("calcularPuntosAbsolutosPared", () => {
  it("traslada los dos extremos de la pared con la matriz del objeto", () => {
    const matriz: Matrix2D = [1, 0, 0, 1, 100, 200];
    const puntosLocales = { x1: -25, y1: 0, x2: 25, y2: 0 };
    expect(calcularPuntosAbsolutosPared(matriz, puntosLocales)).toEqual({
      x1: 75,
      y1: 200,
      x2: 125,
      y2: 200,
    });
  });

  it("preserva coordenada 0 (no la confunde con 'sin valor')", () => {
    const identidad: Matrix2D = [1, 0, 0, 1, 0, 0];
    const puntosLocales = { x1: 0, y1: 0, x2: 40, y2: 0 };
    expect(calcularPuntosAbsolutosPared(identidad, puntosLocales)).toEqual({
      x1: 0,
      y1: 0,
      x2: 40,
      y2: 0,
    });
  });
});

describe("calcularGeometriaRect", () => {
  it("hornea la escala en el ancho/alto", () => {
    const resultado = calcularGeometriaRect({ left: 10, top: 20, width: 100, height: 50, scaleX: 1.5, scaleY: 2, angle: 0 });
    expect(resultado).toEqual({ left: 10, top: 20, width: 150, height: 100, angle: 0 });
  });

  it("usa 1 como escala por defecto si no viene definida", () => {
    const resultado = calcularGeometriaRect({ left: 5, top: 5, width: 60, height: 12 });
    expect(resultado).toEqual({ left: 5, top: 5, width: 60, height: 12, angle: 0 });
  });

  it("no pierde left/top en 0 (bug de usar || en vez de ??)", () => {
    const resultado = calcularGeometriaRect({ left: 0, top: 0, width: 60, height: 12, scaleX: 1, scaleY: 1 });
    expect(resultado.left).toBe(0);
    expect(resultado.top).toBe(0);
  });
});

describe("planRepuntarAsignaciones", () => {
  it("actualiza las asignaciones que no chocan con destino", () => {
    const origen = [
      { id: "a1", reserva_id: "r1", mesa_id: "m-origen" },
      { id: "a2", reserva_id: "r2", mesa_id: "m-origen" },
    ];
    const { aActualizar, aEliminar } = planRepuntarAsignaciones(origen, new Set());
    expect(aActualizar.sort()).toEqual(["a1", "a2"]);
    expect(aEliminar).toEqual([]);
  });

  it("elimina (no actualiza) las que duplicarían el UNIQUE(reserva_id, mesa_id) en destino", () => {
    const origen = [
      { id: "a1", reserva_id: "r1", mesa_id: "m-origen" },
      { id: "a2", reserva_id: "r2", mesa_id: "m-origen" },
    ];
    // r1 ya está asignada a la mesa destino -> repuntar a1 violaría el UNIQUE
    const { aActualizar, aEliminar } = planRepuntarAsignaciones(origen, new Set(["r1"]));
    expect(aActualizar).toEqual(["a2"]);
    expect(aEliminar).toEqual(["a1"]);
  });

  it("con lista de origen vacía no hace nada", () => {
    const { aActualizar, aEliminar } = planRepuntarAsignaciones([], new Set(["r1"]));
    expect(aActualizar).toEqual([]);
    expect(aEliminar).toEqual([]);
  });
});

describe("identificadores de mesa no persistida", () => {
  it("reconoce mesas temporales (mesa-temp-)", () => {
    expect(esMesaTemporal("mesa-temp-12345-0")).toBe(true);
    expect(esMesaTemporal("mesa-grupo-12345")).toBe(false);
    expect(esMesaTemporal("a1b2c3d4-real-uuid")).toBe(false);
  });

  it("reconoce mesas de grupo nuevas (mesa-grupo-)", () => {
    expect(esMesaGrupoNueva("mesa-grupo-99999")).toBe(true);
    expect(esMesaGrupoNueva("mesa-temp-99999")).toBe(false);
  });

  it("esMesaNoPersistida cubre ambos casos", () => {
    expect(esMesaNoPersistida("mesa-temp-1")).toBe(true);
    expect(esMesaNoPersistida("mesa-grupo-1")).toBe(true);
    expect(esMesaNoPersistida("a1b2c3d4-real-uuid")).toBe(false);
  });
});

describe("snapPointToGrid", () => {
  it("redondea a la rejilla de 10cm (a 50px/m -> 5px)", () => {
    expect(snapPointToGrid({ x: 23, y: 48 }, 50)).toEqual({ x: 25, y: 50 });
  });

  it("no cambia un punto ya alineado", () => {
    expect(snapPointToGrid({ x: 100, y: 150 }, 50)).toEqual({ x: 100, y: 150 });
  });
});

describe("snapWallAngle", () => {
  it("ajusta a 0° un trazo casi horizontal", () => {
    const resultado = snapWallAngle({ x: 0, y: 0 }, { x: 100, y: 4 }, false);
    expect(resultado.y).toBeCloseTo(0, 5);
    expect(resultado.x).toBeCloseTo(Math.hypot(100, 4), 1);
  });

  it("ajusta a 90° un trazo casi vertical", () => {
    const resultado = snapWallAngle({ x: 0, y: 0 }, { x: 3, y: 100 }, false);
    expect(resultado.x).toBeCloseTo(0, 5);
    expect(resultado.y).toBeCloseTo(Math.hypot(3, 100), 1);
  });

  it("con freeform=true (Shift) no ajusta nada", () => {
    const punto = { x: 97, y: 13 };
    expect(snapWallAngle({ x: 0, y: 0 }, punto, true)).toEqual(punto);
  });

  it("conserva la longitud real tras el ajuste", () => {
    const anchor = { x: 10, y: 10 };
    const punto = { x: 10 + 70.7, y: 10 + 70.7 }; // ~45°
    const resultado = snapWallAngle(anchor, punto, false);
    const longitudOriginal = Math.hypot(punto.x - anchor.x, punto.y - anchor.y);
    const longitudAjustada = Math.hypot(resultado.x - anchor.x, resultado.y - anchor.y);
    expect(longitudAjustada).toBeCloseTo(longitudOriginal, 3);
  });
});

describe("snapToWallEndpoint", () => {
  const paredes = [
    { x1: 0, y1: 0, x2: 100, y2: 0 },
    { x1: 100, y1: 0, x2: 100, y2: 100 },
  ];

  it("encuentra el extremo más cercano dentro del umbral", () => {
    expect(snapToWallEndpoint({ x: 103, y: 2 }, paredes, 10)).toEqual({ x: 100, y: 0 });
  });

  it("devuelve null si no hay ningún extremo dentro del umbral", () => {
    expect(snapToWallEndpoint({ x: 50, y: 50 }, paredes, 10)).toBeNull();
  });
});

describe("detectarPoligonoCerrado + areaShoelace + bboxPoligono", () => {
  it("detecta un cuadrado cerrado formado por 4 paredes en cualquier orden", () => {
    // Cuadrado de 100x100, con las paredes desordenadas y algunas invertidas
    const paredes = [
      { x1: 100, y1: 0, x2: 100, y2: 100 }, // derecha
      { x1: 0, y1: 0, x2: 100, y2: 0 }, // arriba
      { x1: 100, y1: 100, x2: 0, y2: 100 }, // abajo (invertida)
      { x1: 0, y1: 100, x2: 0, y2: 0 }, // izquierda (invertida)
    ];
    const vertices = detectarPoligonoCerrado(paredes);
    expect(vertices).not.toBeNull();
    expect(vertices).toHaveLength(4);

    const area = areaShoelace(vertices!);
    expect(area).toBeCloseTo(10000, 1);

    const bbox = bboxPoligono(vertices!);
    expect(bbox).toEqual({ width: 100, height: 100 });
  });

  it("tolera pequeños huecos entre extremos (< tolerance)", () => {
    const paredes = [
      { x1: 0, y1: 0, x2: 100, y2: 0 },
      { x1: 100, y1: 0, x2: 100, y2: 100 },
      { x1: 100, y1: 100, x2: 0, y2: 102 }, // 2px de hueco, dentro de tolerance=5
      { x1: 0, y1: 98, x2: 0, y2: 0 },
    ];
    expect(detectarPoligonoCerrado(paredes, 5)).not.toBeNull();
  });

  it("devuelve null si las paredes no cierran un lazo", () => {
    const paredes = [
      { x1: 0, y1: 0, x2: 100, y2: 0 },
      { x1: 100, y1: 0, x2: 100, y2: 100 },
      // Falta cerrar el resto del polígono
    ];
    expect(detectarPoligonoCerrado(paredes)).toBeNull();
  });

  it("devuelve null si hay menos de 3 paredes", () => {
    expect(detectarPoligonoCerrado([{ x1: 0, y1: 0, x2: 10, y2: 0 }])).toBeNull();
  });

  it("detecta el mismo cuadrado sea cual sea el orden/dirección de dibujo de las paredes", () => {
    // Mismo cuadrado 100x100 que el primer test, pero con las paredes en un
    // orden totalmente distinto y direcciones mezcladas (simula al usuario
    // dibujando los 4 lados en cualquier secuencia, algunos "al revés").
    const paredes = [
      { x1: 0, y1: 100, x2: 0, y2: 0 }, // izquierda (invertida)
      { x1: 100, y1: 100, x2: 100, y2: 0 }, // derecha (invertida)
      { x1: 0, y1: 0, x2: 100, y2: 0 }, // arriba
      { x1: 0, y1: 100, x2: 100, y2: 100 }, // abajo
    ];
    const vertices = detectarPoligonoCerrado(paredes);
    expect(vertices).not.toBeNull();
    expect(vertices).toHaveLength(4);
    expect(areaShoelace(vertices!)).toBeCloseTo(10000, 1);
  });

  it("con una partición interior (T-junction) devuelve el contorno EXTERIOR, no la mitad", () => {
    // Cuadrado 100x100 partido en dos por un muro interior en x=50 — el muro
    // superior e inferior quedan divididos en dos segmentos cada uno (así se
    // forma el T-junction en el grafo: comparten nodo con la partición).
    const paredes = [
      { x1: 0, y1: 0, x2: 50, y2: 0 }, // arriba-izq
      { x1: 50, y1: 0, x2: 100, y2: 0 }, // arriba-der
      { x1: 100, y1: 0, x2: 100, y2: 100 }, // derecha
      { x1: 100, y1: 100, x2: 50, y2: 100 }, // abajo-der
      { x1: 50, y1: 100, x2: 0, y2: 100 }, // abajo-izq
      { x1: 0, y1: 100, x2: 0, y2: 0 }, // izquierda
      { x1: 50, y1: 0, x2: 50, y2: 100 }, // partición interior
    ];
    const vertices = detectarPoligonoCerrado(paredes);
    expect(vertices).not.toBeNull();
    // El contorno exterior tiene 6 vértices (incluye los dos T-junctions);
    // el greedy anterior habría podido devolver una de las mitades (50x100).
    expect(vertices).toHaveLength(6);
    expect(areaShoelace(vertices!)).toBeCloseTo(10000, 1); // área completa, no 5000
  });

  it("ignora un muro suelto (dangling) que cuelga de una esquina", () => {
    const paredes = [
      { x1: 0, y1: 0, x2: 100, y2: 0 },
      { x1: 100, y1: 0, x2: 100, y2: 100 },
      { x1: 100, y1: 100, x2: 0, y2: 100 },
      { x1: 0, y1: 100, x2: 0, y2: 0 },
      { x1: 0, y1: 0, x2: 0, y2: -50 }, // pared suelta que no cierra nada
    ];
    const vertices = detectarPoligonoCerrado(paredes);
    expect(vertices).not.toBeNull();
    expect(vertices).toHaveLength(4);
    expect(areaShoelace(vertices!)).toBeCloseTo(10000, 1);
  });

  it("detecta una sala en forma de L", () => {
    const paredes = [
      { x1: 0, y1: 0, x2: 150, y2: 0 },
      { x1: 150, y1: 0, x2: 150, y2: 50 },
      { x1: 150, y1: 50, x2: 50, y2: 50 },
      { x1: 50, y1: 50, x2: 50, y2: 100 },
      { x1: 50, y1: 100, x2: 0, y2: 100 },
      { x1: 0, y1: 100, x2: 0, y2: 0 },
    ];
    const vertices = detectarPoligonoCerrado(paredes);
    expect(vertices).not.toBeNull();
    expect(vertices).toHaveLength(6);
    expect(areaShoelace(vertices!)).toBeCloseTo(10000, 1);
    expect(bboxPoligono(vertices!)).toEqual({ width: 150, height: 100 });
  });

  it("devuelve null con una polilínea abierta (sin ningún ciclo)", () => {
    const paredes = [
      { x1: 0, y1: 0, x2: 100, y2: 0 },
      { x1: 100, y1: 0, x2: 100, y2: 100 },
      { x1: 100, y1: 100, x2: 200, y2: 100 }, // se aleja en vez de cerrar
    ];
    expect(detectarPoligonoCerrado(paredes)).toBeNull();
  });

  it("con dos salas separadas (sin conexión entre sí) devuelve la de mayor área", () => {
    const salaGrande = [
      { x1: 0, y1: 0, x2: 100, y2: 0 },
      { x1: 100, y1: 0, x2: 100, y2: 100 },
      { x1: 100, y1: 100, x2: 0, y2: 100 },
      { x1: 0, y1: 100, x2: 0, y2: 0 },
    ];
    const salaChica = [
      { x1: 500, y1: 500, x2: 550, y2: 500 },
      { x1: 550, y1: 500, x2: 550, y2: 550 },
      { x1: 550, y1: 550, x2: 500, y2: 550 },
      { x1: 500, y1: 550, x2: 500, y2: 500 },
    ];
    const vertices = detectarPoligonoCerrado([...salaChica, ...salaGrande]);
    expect(vertices).not.toBeNull();
    expect(vertices).toHaveLength(4);
    expect(areaShoelace(vertices!)).toBeCloseTo(10000, 1); // la grande (100x100), no la chica (2500)
  });
});

describe("snapRotationDeg", () => {
  it("redondea al múltiplo de 15° más cercano", () => {
    expect(snapRotationDeg(37)).toBe(30);
    expect(snapRotationDeg(38)).toBe(45);
    expect(snapRotationDeg(-7)).toBe(-0);
  });
});

describe("distribuirSillasRectangular", () => {
  it("devuelve tantas sillas como la capacidad para una mesa de 4", () => {
    const sillas = distribuirSillasRectangular(4, 120, 80);
    expect(sillas).toHaveLength(4);
  });

  it("prioriza los lados largos: para una mesa muy alargada de 2, van en los lados largos", () => {
    const sillas = distribuirSillasRectangular(2, 200, 80);
    expect(sillas).toHaveLength(2);
    // Ambas sillas deben estar en los lados largos (y = ±mitad del corto + margen)
    sillas.forEach((s) => {
      expect(Math.abs(s.y)).toBeGreaterThan(0);
      expect(Math.abs(s.x)).toBeLessThan(100); // dentro del rango del lado largo
    });
  });

  it("no revienta con capacidad 0 o dimensiones inválidas", () => {
    expect(distribuirSillasRectangular(0, 80, 80)).toEqual([]);
    expect(distribuirSillasRectangular(4, 0, 80)).toEqual([]);
  });
});

describe("distribuirSillasCirculo", () => {
  it("reparte las sillas a la misma distancia del centro", () => {
    const sillas = distribuirSillasCirculo(6, 150);
    expect(sillas).toHaveLength(6);
    const radioEsperado = 150 / 2 + 14;
    sillas.forEach((s) => {
      expect(Math.hypot(s.x, s.y)).toBeCloseTo(radioEsperado, 5);
    });
  });

  it("no revienta con capacidad 0", () => {
    expect(distribuirSillasCirculo(0, 150)).toEqual([]);
  });
});

describe("calcularRejillaMesas", () => {
  const espacio = { width: 12, height: 8 };

  it("sin mesas no devuelve posiciones", () => {
    const r = calcularRejillaMesas({ cantidad: 0, anchoCm: 80, altoCm: 80, espacio });
    expect(r.posiciones).toEqual([]);
    expect(r.desborda).toBe(false);
  });

  it("devuelve una posición por mesa y ninguna repetida (nada de apilarlas en 1,1)", () => {
    const r = calcularRejillaMesas({ cantidad: 12, anchoCm: 80, altoCm: 80, espacio });
    expect(r.posiciones).toHaveLength(12);
    const claves = new Set(r.posiciones.map((p) => `${p.x},${p.y}`));
    expect(claves.size).toBe(12);
    expect(r.desborda).toBe(false);
  });

  it("llena por filas: la segunda fila baja y vuelve a empezar por la izquierda", () => {
    const r = calcularRejillaMesas({
      cantidad: 4,
      anchoCm: 100,
      altoCm: 100,
      espacio: { width: 4, height: 6 },
      separacion: 0.5,
      margen: 0.5,
    });
    // 3m de ancho útil con mesas de 1m y 0,5m de hueco => 2 columnas
    // (3 mesas necesitarían 1+0,5+1+0,5+1 = 4m).
    expect(r.columnas).toBe(2);
    expect(r.posiciones[0]).toEqual({ x: 0.5, y: 0.5 });
    expect(r.posiciones[1]).toEqual({ x: 2, y: 0.5 });
    expect(r.posiciones[2]).toEqual({ x: 0.5, y: 2 });
    expect(r.posiciones[3]).toEqual({ x: 2, y: 2 });
  });

  it("ninguna mesa se sale del plano", () => {
    const r = calcularRejillaMesas({ cantidad: 40, anchoCm: 150, altoCm: 150, espacio });
    r.posiciones.forEach((p) => {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(espacio.width - 1.5);
      expect(p.y).toBeLessThanOrEqual(espacio.height - 1.5);
    });
  });

  it("avisa con desborda cuando no caben todas sin solaparse", () => {
    const r = calcularRejillaMesas({
      cantidad: 20,
      anchoCm: 200,
      altoCm: 200,
      espacio: { width: 4, height: 4 },
    });
    expect(r.posiciones).toHaveLength(20);
    expect(r.desborda).toBe(true);
  });

  it("aprieta la separación antes de darse por vencido", () => {
    // 6 mesas de 1x1 en 3,6 x 3,6 (3,2 útiles): con 0,3 de hueco salen 2
    // columnas y 3 filas que no caben en alto; apretando a 0,1 caben 3
    // columnas en 2 filas y sí cabe.
    const r = calcularRejillaMesas({
      cantidad: 6,
      anchoCm: 100,
      altoCm: 100,
      espacio: { width: 3.6, height: 3.6 },
      margen: 0.2,
    });
    expect(r.desborda).toBe(false);
    expect(r.columnas).toBe(3);
    expect(r.filas).toBe(2);
  });

  it("nunca baja de una columna aunque la mesa sea más ancha que el plano", () => {
    const r = calcularRejillaMesas({
      cantidad: 2,
      anchoCm: 300,
      altoCm: 100,
      espacio: { width: 1, height: 1 },
    });
    expect(r.columnas).toBe(1);
    expect(r.posiciones).toHaveLength(2);
  });

  it("sin mesas ya colocadas no dice que haya esquivado nada", () => {
    const r = calcularRejillaMesas({ cantidad: 3, anchoCm: 80, altoCm: 80, espacio });
    expect(r.esquivoOcupadas).toBe(false);
  });
});

describe("rectangulosSolapan / rectanguloDeMesa", () => {
  const a: RectanguloOcupado = { x: 0, y: 0, width: 1, height: 1 };

  it("detecta el solape", () => {
    expect(rectangulosSolapan(a, { x: 0.5, y: 0.5, width: 1, height: 1 })).toBe(true);
  });

  it("dos rectángulos separados no se pisan", () => {
    expect(rectangulosSolapan(a, { x: 2, y: 2, width: 1, height: 1 })).toBe(false);
  });

  it("tocarse justo por el borde no cuenta como pisarse", () => {
    expect(rectangulosSolapan(a, { x: 1, y: 0, width: 1, height: 1 })).toBe(false);
  });

  it("con holgura sí cuenta: hay que dejar aire entre mesas", () => {
    expect(rectangulosSolapan(a, { x: 1, y: 0, width: 1, height: 1 }, 0.05)).toBe(true);
  });

  it("no revienta con nulos", () => {
    expect(rectangulosSolapan(a, null as unknown as RectanguloOcupado)).toBe(false);
  });

  it("convierte una mesa del canvas (cm) a su rectángulo en metros", () => {
    expect(rectanguloDeMesa({ posX: 1.5, posY: 2, ancho: 120, alto: 80 })).toEqual({
      x: 1.5,
      y: 2,
      width: 1.2,
      height: 0.8,
    });
  });

  it("una mesa pegada al borde (0,0) conserva su posición", () => {
    expect(rectanguloDeMesa({ posX: 0, posY: 0, ancho: 150, alto: 150 })).toEqual({
      x: 0,
      y: 0,
      width: 1.5,
      height: 1.5,
    });
  });
});

// El segundo lote de una sala empezaba otra vez en (0,3 · 0,3) y caía encima
// del primero: había que separar 20 mesas a mano antes de poder ver el plano.
describe("calcularRejillaMesas con mesas ya colocadas", () => {
  const espacio = { width: 12, height: 8 };
  const opcionesBase = { anchoCm: 100, altoCm: 100, espacio, separacion: 0.5, margen: 0.5 };

  it("no coloca ninguna mesa encima de una que ya estaba", () => {
    const ocupadas: RectanguloOcupado[] = [
      { x: 0.5, y: 0.5, width: 1, height: 1 },
      { x: 2, y: 0.5, width: 1, height: 1 },
    ];
    const r = calcularRejillaMesas({ ...opcionesBase, cantidad: 3, ocupadas });
    expect(r.posiciones).toHaveLength(3);
    expect(r.esquivoOcupadas).toBe(true);
    r.posiciones.forEach((p) => {
      ocupadas.forEach((o) => {
        expect(rectangulosSolapan({ x: p.x, y: p.y, width: 1, height: 1 }, o)).toBe(false);
      });
    });
  });

  it("empieza justo en el primer hueco libre, sin dejar agujeros de más", () => {
    const r = calcularRejillaMesas({
      ...opcionesBase,
      cantidad: 1,
      ocupadas: [{ x: 0.5, y: 0.5, width: 1, height: 1 }],
    });
    // El primer hueco (0,5 · 0,5) está pillado: va al segundo de la fila.
    expect(r.posiciones[0]).toEqual({ x: 2, y: 0.5 });
  });

  it("las mesas del propio lote tampoco se pisan entre ellas", () => {
    const r = calcularRejillaMesas({
      ...opcionesBase,
      cantidad: 6,
      ocupadas: [{ x: 0.5, y: 0.5, width: 1, height: 1 }],
    });
    const claves = new Set(r.posiciones.map((p) => `${p.x},${p.y}`));
    expect(claves.size).toBe(6);
  });

  it("si el plano está lleno avisa con desborda en vez de colgarse", () => {
    const r = calcularRejillaMesas({
      cantidad: 4,
      anchoCm: 100,
      altoCm: 100,
      espacio: { width: 3.6, height: 3.6 },
      margen: 0.2,
      // Tapa el plano entero: no queda un solo hueco libre.
      ocupadas: [{ x: 0, y: 0, width: 4, height: 4 }],
    });
    expect(r.posiciones).toHaveLength(4);
    expect(r.desborda).toBe(true);
    expect(r.esquivoOcupadas).toBe(true);
  });

  it("deja aire entre la mesa nueva y la ya colocada (holgura)", () => {
    const r = calcularRejillaMesas({
      cantidad: 1,
      anchoCm: 100,
      altoCm: 100,
      espacio,
      separacion: 0,
      margen: 0.5,
      holgura: 0.3,
      // Ocupa hasta x = 1,5: sin holgura la siguiente cabría pegada en 1,5.
      ocupadas: [{ x: 0.5, y: 0.5, width: 1, height: 1 }],
    });
    expect(r.posiciones[0].x).toBeGreaterThanOrEqual(1.8);
  });

  it("ignora rectángulos basura en vez de descolocarlo todo", () => {
    const sinBasura = calcularRejillaMesas({ ...opcionesBase, cantidad: 2 });
    const conBasura = calcularRejillaMesas({
      ...opcionesBase,
      cantidad: 2,
      ocupadas: [
        { x: Number.NaN, y: 0, width: 1, height: 1 },
        { x: 0, y: 0, width: 0, height: 0 },
        null as unknown as RectanguloOcupado,
      ],
    });
    expect(conBasura.posiciones).toEqual(sinBasura.posiciones);
    expect(conBasura.esquivoOcupadas).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Dimensiones del espacio (las que fija la herramienta "Sala rectangular")
// ---------------------------------------------------------------------------

describe("normalizarDimensionesEspacio", () => {
  it("acepta medidas normales y las redondea a centímetros", () => {
    const r = normalizarDimensionesEspacio(9.004, 5.126);
    expect(r.ok).toBe(true);
    expect(r.dimensiones).toEqual({ width: 9, height: 5.13 });
  });

  it("rechaza 0 y negativos (un clic suelto, un arrastre invertido)", () => {
    expect(normalizarDimensionesEspacio(0, 5).ok).toBe(false);
    expect(normalizarDimensionesEspacio(5, 0).ok).toBe(false);
    expect(normalizarDimensionesEspacio(-9, 5).ok).toBe(false);
    expect(normalizarDimensionesEspacio(0, 0).motivo).toMatch(/0 m/);
  });

  it("rechaza NaN e Infinity (pixelsPerMeter a 0 al dividir)", () => {
    expect(normalizarDimensionesEspacio(Number.NaN, 5).ok).toBe(false);
    expect(normalizarDimensionesEspacio(5, Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(normalizarDimensionesEspacio(Number.NaN, 5).motivo).toMatch(/número válido/);
  });

  it("rechaza salas absurdamente pequeñas o gigantes", () => {
    expect(normalizarDimensionesEspacio(MIN_LADO_ESPACIO_M - 0.01, 5).ok).toBe(false);
    expect(normalizarDimensionesEspacio(5, MAX_LADO_ESPACIO_M + 1).ok).toBe(false);
    // Los propios límites sí valen.
    expect(normalizarDimensionesEspacio(MIN_LADO_ESPACIO_M, MIN_LADO_ESPACIO_M).ok).toBe(true);
    expect(normalizarDimensionesEspacio(MAX_LADO_ESPACIO_M, MAX_LADO_ESPACIO_M).ok).toBe(true);
  });
});

describe("mesasFueraDelPlano", () => {
  const espacio = { width: 10, height: 6 };

  it("no se queja de las mesas que caben enteras", () => {
    expect(
      mesasFueraDelPlano(
        [
          { nombre: "1", posX: 0, posY: 0, ancho: 80, alto: 80 },
          { nombre: "2", posX: 5, posY: 3, ancho: 100, alto: 100 },
        ],
        espacio,
      ),
    ).toEqual([]);
  });

  it("una mesa pegada JUSTO al borde no cuenta como fuera", () => {
    expect(
      mesasFueraDelPlano([{ nombre: "9", posX: 9, posY: 5, ancho: 100, alto: 100 }], espacio),
    ).toEqual([]);
  });

  it("señala las que se salen por la derecha, por abajo o en negativo", () => {
    const fuera = mesasFueraDelPlano(
      [
        { nombre: "derecha", posX: 9.5, posY: 1, ancho: 100, alto: 100 },
        { nombre: "abajo", posX: 1, posY: 5.5, ancho: 100, alto: 100 },
        { nombre: "negativa", posX: -0.5, posY: 1, ancho: 100, alto: 100 },
        { nombre: "dentro", posX: 2, posY: 2, ancho: 100, alto: 100 },
      ],
      espacio,
    );
    expect(fuera).toEqual(["derecha", "abajo", "negativa"]);
  });

  it("es justo lo que pasa al redibujar una sala más pequeña", () => {
    const mesas = [
      { nombre: "1", posX: 1, posY: 1, ancho: 80, alto: 80 },
      { nombre: "20", posX: 10, posY: 6, ancho: 80, alto: 80 },
    ];
    expect(mesasFueraDelPlano(mesas, { width: 12, height: 8 })).toEqual([]);
    expect(mesasFueraDelPlano(mesas, { width: 6, height: 4 })).toEqual(["20"]);
  });
});

// ---------------------------------------------------------------------------
// Paredes como obstáculo
// ---------------------------------------------------------------------------

describe("segmentosSeCortan / distanciaSegmentoSegmento", () => {
  const P = (x: number, y: number) => ({ x, y });

  it("detecta el cruce en X", () => {
    expect(segmentosSeCortan(P(0, 0), P(2, 2), P(0, 2), P(2, 0))).toBe(true);
  });

  it("dos paralelas separadas no se cortan y su distancia es la separación", () => {
    expect(segmentosSeCortan(P(0, 0), P(2, 0), P(0, 1), P(2, 1))).toBe(false);
    expect(distanciaSegmentoSegmento(P(0, 0), P(2, 0), P(0, 1), P(2, 1))).toBeCloseTo(1, 6);
  });

  it("segmentos colineales solapados cuentan como cortados", () => {
    expect(segmentosSeCortan(P(0, 0), P(2, 0), P(1, 0), P(3, 0))).toBe(true);
  });

  it("dos segmentos en L que no se tocan miden por sus extremos", () => {
    expect(distanciaSegmentoSegmento(P(0, 0), P(1, 0), P(2, 0), P(2, 3))).toBeCloseTo(1, 6);
  });
});

describe("distanciaSegmentoRectangulo", () => {
  const rect: RectanguloOcupado = { x: 1, y: 1, width: 1, height: 1 };

  it("es 0 si la pared atraviesa el rectángulo", () => {
    expect(distanciaSegmentoRectangulo({ x1: 0, y1: 1.5, x2: 3, y2: 1.5 }, rect)).toBe(0);
  });

  it("es 0 si la pared queda entera dentro del rectángulo", () => {
    expect(distanciaSegmentoRectangulo({ x1: 1.2, y1: 1.2, x2: 1.8, y2: 1.8 }, rect)).toBe(0);
  });

  it("mide la separación cuando la pared pasa de largo", () => {
    expect(distanciaSegmentoRectangulo({ x1: 0, y1: 3, x2: 5, y2: 3 }, rect)).toBeCloseTo(1, 6);
  });

  it("una diagonal NO bloquea todo su rectángulo envolvente", () => {
    // La diagonal (0,0)-(4,4) pasa lejos de una mesa arriba a la derecha,
    // aunque la caja envolvente de la diagonal la contiene de sobra.
    const arribaDerecha: RectanguloOcupado = { x: 3, y: 0.2, width: 0.8, height: 0.8 };
    expect(
      distanciaSegmentoRectangulo({ x1: 0, y1: 0, x2: 4, y2: 4 }, arribaDerecha),
    ).toBeGreaterThan(1);
  });
});

describe("rectanguloChocaConPared", () => {
  // Mesa de 1x1 con su esquina en (2, 2): ocupa de x=2 a x=3.
  const mesa: RectanguloOcupado = { x: 2, y: 2, width: 1, height: 1 };

  it("choca si la pared la atraviesa", () => {
    expect(rectanguloChocaConPared(mesa, { x1: 0, y1: 2.5, x2: 10, y2: 2.5 })).toBe(true);
  });

  it("choca si solo la roza el trazo (medio espesor a cada lado del eje)", () => {
    // Eje a 7cm de la mesa: con espesor 15cm el trazo llega a 7,5cm -> pisa.
    expect(rectanguloChocaConPared(mesa, { x1: 0, y1: 1.93, x2: 10, y2: 1.93 }, 0)).toBe(true);
    // Eje a 8cm: el trazo se queda a 0,5cm -> sin holgura NO pisa.
    expect(rectanguloChocaConPared(mesa, { x1: 0, y1: 1.92, x2: 10, y2: 1.92 }, 0)).toBe(false);
  });

  it("la holgura añade aire por encima del espesor", () => {
    const pared: ParedObstaculo = { x1: 0, y1: 1.8, x2: 10, y2: 1.8 };
    // Eje a 20cm: trazo a 12,5cm de la mesa. Sin holgura no choca.
    expect(rectanguloChocaConPared(mesa, pared, 0)).toBe(false);
    // Con 15cm de aire obligatorio sí.
    expect(rectanguloChocaConPared(mesa, pared, 0.15)).toBe(true);
  });

  it("una mesa PEGADA a la pared sigue valiendo con una holgura pequeña", () => {
    // Pared vertical en x = 1,9; la mesa empieza en x = 2 (10cm de aire real,
    // 2,5cm libres tras el trazo). Es la colocación normal de un comedor.
    expect(rectanguloChocaConPared(mesa, { x1: 1.9, y1: 0, x2: 1.9, y2: 10 }, 0.02)).toBe(false);
  });

  it("respeta un espesor propio del muro si lo trae", () => {
    const pared: ParedObstaculo = { x1: 0, y1: 1.5, x2: 10, y2: 1.5, espesor: 1.2 };
    // Eje a 50cm de la mesa, pero con 1,2m de espesor el trazo llega a 60cm.
    expect(rectanguloChocaConPared(mesa, pared, 0)).toBe(true);
    expect(rectanguloChocaConPared(mesa, { ...pared, espesor: ESPESOR_PARED_M }, 0)).toBe(false);
  });
});

describe("paredesDesdeElementos", () => {
  it("pasa de píxeles a metros y se queda solo con los muros", () => {
    const paredes = paredesDesdeElementos(
      [
        { tipo: "wall", props: { x1: 0, y1: 0, x2: 500, y2: 0 } },
        { tipo: "area", props: { left: 0, top: 0, width: 100, height: 100 } },
        { tipo: "door", props: { left: 10, top: 0, width: 40, height: 6, angle: 0 } },
      ],
      PIXELS_PER_METER,
    );
    expect(paredes).toHaveLength(1);
    expect(paredes[0]).toEqual({ x1: 0, y1: 0, x2: 10, y2: 0, espesor: ESPESOR_PARED_M });
  });

  it("descarta muros de longitud cero y coordenadas basura", () => {
    expect(
      paredesDesdeElementos([
        { tipo: "wall", props: { x1: 50, y1: 50, x2: 50, y2: 50 } },
        { tipo: "wall", props: { x1: Number.NaN, y1: 0, x2: 100, y2: 0 } },
        null as unknown as { tipo: string },
      ]),
    ).toEqual([]);
  });

  it("no revienta sin elementos", () => {
    expect(paredesDesdeElementos(undefined)).toEqual([]);
    expect(paredesDesdeElementos(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// La rejilla del alta en lote ya no atraviesa las paredes
// ---------------------------------------------------------------------------

describe("calcularRejillaMesas esquivando paredes", () => {
  const espacio = { width: 12, height: 8 };
  const opcionesBase = { anchoCm: 100, altoCm: 100, espacio, separacion: 0.5, margen: 0.5 };

  /** Tabique horizontal a lo ancho de la sala, a 1,2m del borde de arriba:
   *  parte justo la primera fila de la rejilla (que empieza en y = 0,5). */
  const tabique: ParedObstaculo = { x1: 0, y1: 1.2, x2: 12, y2: 1.2 };

  it("REGRESIÓN: sin paredes la rejilla planta la mesa encima del tabique", () => {
    const r = calcularRejillaMesas({ ...opcionesBase, cantidad: 1 });
    expect(r.posiciones[0]).toEqual({ x: 0.5, y: 0.5 });
    // Ese hueco (0,5 - 0,5) ocupa de y=0,5 a y=1,5: el tabique lo parte.
    expect(rectanguloChocaConPared({ x: 0.5, y: 0.5, width: 1, height: 1 }, tabique)).toBe(true);
    expect(r.esquivoParedes).toBe(false);
  });

  it("con paredes salta esos huecos y baja a la fila siguiente", () => {
    const r = calcularRejillaMesas({ ...opcionesBase, cantidad: 1, paredes: [tabique] });
    expect(r.esquivoParedes).toBe(true);
    expect(r.posiciones[0].y).toBeGreaterThan(1.2);
  });

  it("NINGUNA mesa del lote acaba pisando una pared", () => {
    const paredes: ParedObstaculo[] = [
      tabique,
      // Tabique vertical que parte la sala por la mitad.
      { x1: 6.1, y1: 0, x2: 6.1, y2: 8 },
    ];
    const r = calcularRejillaMesas({ ...opcionesBase, cantidad: 8, paredes });
    expect(r.posiciones).toHaveLength(8);
    expect(r.esquivoParedes).toBe(true);
    r.posiciones.forEach((p) => {
      paredes.forEach((pared) => {
        expect(
          rectanguloChocaConPared({ x: p.x, y: p.y, width: 1, height: 1 }, pared, 0.05),
        ).toBe(false);
      });
    });
  });

  it("esquiva paredes Y mesas a la vez", () => {
    const ocupadas: RectanguloOcupado[] = [{ x: 0.5, y: 2, width: 1, height: 1 }];
    const r = calcularRejillaMesas({
      ...opcionesBase,
      cantidad: 1,
      ocupadas,
      paredes: [tabique],
    });
    expect(r.esquivoParedes).toBe(true);
    expect(r.esquivoOcupadas).toBe(true);
    expect(r.posiciones[0]).not.toEqual({ x: 0.5, y: 2 });
    expect(
      rectanguloChocaConPared({ ...r.posiciones[0], width: 1, height: 1 }, tabique),
    ).toBe(false);
  });

  it("una pared en diagonal no bloquea la sala entera", () => {
    const diagonal: ParedObstaculo = { x1: 0, y1: 0, x2: 12, y2: 8 };
    const r = calcularRejillaMesas({ ...opcionesBase, cantidad: 6, paredes: [diagonal] });
    // Si se usara la caja envolvente de la diagonal no cabría ni una.
    expect(r.posiciones).toHaveLength(6);
    r.posiciones.forEach((p) => {
      expect(
        rectanguloChocaConPared({ x: p.x, y: p.y, width: 1, height: 1 }, diagonal, 0.05),
      ).toBe(false);
    });
  });

  it("sin paredes el resultado es EXACTAMENTE el de siempre", () => {
    const sin = calcularRejillaMesas({ ...opcionesBase, cantidad: 5 });
    const conVacias = calcularRejillaMesas({ ...opcionesBase, cantidad: 5, paredes: [] });
    expect(conVacias.posiciones).toEqual(sin.posiciones);
    expect(sin.esquivoParedes).toBe(false);
    expect(sin.sinSitio).toBe(0);
  });

  it("ignora paredes con coordenadas basura en vez de descolocarlo todo", () => {
    const sinBasura = calcularRejillaMesas({ ...opcionesBase, cantidad: 2 });
    const conBasura = calcularRejillaMesas({
      ...opcionesBase,
      cantidad: 2,
      paredes: [
        { x1: Number.NaN, y1: 0, x2: 1, y2: 0 },
        { x1: 0, y1: 0, x2: Number.POSITIVE_INFINITY, y2: 0 },
        null as unknown as ParedObstaculo,
      ],
    });
    expect(conBasura.posiciones).toEqual(sinBasura.posiciones);
    expect(conBasura.esquivoParedes).toBe(false);
  });
});

describe("calcularRejillaMesas con omitirSinSitio", () => {
  const espacio = { width: 4, height: 4 };

  it("prefiere NO colocar antes que apilar mal, y dice cuántas se quedan fuera", () => {
    const r = calcularRejillaMesas({
      cantidad: 3,
      anchoCm: 100,
      altoCm: 100,
      espacio,
      margen: 0.2,
      // Tapa el plano entero: no queda un solo hueco libre.
      ocupadas: [{ x: 0, y: 0, width: 5, height: 5 }],
      omitirSinSitio: true,
    });
    expect(r.posiciones).toEqual([]);
    expect(r.sinSitio).toBe(3);
    expect(r.desborda).toBe(true);
  });

  it("una pared gorda que cruza todo el plano también deja el lote sin sitio", () => {
    const r = calcularRejillaMesas({
      cantidad: 2,
      anchoCm: 100,
      altoCm: 100,
      espacio: { width: 1.4, height: 4 },
      margen: 0.2,
      paredes: [{ x1: 0.7, y1: 0, x2: 0.7, y2: 4, espesor: 4 }],
      omitirSinSitio: true,
    });
    expect(r.posiciones).toEqual([]);
    expect(r.sinSitio).toBe(2);
  });

  it("coloca las que sí caben y solo omite el resto", () => {
    const r = calcularRejillaMesas({
      cantidad: 5,
      anchoCm: 100,
      altoCm: 100,
      espacio: { width: 3.4, height: 1.4 },
      margen: 0.2,
      separacion: 0,
      omitirSinSitio: true,
    });
    expect(r.posiciones.length).toBeGreaterThan(0);
    expect(r.posiciones.length).toBeLessThan(5);
    expect(r.sinSitio).toBe(5 - r.posiciones.length);
  });

  it("sin la bandera se mantiene el comportamiento de siempre (apila y avisa)", () => {
    const r = calcularRejillaMesas({
      cantidad: 3,
      anchoCm: 100,
      altoCm: 100,
      espacio,
      margen: 0.2,
      ocupadas: [{ x: 0, y: 0, width: 5, height: 5 }],
    });
    expect(r.posiciones).toHaveLength(3);
    expect(r.sinSitio).toBe(0);
    expect(r.desborda).toBe(true);
  });
});
