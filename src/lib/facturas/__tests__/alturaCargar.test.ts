import { describe, expect, it } from "vitest";
import { ALTO_ZONA_AMPLIA, alturaParaZonaAmplia, PROPORCION_MAX_ZONA, repartoCargar } from "../alturaCargar";

describe("repartoCargar (pestaña «Cargar» sin scroll de página)", () => {
  it("sin nada que listar, la zona de subida grande y la descripción", () => {
    expect(repartoCargar({ alto: 400, hayLista: false })).toEqual({ zona: "amplia", descripcion: true });
    expect(repartoCargar({ alto: null, hayLista: false })).toEqual({ zona: "amplia", descripcion: true });
  });

  it("con lista, la zona grande solo si no pasa del 35 % del alto (la lista se queda con el resto)", () => {
    const umbral = alturaParaZonaAmplia();
    expect(umbral).toBe(Math.ceil(ALTO_ZONA_AMPLIA / PROPORCION_MAX_ZONA));
    expect(repartoCargar({ alto: umbral, hayLista: true }).zona).toBe("amplia");
    expect(repartoCargar({ alto: umbral - 1, hayLista: true })).toEqual({ zona: "compacta", descripcion: false });
  });

  it("alturas reales de tarjeta: 1366×768 y tablet apaisada compacta; 1920×1080 y tablet vertical grande", () => {
    expect(repartoCargar({ alto: 600, hayLista: true }).zona).toBe("compacta"); // 1366×768
    expect(repartoCargar({ alto: 660, hayLista: true }).zona).toBe("compacta"); // 1180×820
    expect(repartoCargar({ alto: 930, hayLista: true }).zona).toBe("amplia"); // 1920×1080
    expect(repartoCargar({ alto: 1010, hayLista: true }).zona).toBe("amplia"); // 820×1180
  });

  it("sin medida o con medida rota y lista: compacta (lo prudente en pantalla pequeña)", () => {
    expect(repartoCargar({ alto: null, hayLista: true }).zona).toBe("compacta");
    expect(repartoCargar({ alto: Number.NaN, hayLista: true }).zona).toBe("compacta");
  });
});
