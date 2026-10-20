/**
 * Posición inicial de una mesa dada de alta desde `PlanoEspacio2D`.
 *
 * El fallo que cubre: el alta mandaba `pos_x: 50, pos_y: 50`. Esas columnas van
 * en METROS, así que la mesa nacía a 50 m, fuera de cualquier sala.
 */
import { describe, it, expect } from "vitest";
import { posicionInicialMesaNueva, POSICION_RESPALDO_M } from "../posicionMesaNueva";
import { mesasFueraDelPlano } from "@/components/espacios/planoUtils";

const SALA = { width: 12, height: 8 };

const vacia = () =>
  posicionInicialMesaNueva({ anchoCm: 80, altoCm: 80, forma: "rectangular", espacio: SALA, mesas: [] });

describe("posicionInicialMesaNueva", () => {
  it("en un plano vacío cae dentro de la sala, en metros (nunca 50, 50)", () => {
    const p = vacia();
    expect(p.sinHueco).toBe(false);
    expect([p.pos_x, p.pos_y]).not.toEqual([50, 50]);
    expect(
      mesasFueraDelPlano([{ nombre: "n", posX: p.pos_x, posY: p.pos_y, ancho: 80, alto: 80 }], SALA),
    ).toEqual([]);
  });

  it("esquiva las mesas ya colocadas", () => {
    const primera = vacia();
    const p = posicionInicialMesaNueva({
      anchoCm: 80,
      altoCm: 80,
      forma: "rectangular",
      espacio: SALA,
      mesas: [{ pos_x: primera.pos_x, pos_y: primera.pos_y, ancho: 80, alto: 80 }],
    });
    expect(p.sinHueco).toBe(false);
    expect([p.pos_x, p.pos_y]).not.toEqual([primera.pos_x, primera.pos_y]);
  });

  it("ignora las mesas inactivas y las fusionadas (no se dibujan)", () => {
    const primera = vacia();
    const p = posicionInicialMesaNueva({
      anchoCm: 80,
      altoCm: 80,
      forma: "rectangular",
      espacio: SALA,
      mesas: [
        { pos_x: primera.pos_x, pos_y: primera.pos_y, ancho: 80, alto: 80, activa: false },
        { pos_x: primera.pos_x, pos_y: primera.pos_y, ancho: 80, alto: 80, is_merged: true },
      ],
    });
    expect([p.pos_x, p.pos_y]).toEqual([primera.pos_x, primera.pos_y]);
  });

  it("esquiva las paredes (que están en px de escena a 50 px/m)", () => {
    const primera = vacia();
    // Pared vertical (en px) que atraviesa justo el primer hueco libre.
    const xPx = (primera.pos_x + 0.4) * 50;
    const p = posicionInicialMesaNueva({
      anchoCm: 80,
      altoCm: 80,
      forma: "rectangular",
      espacio: SALA,
      mesas: [],
      elementos: [{ tipo: "wall", props: { x1: xPx, y1: 0, x2: xPx, y2: 8 * 50 } }],
    });
    expect(p.sinHueco).toBe(false);
    expect(p.pos_x).toBeGreaterThan(primera.pos_x);
  });

  it("una mesa circular ocupa un cuadrado de lado `ancho`", () => {
    const p = posicionInicialMesaNueva({ anchoCm: 150, altoCm: 10, forma: "circular", espacio: SALA, mesas: [] });
    expect(
      mesasFueraDelPlano([{ nombre: "c", posX: p.pos_x, posY: p.pos_y, ancho: 150, alto: 150 }], SALA),
    ).toEqual([]);
  });

  it("sin hueco libre usa el respaldo (1 m, 1 m) y lo dice", () => {
    const p = posicionInicialMesaNueva({
      anchoCm: 80,
      altoCm: 80,
      forma: "rectangular",
      espacio: { width: 1, height: 1 },
      mesas: [{ pos_x: 0.1, pos_y: 0.1, ancho: 80, alto: 80 }],
    });
    expect(p.sinHueco).toBe(true);
    expect({ x: p.pos_x, y: p.pos_y }).toEqual(POSICION_RESPALDO_M);
  });
});
