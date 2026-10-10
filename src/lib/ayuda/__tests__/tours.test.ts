import { describe, expect, it } from "vitest";
import { TOURS, TOUR_BOTON_AYUDA, claveTourVisto, esEstadoLanzarTour, resolverPasos, type PasoTour } from "../tours";
import { FICHAS_AYUDA } from "../centroAyuda";

describe("tours de ayuda", () => {
  it("cada sección tiene pasos con título y texto, y acaba en el botón «?»", () => {
    for (const [seccion, pasos] of Object.entries(TOURS)) {
      expect(pasos.length, seccion).toBeGreaterThan(3);
      for (const p of pasos) {
        expect(p.titulo.trim(), seccion).not.toBe("");
        expect(p.texto.trim(), seccion).not.toBe("");
      }
      expect(pasos.at(-1)?.elemento).toBe(TOUR_BOTON_AYUDA);
    }
  });

  it("no repite elementos dentro de un tour", () => {
    for (const pasos of Object.values(TOURS)) {
      const ids = pasos.map((p) => p.elemento).filter(Boolean);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("el tour de Facturas avisa de que las que cuadran se revisan solas", () => {
    expect(TOURS.facturas.some((p) => p.texto.includes("se marcan solas"))).toBe(true);
  });

  it("resolverPasos: salta los opcionales sin elemento y centra los obligatorios", () => {
    const pasos: PasoTour[] = [
      { titulo: "Intro", texto: "a" },
      { elemento: "visible", titulo: "Visible", texto: "b" },
      { elemento: "falta", titulo: "Opcional", texto: "c", opcional: true },
      { elemento: "falta", titulo: "Obligatorio", texto: "d" },
    ];
    const r = resolverPasos(pasos, (id) => (id === "visible" ? "EL" : null));
    expect(r.map((x) => [x.paso.titulo, x.elemento])).toEqual([
      ["Intro", null],
      ["Visible", "EL"],
      ["Obligatorio", null],
    ]);
  });

  it("la clave de «ya visto» distingue sección y usuario", () => {
    expect(claveTourVisto("facturas", "u1")).not.toBe(claveTourVisto("facturas", "u2"));
    expect(claveTourVisto("facturas", "u1")).not.toBe(claveTourVisto("gestor-web", "u1"));
  });

  it("reconoce el estado de navegación que pide lanzar un tour", () => {
    expect(esEstadoLanzarTour({ lanzarTour: "facturas" })).toBe(true);
    expect(esEstadoLanzarTour({ lanzarTour: "nada" })).toBe(false);
    expect(esEstadoLanzarTour(null)).toBe(false);
  });

  it("hay una ficha del Centro de Ayuda por cada tour, con pasos y preguntas", () => {
    expect(FICHAS_AYUDA.map((f) => f.seccion).sort()).toEqual(Object.keys(TOURS).sort());
    for (const f of FICHAS_AYUDA) {
      expect(f.pasos.length).toBeGreaterThan(0);
      expect(f.preguntas.length).toBeGreaterThan(0);
      expect(f.ruta.startsWith("/")).toBe(true);
    }
  });
});
