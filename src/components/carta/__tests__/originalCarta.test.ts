/**
 * Original de la foto de la carta para Instagram (originalCarta.ts): se
 * conserva el fichero ELEGIDO (no la versión web recortada/comprimida), se
 * convierte a JPEG ≤ 4000 px y ≤ 8 MB, y si Drive falla solo se avisa.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const guardarOriginalCartaReal = vi.hoisted(() => ({ fn: null as null | ((...a: unknown[]) => unknown) }));
vi.mock("../originalCarta", async (importOriginal) => {
  const real = await importOriginal<typeof import("../originalCarta")>();
  guardarOriginalCartaReal.fn = real.guardarOriginalCarta as never;
  return { ...real, guardarOriginalCarta: vi.fn(async () => true) };
});
vi.mock("../recorte/recorteEnSegundoPlano", () => ({ avisarSinRecorte: vi.fn(), noRecortar: vi.fn(async () => undefined) }));
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }));

import {
  AVISO_SIN_ORIGINAL,
  guardarOriginalCarta,
  MAX_BYTES_ORIGINAL,
  medidasOriginal,
  prepararOriginal,
  type Lienzo,
} from "../originalCarta";
import { trasGuardarFotoCarta } from "../recorte/avisoGuardadoSinFondo";

/** Lienzo falso: decodifica a ancho×alto y «codifica» un JPEG del tamaño que diga `peso(calidad, ancho)`. */
function lienzoFalso(ancho: number, alto: number, peso: (calidad: number, ancho: number) => number = () => 2_000_000) {
  const pintados: Array<{ ancho: number; alto: number; calidad: number; fondo: string | null }> = [];
  const cerrar = vi.fn();
  const lienzo: Lienzo = {
    decodificar: vi.fn(async () => ({ ancho, alto, dibujar: vi.fn(), cerrar })),
    jpeg: vi.fn(async (a, h, pintar, calidad) => {
      const ctx = { fillStyle: "", fillRect: vi.fn() } as unknown as CanvasRenderingContext2D;
      pintar(ctx);
      pintados.push({ ancho: a, alto: h, calidad, fondo: String(ctx.fillStyle) || null });
      // Blob pequeño de verdad; el peso se simula con la propiedad size.
      const b = new Blob([new Uint8Array(16)], { type: "image/jpeg" });
      Object.defineProperty(b, "size", { value: peso(calidad, a) });
      return b;
    }),
  };
  return { lienzo, pintados, cerrar };
}

const archivo = (nombre = "chuleton.heic", tipo = "image/heic") => new File([new Uint8Array([1, 2, 3])], nombre, { type: tipo });

describe("originalCarta · conversión", () => {
  it("medidas: lado mayor ≤ 4000, sin ampliar", () => {
    expect(medidasOriginal(6000, 4500)).toEqual({ ancho: 4000, alto: 3000 });
    expect(medidasOriginal(3024, 4032)).toEqual({ ancho: 3000, alto: 4000 });
    expect(medidasOriginal(1200, 900)).toEqual({ ancho: 1200, alto: 900 });
  });

  it("foto grande de cámara → JPEG 4000×3000 calidad 0,92 con fondo blanco (y libera la imagen)", async () => {
    const { lienzo, pintados, cerrar } = lienzoFalso(6000, 4500);
    const r = await prepararOriginal(archivo(), lienzo);
    expect(r).toMatchObject({ ancho: 4000, alto: 3000 });
    expect(r.blob.type).toBe("image/jpeg");
    expect(pintados).toEqual([{ ancho: 4000, alto: 3000, calidad: 0.92, fondo: "#ffffff" }]);
    expect(cerrar).toHaveBeenCalledTimes(1);
  });

  it("si pasa de 8 MB baja la calidad; si aún no cabe, el lado a 3000", async () => {
    const pesado = lienzoFalso(4000, 3000, (c) => (c > 0.8 ? MAX_BYTES_ORIGINAL + 1 : 7_000_000));
    expect((await prepararOriginal(archivo(), pesado.lienzo)).ancho).toBe(4000);
    expect(pesado.pintados.map((p) => p.calidad)).toEqual([0.92, 0.86, 0.8]);

    const enorme = lienzoFalso(4000, 3000, (_c, a) => (a > 3000 ? MAX_BYTES_ORIGINAL + 1 : 5_000_000));
    const r = await prepararOriginal(archivo(), enorme.lienzo);
    expect(r).toMatchObject({ ancho: 3000, alto: 2250 });

    const imposible = lienzoFalso(4000, 3000, () => MAX_BYTES_ORIGINAL + 1);
    await expect(prepararOriginal(archivo(), imposible.lienzo)).rejects.toThrow(/8 MB/);
    expect(imposible.cerrar).toHaveBeenCalled();
  });
});

