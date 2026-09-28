import { describe, it, expect } from "vitest";
import {
  MERGE_THRESHOLD,
  detectarAdyacenciaMesas,
  type CajaMesa,
} from "../CanvasPlano";
import { PIXELS_PER_METER } from "../planoUtils";

/**
 * `detectarAdyacenciaMesas` es lo que decide si se OFRECE unir dos mesas.
 *
 * Antes esta misma detección disparaba la fusión SOLA, con un setTimeout, al
 * soltar cualquier mesa: las dos mesas desaparecían y se sustituían por una
 * "7+8" con la capacidad sumada, sin confirmación ni aviso. Como el umbral
 * son 15px (30cm a 50px/m) con solape de ejes, el gesto que lo disparaba era
 * exactamente el de montar una fila normal de mesas. Estos tests fijan qué se
 * considera "juntas"; que la fusión la pida el usuario se garantiza en
 * CanvasPlano (solo `ofrecerFusion` llama a `fusionarMesas`).
 */

/** Mesa cuadrada de 80cm, como la que crea la herramienta. */
const LADO_PX = 0.8 * PIXELS_PER_METER; // 40px

function mesa(left: number, top: number, width = LADO_PX, height = LADO_PX): CajaMesa {
  return { left, top, width, height };
}

describe("MERGE_THRESHOLD", () => {
  it("son 30cm a la escala real del plano", () => {
    expect((MERGE_THRESHOLD / PIXELS_PER_METER) * 100).toBe(30);
  });
});

describe("detectarAdyacenciaMesas", () => {
  it("detecta dos mesas pegadas lado a lado", () => {
    expect(detectarAdyacenciaMesas(mesa(0, 0), mesa(LADO_PX, 0))).toBe("horizontal");
  });

  it("detecta dos mesas pegadas una encima de otra", () => {
    expect(detectarAdyacenciaMesas(mesa(0, 0), mesa(0, LADO_PX))).toBe("vertical");
  });

  it("es simétrica: da igual cuál de las dos se mueva", () => {
    const a = mesa(0, 0);
    const b = mesa(LADO_PX + 5, 0);
    expect(detectarAdyacenciaMesas(a, b)).toBe("horizontal");
    expect(detectarAdyacenciaMesas(b, a)).toBe("horizontal");
  });

  it("acepta un hueco justo por debajo del umbral y lo rechaza justo por encima", () => {
    const a = mesa(0, 0);
    expect(detectarAdyacenciaMesas(a, mesa(LADO_PX + MERGE_THRESHOLD - 0.5, 0))).toBe("horizontal");
    expect(detectarAdyacenciaMesas(a, mesa(LADO_PX + MERGE_THRESHOLD, 0))).toBeNull();
    expect(detectarAdyacenciaMesas(a, mesa(LADO_PX + MERGE_THRESHOLD + 0.5, 0))).toBeNull();
  });

  it("no considera adyacentes dos mesas alineadas pero separadas", () => {
    // Una fila con 50cm (25px) de paso entre mesas: separación real de sala.
    expect(detectarAdyacenciaMesas(mesa(0, 0), mesa(LADO_PX + 25, 0))).toBeNull();
  });

  it("exige solape de ejes: pegadas en X pero desplazadas en Y no cuentan", () => {
    // Bordes verticales a 0px, pero una empieza justo donde acaba la otra en Y.
    expect(detectarAdyacenciaMesas(mesa(0, 0), mesa(LADO_PX, LADO_PX))).toBeNull();
  });

  it("basta con que se solapen un poco en el otro eje", () => {
    expect(detectarAdyacenciaMesas(mesa(0, 0), mesa(LADO_PX, LADO_PX - 1))).toBe("horizontal");
  });

  it("dos mesas solapadas encima la una de la otra también son candidatas", () => {
    // Borde derecho de A contra borde izquierdo de B, superpuestas 5px.
    expect(detectarAdyacenciaMesas(mesa(0, 0), mesa(LADO_PX - 5, 0))).toBe("horizontal");
  });

  it("mesas de tamaños distintos: se mide por bordes, no por centros", () => {
    const grande = mesa(0, 0, 150, 90);
    const pequena = mesa(150, 40, 40, 40);
    expect(detectarAdyacenciaMesas(grande, pequena)).toBe("horizontal");
  });

  it("acepta un umbral a medida", () => {
    const a = mesa(0, 0);
    const b = mesa(LADO_PX + 40, 0);
    expect(detectarAdyacenciaMesas(a, b)).toBeNull();
    expect(detectarAdyacenciaMesas(a, b, 50)).toBe("horizontal");
  });

  it("una mesa lejos en diagonal no es candidata", () => {
    expect(detectarAdyacenciaMesas(mesa(0, 0), mesa(200, 200))).toBeNull();
  });

  it("prioriza horizontal cuando se cumplen las dos condiciones (esquina a esquina)", () => {
    // Solapando en las dos direcciones: el criterio histórico es horizontal.
    expect(detectarAdyacenciaMesas(mesa(0, 0), mesa(LADO_PX - 10, LADO_PX - 10))).toBe("horizontal");
  });
});
