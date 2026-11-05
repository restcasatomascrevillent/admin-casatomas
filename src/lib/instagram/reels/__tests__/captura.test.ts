/** Lógica de la página de captura de reels (fase 6): instantes de medida, portada y revisión de textos. */
import { describe, expect, it } from "vitest";
import { BASES_REEL, calcularTiempos, crearReelDesdeBase, instantePortada, instantesDeMedida, revisarCajas } from "@/lib/instagram/reels";

describe("captura de reels", () => {
  it("mide cada rótulo ya entero y antes de irse, y el cierre", () => {
    for (const base of BASES_REEL) {
      const reel = crearReelDesdeBase(base);
      const t = calcularTiempos(reel);
      const instantes = instantesDeMedida(reel);
      const conRotulo = reel.escenas.filter((e) => e.rotulo).length;
      expect(instantes.length).toBeGreaterThanOrEqual(Math.min(1, conRotulo));
      for (const x of instantes) {
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThan(t.total);
        expect(Math.abs(x * 30 - Math.round(x * 30))).toBeLessThan(1e-9); // cae en un fotograma
      }
      expect(instantes.at(-1)!).toBeGreaterThan(t.inicioCierre);
    }
  });

  it("portada: la pedida si cae dentro; si no, el primer rótulo entero", () => {
    const reel = crearReelDesdeBase("del-mar");
    expect(instantePortada(reel, 3.5)).toBe(3.5);
    expect(instantePortada(reel, 500)).toBe(instantesDeMedida(reel)[0]);
    expect(instantePortada(reel, null)).toBe(instantesDeMedida(reel)[0]);
  });

  it("un texto fuera del lienzo es un problema; fuera de la zona segura, un aviso", () => {
    const caja = (izquierda: number, derecha: number, arriba = 900, abajo = 1000) => ({ campo: "titulo", izquierda, derecha, arriba, abajo });
    expect(revisarCajas([caja(100, 980)], 2)).toEqual({ problemas: [], avisos: [] });
    expect(revisarCajas([caja(-40, 900)], 2).problemas[0]).toMatch(/se sale del vídeo por la izquierda/);
    expect(revisarCajas([caja(100, 1100)], 2).problemas[0]).toMatch(/por la derecha/);
    expect(revisarCajas([caja(30, 900)], 2).avisos[0]).toMatch(/pegado al borde/);
    expect(revisarCajas([caja(100, 900, 1700, 1780)], 2).avisos[0]).toMatch(/zona segura/);
    expect(revisarCajas([caja(100, 100)], 2)).toEqual({ problemas: [], avisos: [] }); // vacía
  });
});
