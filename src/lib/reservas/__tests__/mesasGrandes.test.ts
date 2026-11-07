/** Mesas grandes de «Hoy» de escritorio (07/11/2026): de las posiciones del plano a una rejilla sin solapes. */
import { describe, it, expect } from "vitest";
import { agruparCercanos, medidasTarjetas, rejillaMesasGrandes } from "../mesasGrandes";

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

describe("rejillaMesasGrandes · sin huecos ni scroll (Salón de la demo, 07/11/2026)", () => {
  // Posiciones reales del Salón (demo): esquina en metros, tamaño en cm.
  const SALON = [
    m("1", 8.21, 6.0, 70, 110), m("10", 15.2, 2.0, 70, 110), m("11", 10.9, 3.3, 150, 150), m("12", 7.25, 2.25, 150, 150),
    m("13", 11.6, 0.9, 110, 70), m("14", 9.7, 0.9, 110, 70), m("2", 6.39, 6.0, 70, 55), m("3", 4.51, 6.0, 70, 110),
    m("4", 2.26, 6.0, 70, 110), m("5", 13.89, 5.72, 150, 150), m("7", 9.0, 5.03, 70, 55), m("8", 5.26, 4.3, 70, 110),
    m("9", 2.26, 4.3, 70, 110),
  ];

  it("tantas columnas como la fila más larga: ninguna columna vacía", () => {
    const r = rejillaMesasGrandes(SALON);
    const usadas = new Set(r.celdas.map((c) => c.columna));
    expect(usadas.size).toBe(r.columnas);
    const porFila = new Map<number, number>();
    r.celdas.forEach((c) => porFila.set(c.fila, (porFila.get(c.fila) ?? 0) + 1));
    expect(Math.max(...porFila.values())).toBe(r.columnas);
    expect(new Set(r.celdas.map((c) => c.fila)).size).toBe(r.filas);
    expect(new Set(r.celdas.map((c) => `${c.fila}-${c.columna}`)).size).toBe(13);
  });

  it("con poco alto junta filas hasta que quepan, sin perder mesas ni solaparlas", () => {
    const r = rejillaMesasGrandes(SALON, [], 3);
    expect(r.filas).toBeLessThanOrEqual(3);
    expect(new Set(r.celdas.map((c) => `${c.fila}-${c.columna}`)).size).toBe(13);
    expect(r.celdas.every((c) => c.columna <= r.columnas)).toBe(true);
  });

  it("medidasTarjetas: filas × columnas entran enteras en el hueco, y nunca más altas que anchas", () => {
    for (const [ancho, alto] of [[760, 540], [480, 560], [1300, 900], [300, 250]]) {
      for (const [filas, columnas] of [[5, 5], [2, 8], [6, 3]]) {
        const { tarjetaAncho, tarjetaAlto, hueco } = medidasTarjetas(ancho, alto, filas, columnas);
        expect(columnas * tarjetaAncho + (columnas - 1) * hueco + 16).toBeLessThanOrEqual(ancho);
        expect(filas * tarjetaAlto + (filas - 1) * hueco + 16).toBeLessThanOrEqual(alto);
        expect(tarjetaAlto).toBeLessThanOrEqual(tarjetaAncho);
      }
    }
  });
});
