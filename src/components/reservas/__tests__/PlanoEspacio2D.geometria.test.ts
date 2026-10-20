/**
 * Geometría de los ELEMENTOS DEL PLANO en la vista de reservas
 * (`src/components/reservas/PlanoEspacio2D.tsx`).
 *
 * EL FALLO QUE CUBRE
 * ----------------------------------------------------------------------------
 * El dueño avisó de que "las puertas salen todas horizontales". Y salían: esta
 * vista NUNCA rotaba los elementos. El `angle` estaba bien guardado (el editor
 * lo arregló en el commit 1e77baf) pero al dibujar se ignoraba, así que una
 * puerta de la pared izquierda —que se guarda a 90°— se pintaba tumbada.
 *
 * POR QUÉ ESTOS TESTS NO MONTAN EL COMPONENTE
 * ----------------------------------------------------------------------------
 * Lo que puede volver a romperse es CÁLCULO, no marcado: el punto de pivote.
 * jsdom no aplica `transform`, así que renderizar no probaría nada — leería un
 * `style` de vuelta sin comprobar dónde cae la puerta. Aquí se hace la cuenta
 * que hace el navegador con ese CSS y se compara con dónde DEBE caer.
 *
 * LAS DOS CONVENCIONES (no mezclarlas)
 * ----------------------------------------------------------------------------
 *   · ELEMENTOS del plano: `left`/`top` es la ESQUINA y giran alrededor de
 *     ella (convención de Fabric v6) → en CSS, `transform-origin: 0 0`.
 *   · MESAS: `pos_x`/`pos_y` es la esquina de la caja SIN rotar y giran
 *     alrededor del CENTRO → en CSS, `transform-origin: center center`.
 */
import { describe, it, expect } from "vitest";
import {
  calcularPuertaEnMuro,
  centroRectFabric,
  rectFabricDesdeElemento,
} from "@/components/espacios/puertaGeometria";
import { PIXELS_PER_METER, type Punto, type SegmentoPared } from "@/components/espacios/planoUtils";

// Constantes reales de la hoja de la puerta en el camino vivo (CanvasPlano).
const DOOR_WIDTH_PX = 0.8 * PIXELS_PER_METER; // 80 cm
const DOOR_LEAF_THICKNESS_PX = 6;
const DOOR_WALL_SNAP_PX = 25;

/** Valores por defecto que usa `renderElementoPlano` para una puerta. */
const PUERTA_ANCHO_DEF = 70;
const PUERTA_ALTO_DEF = 12;

/**
 * El CSS que emite `renderElementoPlano` para un elemento rectangular.
 * Copia literal de la fórmula de la vista: posición y tamaño en unidades de
 * escena, desplazadas por el encuadre (`offset`) y multiplicadas por el zoom.
 */
function cssDeElemento(
  elem: Record<string, any>,
  vista: { offsetX: number; offsetY: number; scale: number }
) {
  const rect = rectFabricDesdeElemento(elem, PUERTA_ANCHO_DEF, PUERTA_ALTO_DEF);
  return {
    left: (rect.left - vista.offsetX) * vista.scale,
    top: (rect.top - vista.offsetY) * vista.scale,
    width: rect.width * vista.scale,
    height: rect.height * vista.scale,
    transform: `rotate(${rect.angle}deg)`,
    transformOrigin: "0 0",
    angle: rect.angle,
  };
}

/**
 * Dónde acaba el CENTRO del div en pantalla, haciendo la cuenta que haría el
 * navegador: `transform-origin: 0 0` gira alrededor de la esquina superior
 * izquierda, que es justo donde lo dejan `left`/`top`.
 */
