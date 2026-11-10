import { describe, it, expect } from "vitest";
import { COLORES_MESA, ESTADOS_COLOR_MESA, estadoColorMovil } from "../coloresMesa";
import { CONFIG_ESTADO_MESA } from "@/components/reservas/servicio/estadosMesa";

describe("Colores de las mesas: una sola tabla para móvil y escritorio (10/11/2026)", () => {
  it("cada estado con su color: libre verde, reservada azul, retrasada rojo, ocupada ámbar, por liberar violeta", () => {
    const color = (clases: string) => /border-(emerald|sky|rose|amber|violet)-\d+/.exec(clases)?.[1];
    expect(Object.fromEntries(ESTADOS_COLOR_MESA.map((e) => [e, color(COLORES_MESA[e].mesa)]))).toEqual({
      libre: "emerald",
      reservada: "sky",
      retrasada: "rose",
      ocupada: "amber",
      por_liberar: "violet",
    });
  });

  it("colores distintos entre estados, con variante oscura y la insignia con texto blanco", () => {
    const familias = ESTADOS_COLOR_MESA.map((e) => /bg-(\w+)-/.exec(COLORES_MESA[e].badge)?.[1]);
    expect(new Set(familias).size).toBe(ESTADOS_COLOR_MESA.length);
    for (const e of ESTADOS_COLOR_MESA) {
      expect(COLORES_MESA[e].mesa).toMatch(/dark:border-/);
      expect(COLORES_MESA[e].mesa).toMatch(/dark:bg-/);
      expect(COLORES_MESA[e].badge).toMatch(/bg-\w+-(700|800) text-white/);
    }
  });

  it("el móvil usa los mismos: sentada = ocupada", () => {
    expect(estadoColorMovil("libre")).toBe("libre");
    expect(estadoColorMovil("reservada")).toBe("reservada");
    expect(estadoColorMovil("sentada")).toBe("ocupada");
  });

  it("el plano de escritorio lee de la misma tabla", () => {
    for (const e of ESTADOS_COLOR_MESA) {
      expect(CONFIG_ESTADO_MESA[e].clases).toBe(COLORES_MESA[e].mesa);
      expect(CONFIG_ESTADO_MESA[e].badge).toBe(COLORES_MESA[e].badge);
      expect(CONFIG_ESTADO_MESA[e].etiqueta).toBe(COLORES_MESA[e].etiqueta);
    }
  });
});
