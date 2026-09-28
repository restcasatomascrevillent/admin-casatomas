import { describe, it, expect } from "vitest";
import { Line, Rect } from "fabric";
import {
  aabbRectFabric,
  anguloSegmentoDeg,
  calcularPuertaEnMuro,
  centroRectFabric,
  proyectarPuntoEnSegmento,
  rectFabricDesdeElemento,
  topLeftRectFabric,
  verticesRectFabric,
} from "../puertaGeometria";
import {
  PIXELS_PER_METER,
  calcularPuntosAbsolutosPared,
  type Matrix2D,
  type Punto,
  type SegmentoPared,
} from "../planoUtils";

// Constantes REALES del camino vivo de la puerta (CanvasPlano.tsx).
const DOOR_WIDTH_PX = 0.8 * PIXELS_PER_METER; // 40px = 80cm
const DOOR_LEAF_THICKNESS_PX = 6;
const DOOR_WALL_SNAP_PX = 25;

/** Distancia de un punto a la recta/segmento del muro. */
function distanciaAlMuro(punto: Punto, muro: SegmentoPared): number {
  const p = proyectarPuntoEnSegmento(punto, muro);
  return Math.hypot(p.x - punto.x, p.y - punto.y);
}

/**
 * Centro de la puerta calculado por FABRIC, no por nosotros: se construye el
 * Rect igual que `handleDoorClick` y se le pregunta a la propia librería.
 * `strokeWidth: 0` para que la caja de Fabric coincida con el rectángulo
 * geométrico (con trazo, Fabric mete `strokeWidth/2` de relleno en cada eje).
 */
function centroSegunFabric(rect: {
  left: number;
  top: number;
  width: number;
  height: number;
  angle: number;
}): Punto {
  const obj = new Rect({
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    angle: rect.angle,
    strokeWidth: 0,
    originX: "left",
    originY: "top",
  });
  obj.setCoords();
  const c = obj.getCenterPoint();
  return { x: c.x, y: c.y };
}

/** El `left`/`top` que calculaba el código ROTO (solo válido con angle = 0). */
function topLeftIngenuo(centro: Punto, width: number, height: number) {
  return { left: centro.x - width / 2, top: centro.y - height / 2 };
}

/**
 * Muros de una sala rectangular de 10x6m dibujada en el sentido de las agujas
 * del reloj, más dos diagonales. Son los ángulos que cita el fallo del dueño.
 */
const MUROS: Array<{ nombre: string; anguloEsperado: number; seg: SegmentoPared }> = [
  { nombre: "pared de arriba (0°)", anguloEsperado: 0, seg: { x1: 0, y1: 0, x2: 500, y2: 0 } },
  { nombre: "diagonal (45°)", anguloEsperado: 45, seg: { x1: 0, y1: 0, x2: 400, y2: 400 } },
  { nombre: "pared derecha (90°)", anguloEsperado: 90, seg: { x1: 500, y1: 0, x2: 500, y2: 300 } },
  { nombre: "diagonal (135°)", anguloEsperado: 135, seg: { x1: 500, y1: 0, x2: 100, y2: 400 } },
  { nombre: "pared de abajo (180°)", anguloEsperado: 180, seg: { x1: 500, y1: 300, x2: 0, y2: 300 } },
  { nombre: "pared izquierda (-90°)", anguloEsperado: -90, seg: { x1: 0, y1: 300, x2: 0, y2: 0 } },
];

