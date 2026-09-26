import { describe, it, expect } from "vitest";
import {
  mensajeNombreMesaDuplicado,
  nombreMesaDuplicado,
  normalizarNombreMesa,
} from "../nombresMesa";

describe("normalizarNombreMesa", () => {
  it("recorta espacios y pasa a minúsculas", () => {
    expect(normalizarNombreMesa("  Mesa 9  ")).toBe("mesa 9");
  });

  it("colapsa espacios repetidos", () => {
    expect(normalizarNombreMesa("Mesa   9")).toBe("mesa 9");
  });

  it("trata null/undefined como cadena vacía", () => {
    expect(normalizarNombreMesa(null)).toBe("");
    expect(normalizarNombreMesa(undefined)).toBe("");
  });
});

describe("nombreMesaDuplicado", () => {
  const mesas = [
    { id: "m-1", nombre: "Mesa 1" },
    { id: "m-2", nombre: "Mesa 9" },
    { id: "m-3", nombre: "Barra" },
  ];

  it("detecta un nombre exactamente igual", () => {
    expect(nombreMesaDuplicado("Mesa 9", mesas)).toBe(true);
  });

  it("detecta el duplicado ignorando mayúsculas y espacios", () => {
    expect(nombreMesaDuplicado("  mesa   9 ", mesas)).toBe(true);
  });

  it("no marca duplicado un nombre distinto", () => {
    expect(nombreMesaDuplicado("Mesa 10", mesas)).toBe(false);
  });

  it("no marca duplicado un nombre vacío", () => {
    expect(nombreMesaDuplicado("   ", mesas)).toBe(false);
  });

  it("excluye la propia mesa al renombrar (mismo id, mismo nombre)", () => {
    expect(nombreMesaDuplicado("Mesa 9", mesas, "m-2")).toBe(false);
  });

  it("sigue detectando el choque al renombrar hacia el nombre de OTRA mesa", () => {
    // Renombrando "Mesa 1" (m-1) a "Mesa 9": chocaría con m-2.
    expect(nombreMesaDuplicado("Mesa 9", mesas, "m-1")).toBe(true);
  });

  it("no revienta con una lista vacía o con filas nulas", () => {
    expect(nombreMesaDuplicado("Mesa 1", [])).toBe(false);
    const conFilaNula = [null, { id: "m-1", nombre: "Mesa 1" }] as unknown as {
      id: string;
      nombre: string;
    }[];
    expect(nombreMesaDuplicado("Mesa 1", conFilaNula)).toBe(true);
  });
});

describe("mensajeNombreMesaDuplicado", () => {
  it("incluye el nombre recortado tal cual lo escribió el usuario", () => {
    expect(mensajeNombreMesaDuplicado("  Mesa 9  ")).toBe(
      'Ya hay una mesa llamada "Mesa 9" en este espacio. Usa un nombre distinto.',
    );
  });
});
