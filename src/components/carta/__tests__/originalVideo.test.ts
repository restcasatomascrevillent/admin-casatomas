import { describe, expect, it } from "vitest";
import {
  accionCambioFondo,
  archivoDesdeOriginal,
  extensionDeRuta,
  extensionOriginal,
  originalesDePlato,
  rutaOriginalVideo,
  temaDeVideoUrl,
  temaMarcado,
  urlConFondo,
} from "../video/originalVideo";

const ID = "3f2b9c1e-1111-4222-8333-444455556666";

describe("ruta del vídeo original", () => {
  it("una ruta estable por plato en videos-originales/", () => {
    expect(rutaOriginalVideo(ID, "mov")).toBe(`videos-originales/${ID}.mov`);
    expect(extensionOriginal({ name: "IMG_1234.MOV", type: "video/quicktime" })).toBe("mov");
    expect(extensionOriginal({ type: "video/webm" })).toBe("webm");
    expect(extensionOriginal({})).toBe("mp4");
    expect(extensionDeRuta("pendientes/abcdefgh.m4v")).toBe("m4v");
  });

  it("filtra del listado solo los originales de ese plato", () => {
    const nombres = [`${ID}.mp4`, `${ID}.mov`, `${ID}-video.mp4`, `otro-${ID}.mp4`, "x.mp4", `${ID}.mp4.bak`];
    expect(originalesDePlato(nombres, ID)).toEqual([`videos-originales/${ID}.mp4`, `videos-originales/${ID}.mov`]);
    expect(originalesDePlato([], ID)).toEqual([]);
  });

  it("el original descargado vuelve como File con su extensión", () => {
    const f = archivoDesdeOriginal(new Blob(["v"], { type: "video/quicktime" }), `videos-originales/${ID}.mov`);
    expect(f.name).toBe(`${ID}.mov`);
    expect(f.type).toBe("video/quicktime");
    expect(archivoDesdeOriginal(new Blob(["v"]), "videos-originales/a.mp4").type).toBe("video/mp4");
  });
});

describe("fondo apuntado en video_url", () => {
  const base = "https://x.supabase.co/storage/v1/object/public/platos/p1-video.mp4";

  it("añade y sustituye fondo= sin perder ?t=", () => {
    const u = urlConFondo(`${base}?t=123`, "carbon");
    expect(u).toBe(`${base}?t=123&fondo=carbon`);
    expect(urlConFondo(u, "arena")).toBe(`${base}?t=123&fondo=arena`);
    expect(urlConFondo(base, "marfil")).toBe(`${base}?fondo=marfil`);
  });

  it("lee el fondo; null si no hay o no es un tema conocido", () => {
    expect(temaDeVideoUrl(`${base}?t=1&fondo=piedra`)).toBe("piedra");
    expect(temaDeVideoUrl(`${base}?t=1`)).toBeNull();
    expect(temaDeVideoUrl(`${base}?fondo=inventado`)).toBeNull();
    expect(temaDeVideoUrl(`${base}?fondo=toString`)).toBeNull();
    expect(temaDeVideoUrl(null)).toBeNull();
  });

  it("círculo marcado: lo tocado > fondo real del vídeo > fondo de la foto", () => {
    expect(temaMarcado("arena", "carbon", "marfil")).toBe("arena");
    expect(temaMarcado(null, "carbon", "marfil")).toBe("carbon");
    expect(temaMarcado(null, null, "marfil")).toBe("marfil");
  });
});

describe("accionCambioFondo", () => {
  const base = { hayVideo: true, elegido: "arena" as const, real: "carbon" as const, tieneArchivo: false, original: "videos-originales/p1.mp4" };

  it("sin vídeo o sin tocar otro fondo: nada", () => {
    expect(accionCambioFondo({ ...base, hayVideo: false })).toBe("nada");
    expect(accionCambioFondo({ ...base, elegido: null })).toBe("nada");
    expect(accionCambioFondo({ ...base, elegido: "carbon" })).toBe("nada");
  });

  it("con original guardado o archivo en memoria: botón", () => {
    expect(accionCambioFondo(base)).toBe("boton");
    expect(accionCambioFondo({ ...base, original: false, tieneArchivo: true })).toBe("boton");
    // Fondo real desconocido (vídeo antiguo) pero con original: también.
    expect(accionCambioFondo({ ...base, real: null })).toBe("boton");
  });

  it("mientras se busca el original, y vídeo antiguo sin original", () => {
    expect(accionCambioFondo({ ...base, original: null })).toBe("buscando");
    expect(accionCambioFondo({ ...base, original: false })).toBe("sin-original");
  });
});
