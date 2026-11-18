// Ayuda para el panel (18/11/2026): nombres parecidos y fecha de los datos
// que ya devuelven las herramientas; nada se calcula ni se inventa.
import { describe, expect, it } from "vitest";
import { ayudaDeResultado, unirAyuda } from "../hilo.ts";

describe("ayudaDeResultado", () => {
  it("sugerencias de un «no lo encuentro»", () => {
    const r = JSON.stringify({ sin_datos: true, coincidencia: "ninguna", sugerencias: ["LAURENT PERRIER CUVEE", "LP ROSE"] });
    expect(ayudaDeResultado(r)).toEqual({ sugerencias: ["LAURENT PERRIER CUVEE", "LP ROSE"] });
  });
  it("posibles_coincidencias: solo el nombre, sin repetidos", () => {
    const r = JSON.stringify({ posibles_coincidencias: [{ nombre: "C/6B LP LA CUVEE", importe: 10 }, { nombre: "c/6b lp la cuvee" }, { importe: 3 }] });
    expect(ayudaDeResultado(r)).toEqual({ sugerencias: ["C/6B LP LA CUVEE", "c/6b lp la cuvee"] });
  });
  it("ultima_fecha = datos hasta", () => {
    expect(ayudaDeResultado(JSON.stringify({ ultima_fecha: "2026-11-12" }))).toEqual({ datos_hasta: "2026-11-12" });
  });
  it("JSON roto, listas y fechas raras no dan nada", () => {
    expect(ayudaDeResultado("{cortado")).toEqual({});
    expect(ayudaDeResultado("[1,2]")).toEqual({});
    expect(ayudaDeResultado(JSON.stringify({ ultima_fecha: "ayer", sugerencias: [3, null] }))).toEqual({});
  });
  it("tope de 5 nombres", () => {
    const r = JSON.stringify({ sugerencias: ["a", "b", "c", "d", "e", "f", "g"] });
    expect(ayudaDeResultado(r).sugerencias).toHaveLength(5);
  });
});

describe("unirAyuda", () => {
  it("junta sugerencias sin repetir y se queda con la fecha más reciente", () => {
    expect(unirAyuda([{ sugerencias: ["a"], datos_hasta: "2026-11-01" }, { sugerencias: ["a", "b"], datos_hasta: "2026-11-12" }, {}])).toEqual({
      sugerencias: ["a", "b"],
      datos_hasta: "2026-11-12",
    });
    expect(unirAyuda([])).toEqual({});
  });
});