describe("originalCarta · guardar en Drive sin bloquear", () => {
  it("sube el JPEG convertido con la tabla y el id de la ficha", async () => {
    const { lienzo } = lienzoFalso(5000, 5000);
    const subir = vi.fn(async () => ({}));
    const avisar = vi.fn();
    expect(await guardarOriginalCartaReal.fn!("Platos", "p1", archivo(), { lienzo, subir, avisar })).toBe(true);
    expect(subir).toHaveBeenCalledTimes(1);
    const n = (subir.mock.calls[0] as unknown[])[0] as { tabla: string; id: string; blob: Blob };
    expect(n).toMatchObject({ tabla: "Platos", id: "p1" });
    expect(n.blob.type).toBe("image/jpeg");
    expect(avisar).not.toHaveBeenCalled();
  });

  it("si Drive falla: avisa «El original no se ha podido guardar en Drive» y NO lanza", async () => {
    const { lienzo } = lienzoFalso(1200, 900);
    const subir = vi.fn(async () => {
      throw new Error("Google Drive: Backend Error");
    });
    const avisar = vi.fn();
    await expect(guardarOriginalCartaReal.fn!("Vinos", "v1", archivo(), { lienzo, subir, avisar })).resolves.toBe(false);
    expect(avisar).toHaveBeenCalledWith(AVISO_SIN_ORIGINAL, expect.stringContaining("La foto de la web sí está guardada. Google Drive: Backend Error"));
  });

  it("si la foto no se puede abrir (HEIC en Chrome): mismo aviso, sin subir nada", async () => {
    const lienzo: Lienzo = { decodificar: vi.fn(async () => Promise.reject(new Error("formato no soportado"))), jpeg: vi.fn() };
    const subir = vi.fn();
    const avisar = vi.fn();
    expect(await guardarOriginalCartaReal.fn!("Platos", "p1", archivo(), { lienzo, subir, avisar })).toBe(false);
    expect(subir).not.toHaveBeenCalled();
    expect(avisar).toHaveBeenCalledWith(AVISO_SIN_ORIGINAL, expect.any(String));
  });
});

describe("trasGuardarFotoCarta conserva el ORIGINAL elegido (no la versión web)", () => {
  const listo = { fase: "listo", r: { sticker: new Blob(), metodo: "recortada" } } as const;
  beforeEach(() => vi.mocked(guardarOriginalCarta).mockClear());

  it("plato: manda a Drive el fichero que eligió el usuario, no la compuesta 1200×900", () => {
    const original = archivo("IMG_1234.JPG", "image/jpeg");
    trasGuardarFotoCarta({ estado: listo, original, tema: "piedra" as never, eleccion: "carta" }, { tabla: "Platos", id: "p1", nombre: "Chuletón" });
    expect(guardarOriginalCarta).toHaveBeenCalledWith("Platos", "p1", original);
  });

  it("vino: igual; aunque el recorte fallara (se guarda igual el original)", () => {
    const original = archivo("botella.png", "image/png");
    trasGuardarFotoCarta({ estado: { fase: "fallo", aviso: "x" }, original, tema: "piedra" as never, eleccion: "original" }, { tabla: "Vinos", id: "v1" });
    expect(guardarOriginalCarta).toHaveBeenCalledWith("Vinos", "v1", original);
  });

  it("bebidas, cócteles o sin foto nueva: no manda nada", () => {
    trasGuardarFotoCarta({ estado: listo, original: archivo(), tema: "piedra" as never, eleccion: "carta" }, { tabla: "Bebidas", id: "b1" });
    trasGuardarFotoCarta({ estado: { fase: "nada" }, original: null, tema: "piedra" as never, eleccion: "carta" }, { tabla: "Platos", id: "p1" });
    expect(guardarOriginalCarta).not.toHaveBeenCalled();
  });
});
