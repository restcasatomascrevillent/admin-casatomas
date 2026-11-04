/**
 * Maquetas (lib/maqueta.ts): la Tienda solo existe fuera de producción
 * (dueño, 03/11/2026). El entorno sale de VERSION_APP, como en VersionPanel.
 *
 * Sin `vi.doMock` + `vi.resetModules` (04/11/2026): con la suite completa en paralelo,
 * a veces la importación dinámica se quedaba con el VERSION_APP real y el caso
 * «produccion» fallaba (1 de cada 8 ejecuciones con carga). Ahora se prueba con las
 * funciones puras, pasándoles el entorno.
 */
import { describe, expect, it } from "vitest";
import { maquetaVisibleEn, maquetasVisibles } from "@/lib/maqueta";
import { VERSION_APP, type VersionApp } from "@/lib/version";
import { SECCIONES_CONFIGURABLES, seccionesConfigurables } from "@/components/usuarios/permisosSecciones";

const version = (entorno: VersionApp["entorno"]): VersionApp => ({
  version: "0.99", mayor: 0, numero: 99, commit: "abc1234", rama: "x", entorno, aviso: null,
});

describe("maquetas solo fuera de producción", () => {
  it.each([
    ["produccion", false],
    ["demo", true],
    ["preview", true],
    ["local", true],
  ] as const)("%s → %s", (entorno, visible) => {
    expect(maquetaVisibleEn(entorno)).toBe(visible);
  });

  it.each([
    ["produccion", false],
    ["demo", true],
  ] as const)("maquetasVisibles() mira el entorno de la versión (%s)", (entorno, visible) => {
    expect(maquetasVisibles(version(entorno))).toBe(visible);
  });

  it("sin argumento, maquetasVisibles() usa el entorno de este build (VERSION_APP)", () => {
    expect(maquetasVisibles()).toBe(maquetaVisibleEn(VERSION_APP.entorno));
  });

  it.each([
    ["produccion", false],
    ["demo", true],
  ] as const)("la tabla de permisos de Usuarios trae Tienda solo fuera de producción (%s)", (entorno, conTienda) => {
    const claves = seccionesConfigurables(maquetaVisibleEn(entorno)).map((s) => s.key);
    expect(claves.includes("tienda")).toBe(conTienda);
    expect(claves).toContain("cheques");
    expect(claves).toContain("facturas");
    expect(claves).not.toContain("usuarios");
  });

  it("SECCIONES_CONFIGURABLES es la lista de este build", () => {
    expect(SECCIONES_CONFIGURABLES).toEqual(seccionesConfigurables(maquetasVisibles()));
  });
});
