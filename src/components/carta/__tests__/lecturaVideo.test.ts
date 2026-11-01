import { describe, expect, it } from "vitest";
import {
  ACEPTA_VIDEO,
  argumentosConversion,
  ErrorLecturaVideo,
  esErrorLecturaVideo,
  esVideoQuickTime,
  MENSAJE_FORMATO_NO_COMPATIBLE,
  MENSAJE_HEVC_NO_CONVERTIDO,
  mensajeFalloLectura,
  pasosLecturaVideo,
  porcentajeConversion,
} from "../video/lecturaVideo";
import { porcentajeProgresoVideo, textoProgresoVideo } from "../video/videoPlato";

describe("esVideoQuickTime", () => {
  it("por tipo video/quicktime (con o sin parámetros) y video/x-m4v", () => {
    expect(esVideoQuickTime("video/quicktime", "a.bin")).toBe(true);
    expect(esVideoQuickTime("Video/QuickTime; codecs=hvc1")).toBe(true);
    expect(esVideoQuickTime("video/x-m4v")).toBe(true);
  });
  it("por extensión .mov/.m4v si el tipo viene vacío o genérico", () => {
    expect(esVideoQuickTime("", "IMG_1234.MOV")).toBe(true);
    expect(esVideoQuickTime("application/octet-stream", "clip.m4v")).toBe(true);
  });
  it("mp4/webm normales no", () => {
    expect(esVideoQuickTime("video/mp4", "a.mp4")).toBe(false);
    expect(esVideoQuickTime("video/webm", "a.webm")).toBe(false);
    expect(esVideoQuickTime(undefined, undefined)).toBe(false);
    expect(esVideoQuickTime("", "movimiento.mp4")).toBe(false);
  });
});

describe("pasosLecturaVideo", () => {
  it(".mov del iPhone: tal cual → como mp4 → convertir", () => {
    expect(pasosLecturaVideo("video/quicktime", "IMG_1.MOV")).toEqual(["original", "mp4", "convertir"]);
  });
  it("tipo vacío pero .mov: igual", () => {
    expect(pasosLecturaVideo("", "IMG_1.mov")).toEqual(["original", "mp4", "convertir"]);
  });
  it("mp4 (p. ej. HEVC de Android): sin el paso mp4", () => {
    expect(pasosLecturaVideo("video/mp4", "a.mp4")).toEqual(["original", "convertir"]);
  });
  it("sin conversor disponible no se intenta convertir", () => {
    expect(pasosLecturaVideo("video/quicktime", "a.mov", false)).toEqual(["original", "mp4"]);
    expect(pasosLecturaVideo("video/webm", "a.webm", false)).toEqual(["original"]);
  });
});

describe("mensajeFalloLectura", () => {
  it("QuickTime → instrucciones del iPhone (HEVC)", () => {
    expect(mensajeFalloLectura("video/quicktime", "a.mov")).toBe(MENSAJE_HEVC_NO_CONVERTIDO);
    expect(MENSAJE_HEVC_NO_CONVERTIDO).toContain("Ajustes → Cámara → Formatos → Más compatible");
  });
  it("otros → formato no compatible", () => {
    expect(mensajeFalloLectura("video/mp4", "a.mp4")).toBe(MENSAJE_FORMATO_NO_COMPATIBLE);
  });
});

describe("ErrorLecturaVideo", () => {
  it("se reconoce por clase o por nombre (cruza límites de módulo)", () => {
    expect(esErrorLecturaVideo(new ErrorLecturaVideo("x", "formato"))).toBe(true);
    expect(esErrorLecturaVideo(Object.assign(new Error("x"), { name: "ErrorLecturaVideo" }))).toBe(true);
    expect(esErrorLecturaVideo(new Error("El vídeo es demasiado corto"))).toBe(false);
    expect(esErrorLecturaVideo(null)).toBe(false);
  });
});

describe("argumentosConversion", () => {
  const a = argumentosConversion("/in/x.mov", "/salida.mp4");
  const valor = (flag: string) => a[a.indexOf(flag) + 1];
  it("solo los primeros 4 s, sin audio, H.264 ultrafast yuv420p", () => {
    expect(valor("-i")).toBe("/in/x.mov");
    expect(valor("-t")).toBe("4");
    expect(a).toContain("-an");
    expect(valor("-c:v")).toBe("libx264");
    expect(valor("-preset")).toBe("ultrafast");
    expect(valor("-pix_fmt")).toBe("yuv420p");
    expect(a[a.length - 1]).toBe("/salida.mp4");
  });
  it("-t va después de -i (se corta la salida, no se busca en la entrada)", () => {
    expect(a.indexOf("-t")).toBeGreaterThan(a.indexOf("-i"));
  });
  it("escala a lado mayor ≤ 1280 sin agrandar, dimensiones pares, 24 fps", () => {
    const vf = valor("-vf");
    expect(vf).toContain("min(1280,iw)");
    expect(vf).toContain("min(1280,ih)");
    expect(vf).toContain("force_original_aspect_ratio=decrease");
    expect(vf).toContain("force_divisible_by=2");
    expect(vf).toContain("fps=24");
  });
  it("opciones personalizadas", () => {
    const b = argumentosConversion("i", "o", { segundos: 2, lado: 640, fps: 12 });
    expect(b[b.indexOf("-t") + 1]).toBe("2");
    expect(b[b.indexOf("-vf") + 1]).toContain("min(640,iw)");
    expect(b[b.indexOf("-g") + 1]).toBe("12");
  });
});

describe("porcentajeConversion", () => {
  it("µs de vídeo convertido sobre 4 s, acotado 0–100", () => {
    expect(porcentajeConversion(0)).toBe(0);
    expect(porcentajeConversion(-5)).toBe(0);
    expect(porcentajeConversion(NaN)).toBe(0);
    expect(porcentajeConversion(2_000_000)).toBe(50);
    expect(porcentajeConversion(9_000_000)).toBe(100);
  });
});

describe("progreso «convirtiendo»", () => {
  it("texto con «Convirtiendo vídeo del móvil…»", () => {
    expect(textoProgresoVideo({ fase: "convirtiendo", pct: -1 })).toMatch(/^Convirtiendo vídeo del móvil…/);
    expect(textoProgresoVideo({ fase: "convirtiendo", pct: 40 })).toBe("Convirtiendo vídeo del móvil… 40 %");
    expect(porcentajeProgresoVideo({ fase: "convirtiendo", pct: 40 })).toBe(0);
  });
});

describe("ACEPTA_VIDEO", () => {
  it("acepta video/* y las extensiones del móvil", () => {
    expect(ACEPTA_VIDEO).toBe("video/*,.mov,.mp4,.m4v,.webm");
  });
});
