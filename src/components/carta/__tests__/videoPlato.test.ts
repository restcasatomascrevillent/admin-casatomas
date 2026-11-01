import { describe, expect, it } from "vitest";
import {
  aUint8,
  cajaDeMascara,
  columnaVideoDisponible,
  elegirMimeVideo,
  esErrorColumnaVideo,
  extensionVideo,
  indicesClave,
  interpolarMascara,
  pasoInferencia,
  porcentajeProgresoVideo,
  rutaVideoPlato,
  suavizarCajas,
  suavizarMascara,
  textoProgresoVideo,
  tiemposFotogramas,
  vecinosClave,
} from "../video/videoPlato";

describe("elegirMimeVideo", () => {
  it("prefiere mp4 si el navegador lo graba", () => {
    const f = elegirMimeVideo((m) => m === "video/mp4" || m.startsWith("video/webm"));
    expect(f).toEqual({ mime: "video/mp4", ext: "mp4", contentType: "video/mp4" });
  });
  it("prefiere H.264 explícito antes que mp4 genérico", () => {
    expect(elegirMimeVideo(() => true)?.mime).toBe("video/mp4;codecs=avc1.42E01E");
  });
  it("sin mp4 cae a webm VP9 y luego VP8", () => {
    expect(elegirMimeVideo((m) => m.startsWith("video/webm"))?.mime).toBe("video/webm;codecs=vp9");
    expect(elegirMimeVideo((m) => m === "video/webm;codecs=vp8" || m === "video/webm")).toEqual({
      mime: "video/webm;codecs=vp8",
      ext: "webm",
      contentType: "video/webm",
    });
  });
  it("null si no soporta nada (o isTypeSupported lanza)", () => {
    expect(elegirMimeVideo(() => false)).toBeNull();
    expect(
      elegirMimeVideo(() => {
        throw new Error("x");
      }),
    ).toBeNull();
  });
});

describe("tiemposFotogramas", () => {
  it("12 fps de los primeros 4 s: 48 fotogramas", () => {
    const t = tiemposFotogramas(10);
    expect(t).toHaveLength(48);
    expect(t[0]).toBe(0);
    expect(t[1]).toBeCloseTo(1 / 12, 3);
    expect(t[47]).toBeLessThan(4);
  });
  it("vídeo corto: solo los fotogramas que hay, sin salirse", () => {
    const t = tiemposFotogramas(2);
    expect(t).toHaveLength(24);
    expect(Math.max(...t)).toBeLessThan(2);
  });
  it("respeta el tope de fotogramas", () => {
    expect(tiemposFotogramas(4, { fps: 15, maxFotogramas: 60 })).toHaveLength(60);
    expect(tiemposFotogramas(4, { fps: 30, maxFotogramas: 60 })).toHaveLength(60);
  });
  it("duración Infinity (webm sin duración) → 4 s; 0/NaN → []", () => {
    expect(tiemposFotogramas(Infinity)).toHaveLength(48);
    expect(tiemposFotogramas(0)).toEqual([]);
    expect(tiemposFotogramas(NaN)).toEqual([]);
  });
  it("crecientes", () => {
    const t = tiemposFotogramas(3.3);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
  });
});

describe("pasoInferencia / indicesClave / vecinosClave", () => {
  it("paso según lo que tarda el modelo", () => {
    expect(pasoInferencia(800)).toBe(1);
    expect(pasoInferencia(4000)).toBe(2);
    expect(pasoInferencia(13000)).toBe(4);
    expect(pasoInferencia(0)).toBe(1);
  });
  it("claves cada paso e incluye el último", () => {
    expect(indicesClave(10, 4)).toEqual([0, 4, 8, 9]);
    expect(indicesClave(9, 4)).toEqual([0, 4, 8]);
    expect(indicesClave(3, 1)).toEqual([0, 1, 2]);
    expect(indicesClave(0, 2)).toEqual([]);
  });
  it("vecinos y peso de interpolación", () => {
    const c = [0, 4, 8, 9];
    expect(vecinosClave(0, c)).toEqual({ a: 0, b: 0, t: 0 });
    expect(vecinosClave(2, c)).toEqual({ a: 0, b: 4, t: 0.5 });
    expect(vecinosClave(4, c)).toEqual({ a: 4, b: 4, t: 0 });
    expect(vecinosClave(7, c)).toEqual({ a: 4, b: 8, t: 0.75 });
    expect(vecinosClave(9, c)).toEqual({ a: 9, b: 9, t: 0 });
  });
});