describe("centroRectFabric / topLeftRectFabric", () => {
  it("coinciden con la transformación real de Fabric para cualquier ángulo", () => {
    for (const angle of [0, 15, 45, 90, 135, 180, -90, -37.5]) {
      const rect = { left: 123.5, top: -44.25, width: DOOR_WIDTH_PX, height: DOOR_LEAF_THICKNESS_PX, angle };
      const mio = centroRectFabric(rect);
      const deFabric = centroSegunFabric(rect);
      expect(mio.x, `x @ ${angle}°`).toBeCloseTo(deFabric.x, 6);
      expect(mio.y, `y @ ${angle}°`).toBeCloseTo(deFabric.y, 6);
    }
  });

  it("son inversas exactas la una de la otra", () => {
    for (const angle of [0, 30, 90, 137.5, 180, -90]) {
      const centro: Punto = { x: 250, y: -80.5 };
      const { left, top } = topLeftRectFabric(centro, DOOR_WIDTH_PX, DOOR_LEAF_THICKNESS_PX, angle);
      const vuelta = centroRectFabric({
        left,
        top,
        width: DOOR_WIDTH_PX,
        height: DOOR_LEAF_THICKNESS_PX,
        angle,
      });
      expect(vuelta.x, `x @ ${angle}°`).toBeCloseTo(centro.x, 9);
      expect(vuelta.y, `y @ ${angle}°`).toBeCloseTo(centro.y, 9);
    }
  });

  it("solo coincide con `left + width/2` cuando el ángulo es 0", () => {
    const base = { left: 100, top: 200, width: DOOR_WIDTH_PX, height: DOOR_LEAF_THICKNESS_PX };
    const cero = centroRectFabric({ ...base, angle: 0 });
    expect(cero.x).toBeCloseTo(base.left + base.width / 2, 9);
    expect(cero.y).toBeCloseTo(base.top + base.height / 2, 9);

    const noventa = centroRectFabric({ ...base, angle: 90 });
    expect(noventa.x).not.toBeCloseTo(base.left + base.width / 2, 1);
  });

  it("NO es lo mismo que Rect.getCenterPoint(), que incluye el grosor del trazo", () => {
    // Documentado para que nadie "simplifique" sustituyendo esta fórmula por
    // getCenterPoint(): con strokeWidth 2 (el de la hoja de la puerta) el
    // centro de Fabric está desplazado (1,1) en ejes locales, o sea √2 px.
    // Mezclar las dos convenciones desplazaría la puerta en cada arrastre.
    const rect = { left: 100, top: 200, width: DOOR_WIDTH_PX, height: DOOR_LEAF_THICKNESS_PX, angle: 0 };
    const conTrazo = new Rect({ ...rect, strokeWidth: 2, originX: "left", originY: "top" });
    conTrazo.setCoords();
    const c = conTrazo.getCenterPoint();
    const geometrico = centroRectFabric(rect);
    expect(Math.hypot(c.x - geometrico.x, c.y - geometrico.y)).toBeCloseTo(Math.SQRT2, 6);
  });
});

describe("anguloSegmentoDeg", () => {
  it("da el ángulo de cada muro de una sala dibujada en sentido horario", () => {
    for (const { nombre, seg, anguloEsperado } of MUROS) {
      expect(anguloSegmentoDeg(seg), nombre).toBeCloseTo(anguloEsperado, 6);
    }
  });
});