function centroEnPantalla(css: ReturnType<typeof cssDeElemento>): Punto {
  const rad = (css.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hx = css.width / 2;
  const hy = css.height / 2;
  return {
    x: css.left + hx * cos - hy * sin,
    y: css.top + hx * sin + hy * cos,
  };
}

/** Lo que hacía el código ANTIGUO: mismo div, pero sin `transform` ninguno. */
function centroEnPantallaSinRotar(css: ReturnType<typeof cssDeElemento>): Punto {
  return { x: css.left + css.width / 2, y: css.top + css.height / 2 };
}

/** Punto de escena → punto de pantalla, con el mismo encuadre y zoom. */
function aPantalla(p: Punto, vista: { offsetX: number; offsetY: number; scale: number }): Punto {
  return { x: (p.x - vista.offsetX) * vista.scale, y: (p.y - vista.offsetY) * vista.scale };
}

/** Distancia perpendicular de un punto a la recta del muro, en píxeles. */
function distanciaARecta(p: Punto, seg: SegmentoPared): number {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const largo = Math.hypot(dx, dy);
  return Math.abs((p.x - seg.x1) * dy - (p.y - seg.y1) * dx) / largo;
}

const cm = (px: number) => (px / PIXELS_PER_METER) * 100;

/** Sala rectangular de 10x6 m dibujada en el sentido de las agujas del reloj. */
const SALA: Array<{ nombre: string; seg: SegmentoPared; anguloEsperado: number }> = [
  { nombre: "arriba", seg: { x1: 0, y1: 0, x2: 500, y2: 0 }, anguloEsperado: 0 },
  { nombre: "derecha", seg: { x1: 500, y1: 0, x2: 500, y2: 300 }, anguloEsperado: 90 },
  { nombre: "abajo", seg: { x1: 500, y1: 300, x2: 0, y2: 300 }, anguloEsperado: 180 },
  { nombre: "izquierda", seg: { x1: 0, y1: 300, x2: 0, y2: 0 }, anguloEsperado: -90 },
];

/** Puerta colocada por el EDITOR sobre la pared indicada, tal cual se persiste. */
function puertaGuardadaEn(muro: SegmentoPared) {
  const medio = { x: (muro.x1 + muro.x2) / 2, y: (muro.y1 + muro.y2) / 2 };
  const puerta = calcularPuertaEnMuro(
    medio,
    [muro],
    DOOR_WIDTH_PX,
    DOOR_LEAF_THICKNESS_PX,
    DOOR_WALL_SNAP_PX
  );
  expect(puerta.anclada).toBe(true);
  return {
    id: "puerta-1",
    tipo: "door",
    props: {
      left: puerta.left,
      top: puerta.top,
      width: puerta.width,
      height: puerta.height,
      angle: puerta.angle,
    },
  };
}

const VISTA = { offsetX: 0, offsetY: 0, scale: 1 };

describe("la puerta de la vista de reservas cae SOBRE su pared", () => {
  it("en las cuatro paredes de una sala, con el CSS que emite la vista", () => {
    for (const { nombre, seg, anguloEsperado } of SALA) {
      const elem = puertaGuardadaEn(seg);
      expect(elem.props.angle, `ángulo de la pared ${nombre}`).toBeCloseTo(anguloEsperado, 6);

      const css = cssDeElemento(elem, VISTA);
      const centro = centroEnPantalla(css);
      expect(distanciaARecta(centro, seg), `pared ${nombre}`).toBeLessThanOrEqual(0.001);
    }
  });

  it("sin rotar (el código de antes) se apartaba 46, 34 y 12 cm de su pared", () => {
    // Mismas cifras que midió el arreglo del editor (commit 1e77baf): la
    // convención es la misma, así que el error de ignorar el giro también.
    const medidas = SALA.map(({ nombre, seg }) => {
      const css = cssDeElemento(puertaGuardadaEn(seg), VISTA);
      return {
        nombre,
        antes: Math.round(cm(distanciaARecta(centroEnPantallaSinRotar(css), seg))),
        ahora: Math.round(cm(distanciaARecta(centroEnPantalla(css), seg))),
      };
    });

    expect(medidas).toEqual([
      { nombre: "arriba", antes: 0, ahora: 0 },
      { nombre: "derecha", antes: 46, ahora: 0 },
      { nombre: "abajo", antes: 12, ahora: 0 },
      { nombre: "izquierda", antes: 34, ahora: 0 },
    ]);
  });

  it("la puerta sale TUMBADA en las paredes verticales, no horizontal", () => {
    // El síntoma que contó el dueño: todas horizontales. Una puerta de 80 cm
    // en una pared vertical tiene que ocupar 80 cm de ALTO y 6 px de ancho.
    const izquierda = SALA.find((m) => m.nombre === "izquierda")!;
    const css = cssDeElemento(puertaGuardadaEn(izquierda.seg), VISTA);

    // El div en sí sigue siendo ancho: lo que lo pone de pie es el transform.
    expect(css.width).toBeCloseTo(DOOR_WIDTH_PX, 6);
    expect(Math.abs(css.angle)).toBeCloseTo(90, 6);
    expect(css.transformOrigin).toBe("0 0");

    // Y su huella real en pantalla es vertical.
    const rad = (css.angle * Math.PI) / 180;
    const huellaX = Math.abs(css.width * Math.cos(rad)) + Math.abs(css.height * Math.sin(rad));
    const huellaY = Math.abs(css.width * Math.sin(rad)) + Math.abs(css.height * Math.cos(rad));
    expect(huellaY).toBeGreaterThan(huellaX);
    expect(huellaY).toBeCloseTo(DOOR_WIDTH_PX, 6);
  });
});

describe("el zoom y el encuadre no descolocan la puerta", () => {
  it("con cualquier zoom y desplazamiento, el centro sigue sobre la pared", () => {
    // Girar y escalar conmutan porque la escala es uniforme; este test es el
    // que impide que alguien 'arregle' el pivote metiendo el offset dentro del
    // transform o cambiando el origen a `center`.
    const izquierda = SALA.find((m) => m.nombre === "izquierda")!;
    const elem = puertaGuardadaEn(izquierda.seg);
    const centroEscena = centroRectFabric(rectFabricDesdeElemento(elem, PUERTA_ANCHO_DEF, PUERTA_ALTO_DEF));

    for (const scale of [0.35, 1, 2.4]) {
      for (const [offsetX, offsetY] of [
        [0, 0],
        [120, 80],
        [-40, 15.5],
      ]) {
        const vista = { offsetX, offsetY, scale };
        const obtenido = centroEnPantalla(cssDeElemento(elem, vista));
        const esperado = aPantalla(centroEscena, vista);
        const etiqueta = `scale ${scale}, offset ${offsetX},${offsetY}`;
        expect(obtenido.x, `x @ ${etiqueta}`).toBeCloseTo(esperado.x, 6);
        expect(obtenido.y, `y @ ${etiqueta}`).toBeCloseTo(esperado.y, 6);
      }
    }
  });
});

describe("`transform-origin: center center` sería otro fallo distinto", () => {
  it("girar por el centro deja la puerta fuera de la pared", () => {
    // Guardia contra el arreglo 'obvio' equivocado: es lo que usan las MESAS
    // (que sí se persisten centradas), y copiarlo aquí vuelve a romperlo.
    const derecha = SALA.find((m) => m.nombre === "derecha")!;
    const css = cssDeElemento(puertaGuardadaEn(derecha.seg), VISTA);

    const centroPorLaEsquina = centroEnPantalla(css);
    const centroPorElCentro = { x: css.left + css.width / 2, y: css.top + css.height / 2 };

    expect(distanciaARecta(centroPorLaEsquina, derecha.seg)).toBeLessThanOrEqual(0.001);
    expect(cm(distanciaARecta(centroPorElCentro, derecha.seg))).toBeGreaterThan(40);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// La BANDA de la pared tiene que quedar centrada en su línea.
//
// Lo destapó medir el arreglo de las puertas en el navegador: con la puerta ya
// bien colocada, en las paredes HORIZONTALES seguía viéndose separada. No era
// la puerta: la banda de la pared se pintaba entera por debajo de su línea
// (medio grosor, 3 px de escena ≈ 6 cm). En las verticales no se notaba porque
// el giro alrededor de `0 50%` ya la recentraba de casualidad.
// ─────────────────────────────────────────────────────────────────────────────

const GROSOR_PARED_ESCENA = 6;

/** CSS que emite `renderElementoPlano` para una pared. */
function cssDePared(seg: SegmentoPared, vista: { offsetX: number; offsetY: number; scale: number }) {
  const length = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
  const angle = (Math.atan2(seg.y2 - seg.y1, seg.x2 - seg.x1) * 180) / Math.PI;
  return {
    left: (seg.x1 - vista.offsetX) * vista.scale,
    top: (seg.y1 - vista.offsetY - GROSOR_PARED_ESCENA / 2) * vista.scale,
    width: length * vista.scale,
    height: GROSOR_PARED_ESCENA * vista.scale,
    angle,
  };
}

/** Punto local del div → pantalla, girando alrededor de `transform-origin: 0 50%`. */
function puntoDePared(css: ReturnType<typeof cssDePared>, lx: number, ly: number): Punto {
  const rad = (css.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const ox = 0;
  const oy = css.height / 2;
  const dx = lx - ox;
  const dy = ly - oy;
  return {
    x: css.left + ox + dx * cos - dy * sin,
    y: css.top + oy + dx * sin + dy * cos,
  };
}

describe("la banda de la pared queda centrada en su línea", () => {
  const VISTA_ZOOM = { offsetX: 25, offsetY: 10, scale: 1.7 };

  it("los extremos de la banda caen justo en (x1,y1) y (x2,y2)", () => {
    for (const { nombre, seg } of SALA) {
      const css = cssDePared(seg, VISTA_ZOOM);
      const inicio = puntoDePared(css, 0, css.height / 2);
      const fin = puntoDePared(css, css.width, css.height / 2);
      const esperadoInicio = aPantalla({ x: seg.x1, y: seg.y1 }, VISTA_ZOOM);
      const esperadoFin = aPantalla({ x: seg.x2, y: seg.y2 }, VISTA_ZOOM);

      expect(inicio.x, `inicio x · ${nombre}`).toBeCloseTo(esperadoInicio.x, 6);
      expect(inicio.y, `inicio y · ${nombre}`).toBeCloseTo(esperadoInicio.y, 6);
      expect(fin.x, `fin x · ${nombre}`).toBeCloseTo(esperadoFin.x, 6);
      expect(fin.y, `fin y · ${nombre}`).toBeCloseTo(esperadoFin.y, 6);
    }
  });

  it("la banda sobresale lo mismo a cada lado de la línea", () => {
    const medio = GROSOR_PARED_ESCENA / 2;
    for (const { nombre, seg } of SALA) {
      const css = cssDePared(seg, VISTA_ZOOM);
      const arriba = puntoDePared(css, css.width / 2, 0);
      const abajo = puntoDePared(css, css.width / 2, css.height);
      // La línea de la pared, en PANTALLA: mezclar escena y pantalla aquí da
      // números sin sentido (el zoom no es 1).
      const p1 = aPantalla({ x: seg.x1, y: seg.y1 }, VISTA_ZOOM);
      const p2 = aPantalla({ x: seg.x2, y: seg.y2 }, VISTA_ZOOM);
      const lineaEnPantalla: SegmentoPared = { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
      expect(
        distanciaARecta(arriba, lineaEnPantalla) / VISTA_ZOOM.scale,
        `lado A · ${nombre}`,
      ).toBeCloseTo(medio, 6);
      expect(
        distanciaARecta(abajo, lineaEnPantalla) / VISTA_ZOOM.scale,
        `lado B · ${nombre}`,
      ).toBeCloseTo(medio, 6);
    }
  });

  it("el centro de la puerta cae en el eje de la banda, no en su borde", () => {
    for (const { nombre, seg } of SALA) {
      const css = cssDePared(seg, VISTA_ZOOM);
      const ejeInicio = puntoDePared(css, 0, css.height / 2);
      const ejeFin = puntoDePared(css, css.width, css.height / 2);
      const centroPuerta = centroEnPantalla(cssDeElemento(puertaGuardadaEn(seg), VISTA_ZOOM));
      const eje: SegmentoPared = {
        x1: ejeInicio.x,
        y1: ejeInicio.y,
        x2: ejeFin.x,
        y2: ejeFin.y,
      };
      expect(distanciaARecta(centroPuerta, eje), `pared ${nombre}`).toBeLessThanOrEqual(0.001);
    }
  });

  it("sin la corrección, la puerta se separaba medio grosor en las horizontales", () => {
    // El `top` de antes: `(y1 - offsetY) * scale`, sin restar medio grosor.
    const vista = { offsetX: 0, offsetY: 0, scale: 1 };
    const medidas = SALA.map(({ nombre, seg }) => {
      const css = cssDePared(seg, vista);
      const cssViejo = { ...css, top: (seg.y1 - vista.offsetY) * vista.scale };
      const ejeViejo = {
        x1: puntoDePared(cssViejo, 0, cssViejo.height / 2).x,
        y1: puntoDePared(cssViejo, 0, cssViejo.height / 2).y,
        x2: puntoDePared(cssViejo, cssViejo.width, cssViejo.height / 2).x,
        y2: puntoDePared(cssViejo, cssViejo.width, cssViejo.height / 2).y,
      };
      const centroPuerta = centroEnPantalla(cssDeElemento(puertaGuardadaEn(seg), vista));
      return { nombre, antesCm: Math.round(cm(distanciaARecta(centroPuerta, ejeViejo))) };
    });

    // 3 px de escena = 6 cm a 50 px/m. Solo en las horizontales: en las
    // verticales el giro por `0 50%` ya recentraba la banda.
    expect(medidas).toEqual([
      { nombre: "arriba", antesCm: 6 },
      { nombre: "derecha", antesCm: 0 },
      { nombre: "abajo", antesCm: 6 },
      { nombre: "izquierda", antesCm: 0 },
    ]);
  });
});
