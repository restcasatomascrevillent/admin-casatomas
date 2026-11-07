/** Mesas grandes de «Hoy» de escritorio (07/11/2026): de las posiciones del plano a una rejilla sin solapes. */
import { describe, it, expect } from "vitest";
import { agruparCercanos, rejillaMesasGrandes } from "../mesasGrandes";

const m = (id: string, pos_x: number, pos_y: number, ancho = 80, alto = 80) => ({ id, pos_x, pos_y, ancho, alto });

describe("agruparCercanos", () => {
  it("junta valores cercanos y separa los lejanos", () => {
    expect(agruparCercanos([1, 1.1, 3, 3.2, 6], 0.5, 1.2)).toEqual([0, 0, 1, 1, 2]);
  });
  it("una hilera de valores muy juntos no acaba en un solo grupo (tramo máximo)", () => {
    expect(new Set(agruparCercanos([0, 0.4, 0.8, 1.2, 1.6, 2.0], 0.5, 1)).size).toBeGreaterThan(1);
  });
});

describe("rejillaMesasGrandes", () => {
  it("sin mesas, rejilla vacía", () => {
    expect(rejillaMesasGrandes([])).toEqual({ filas: 0, columnas: 0, celdas: [] });
  });

  it("conserva filas y columnas de la sala", () => {
    const r = rejillaMesasGrandes([m("a", 1, 1), m("b", 3, 1), m("c", 5, 1), m("d", 1, 4), m("e", 3, 4)]);
    expect(r.filas).toBe(2);
    expect(r.columnas).toBe(3);
    const pos = Object.fromEntries(r.celdas.map((c) => [c.ids[0], [c.fila, c.columna]]));
    expect(pos).toEqual({ a: [1, 1], b: [1, 2], c: [1, 3], d: [2, 1], e: [2, 2] });
  });

  it("dos mesas en la misma casilla no se pisan: la segunda pasa a la columna siguiente", () => {
    const r = rejillaMesasGrandes([m("a", 1, 1), m("b", 1.2, 1.1), m("c", 1, 4)]);
    const casillas = r.celdas.map((c) => `${c.fila}-${c.columna}`);
    expect(new Set(casillas).size).toBe(casillas.length);
    expect(r.columnas).toBe(2);
  });

  it("las mesas unidas de una reserva van en UNA casilla, la principal primero", () => {
    const r = rejillaMesasGrandes(
      [m("a", 1, 1), m("b", 1.8, 1), m("c", 5, 1)],
      [{ ids: ["a", "b"], pos_x: 1, pos_y: 1, ancho: 160, alto: 80 }],
    );
    expect(r.celdas.map((c) => c.ids)).toEqual([["a", "b"], ["c"]]);
    expect(r.columnas).toBe(2);
  });

  it("sin solapes con muchas mesas desordenadas", () => {
    const mesas = Array.from({ length: 20 }, (_, i) => m(`m${i}`, (i * 37) % 11, (i * 53) % 7));
    const r = rejillaMesasGrandes(mesas);
    const casillas = r.celdas.map((c) => `${c.fila}-${c.columna}`);
    expect(new Set(casillas).size).toBe(20);
    expect(r.celdas.every((c) => c.fila <= r.filas && c.columna <= r.columnas)).toBe(true);
  });
});

describe("rejillaMesasGrandes · con poco ancho", () => {
  it("si la sala pide más columnas de las que caben, se comprimen sin solaparse ni perder el orden de cada fila", () => {
    const mesas = [m("a", 1, 1), m("b", 2.6, 1), m("c", 4.2, 1), m("d", 1.8, 4), m("e", 3.4, 4), m("f", 5, 4)];
    const libre = rejillaMesasGrandes(mesas);
    expect(libre.columnas).toBeGreaterThan(3);
    const r = rejillaMesasGrandes(mesas, [], 3);
    expect(r.columnas).toBe(3);
    const casillas = r.celdas.map((c) => `${c.fila}-${c.columna}`);
    expect(new Set(casillas).size).toBe(6);
    const fila2 = r.celdas.filter((c) => c.fila === 2).map((c) => c.ids[0]);
    expect(fila2).toEqual(["d", "e", "f"]);
  });
});
