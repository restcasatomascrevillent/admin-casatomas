/**
 * Mesas grandes de «Hoy» de escritorio (07/11/2026): «Plano» (cada mesa en su sitio, a escala, lo más grande
 * posible sin pisarse) y «Ordenadas» (rejilla por número), siempre dentro del hueco.
 */
import { describe, it, expect } from "vitest";
import {
  compararNombreMesa,
  medidasTarjetas,
  planoFiel,
  rejillaOrdenadas,
  unidadesMesas,
  type CajaTarjeta,
} from "../mesasGrandes";

const m = (id: string, pos_x: number, pos_y: number, ancho = 80, alto = 80) => ({ id, nombre: id, pos_x, pos_y, ancho, alto });

// Posiciones reales de la demo (solo lectura, 07/11/2026): esquina en metros, tamaño en cm.
const SALON = [
  m("1", 8.21, 6.0, 70, 110), m("10", 15.2, 2.0, 70, 110), m("11", 10.9, 3.3, 150, 150), m("12", 7.25, 2.25, 150, 150),
  m("13", 11.6, 0.9, 110, 70), m("14", 9.7, 0.9, 110, 70), m("2", 6.39, 6.0, 70, 55), m("3", 4.51, 6.0, 70, 110),
  m("4", 2.26, 6.0, 70, 110), m("5", 13.89, 5.72, 150, 150), m("7", 9.0, 5.03, 70, 55), m("8", 5.26, 4.3, 70, 110),
  m("9", 2.26, 4.3, 70, 110),
];
const TERRAZA = Array.from({ length: 16 }, (_, i) => m(String(i + 1), 2.2 + (i % 4) * 1.8, 2.2 + Math.floor(i / 4) * 1.8, 65, 65));

const seSolapan = (a: CajaTarjeta, b: CajaTarjeta) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

function comprobarDentroYSinSolapes(cajas: CajaTarjeta[], ancho: number, alto: number) {
  for (const c of cajas) {
    expect(c.left).toBeGreaterThanOrEqual(0);
    expect(c.top).toBeGreaterThanOrEqual(0);
    expect(c.left + c.width).toBeLessThanOrEqual(ancho);
    expect(c.top + c.height).toBeLessThanOrEqual(alto);
  }
  for (let i = 0; i < cajas.length; i++) for (let j = i + 1; j < cajas.length; j++) expect(seSolapan(cajas[i], cajas[j])).toBe(false);
}

describe("planoFiel («Plano»)", () => {
  for (const [nombre, sala] of [["Salón", SALON], ["Terraza", TERRAZA]] as const) {
    for (const [ancho, alto] of [[760, 520], [520, 470]]) {
      it(`${nombre} en ${ancho}×${alto}: todas dentro del hueco, sin solaparse, y ninguna más alta que ancha`, () => {
        const { cajas } = planoFiel(unidadesMesas(sala), ancho, alto);
        expect(cajas).toHaveLength(sala.length);
        comprobarDentroYSinSolapes(cajas, ancho, alto);
        for (const c of cajas) expect(c.height).toBeLessThanOrEqual(c.width);
      });
    }
  }

  it("respeta la posición relativa: lo que está a la izquierda (o arriba) en la sala, queda a la izquierda (o arriba)", () => {
    const { cajas } = planoFiel(unidadesMesas(SALON), 760, 520);
    const centro = (id: string) => {
      const c = cajas.find((x) => x.ids[0] === id)!;
      return { x: c.left + c.width / 2, y: c.top + c.height / 2 };
    };
    // 4 (x 2,26) a la izquierda de 3 (4,51), de 2 (6,39) y de 1 (8,21): la fila de abajo del Salón.
    expect(centro("4").x).toBeLessThan(centro("3").x);
    expect(centro("3").x).toBeLessThan(centro("2").x);
    expect(centro("2").x).toBeLessThan(centro("1").x);
    // 10 (x 15,2) es la de más a la derecha; 14 y 13 (y 0,9) las de más arriba.
    expect(Math.max(...SALON.map((s) => centro(s.id).x))).toBe(centro("10").x);
    expect(centro("14").y).toBeLessThan(centro("9").y);
  });

  it("recorta los márgenes vacíos: las tarjetas de los extremos tocan los bordes del hueco (con su relleno)", () => {
    const { cajas } = planoFiel(unidadesMesas(TERRAZA), 600, 600);
    expect(Math.min(...cajas.map((c) => c.left))).toBeLessThanOrEqual(9);
    expect(Math.max(...cajas.map((c) => c.left + c.width))).toBeGreaterThanOrEqual(591);
  });

  it("con poco sitio, `minimo` baja de 44 px (la sala pasará a «Ordenadas»)", () => {
    expect(planoFiel(unidadesMesas(SALON), 760, 520).minimo).toBeGreaterThanOrEqual(44);
    expect(planoFiel(unidadesMesas(SALON), 220, 160).minimo).toBeLessThan(44);
  });

  it("las mesas unidas son una sola tarjeta", () => {
    const u = unidadesMesas([m("a", 1, 1), m("b", 1.8, 1), m("c", 5, 1)], [{ ids: ["a", "b"], pos_x: 1, pos_y: 1, ancho: 160, alto: 80 }]);
    expect(u.map((x) => x.ids)).toEqual([["a", "b"], ["c"]]);
  });
});

describe("«Ordenadas»", () => {
  it("orden natural por número: el 10 después del 9", () => {
    expect(["10", "2", "1", "9", "14"].sort(compararNombreMesa)).toEqual(["1", "2", "9", "10", "14"]);
  });

  it("rejillaOrdenadas: todas caben sin scroll y las tarjetas no son más altas que anchas", () => {
    for (const [n, ancho, alto] of [[13, 760, 520], [16, 520, 470], [3, 900, 560], [1, 300, 200]]) {
      const r = rejillaOrdenadas(n, ancho, alto);
      expect(r.filas * r.columnas).toBeGreaterThanOrEqual(n);
      expect(r.columnas * r.tarjetaAncho + (r.columnas - 1) * r.hueco + 16).toBeLessThanOrEqual(ancho);
      expect(r.filas * r.tarjetaAlto + (r.filas - 1) * r.hueco + 16).toBeLessThanOrEqual(alto);
      expect(r.tarjetaAlto).toBeLessThanOrEqual(r.tarjetaAncho);
      expect(r.tarjetaAlto).toBeGreaterThanOrEqual(44);
    }
  });

  it("medidasTarjetas nunca se pasa del hueco", () => {
    const { tarjetaAncho, tarjetaAlto, hueco } = medidasTarjetas(480, 560, 6, 3);
    expect(3 * tarjetaAncho + 2 * hueco + 16).toBeLessThanOrEqual(480);
    expect(6 * tarjetaAlto + 5 * hueco + 16).toBeLessThanOrEqual(560);
  });
});
