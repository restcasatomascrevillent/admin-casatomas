import { describe, expect, it } from "vitest";
import {
  formatearPorcentaje,
  interaccionesDe,
  ordenarPublicaciones,
  tasaDe,
  textoVariacion,
  tipoFotoDe,
} from "../agregacion";
import type { Publicacion } from "../tipos";

const pub = (o: Partial<Publicacion>): Publicacion => ({
  mediaId: "1",
  piezaId: null,
  marca: null,
  plantilla: null,
  formato: null,
  foto: null,
  tipoFoto: null,
  tipoMedio: "IMAGE",
  producto: "FEED",
  publicadoAt: null,
  permalink: null,
  miniaturaUrl: null,
  caption: null,
  fechaCaptura: "2026-11-05",
  alcance: null,
  meGusta: null,
  comentarios: null,
  guardados: null,
  compartidos: null,
  visualizaciones: null,
  interacciones: null,
  ...o,
});

describe("utilidades de la pestaña Métricas", () => {
  it("interacciones: las de Meta o la suma del desglose; tasa sobre el alcance", () => {
    expect(interaccionesDe(pub({ interacciones: 9, meGusta: 100 }))).toBe(9);
    expect(interaccionesDe(pub({ meGusta: 5, comentarios: 2, guardados: null, compartidos: 1 }))).toBe(8);
    expect(interaccionesDe(pub({}))).toBeNull();
    expect(tasaDe(pub({ alcance: 200, interacciones: 15 }))).toBe(7.5);
    expect(tasaDe(pub({ alcance: 0, interacciones: 15 }))).toBeNull();
  });

  it("tipo de foto: el de la función (foto subida) o el del catálogo estático", () => {
    expect(tipoFotoDe(pub({ tipoFoto: "plato", foto: "uuid" }))).toBe("plato");
    expect(tipoFotoDe(pub({ foto: "ct-salon-1" }))).toBe("sala");
    expect(tipoFotoDe(pub({ foto: "no-existe" }))).toBeNull();
    expect(tipoFotoDe(pub({ tipoFoto: "raro" }))).toBeNull();
  });

  it("formatos en español y orden de la lista", () => {
    expect(textoVariacion(12.5)).toBe("+12,5 %");
    expect(textoVariacion(-3)).toBe("−3 %");
    expect(textoVariacion(0)).toBe("= 0 %");
    expect(textoVariacion(null)).toBe("—");
    expect(formatearPorcentaje(7.5)).toBe("7,5 %");
    const lista = [pub({ mediaId: "a", publicadoAt: "2026-11-01T00:00:00Z", alcance: 9 }), pub({ mediaId: "b", publicadoAt: "2026-11-03T00:00:00Z", alcance: 1 })];
    expect(ordenarPublicaciones(lista, "recientes").map((p) => p.mediaId)).toEqual(["b", "a"]);
    expect(ordenarPublicaciones(lista, "alcance").map((p) => p.mediaId)).toEqual(["a", "b"]);
  });
});