describe("calcularPuertaEnMuro — la puerta cae SOBRE su pared", () => {
  it("para muros a 0, 45, 90, 135, 180 y -90 grados, el centro real está en el muro", () => {
    for (const { nombre, seg, anguloEsperado } of MUROS) {
      // Clic un poco fuera del muro, dentro del alcance del imán.
      const medio = { x: (seg.x1 + seg.x2) / 2, y: (seg.y1 + seg.y2) / 2 };
      const clic = { x: medio.x + 7, y: medio.y - 5 };

      const puerta = calcularPuertaEnMuro(
        clic,
        [seg],
        DOOR_WIDTH_PX,
        DOOR_LEAF_THICKNESS_PX,
        DOOR_WALL_SNAP_PX
      );

      expect(puerta.anclada, nombre).toBe(true);
      expect(puerta.angle, `ángulo en ${nombre}`).toBeCloseTo(anguloEsperado, 6);

      // Centro segun FABRIC (no según nuestra fórmula): camino independiente.
      const centroReal = centroSegunFabric(puerta);
      expect(distanciaAlMuro(centroReal, seg), `distancia al muro en ${nombre}`).toBeLessThanOrEqual(1);
    }
  });

  it("la fórmula ingenua (centro - tamaño/2) colocaba la puerta a 57-81cm de donde tocaba", () => {
    // Desviaciones medidas del fallo original con las constantes reales
    // (hueco de 0.8m, 50px/m, hoja de 6px): cuánto se aleja la puerta del
    // punto del muro donde el usuario la pidió.
    const desviacionEsperadaCm: Record<string, number> = {
      "pared de arriba (0°)": 0,
      "pared derecha (90°)": 57,
      "pared de abajo (180°)": 81,
      "pared izquierda (-90°)": 57,
    };
    // Y cuánto se sale de la LÍNEA del muro (el resto de la desviación es
    // deslizamiento a lo largo de la pared, que también está mal pero no se
    // ve "flotando").
    const fueraDelMuroEsperadoCm: Record<string, number> = {
      "pared de arriba (0°)": 0,
      "pared derecha (90°)": 46,
      "pared de abajo (180°)": 12,
      "pared izquierda (-90°)": 34,
    };

    for (const { nombre, seg } of MUROS) {
      if (!(nombre in desviacionEsperadaCm)) continue;
      const centroPedido = { x: (seg.x1 + seg.x2) / 2, y: (seg.y1 + seg.y2) / 2 };
      const angle = anguloSegmentoDeg(seg);
      const { left, top } = topLeftIngenuo(centroPedido, DOOR_WIDTH_PX, DOOR_LEAF_THICKNESS_PX);
      const centroReal = centroSegunFabric({
        left,
        top,
        width: DOOR_WIDTH_PX,
        height: DOOR_LEAF_THICKNESS_PX,
        angle,
      });

      const desviacionCm =
        (Math.hypot(centroReal.x - centroPedido.x, centroReal.y - centroPedido.y) /
          PIXELS_PER_METER) *
        100;
      expect(Math.round(desviacionCm), `desviación en ${nombre}`).toBe(
        desviacionEsperadaCm[nombre]
      );

      const fueraCm = (distanciaAlMuro(centroReal, seg) / PIXELS_PER_METER) * 100;
      expect(Math.round(fueraCm), `fuera del muro en ${nombre}`).toBe(
        fueraDelMuroEsperadoCm[nombre]
      );

      // Y con la conversión correcta, cero: cae exactamente donde se pidió.
      const buena = calcularPuertaEnMuro(
        centroPedido,
        [seg],
        DOOR_WIDTH_PX,
        DOOR_LEAF_THICKNESS_PX,
        DOOR_WALL_SNAP_PX
      );
      const centroBueno = centroSegunFabric(buena);
      expect(
        Math.hypot(centroBueno.x - centroPedido.x, centroBueno.y - centroPedido.y),
        `desviación corregida en ${nombre}`
      ).toBeLessThanOrEqual(1e-6);
    }
  });

  it("el re-anclaje ANTIGUO apartaba 46cm de su pared a una puerta bien puesta", () => {
    // Reproducción del re-anclaje roto de object:modified: buscaba el muro
    // usando `left + width/2` como centro y volvía a escribir
    // `left = proyección - width/2`. Sobre un muro vertical, cada arrastre
    // desplazaba la puerta 23px (46cm) — el usuario la soltaba encima de la
    // pared y "saltaba" a otro sitio.
    const seg: SegmentoPared = { x1: 500, y1: 0, x2: 500, y2: 300 };
    const centroPedido = { x: 500, y: 150 };
    const colocada = calcularPuertaEnMuro(
      centroPedido,
      [seg],
      DOOR_WIDTH_PX,
      DOOR_LEAF_THICKNESS_PX,
      DOOR_WALL_SNAP_PX
    );
    expect(distanciaAlMuro(centroSegunFabric(colocada), seg)).toBeLessThanOrEqual(1e-6);

    // --- re-anclaje ANTIGUO ---
    const centroIngenuo = {
      x: colocada.left + DOOR_WIDTH_PX / 2,
      y: colocada.top + DOOR_LEAF_THICKNESS_PX / 2,
    };
    const proyeccion = proyectarPuntoEnSegmento(centroIngenuo, seg);
    expect(
      Math.hypot(proyeccion.x - centroIngenuo.x, proyeccion.y - centroIngenuo.y),
      "el punto de búsqueda ya está 23px fuera del muro"
    ).toBeCloseTo(23, 6);
    const reanclajeViejo = topLeftIngenuo(proyeccion, DOOR_WIDTH_PX, DOOR_LEAF_THICKNESS_PX);
    const centroTrasReanclajeViejo = centroSegunFabric({
      ...reanclajeViejo,
      width: DOOR_WIDTH_PX,
      height: DOOR_LEAF_THICKNESS_PX,
      angle: colocada.angle,
    });
    const fueraCm = (distanciaAlMuro(centroTrasReanclajeViejo, seg) / PIXELS_PER_METER) * 100;
    expect(Math.round(fueraCm), "se queda flotando a 46cm").toBe(46);

    // --- re-anclaje NUEVO: punto fijo, no se mueve ---
    const reanclajeNuevo = calcularPuertaEnMuro(
      centroRectFabric(colocada),
      [seg],
      DOOR_WIDTH_PX,
      DOOR_LEAF_THICKNESS_PX,
      DOOR_WALL_SNAP_PX
    );
    expect(reanclajeNuevo.left).toBeCloseTo(colocada.left, 6);
    expect(reanclajeNuevo.top).toBeCloseTo(colocada.top, 6);
  });

  it("el re-anclaje reconoce como YA COLOCADA una puerta bien puesta (antes era código muerto)", () => {
    // Con la fórmula ingenua, el centro de búsqueda de una puerta pegada a un
    // muro vertical se iba 28.6px: más que el umbral de 25px, así que el
    // re-anclaje descartaba SIEMPRE su propio muro.
    for (const { nombre, seg, anguloEsperado } of MUROS) {
      const centroEnMuro = { x: (seg.x1 + seg.x2) / 2, y: (seg.y1 + seg.y2) / 2 };
      const colocada = calcularPuertaEnMuro(
        centroEnMuro,
        [seg],
        DOOR_WIDTH_PX,
        DOOR_LEAF_THICKNESS_PX,
        DOOR_WALL_SNAP_PX
      );

      // Segunda pasada: como hace object:modified al soltar la puerta.
      const centroRecalculado = centroRectFabric(colocada);
      expect(distanciaAlMuro(centroRecalculado, seg), `búsqueda en ${nombre}`).toBeLessThanOrEqual(1);

      const reanclada = calcularPuertaEnMuro(
        centroRecalculado,
        [seg],
        DOOR_WIDTH_PX,
        DOOR_LEAF_THICKNESS_PX,
        DOOR_WALL_SNAP_PX
      );
      expect(reanclada.anclada, nombre).toBe(true);
      expect(reanclada.angle, nombre).toBeCloseTo(anguloEsperado, 6);
      // Y no se mueve: arrastrar y soltar una puerta ya colocada no la desplaza.
      expect(reanclada.left, `left en ${nombre}`).toBeCloseTo(colocada.left, 6);
      expect(reanclada.top, `top en ${nombre}`).toBeCloseTo(colocada.top, 6);
    }
  });

  it("una puerta mal colocada (datos antiguos) se recoloca sola en el muro", () => {
    const seg: SegmentoPared = { x1: 500, y1: 0, x2: 500, y2: 300 }; // 90°
    const centroEnMuro = { x: 500, y: 150 };
    const { left, top } = topLeftIngenuo(centroEnMuro, DOOR_WIDTH_PX, DOOR_LEAF_THICKNESS_PX);
    const guardada = { left, top, width: DOOR_WIDTH_PX, height: DOOR_LEAF_THICKNESS_PX, angle: 90 };

    // Punto de partida: está flotando a 23px (46cm) de su muro.
    const centroMalo = centroRectFabric(guardada);
    expect(distanciaAlMuro(centroMalo, seg)).toBeCloseTo(23, 6);

    // Al soltarla, el imán la engancha (23px < 25px de umbral) y esta vez la
    // deja EXACTAMENTE encima: los planos ya guardados se curan solos al
    // primer arrastre, sin migración de datos.
    const arreglada = calcularPuertaEnMuro(
      centroMalo,
      [seg],
      DOOR_WIDTH_PX,
      DOOR_LEAF_THICKNESS_PX,
      DOOR_WALL_SNAP_PX
    );
    expect(arreglada.anclada).toBe(true);
    expect(distanciaAlMuro(centroSegunFabric(arreglada), seg)).toBeLessThanOrEqual(1);
  });

  it("no ancla si el clic está lejos de cualquier muro y respeta el punto pedido", () => {
    const seg: SegmentoPared = { x1: 0, y1: 0, x2: 500, y2: 0 };
    const lejos = { x: 250, y: 400 };
    const puerta = calcularPuertaEnMuro(
      lejos,
      [seg],
      DOOR_WIDTH_PX,
      DOOR_LEAF_THICKNESS_PX,
      DOOR_WALL_SNAP_PX
    );
    expect(puerta.anclada).toBe(false);
    expect(puerta.angle).toBe(0);
    const centro = centroSegunFabric(puerta);
    expect(centro.x).toBeCloseTo(lejos.x, 6);
    expect(centro.y).toBeCloseTo(lejos.y, 6);
  });

  it("se queda dentro del muro aunque el clic caiga más allá de su extremo", () => {
    const seg: SegmentoPared = { x1: 100, y1: 0, x2: 200, y2: 0 };
    const puerta = calcularPuertaEnMuro(
      { x: 215, y: 3 },
      [seg],
      DOOR_WIDTH_PX,
      DOOR_LEAF_THICKNESS_PX,
      DOOR_WALL_SNAP_PX
    );
    expect(puerta.anclada).toBe(true);
    expect(puerta.centro.x).toBeCloseTo(200, 6);
    expect(puerta.centro.y).toBeCloseTo(0, 6);
  });

  it("elige el muro más cercano cuando hay varios en el radio del imán", () => {
    const horizontal: SegmentoPared = { x1: 0, y1: 0, x2: 400, y2: 0 };
    const vertical: SegmentoPared = { x1: 0, y1: 0, x2: 0, y2: 400 };
    const puerta = calcularPuertaEnMuro(
      { x: 4, y: 40 },
      [horizontal, vertical],
      DOOR_WIDTH_PX,
      DOOR_LEAF_THICKNESS_PX,
      DOOR_WALL_SNAP_PX
    );
    expect(puerta.anclada).toBe(true);
    expect(puerta.angle).toBeCloseTo(90, 6); // el vertical, a 4px
    expect(puerta.centro.x).toBeCloseTo(0, 6);
    expect(puerta.centro.y).toBeCloseTo(40, 6);
  });
});