describe("máscaras", () => {
  it("interpolación lineal", () => {
    expect(Array.from(interpolarMascara([0, 100, 255], [255, 100, 0], 0.5))).toEqual([127.5, 100, 127.5]);
    expect(Array.from(interpolarMascara([0], [200], 2))).toEqual([200]);
  });
  it("media exponencial: sin previa devuelve la nueva", () => {
    expect(Array.from(suavizarMascara(null, [10, 20]))).toEqual([10, 20]);
  });
  it("media exponencial con alfa", () => {
    const r = suavizarMascara([0, 255], [255, 0], 0.6);
    expect(r[0]).toBeCloseTo(153, 5);
    expect(r[1]).toBeCloseTo(102, 5);
  });
  it("amortigua un parpadeo de un fotograma (el borde no tiembla)", () => {
    // Píxel de borde: dentro, fuera un fotograma (ruido del modelo), dentro.
    let m: Float32Array | null = null;
    const serie = [255, 255, 0, 255, 255];
    const salida: number[] = [];
    for (const v of serie) {
      m = suavizarMascara(m, [v]);
      salida.push(m[0]);
    }
    // Sin suavizado caería a 0 (< 127, fuera); con suavizado se queda dentro.
    expect(salida[2]).toBeGreaterThanOrEqual(100);
    expect(salida[4]).toBeGreaterThan(salida[2]);
  });
  it("aUint8 redondea y recorta", () => {
    expect(Array.from(aUint8([-3, 12.6, 300]))).toEqual([0, 13, 255]);
  });
});

describe("encuadre", () => {
  it("caja de la máscara escalada al fotograma", () => {
    const lado = 4;
    const m = new Uint8Array(16);
    m[1 * 4 + 1] = 255;
    m[2 * 4 + 2] = 255;
    // 4×4 → fotograma 400×200: x 1..2 → 100..300, y 1..2 → 50..150
    expect(cajaDeMascara(m, lado, 400, 200)).toEqual({ x: 100, y: 50, w: 200, h: 100 });
    expect(cajaDeMascara(new Uint8Array(16), lado, 400, 200)).toBeNull();
  });
  it("suavizarCajas rellena huecos y amortigua saltos", () => {
    const a = { x: 100, y: 100, w: 200, h: 200 };
    const salto = { x: 160, y: 100, w: 260, h: 200 };
    const r = suavizarCajas([null, a, a, salto, a, a]);
    expect(r).toHaveLength(6);
    expect(r[0].y).toBe(100); // el hueco inicial toma la primera caja
    expect(r[0].x).toBeLessThan(110);
    expect(r[3].w).toBeLessThan(260);
    expect(r[3].w).toBeGreaterThan(200);
    expect(suavizarCajas([null, null])).toEqual([]);
  });
});

describe("rutas, errores y textos", () => {
  it("ruta y extensión", () => {
    expect(rutaVideoPlato("abc", "mp4")).toBe("abc-video.mp4");
    expect(extensionVideo("video/mp4;codecs=avc1")).toBe("mp4");
    expect(extensionVideo("video/webm")).toBe("webm");
  });
  it("detecta la columna video_url ausente", () => {
    expect(esErrorColumnaVideo({ code: "PGRST204", message: "Could not find the 'video_url' column of 'Platos' in the schema cache" })).toBe(true);
    expect(esErrorColumnaVideo({ code: "42703", message: 'column "video_url" of relation "Platos" does not exist' })).toBe(true);
    expect(esErrorColumnaVideo({ code: "42501", message: "permission denied" })).toBe(false);
    expect(esErrorColumnaVideo({ code: "PGRST204", message: "Could not find the 'otra' column" })).toBe(false);
    expect(esErrorColumnaVideo(null)).toBe(false);
  });
  it("columnaVideoDisponible según la fila de select('*')", () => {
    expect(columnaVideoDisponible([{ id: "1", video_url: null }])).toBe(true);
    expect(columnaVideoDisponible([{ id: "1" }])).toBe(false);
    expect(columnaVideoDisponible([])).toBeNull();
    expect(columnaVideoDisponible(undefined)).toBeNull();
  });
  it("texto y porcentaje de progreso", () => {
    expect(textoProgresoVideo({ fase: "componiendo", hecho: 23, total: 48 })).toBe("Procesando vídeo… 23/48");
    expect(textoProgresoVideo(null)).toBe("Preparando vídeo…");
    expect(porcentajeProgresoVideo({ fase: "recortando", hecho: 12, total: 12 })).toBe(70);
    expect(porcentajeProgresoVideo({ fase: "componiendo", hecho: 48, total: 48 })).toBe(95);
  });
});
