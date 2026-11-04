import { describe, expect, it } from "vitest";
import {
  agrupar,
  formatearPorcentaje,
  interaccionesDe,
  ordenarPublicaciones,
  queFuncionaMejor,
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

describe("agregación de «Qué funciona mejor»", () => {
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

  it("agrupa por plantilla, marca y tipo de foto; la tasa pondera por alcance; ignora lo que no salió del panel", () => {
    const pubs = [
      pub({ mediaId: "1", piezaId: "a", marca: "casa-tomas", plantilla: "ct-foto-titular", foto: "ct-salon-1", alcance: 100, interacciones: 10 }),
      pub({ mediaId: "2", piezaId: "b", marca: "casa-tomas", plantilla: "ct-foto-titular", foto: "ct-champan", alcance: 300, interacciones: 6 }),
      pub({ mediaId: "3", piezaId: "c", marca: "touza", plantilla: "tz-tipografica", alcance: 1000, interacciones: 100 }),
      pub({ mediaId: "4", alcance: 5000, interacciones: 500 }),
    ];
    const r = queFuncionaMejor(pubs);
    expect(r.conPieza).toBe(3);
    expect(r.sinPieza).toBe(1);
    expect(r.porPlantilla.map((g) => [g.clave, g.publicaciones, g.alcanceMedio, g.interaccionesMedias, g.tasaInteraccion])).toEqual([
      ["tz-tipografica", 1, 1000, 100, 10],
      ["ct-foto-titular", 2, 200, 8, 4],
    ]);
    expect(r.porPlantilla[1].etiqueta).not.toBe("ct-foto-titular"); // nombre legible de la plantilla
    expect(r.porMarca.map((g) => g.clave)).toEqual(["touza", "casa-tomas"]);
    expect(r.porTipoFoto.map((g) => [g.clave, g.etiqueta, g.alcanceMedio])).toEqual([
      ["bebida", "Bebida", 300],
      ["sala", "Sala", 100],
    ]);
  });

  it("grupos sin alcance van al final y no rompen las medias", () => {
    const g = agrupar([pub({ plantilla: "x" }), pub({ plantilla: "y", alcance: 5 })], (p) => p.plantilla, (c) => c);
    expect(g.map((x) => [x.clave, x.alcanceMedio, x.tasaInteraccion])).toEqual([
      ["y", 5, null],
      ["x", null, null],
    ]);
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
