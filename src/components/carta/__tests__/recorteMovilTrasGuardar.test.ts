/**
 * Recorte en el móvil sin Replicate (02-11-2026): la foto se guarda ANTES de
 * recortar; la marca «recorte en curso» detecta la pestaña que iOS mató; un
 * móvil marcado no lo vuelve a intentar; y no queda ninguna llamada a la
 * función de pago recortar-fondo-vino.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  loading: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { loading: mocks.loading, success: mocks.success, warning: mocks.warning, dismiss: mocks.dismiss, error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  CLAVE_EN_CURSO,
  CLAVE_NO_NAVEGADOR,
  decidirRecorte,
  dispositivoNoRecorta,
  esFaltaDeMemoria,
  ID_PESTANA,
  latirMarcaRecorte,
  leerMarcaRecorte,
  marcaHuerfana,
  marcarRecorteEnCurso,
  MS_MARCA_MUERTA,
  type DatosRecorte,
} from "../recorte/recorteMovil";
import { configurarAlNoRecortar, recortarEnMovil, recuperarRecorteInterrumpido } from "../recorte/recorteEnSegundoPlano";
import { ErrorFichaCambiada } from "../recorte/recortarFotoGuardada";
import { trasGuardarFotoCarta } from "../recorte/avisoGuardadoSinFondo";
import { anchoReducido, medidasCabecera } from "../recorte/reducirFotoRecorte";

const DATOS: DatosRecorte = { tabla: "Vinos", registroId: "v1", nombre: "Fondillón", rutaOriginal: "v1.jpeg", tema: "arena" };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  configurarAlNoRecortar(null);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("decidirRecorte", () => {
  it("ordenador → en el formulario; móvil → tras guardar en el móvil; móvil marcado o sin Worker → sin recortar", () => {
    expect(decidirRecorte({ seguro: true, disponible: true, noRecorta: false })).toBe("formulario");
    expect(decidirRecorte({ seguro: true, disponible: true, noRecorta: true })).toBe("formulario");
    expect(decidirRecorte({ seguro: false, disponible: true, noRecorta: false })).toBe("movil");
    expect(decidirRecorte({ seguro: false, disponible: true, noRecorta: true })).toBe("sin-recorte");
    expect(decidirRecorte({ seguro: false, disponible: false, noRecorta: false })).toBe("sin-recorte");
  });

  it("reconoce la falta de memoria", () => {
    expect(esFaltaDeMemoria(new RangeError("Array buffer allocation failed"))).toBe(true);
    expect(esFaltaDeMemoria(new Error("failed to allocate memory"))).toBe(true);
    expect(esFaltaDeMemoria(new Error("No se encontró la botella en la foto"))).toBe(false);
  });
});

describe("marca de recorte en curso (pestaña muerta)", () => {
  it("la marca de ESTA pestaña nunca es huérfana; la de otra sin latido sí", () => {
    marcarRecorteEnCurso(DATOS, { ahora: 1_000 });
    const m = leerMarcaRecorte()!;
    expect(m).toMatchObject({ ...DATOS, pestana: ID_PESTANA, latido: 1_000 });
    expect(marcaHuerfana(m, 1_000 + MS_MARCA_MUERTA * 10)).toBe(false);
    const otra = { ...m, pestana: "otra" };
    expect(marcaHuerfana(otra, 1_000 + MS_MARCA_MUERTA - 1)).toBe(false);
    expect(marcaHuerfana(otra, 1_000 + MS_MARCA_MUERTA + 1)).toBe(true);
  });

  it("el latido solo lo refresca la pestaña dueña", () => {
    marcarRecorteEnCurso(DATOS, { ahora: 1_000, pestana: "otra" });
    latirMarcaRecorte({ ahora: 9_000 });
    expect(leerMarcaRecorte()!.latido).toBe(1_000);
    latirMarcaRecorte({ ahora: 9_000, pestana: "otra" });
    expect(leerMarcaRecorte()!.latido).toBe(9_000);
  });

  it("al abrir el panel con la marca muerta: marca el dispositivo, quita la marca y avisa de la foto normal", () => {
    marcarRecorteEnCurso(DATOS, { ahora: 1_000, pestana: "pestana-que-murio" });
    const detectada = vi.fn();
    recuperarRecorteInterrumpido({ ahora: () => 1_000 + MS_MARCA_MUERTA + 5, alDetectar: detectada });
    expect(localStorage.getItem(CLAVE_EN_CURSO)).toBeNull();
    expect(dispositivoNoRecorta()).not.toBeNull();
    expect(detectada).toHaveBeenCalledWith(DATOS);
  });

  it("con la marca aún reciente espera y vuelve a mirar (puede ser otra pestaña viva)", () => {
    vi.useFakeTimers();
    let t = 1_000;
    marcarRecorteEnCurso(DATOS, { ahora: t, pestana: "otra-pestana" });
    const detectada = vi.fn();
    recuperarRecorteInterrumpido({ ahora: () => t, alDetectar: detectada });
    expect(detectada).not.toHaveBeenCalled();
    t += MS_MARCA_MUERTA + 2_000;
    vi.advanceTimersByTime(MS_MARCA_MUERTA + 2_000);
    expect(detectada).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CLAVE_NO_NAVEGADOR)).not.toBeNull();
  });

  it("si la otra pestaña sigue latiendo no se marca nada", () => {
    vi.useFakeTimers();
    let t = 1_000;
    marcarRecorteEnCurso(DATOS, { ahora: t, pestana: "viva" });
    const detectada = vi.fn();
    recuperarRecorteInterrumpido({ ahora: () => t, alDetectar: detectada });
    t += MS_MARCA_MUERTA + 2_000;
    latirMarcaRecorte({ ahora: t, pestana: "viva" });
    vi.advanceTimersByTime(MS_MARCA_MUERTA + 2_000);
    expect(detectada).not.toHaveBeenCalled();
    expect(dispositivoNoRecorta()).toBeNull();
  });
});

describe("recortarEnMovil (después de guardar la foto original)", () => {
  it("deja la marca mientras recorta, la quita al acabar, libera el worker y avisa", async () => {
    let marcaDurante: unknown = null;
    const liberar = vi.fn();
    const recortar = vi.fn(async () => {
      marcaDurante = leerMarcaRecorte();
      return "https://x/v1-carta-jpeg.webp";
    });
    const blob = new Blob(["foto"], { type: "image/jpeg" });
    expect(await recortarEnMovil(DATOS, blob, { recortar, liberar })).toBe(true);
    expect(marcaDurante).toMatchObject(DATOS);
    expect(recortar).toHaveBeenCalledWith(DATOS, { original: blob });
    expect(localStorage.getItem(CLAVE_EN_CURSO)).toBeNull();
    expect(liberar).toHaveBeenCalled();
    expect(mocks.success).toHaveBeenCalled();
  });

  it("si falla: la foto normal se queda, se avisa de que se recortará desde un ordenador", async () => {
    const recortar = vi.fn(async () => {
      throw new Error("No se encontró la botella en la foto");
    });
    expect(await recortarEnMovil(DATOS, null, { recortar, liberar: vi.fn() })).toBe(false);
    expect(localStorage.getItem(CLAVE_EN_CURSO)).toBeNull();
    expect(dispositivoNoRecorta()).toBeNull();
    expect(mocks.warning).toHaveBeenCalledTimes(1);
    expect(mocks.warning.mock.calls[0][1].description).toMatch(/desde un ordenador/);
  });

  it("sin memoria: además marca el dispositivo para no volver a intentarlo", async () => {
    const recortar = vi.fn(async () => {
      throw new RangeError("Array buffer allocation failed");
    });
    await recortarEnMovil(DATOS, null, { recortar, liberar: vi.fn() });
    expect(dispositivoNoRecorta()).not.toBeNull();
  });

  it("si la ficha ya tiene otra foto no pisa nada ni avisa de error", async () => {
    const recortar = vi.fn(async () => {
      throw new ErrorFichaCambiada();
    });
    const alNo = vi.fn(async (_d: DatosRecorte, _m: string) => undefined);
    configurarAlNoRecortar(alNo);
    expect(await recortarEnMovil(DATOS, null, { recortar, liberar: vi.fn() })).toBe(false);
    expect(alNo).not.toHaveBeenCalled();
    expect(mocks.warning).not.toHaveBeenCalled();
  });

  it("el gestor de «no se pudo» es configurable (lo usará el trabajo para un ordenador)", async () => {
    const alNo = vi.fn(async (_d: DatosRecorte, _m: string) => undefined);
    configurarAlNoRecortar(alNo);
    await recortarEnMovil(DATOS, null, { recortar: vi.fn(async () => Promise.reject(new Error("x"))), liberar: vi.fn() });
    expect(alNo).toHaveBeenCalledWith(DATOS, expect.any(String));
  });
});

describe("trasGuardarFotoCarta", () => {
  const original = new File(["x"], "foto.JPEG", { type: "image/jpeg" });

  it("en el ordenador con recorte fallido solo avisa (como antes)", () => {
    trasGuardarFotoCarta({ estado: { fase: "fallo", aviso: "x" }, original, tema: "arena", recortarTrasGuardar: false }, { tabla: "Vinos", id: "v1" });
    expect(mocks.warning).toHaveBeenCalledTimes(1);
  });

  it("móvil marcado: la foto normal se queda y se avisa (con la ruta original guardada)", async () => {
    const alNo = vi.fn(async (_d: DatosRecorte, _m: string) => undefined);
    configurarAlNoRecortar(alNo);
    trasGuardarFotoCarta(
      { estado: { fase: "diferido", destino: "sin-recorte" }, original, tema: "carbon", recortarTrasGuardar: true },
      { tabla: "Platos", id: "p9", nombre: " Arroz " },
    );
    await vi.waitFor(() => expect(alNo).toHaveBeenCalled());
    expect(alNo.mock.calls[0][0]).toEqual({ tabla: "Platos", registroId: "p9", nombre: "Arroz", rutaOriginal: "p9.jpeg", tema: "carbon" });
  });

  it("«Usar foto original» en el móvil: no hace nada después", async () => {
    const alNo = vi.fn(async (_d: DatosRecorte, _m: string) => undefined);
    configurarAlNoRecortar(alNo);
    trasGuardarFotoCarta({ estado: { fase: "diferido", destino: "movil" }, original, tema: "arena", recortarTrasGuardar: false }, { tabla: "Vinos", id: "v1" });
    await new Promise((r) => setTimeout(r, 20));
    expect(alNo).not.toHaveBeenCalled();
    expect(mocks.loading).not.toHaveBeenCalled();
  });
});

describe("reducir la foto antes de decodificarla", () => {
  it("lee las medidas de la cabecera de un JPEG, PNG y WebP", () => {
    // JPEG: SOI + APP0 (16 B) + SOF0 alto 3024 ancho 4032.
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x0b, 0xd0, 0x0f, 0xc0, 0x03, 0x01, 0x22, 0x00,
    ]);
    expect(medidasCabecera(jpeg)).toEqual({ ancho: 4032, alto: 3024 });
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x07, 0xd0, 0, 0, 0x05, 0xdc]);
    expect(medidasCabecera(png)).toEqual({ ancho: 2000, alto: 1500 });
    const webp = new Uint8Array(30);
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
    webp.set([0xff, 0x0f, 0x00, 0xbf, 0x0b, 0x00], 24); // 4096 × 3008
    expect(medidasCabecera(webp)).toEqual({ ancho: 4096, alto: 3008 });
    expect(medidasCabecera(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("pide al decodificador el ancho justo (solo si hace falta reducir)", () => {
    expect(anchoReducido({ ancho: 4032, alto: 3024 }, 1200)).toBe(1200);
    expect(anchoReducido({ ancho: 3024, alto: 4032 }, 1200)).toBe(900);
    expect(anchoReducido({ ancho: 800, alto: 600 }, 1200)).toBeNull();
  });
});

describe("sin Replicate", () => {
  function ficheros(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) return n === "__tests__" ? [] : ficheros(p);
      return /\.(ts|tsx)$/.test(n) ? [p] : [];
    });
  }

  it("el panel ya no llama a recortar-fondo-vino ni habla de la clave de Replicate", () => {
    const culpables = ficheros(join(process.cwd(), "src")).filter((f) => {
      const s = readFileSync(f, "utf8");
      return /recortar-fondo-vino|falta la clave de Replicate|sin_token|token_invalido|sin_saldo/.test(s);
    });
    expect(culpables).toEqual([]);
  });
});
