import { describe, expect, it } from "vitest";
import {
  ACCEPT_FOTO,
  ErrorFoto,
  MAX_FOTO_BYTES,
  MENSAJE_FOTO_GRANDE,
  MENSAJE_FOTO_HEIC,
  MENSAJE_FOTO_NO_VALIDA,
  exigirFotoValida,
  mensajeErrorStorage,
  tipoPorFirma,
  validarFoto,
} from "@/lib/validarFoto";

const JPG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d];
const WEBP = [..."RIFF"].map((c) => c.charCodeAt(0)).concat([0x24, 0, 0, 0], [..."WEBP"].map((c) => c.charCodeAt(0)));
const HEIC = [0, 0, 0, 0x18, ...[..."ftypheic"].map((c) => c.charCodeAt(0))];
const EXE = [0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0];

const archivo = (cabecera: number[], { nombre = "foto.jpg", tipo = "image/jpeg", total = 64 } = {}) => {
  const bytes = new Uint8Array(Math.max(total, cabecera.length));
  bytes.set(cabecera);
  return new File([bytes], nombre, { type: tipo });
};

describe("tipoPorFirma", () => {
  it("reconoce JPG, PNG y WebP por los primeros bytes", () => {
    expect(tipoPorFirma(new Uint8Array(JPG))).toBe("image/jpeg");
    expect(tipoPorFirma(new Uint8Array(PNG))).toBe("image/png");
    expect(tipoPorFirma(new Uint8Array(WEBP))).toBe("image/webp");
    expect(tipoPorFirma(new Uint8Array(EXE))).toBeNull();
    expect(tipoPorFirma(new Uint8Array([]))).toBeNull();
  });
});

describe("validarFoto", () => {
  it("acepta JPG, PNG y WebP aunque el nombre o el type mientan", async () => {
    expect(await validarFoto(archivo(JPG))).toEqual({ ok: true, tipo: "image/jpeg" });
    expect(await validarFoto(archivo(PNG, { nombre: "x.jpg", tipo: "" }))).toEqual({ ok: true, tipo: "image/png" });
    expect(await validarFoto(archivo(WEBP, { nombre: "x", tipo: "application/octet-stream" }))).toEqual({
      ok: true,
      tipo: "image/webp",
    });
  });

  it("acepta una foto JPG de 3 MB", async () => {
    expect(await validarFoto(archivo(JPG, { total: 3 * 1024 * 1024 }))).toEqual({ ok: true, tipo: "image/jpeg" });
  });

  it("rechaza un .exe, un .txt y texto renombrado a .jpg", async () => {
    const exe = archivo(EXE, { nombre: "virus.exe", tipo: "application/x-msdownload" });
    const txt = new File(["hola, esto es texto"], "notas.txt", { type: "text/plain" });
    const disfrazado = new File(["hola, esto es texto"], "foto.jpg", { type: "image/jpeg" });
    const exeComoJpg = archivo(EXE, { nombre: "plato.jpg", tipo: "image/jpeg" });
    for (const f of [exe, txt, disfrazado, exeComoJpg]) {
      expect(await validarFoto(f)).toEqual({ ok: false, mensaje: MENSAJE_FOTO_NO_VALIDA });
    }
    expect(MENSAJE_FOTO_NO_VALIDA).toMatch(/JPG, PNG o WebP/);
  });

  it("rechaza más de 5 MB (un .exe de 30 MB por tipo, una foto grande por peso)", async () => {
    expect(await validarFoto(archivo(JPG, { total: MAX_FOTO_BYTES }))).toEqual({ ok: true, tipo: "image/jpeg" });
    expect(await validarFoto(archivo(JPG, { total: MAX_FOTO_BYTES + 1 }))).toEqual({
      ok: false,
      mensaje: MENSAJE_FOTO_GRANDE,
    });
    expect(MENSAJE_FOTO_GRANDE).toMatch(/5 MB/);
  });

  it("explica qué hacer con una foto HEIC del iPhone", async () => {
    const r = await validarFoto(archivo(HEIC, { nombre: "IMG_0001.HEIC", tipo: "image/heic" }));
    expect(r).toEqual({ ok: false, mensaje: MENSAJE_FOTO_HEIC });
    expect(MENSAJE_FOTO_HEIC).toMatch(/Más compatible/);
  });

  it("rechaza un archivo vacío", async () => {
    const r = await validarFoto(new File([], "vacia.jpg", { type: "image/jpeg" }));
    expect(r.ok).toBe(false);
  });

  it("el accept del input solo ofrece JPG, PNG y WebP", () => {
    expect(ACCEPT_FOTO).toBe("image/jpeg,image/png,image/webp");
  });
});

describe("exigirFotoValida", () => {
  it("devuelve el tipo real o lanza ErrorFoto con el motivo", async () => {
    await expect(exigirFotoValida(archivo(PNG))).resolves.toBe("image/png");
    await expect(exigirFotoValida(archivo(EXE))).rejects.toBeInstanceOf(ErrorFoto);
  });
});

describe("mensajeErrorStorage", () => {
  it("traduce 413 y 415 de Storage", () => {
    expect(mensajeErrorStorage({ statusCode: "413", message: "Payload too large" })).toBe(MENSAJE_FOTO_GRANDE);
    expect(mensajeErrorStorage({ message: "The object exceeded the maximum allowed size" })).toBe(MENSAJE_FOTO_GRANDE);
    expect(mensajeErrorStorage({ statusCode: 415, message: "invalid_mime_type" })).toBe(MENSAJE_FOTO_NO_VALIDA);
    expect(mensajeErrorStorage({ message: "mime type application/x-msdownload is not supported" })).toBe(
      MENSAJE_FOTO_NO_VALIDA,
    );
    expect(mensajeErrorStorage(new ErrorFoto("motivo"))).toBe("motivo");
  });

  it("deja los demás errores al formulario", () => {
    expect(mensajeErrorStorage({ statusCode: "500", message: "Internal" })).toBeNull();
    expect(mensajeErrorStorage(new Error("Failed to fetch"))).toBeNull();
    expect(mensajeErrorStorage(null)).toBeNull();
  });
});
