import { describe, expect, it } from "vitest";
import { ejemplosUbicacion, elegirRegion, normalizarUbicacion, regionEsGenerica } from "../ubicacion-vino.ts";

describe("regionEsGenerica", () => {
  it("una comunidad autónoma, el país o un valor vacío no sitúan el vino", () => {
    for (const r of ["Galicia", "galicia", "Castilla y León", "La Rioja", "Cataluña", "España", " ", null, undefined]) {
      expect(regionEsGenerica(r, "España"), String(r)).toBe(true);
    }
    expect(regionEsGenerica("Francia", "Francia")).toBe(true);
  });
  it("una localidad, comarca o subzona sí", () => {
    for (const r of ["Val do Salnés, Pontevedra", "Cambados, Pontevedra", "Rioja Alta", "Peñafiel, Valladolid", "Ribera del Duero, Castilla y León"]) {
      expect(regionEsGenerica(r, "España"), r).toBe(false);
    }
  });
  it("normaliza tildes y mayúsculas", () => {
    expect(normalizarUbicacion("  Cataluña ")).toBe("cataluna");
    expect(regionEsGenerica("ANDALUCÍA")).toBe(true);
  });
});

describe("elegirRegion", () => {
  it("si la etiqueta solo da «Galicia» y la ficha da el Val do Salnés, gana la ficha", () => {
    expect(elegirRegion("Galicia", "Val do Salnés, Pontevedra", "España")).toBe("Val do Salnés, Pontevedra");
    expect(elegirRegion(null, "Val do Salnés, Pontevedra", "España")).toBe("Val do Salnés, Pontevedra");
  });
  it("una región concreta de la etiqueta no se sustituye por la de la ficha", () => {
    expect(elegirRegion("Cambados, Pontevedra", "O Rosal, Pontevedra", "España")).toBe("Cambados, Pontevedra");
  });
  it("una ficha genérica o ausente no pisa nada", () => {
    expect(elegirRegion("Galicia", "Galicia", "España")).toBe("Galicia");
    expect(elegirRegion("Galicia", null, "España")).toBe("Galicia");
    expect(elegirRegion("Galicia", "  ", "España")).toBe("Galicia");
    expect(elegirRegion(null, "Galicia", "España")).toBe("Galicia");
    expect(elegirRegion(null, null, "España")).toBeNull();
  });
});

describe("ejemplosUbicacion", () => {
  const carta = [
    { denominacion_origen: "D.O. Rías Baixas", ubicacion_region: "Cambados, Pontevedra, Galicia" },
    { denominacion_origen: "D.O. Rías Baixas", ubicacion_region: "Val do Salnés, Pontevedra" },
    { denominacion_origen: "D.O. Rías Baixas", ubicacion_region: "Cambados, Pontevedra, Galicia" },
    { denominacion_origen: "D.O. Rías Baixas", ubicacion_region: "Galicia" },
    { denominacion_origen: "D.O.Ca. Rioja", ubicacion_region: "Rioja" },
    { denominacion_origen: "D.O.Ca. Rioja", ubicacion_region: "San Vicente de la Sonsierra, La Rioja" },
    { denominacion_origen: null, ubicacion_region: "Penedès, Cataluña" },
  ];
  it("toma solo regiones concretas con D.O., sin repetir, alternando D.O.", () => {
    expect(ejemplosUbicacion(carta)).toEqual([
      "Cambados, Pontevedra, Galicia [D.O. Rías Baixas]",
      "San Vicente de la Sonsierra, La Rioja [D.O.Ca. Rioja]",
      "Val do Salnés, Pontevedra [D.O. Rías Baixas]",
    ]);
  });
  it("respeta el máximo", () => {
    expect(ejemplosUbicacion(carta, 2)).toHaveLength(2);
    expect(ejemplosUbicacion([])).toEqual([]);
  });
});
