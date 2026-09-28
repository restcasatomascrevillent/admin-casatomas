/**
 * Tests para supabase/functions/procesar-dibujo-perimetro/geometria.ts
 * (TS puro, sin Deno): corre bajo vitest igual que chat-web/alergenos.test.ts.
 *
 * Lo crítico: el modelo acierta la FORMA pero falla la ARITMÉTICA del área en
 * plantas no convexas. Estos tests fijan que la cuenta la hacemos nosotros y
 * que sale exacta, usando como referencia los dos croquis reales del
 * restaurante medidos el 28/09/2026.
 */
import { describe, expect, it } from "vitest";
import {
  areaPoligono,
  longitudSegmento,
  perimetroDeParedes,
  redondear,
  type Punto,
} from "../geometria.ts";

// ─── Los dos croquis reales ──────────────────────────────────────────────────
// Comedor (croquis 40): planta escalonada, no convexa. 46 m de perímetro,
// 112 m² de superficie.
const COMEDOR: Punto[] = [
  { x: 0, y: 0 },
  { x: 12, y: 0 },
  { x: 12, y: 9 },
  { x: 7, y: 9 },
  { x: 7, y: 11 },
  { x: 2, y: 11 },
  { x: 2, y: 6 },
  { x: 0, y: 6 },
];

// Terraza (croquis 41): cuadrilátero simple. 32 m de perímetro, 63 m².
const TERRAZA: Punto[] = [
  { x: 0, y: 0 },
  { x: 9, y: 0 },
  { x: 9, y: 7 },
  { x: 0, y: 7 },
];

function aParedes(esquinas: Punto[]) {
  return esquinas.map((a, i) => {
    const b = esquinas[(i + 1) % esquinas.length];
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  });
}

describe("longitudSegmento", () => {
  it("mide un tramo horizontal", () => {
    expect(longitudSegmento(0, 0, 12, 0)).toBe(12);
  });

  it("mide un tramo vertical", () => {
    expect(longitudSegmento(12, 0, 12, 9)).toBe(9);
  });

  it("mide una diagonal (3-4-5)", () => {
    expect(longitudSegmento(0, 0, 3, 4)).toBe(5);
  });

  it("no depende del sentido del trazo", () => {
    expect(longitudSegmento(2, 6, 0, 6)).toBe(longitudSegmento(0, 6, 2, 6));
  });
});

describe("areaPoligono", () => {
  it("clava el área del comedor, que es NO convexo (el caso que falla el modelo)", () => {
    // gpt-5.4-mini devolvió 95, 98, 98, 100, 103 y 104 m² para esta misma
    // planta en seis intentos. La cuenta exacta sobre SUS PROPIAS esquinas
    // da 112.
    expect(areaPoligono(COMEDOR)).toBe(112);
  });

  it("clava el área de la terraza", () => {
    expect(areaPoligono(TERRAZA)).toBe(63);
  });

  it("da lo mismo recorrido en sentido horario que antihorario", () => {
    expect(areaPoligono([...COMEDOR].reverse())).toBe(112);
  });

  it("devuelve null si no hay polígono que medir", () => {
    expect(areaPoligono([])).toBeNull();
    expect(areaPoligono([{ x: 0, y: 0 }])).toBeNull();
    expect(areaPoligono([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
  });

  it("declara no calculable un polígono degenerado en vez de devolver 0 m²", () => {
    // Tres esquinas alineadas: no encierran superficie. Medido de verdad —
    // con una variante del prompt el modelo devolvió 10 esquinas cuyo
    // recorrido se cruza y el shoelace daba 0. Enseñar "0 m²" en el lienzo
    // sería peor que no enseñar nada.
    expect(areaPoligono([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }])).toBeNull();
  });

  it("declara no calculable si alguna coordenada no es un número", () => {
    expect(areaPoligono([{ x: 0, y: 0 }, { x: NaN, y: 3 }, { x: 4, y: 0 }])).toBeNull();
  });

  it("no exige que la última esquina repita la primera (el anillo se cierra solo)", () => {
    const cerradoAMano = [...TERRAZA, { x: 0, y: 0 }];
    expect(areaPoligono(cerradoAMano)).toBe(63);
  });
});

describe("perimetroDeParedes", () => {
  it("suma los 46 m del comedor", () => {
    expect(perimetroDeParedes(aParedes(COMEDOR))).toBe(46);
  });

  it("suma los 32 m de la terraza", () => {
    expect(perimetroDeParedes(aParedes(TERRAZA))).toBe(32);
  });

  it("devuelve null si no hay paredes", () => {
    expect(perimetroDeParedes([])).toBeNull();
  });

  it("declara no calculable si alguna coordenada no es un número", () => {
    expect(perimetroDeParedes([{ x1: 0, y1: 0, x2: NaN, y2: 4 }])).toBeNull();
  });

  it("declara no calculable un perímetro de longitud cero", () => {
    expect(perimetroDeParedes([{ x1: 3, y1: 3, x2: 3, y2: 3 }])).toBeNull();
  });

  it("ignora el campo `length` del modelo y recalcula desde los extremos", () => {
    // Pared de 5 m que el modelo etiquetó como 99: se mide, no se cree.
    const mentirosa = [{ x1: 0, y1: 0, x2: 3, y2: 4, length: 99 }];
    expect(perimetroDeParedes(mentirosa)).toBe(5);
  });
});

describe("redondear", () => {
  it("deja 2 decimales", () => {
    expect(redondear(45.556789)).toBe(45.56);
    expect(redondear(112.3958)).toBe(112.4);
  });

  it("limpia el ruido en coma flotante", () => {
    expect(redondear(0.1 + 0.2)).toBe(0.3);
  });

  it("no toca los enteros", () => {
    expect(redondear(46)).toBe(46);
  });
});

// ─── Salida real del modelo ──────────────────────────────────────────────────
describe("respuesta real de gpt-5.4-mini sobre el croquis del comedor", () => {
  // Capturada el 28/09/2026. La forma es exacta; el área que se inventó, no.
  const RESPUESTA_REAL = {
    walls: [
      { x1: 0, y1: 0, x2: 12, y2: 0, length: 12.0 },
      { x1: 12, y1: 0, x2: 12, y2: 9, length: 9.0 },
      { x1: 12, y1: 9, x2: 7, y2: 9, length: 5.0 },
      { x1: 7, y1: 9, x2: 7, y2: 11, length: 2.0 },
      { x1: 7, y1: 11, x2: 2, y2: 11, length: 5.0 },
      { x1: 2, y1: 11, x2: 2, y2: 6, length: 5.0 },
      { x1: 2, y1: 6, x2: 0, y2: 6, length: 2.0 },
      { x1: 0, y1: 6, x2: 0, y2: 0, length: 6.0 },
    ],
    corners: COMEDOR,
    perimeter: 46.0,
    area: 103.0, // ← el modelo se equivoca aquí
  };

  it("el perímetro que calculamos coincide con el suyo (46 m)", () => {
    expect(perimetroDeParedes(RESPUESTA_REAL.walls)).toBe(RESPUESTA_REAL.perimeter);
  });

  it("el área que calculamos corrige la suya: 112 m² reales frente a los 103 que dijo", () => {
    const nuestra = areaPoligono(RESPUESTA_REAL.corners);
    expect(nuestra).toBe(112);
    expect(nuestra).not.toBe(RESPUESTA_REAL.area);
  });
});