describe("proyectarPuntoEnSegmento", () => {
  it("devuelve el extremo cuando el segmento tiene longitud cero", () => {
    const seg: SegmentoPared = { x1: 10, y1: 20, x2: 10, y2: 20 };
    expect(proyectarPuntoEnSegmento({ x: 500, y: 500 }, seg)).toEqual({ x: 10, y: 20 });
  });

  it("clampa a los dos extremos", () => {
    const seg: SegmentoPared = { x1: 0, y1: 0, x2: 100, y2: 0 };
    expect(proyectarPuntoEnSegmento({ x: -50, y: 10 }, seg)).toEqual({ x: 0, y: 0 });
    expect(proyectarPuntoEnSegmento({ x: 150, y: 10 }, seg)).toEqual({ x: 100, y: 0 });
  });
});

describe("coordenadas de una pared movida (el imán apuntaba a la posición vieja)", () => {
  it("line.x1/y1/x2/y2 se quedan obsoletos al mover la pared; la matriz no", () => {
    const line = new Line([0, 0, 200, 0], { strokeWidth: 2 });
    line.setCoords();
    const antes = calcularPuntosAbsolutosPared(
      line.calcTransformMatrix() as unknown as Matrix2D,
      line.calcLinePoints()
    );
    expect(antes.x1).toBeCloseTo(0, 6);
    expect(antes.x2).toBeCloseTo(200, 6);

    // Mover la pared como lo hace Fabric al arrastrarla: solo left/top.
    line.set({ left: (line.left ?? 0) + 150, top: (line.top ?? 0) + 80 });
    line.setCoords();

    // x1..y2 del objeto NO se enteran: esto es exactamente lo que leía
    // getWallSegments antes del arreglo.
    expect(line.x1).toBeCloseTo(0, 6);
    expect(line.x2).toBeCloseTo(200, 6);

    // La matriz sí: es de donde salen ahora los segmentos del imán.
    const despues = calcularPuntosAbsolutosPared(
      line.calcTransformMatrix() as unknown as Matrix2D,
      line.calcLinePoints()
    );
    expect(despues.x1).toBeCloseTo(150, 6);
    expect(despues.y1).toBeCloseTo(80, 6);
    expect(despues.x2).toBeCloseTo(350, 6);
    expect(despues.y2).toBeCloseTo(80, 6);
  });

  it("con las coordenadas viejas la puerta se ancla a la pared donde YA NO está", () => {
    const line = new Line([0, 0, 200, 0], { strokeWidth: 2 });
    line.setCoords();
    const viejo: SegmentoPared = { x1: line.x1 ?? 0, y1: line.y1 ?? 0, x2: line.x2 ?? 0, y2: line.y2 ?? 0 };

    line.set({ left: (line.left ?? 0) + 150, top: (line.top ?? 0) + 80 });
    line.setCoords();
    const nuevo = calcularPuntosAbsolutosPared(
      line.calcTransformMatrix() as unknown as Matrix2D,
      line.calcLinePoints()
    );

    // Clic justo encima de la pared en su posición ACTUAL.
    const clic = { x: 250, y: 82 };
    const conCoordsViejas = calcularPuertaEnMuro(
      clic,
      [viejo],
      DOOR_WIDTH_PX,
      DOOR_LEAF_THICKNESS_PX,
      DOOR_WALL_SNAP_PX
    );
    expect(conCoordsViejas.anclada).toBe(false); // no ve la pared: está a 82px

    const conCoordsBuenas = calcularPuertaEnMuro(
      clic,
      [nuevo],
      DOOR_WIDTH_PX,
      DOOR_LEAF_THICKNESS_PX,
      DOOR_WALL_SNAP_PX
    );
    expect(conCoordsBuenas.anclada).toBe(true);
    expect(distanciaAlMuro(centroSegunFabric(conCoordsBuenas), nuevo)).toBeLessThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Caja del rectángulo girado y lectura del elemento persistido.
//
// Lo añadió el arreglo de la VISTA DE RESERVAS (`PlanoEspacio2D.tsx`), que
// nunca rotaba los elementos y sacaba todas las puertas horizontales.
// ─────────────────────────────────────────────────────────────────────────────

describe("verticesRectFabric", () => {
  it("coincide con las esquinas que calcula Fabric, para cualquier ángulo", () => {
    for (const angle of [0, 15, 45, 90, 135, 180, -90, -37.5]) {
      const rect = { left: 123.5, top: -44.25, width: DOOR_WIDTH_PX, height: 30, angle };
      const obj = new Rect({ ...rect, strokeWidth: 0, originX: "left", originY: "top" });
      obj.setCoords();
      // Fabric los da como {tl, tr, br, bl}; mismo orden que devolvemos.
      const deFabric = obj.getCoords();
      const mios = verticesRectFabric(rect);
      mios.forEach((v, i) => {
        expect(v.x, `x vértice ${i} @ ${angle}°`).toBeCloseTo(deFabric[i].x, 6);
        expect(v.y, `y vértice ${i} @ ${angle}°`).toBeCloseTo(deFabric[i].y, 6);
      });
    }
  });

  it("el primer vértice ES el pivote: no se mueve al girar", () => {
    const base = { left: 100, top: 200, width: DOOR_WIDTH_PX, height: 12 };
    for (const angle of [0, 45, 90, 180, -90]) {
      const [tl] = verticesRectFabric({ ...base, angle });
      expect(tl.x, `x @ ${angle}°`).toBeCloseTo(base.left, 9);
      expect(tl.y, `y @ ${angle}°`).toBeCloseTo(base.top, 9);
    }
  });

  it("su punto medio es exactamente `centroRectFabric`", () => {
    for (const angle of [0, 33, 90, 180, -90]) {
      const rect = { left: 10, top: -5, width: 70, height: 12, angle };
      const vs = verticesRectFabric(rect);
      const medio = {
        x: (vs[0].x + vs[2].x) / 2,
        y: (vs[0].y + vs[2].y) / 2,
      };
      const centro = centroRectFabric(rect);
      expect(medio.x, `x @ ${angle}°`).toBeCloseTo(centro.x, 9);
      expect(medio.y, `y @ ${angle}°`).toBeCloseTo(centro.y, 9);
    }
  });
});

describe("aabbRectFabric", () => {
  it("con ángulo 0 es la caja de toda la vida (left..left+width)", () => {
    const caja = aabbRectFabric({ left: 40, top: 90, width: 70, height: 12, angle: 0 });
    expect(caja).toEqual({ minX: 40, minY: 90, maxX: 110, maxY: 102 });
  });

  it("una puerta tumbada a 90° ocupa 12 de ancho y 70 de alto, no al revés", () => {
    const caja = aabbRectFabric({ left: 40, top: 90, width: 70, height: 12, angle: 90 });
    expect(caja.maxX - caja.minX).toBeCloseTo(12, 9);
    expect(caja.maxY - caja.minY).toBeCloseTo(70, 9);
  });

  it("a 90° la puerta sobresale a la IZQUIERDA de `left` (la caja ingenua la dejaba fuera)", () => {
    // Este es el caso que recortaba el PDF: con la caja ingenua el encuadre
    // empezaba en left=40 y los 12px reales de puerta a su izquierda se
    // quedaban fuera del papel.
    const caja = aabbRectFabric({ left: 40, top: 90, width: 70, height: 12, angle: 90 });
    expect(caja.minX).toBeCloseTo(28, 9);
    expect(caja.minX).toBeLessThan(40);
  });

  it("contiene siempre al centro real de la puerta", () => {
    for (const angle of [0, 27, 45, 90, 133, 180, -90]) {
      const rect = { left: 300, top: 150, width: 70, height: 12, angle };
      const caja = aabbRectFabric(rect);
      const centro = centroRectFabric(rect);
      expect(centro.x, `x @ ${angle}°`).toBeGreaterThanOrEqual(caja.minX - 1e-9);
      expect(centro.x, `x @ ${angle}°`).toBeLessThanOrEqual(caja.maxX + 1e-9);
      expect(centro.y, `y @ ${angle}°`).toBeGreaterThanOrEqual(caja.minY - 1e-9);
      expect(centro.y, `y @ ${angle}°`).toBeLessThanOrEqual(caja.maxY + 1e-9);
    }
  });
});

describe("rectFabricDesdeElemento", () => {
  it("lee la forma anidada (`props`) y la plana", () => {
    const anidado = { props: { left: 10, top: 20, width: 70, height: 12, angle: 90 } };
    const plano = { left: 10, top: 20, width: 70, height: 12, angle: 90 };
    expect(rectFabricDesdeElemento(anidado, 70, 12)).toEqual(plano);
    expect(rectFabricDesdeElemento(plano, 70, 12)).toEqual(plano);
  });

  it("un 0 guardado se respeta: `??` y no `||`", () => {
    // Un área pegada al borde izquierdo del plano está en x = 0. Con `||` ese
    // 0 se descartaba por falsy y se caía al valor por defecto o, peor, al
    // campo del otro nivel (que puede valer otra cosa).
    const pegadoAlBorde = { props: { left: 0, top: 0, width: 0, height: 0, angle: 0 } };
    expect(rectFabricDesdeElemento(pegadoAlBorde, 100, 100)).toEqual({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      angle: 0,
    });
  });

  it("con `||` un `props.left` de 0 leía el campo plano, que es otro sitio", () => {
    // Caso exacto que rompía: el elemento trae las dos formas y la anidada
    // manda. `props.left || elem.left` devolvía 300 en vez de 0.
    const conLasDosFormas = { left: 300, top: 400, props: { left: 0, top: 0 } };
    const leidoConOr = conLasDosFormas.props.left || conLasDosFormas.left || 0;
    expect(leidoConOr).toBe(300); // lo viejo: 300px fuera de sitio
    expect(rectFabricDesdeElemento(conLasDosFormas, 70, 12).left).toBe(0);
    expect(rectFabricDesdeElemento(conLasDosFormas, 70, 12).top).toBe(0);
  });

  it("los valores por defecto solo entran si el campo falta de verdad", () => {
    expect(rectFabricDesdeElemento({ left: 5, top: 6 }, 70, 12)).toEqual({
      left: 5,
      top: 6,
      width: 70,
      height: 12,
      angle: 0,
    });
  });

  it("aguanta `props: null` sin reventar (elementos viejos)", () => {
    expect(rectFabricDesdeElemento({ left: 5, top: 6, props: null }, 70, 12).left).toBe(5);
  });
});
