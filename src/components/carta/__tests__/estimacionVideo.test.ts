import { describe, expect, it } from "vitest";
import {
  AVISO_PANTALLA_ENCENDIDA,
  estimarRestanteMs,
  FPS_VIDEO,
  MS_CODIFICACION,
  MS_COMPOSICION_FOTOGRAMA,
  textoProgresoVideo,
  textoRestante,
  tiemposFotogramas,
} from "../video/videoPlato";

describe("estimarRestanteMs", () => {
  it("claves pendientes × lo que tardó el primero + composición + codificación", () => {
    expect(estimarRestanteMs({ msPorClave: 13_000, clavesPendientes: 12, fotogramas: 48 })).toBe(
      12 * 13_000 + 48 * MS_COMPOSICION_FOTOGRAMA + MS_CODIFICACION,
    );
  });
  it("con varios workers las claves se reparten en rondas", () => {
    // 12 claves entre 4 workers = 3 rondas; 13 claves = 4 rondas.
    expect(estimarRestanteMs({ msPorClave: 10_000, clavesPendientes: 12, workers: 4, fotogramas: 0 })).toBe(30_000 + MS_CODIFICACION);
    expect(estimarRestanteMs({ msPorClave: 10_000, clavesPendientes: 13, workers: 4, fotogramas: 0 })).toBe(40_000 + MS_CODIFICACION);
  });
  it("valores raros no dan negativos", () => {
    expect(estimarRestanteMs({ msPorClave: -5, clavesPendientes: -2, workers: 0, fotogramas: -1 })).toBe(MS_CODIFICACION);
  });
});

describe("textoRestante", () => {
  it("minutos redondeados, menos de 1 min, o nada si no se sabe", () => {
    expect(textoRestante(undefined)).toBe("");
    expect(textoRestante(NaN)).toBe("");
    expect(textoRestante(30_000)).toBe(" · queda menos de 1 min");
    expect(textoRestante(150_000)).toBe(" · quedan ~3 min");
  });
  it("se muestra en el progreso", () => {
    expect(textoProgresoVideo({ fase: "recortando", hecho: 1, total: 12, restanteMs: 240_000 })).toBe(
      "Procesando vídeo… quitando fondo 1/12 · quedan ~4 min",
    );
    expect(textoProgresoVideo({ fase: "componiendo", hecho: 23, total: 48 })).toBe("Procesando vídeo… 23/48");
  });
});

describe("misma calidad en móvil y en PC (decisión del dueño 01-11)", () => {
  it("30 fps y 120 fotogramas en 4 s, sin modo ligero (antes 12 fps: se veía a saltos)", () => {
    expect(FPS_VIDEO).toBe(30);
    expect(tiemposFotogramas(10)).toHaveLength(120);
  });
  it("aviso fijo de pantalla encendida", () => {
    expect(AVISO_PANTALLA_ENCENDIDA).toBe("Deja la pantalla encendida y esta pestaña abierta");
  });
});
