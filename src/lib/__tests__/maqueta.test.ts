/**
 * Maquetas (lib/maqueta.ts): la Tienda solo existe fuera de producción
 * (dueño, 03/11/2026). El entorno sale de VERSION_APP, como en VersionPanel.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { maquetaVisibleEn } from "@/lib/maqueta";
import type { VersionApp } from "@/lib/version";

const version = (entorno: VersionApp["entorno"]): VersionApp => ({
  version: "0.99", mayor: 0, numero: 99, commit: "abc1234", rama: "x", entorno, aviso: null,
});

afterEach(() => {
  vi.doUnmock("@/lib/version");
  vi.resetModules();
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
  ] as const)("maquetasVisibles() lee el entorno del build (%s)", async (entorno, visible) => {
    vi.resetModules();
    vi.doMock("@/lib/version", async (original) => ({ ...(await original<typeof import("@/lib/version")>()), VERSION_APP: version(entorno) }));
    const { maquetasVisibles } = await import("@/lib/maqueta");
    expect(maquetasVisibles()).toBe(visible);
  });

  it.each([
    ["produccion", false],
    ["demo", true],
  ] as const)("la tabla de permisos de Usuarios trae Tienda solo fuera de producción (%s)", async (entorno, conTienda) => {
    vi.resetModules();
    vi.doMock("@/lib/version", async (original) => ({ ...(await original<typeof import("@/lib/version")>()), VERSION_APP: version(entorno) }));
    const { SECCIONES_CONFIGURABLES } = await import("@/components/usuarios/permisosSecciones");
    const claves = SECCIONES_CONFIGURABLES.map((s) => s.key);
    expect(claves.includes("tienda")).toBe(conTienda);
    expect(claves).toContain("cheques");
    expect(claves).toContain("facturas");
  });
});
