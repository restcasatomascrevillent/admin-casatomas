import { describe, expect, it, vi } from "vitest";
import { TOURS, TOUR_BOTON_AYUDA, claveTourVisto, esEstadoLanzarTour, esperarA, pestanasDelTour, cadenaPestanas } from "../tours";
import { FICHAS_AYUDA, esArchivoVideo, pasosDeFicha } from "../centroAyuda";

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

  it("no repite el mismo elemento en la misma pestaña", () => {
    for (const pasos of Object.values(TOURS)) {
      const ids = pasos.filter((p) => p.elemento).map((p) => `${p.pestana ?? ""}|${p.elemento}`);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("el tour de Facturas avisa de que las que cuadran se revisan solas", () => {
    expect(TOURS.facturas.some((p) => p.texto.includes("se marcan solas"))).toBe(true);
  });

  it("el tour de Facturas enseña la lista por meses, el vínculo albarán-factura y el zoom del original", () => {
    const compras = TOURS.facturas.filter((p) => p.pestana === "facturas-pestana-compras").map((p) => p.elemento);
    expect(compras).toEqual(expect.arrayContaining(["facturas-lista", "facturas-ficha-vinculo", "facturas-original"]));
    expect(TOURS.facturas.find((p) => p.elemento === "facturas-original")?.texto).toMatch(/zoom|Amplía/i);
  });

  it("los textos de ayuda hablan de tú y en español: nada de «usted»", () => {
    const textos = [
      ...Object.values(TOURS).flat().map((p) => p.texto),
      ...FICHAS_AYUDA.flatMap((f) => [f.queEs, ...pasosDeFicha(f), ...f.preguntas.map((q) => q.respuesta)]),
    ];
    for (const t of textos) expect(t).not.toMatch(/\busted\b/i);
  });

  it("recorre las pestañas en orden: Facturas Cargar → Compras → IA; Gestor Web Carta (› Vinos) → Novedades → Menús → Tapas", () => {
    expect(pestanasDelTour(TOURS.facturas)).toEqual([
      "facturas-pestana-cargar",
      "facturas-pestana-compras",
      "facturas-pestana-ia",
    ]);
    expect(pestanasDelTour(TOURS["gestor-web"])).toEqual([
      "gw-pestana-carta",
      "gw-pestana-novedades",
      "gw-pestana-menus",
      "gw-pestana-tapas",
    ]);
  });

  it("los pasos de una subpestaña abren antes su pestaña de fuera (Carta > Vinos)", () => {
    const vinos = TOURS["gestor-web"].filter((p) => cadenaPestanas(p).includes("gw-carta-vinos"));
    expect(vinos.length).toBe(2);
    for (const paso of vinos) expect(cadenaPestanas(paso)).toEqual(["gw-pestana-carta", "gw-carta-vinos"]);
  });

  it("los pasos de una pestaña van juntos (no se salta de una a otra y vuelve)", () => {
    for (const pasos of Object.values(TOURS)) {
      const secuencia = pasos.map((p) => cadenaPestanas(p).join(" > ")).filter(Boolean);
      const bloques = secuencia.filter((p, i) => p !== secuencia[i - 1]);
      expect(new Set(bloques).size).toBe(bloques.length);
    }
  });

  it("Análisis de Facturas se explica por partes: barra, cifras, tablero y la IA plegada (se abre para enseñar la caja)", () => {
    const ia = TOURS.facturas.filter((p) => p.pestana === "facturas-pestana-ia").map((p) => p.elemento);
    expect(ia).toEqual([
      "facturas-pestana-ia",
      "facturas-gasto-ia",
      "facturas-analisis-barra",
      "facturas-analisis-indicadores",
      "facturas-analisis-tablero",
      "facturas-ia-abrir",
      "facturas-ia-pregunta",
    ]);
    expect(TOURS.facturas.find((p) => p.elemento === "facturas-ia-pregunta")?.abrir).toBe("facturas-ia-abrir");
    expect(TOURS.facturas.some((p) => /Al instante/.test(p.texto))).toBe(false);
  });

  it("esperarA: devuelve el elemento en cuanto aparece y null si no llega a tiempo", async () => {
    vi.useFakeTimers();
    try {
      let el: string | null = null;
      const encontrado = esperarA(() => el, 2000);
      await vi.advanceTimersByTimeAsync(300);
      el = "EL";
      await vi.advanceTimersByTimeAsync(100);
      await expect(encontrado).resolves.toBe("EL");

      const nunca = esperarA(() => null, 2000);
      await vi.advanceTimersByTimeAsync(2100);
      await expect(nunca).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
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
      expect(pasosDeFicha(f).length).toBeGreaterThan(0);
      for (const g of f.grupos) {
        expect(g.titulo.trim()).not.toBe("");
        expect(g.pasos.length).toBeGreaterThan(0);
      }
      expect(f.preguntas.length).toBeGreaterThan(0);
      expect(f.ruta.startsWith("/")).toBe(true);
    }
  });
});

describe("esArchivoVideo", () => {
  it("distingue archivos de vídeo propios de enlaces de inserción", () => {
    expect(esArchivoVideo("/ayuda/videos/facturas.webm")).toBe(true);
    expect(esArchivoVideo("/ayuda/videos/gestor-web.mp4?v=2")).toBe(true);
    expect(esArchivoVideo("https://www.youtube.com/embed/abc123")).toBe(false);
    expect(esArchivoVideo("https://player.vimeo.com/video/123")).toBe(false);
  });
});
