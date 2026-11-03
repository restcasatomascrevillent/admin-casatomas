/**
 * Móvil (Android, iPhone, iPad; el mismo camino que el portátil): el fondo se
 * quita EN EL FORMULARIO al poner la foto (decisión del dueño, 03-11-2026):
 *   - primero en el navegador del móvil; si falla → el SERVIDOR, también en
 *     el formulario; si también falla → al guardar, la foto normal va a un
 *     ordenador con el motivo;
 *   - un móvil que se queda sin memoria (error o pestaña muerta a la vista)
 *     queda marcado y va directo al servidor;
 *   - el servidor (fetch simulado): éxito, 401, tope, sin respuesta;
 *   - y no queda ninguna llamada a la función de pago recortar-fondo-vino.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  warning: vi.fn(),
  info: vi.fn(),
  reducir: vi.fn(async (f: Blob) => f),
}));
vi.mock("sonner", () => ({ toast: { loading: vi.fn(), success: vi.fn(), warning: mocks.warning, info: mocks.info, dismiss: vi.fn(), error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("../recorte/reducirFotoRecorte", async (o) => ({ ...(await o<typeof import("../recorte/reducirFotoRecorte")>()), reducirFotoRecorte: mocks.reducir }));

import {
  CLAVE_EN_CURSO,
  ID_PESTANA,
  latirMarcaRecorte,
  leerMarcaRecorte,
  marcaHuerfana,
  marcarMovilSinLocal,
  marcarRecorteEnCurso,
  movilSinLocal,
  MS_MARCA_MUERTA,
  type DatosRecorte,
} from "../recorte/recorteMovil";
import { configurarAlNoRecortar, recuperarRecorteInterrumpido } from "../recorte/recorteEnSegundoPlano";
import { LADO_RECORTE_MOVIL, quitarFondoMovil } from "../recorte/quitarFondoMovil";
import { CLAVE_TOPE, ErrorRecorteServidor, finDelTope, pedirMascaraServidor, topeVigente } from "../recorte/quitarFondoServidor";
import { trasGuardarFotoCarta } from "../recorte/avisoGuardadoSinFondo";
import { anchoReducido, medidasCabecera } from "../recorte/reducirFotoRecorte";

const FOTO = new Blob(["foto"], { type: "image/jpeg" });
const STICKER = new Blob(["sticker"], { type: "image/png" });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  configurarAlNoRecortar(null);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("quitarFondoMovil: primero en el móvil y, si falla, en el servidor", () => {
  it("reduce la foto a 1200 y, si el móvil puede, no llama al servidor y suelta la memoria del modelo", async () => {
    let marcaDurante: unknown = null;
    const local = vi.fn(async () => {
      marcaDurante = leerMarcaRecorte();
      return STICKER;
    });
    const servidor = vi.fn();
    const liberar = vi.fn();
    expect(await quitarFondoMovil(FOTO, undefined, { local, servidor, liberar })).toEqual({ sticker: STICKER, metodo: "navegador" });
    expect(mocks.reducir).toHaveBeenCalledWith(FOTO, LADO_RECORTE_MOVIL);
    expect(marcaDurante).toMatchObject({ pestana: ID_PESTANA });
    expect(leerMarcaRecorte()).toBeNull();
    expect(servidor).not.toHaveBeenCalled();
    expect(liberar).toHaveBeenCalled();
  });

  it("sin memoria en el móvil: servidor, el móvil queda marcado y la siguiente va directa al servidor", async () => {
    const local = vi.fn(async () => {
      throw new RangeError("Out of memory");
    });
    const servidor = vi.fn(async () => STICKER);
    const deps = { local, servidor, liberar: vi.fn() };
    expect((await quitarFondoMovil(FOTO, undefined, deps)).metodo).toBe("servidor");
    expect(movilSinLocal()?.motivo).toMatch(/memoria/);
    await quitarFondoMovil(FOTO, undefined, deps);
    expect(local).toHaveBeenCalledTimes(1);
    expect(servidor).toHaveBeenCalledTimes(2);
  });

  it("otro fallo en el móvil (descarga, etc.): servidor, sin marcar el móvil", async () => {
    const local = vi.fn(async () => {
      throw new Error("No se pudo descargar el recortador (Load failed)");
    });
    const servidor = vi.fn(async () => STICKER);
    expect((await quitarFondoMovil(FOTO, undefined, { local, servidor, liberar: vi.fn() })).metodo).toBe("servidor");
    expect(movilSinLocal()).toBeNull();
  });

  it("si el servidor también falla, lanza su error (el formulario enseña el motivo)", async () => {
    marcarMovilSinLocal("prueba");
    const servidor = vi.fn(async () => {
      throw new ErrorRecorteServidor("caído", "servidor", 500);
    });
    await expect(quitarFondoMovil(FOTO, undefined, { servidor })).rejects.toMatchObject({ causa: "servidor" });
  });
});

describe("pestaña muerta recortando en el formulario", () => {
  it("la marca de ESTA pestaña nunca es huérfana; la de otra sin latido sí", () => {
    marcarRecorteEnCurso({ ahora: 1_000 });
    const m = leerMarcaRecorte()!;
    expect(marcaHuerfana(m, 1_000 + MS_MARCA_MUERTA * 10)).toBe(false);
    const otra = { ...m, pestana: "otra" };
    expect(marcaHuerfana(otra, 1_000 + MS_MARCA_MUERTA - 1)).toBe(false);
    expect(marcaHuerfana(otra, 1_000 + MS_MARCA_MUERTA + 1)).toBe(true);
  });

  it("el latido solo lo refresca la pestaña dueña", () => {
    marcarRecorteEnCurso({ ahora: 1_000, pestana: "otra" });
    latirMarcaRecorte({ ahora: 9_000 });
    expect(leerMarcaRecorte()!.latido).toBe(1_000);
    latirMarcaRecorte({ ahora: 9_000, pestana: "otra" });
    expect(leerMarcaRecorte()!.latido).toBe(9_000);
  });

  it("murió a la vista (memoria): el móvil queda marcado y se avisa", () => {
    marcarRecorteEnCurso({ ahora: 1_000, pestana: "murio", visible: true });
    recuperarRecorteInterrumpido({ ahora: () => 1_000 + MS_MARCA_MUERTA + 5 });
    expect(localStorage.getItem(CLAVE_EN_CURSO)).toBeNull();
    expect(movilSinLocal()?.motivo).toMatch(/memoria/);
    expect(mocks.info).toHaveBeenCalled();
  });

  it("murió estando oculta (el usuario salió): no se marca", () => {
    marcarRecorteEnCurso({ ahora: 1_000, pestana: "murio", visible: false });
    recuperarRecorteInterrumpido({ ahora: () => 1_000 + MS_MARCA_MUERTA + 5 });
    expect(movilSinLocal()).toBeNull();
  });

  it("con la marca aún reciente espera; si la otra pestaña sigue latiendo no marca", () => {
    vi.useFakeTimers();
    let t = 1_000;
    marcarRecorteEnCurso({ ahora: t, pestana: "viva" });
    const detectada = vi.fn();
    recuperarRecorteInterrumpido({ ahora: () => t, alDetectar: detectada });
    t += MS_MARCA_MUERTA + 2_000;
    latirMarcaRecorte({ ahora: t, pestana: "viva" });
    vi.advanceTimersByTime(MS_MARCA_MUERTA + 2_000);
    expect(detectada).not.toHaveBeenCalled();
  });
});

describe("servidor (fetch simulado)", () => {
  const pedir = (f: unknown, msTiempo = 2_000) => pedirMascaraServidor(FOTO, { fetch: f as typeof fetch, token: "jwt", msTiempo });

  it("éxito: manda la foto con el JWT y devuelve la máscara", async () => {
    const f = vi.fn(async () => new Response(new Blob(["png"], { type: "image/png" }), { status: 200 }));
    // (Blob de undici, no el de jsdom: en Node 22 no es instanceof del Blob global.)
    expect(typeof (await pedir(f)).arrayBuffer).toBe("function");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/recortar-foto");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt");
    expect(init.body).toBe(FOTO);
  });

  it("401 → causa «sesión»", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: "Sesión no válida o caducada" }), { status: 401 }));
    await expect(pedir(f)).rejects.toMatchObject({ causa: "sesion", estado: 401 });
  });

  it("sin respuesta a tiempo → se corta («tiempo»)", async () => {
    const colgado = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise<Response>((_ok, ko) => init.signal?.addEventListener("abort", () => ko(new DOMException("Aborted", "AbortError")))),
    );
    await expect(pedir(colgado, 30)).rejects.toMatchObject({ causa: "tiempo" });
  });

  it("429 (tope de gasto): «tope mensual» y no vuelve a llamar este mes", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: "x", tope: "mes" }), { status: 429 }));
    await expect(pedir(f)).rejects.toMatchObject({ causa: "tope", message: "Se ha alcanzado el tope mensual de recortes en el servidor" });
    expect(topeVigente()).toBe("mes");
    await expect(pedir(f)).rejects.toMatchObject({ causa: "tope" });
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(CLAVE_TOPE)!).hasta).toBe(finDelTope("mes"));
  });

  it("el tope diario caduca a medianoche y el mensual el día 1", () => {
    const d = new Date(2026, 10, 3, 18, 0);
    expect(new Date(finDelTope("dia", d))).toEqual(new Date(2026, 10, 4));
    expect(new Date(finDelTope("mes", d))).toEqual(new Date(2026, 11, 1));
  });
});

describe("trasGuardarFotoCarta (solo queda el caso del fallo)", () => {
  const original = new File(["x"], "foto.JPEG", { type: "image/jpeg" });

  it("móvil (falló en el móvil y en el servidor): la foto normal va a un ordenador con el motivo", async () => {
    const alNo = vi.fn(async (_d: DatosRecorte, _m: string) => undefined);
    configurarAlNoRecortar(alNo);
    trasGuardarFotoCarta(
      {
        estado: {
          fase: "fallo",
          aviso: "Se ha alcanzado el tope mensual de recortes en el servidor. Al guardar se guarda la foto normal y se recortará en un ordenador.",
          aOrdenador: true,
        },
        original,
        tema: "carbon",
        eleccion: "original",
      },
      { tabla: "Platos", id: "p9", nombre: " Arroz " },
    );
    await vi.waitFor(() => expect(alNo).toHaveBeenCalled());
    expect(alNo).toHaveBeenCalledWith(
      { tabla: "Platos", registroId: "p9", nombre: "Arroz", rutaOriginal: "p9.jpeg", tema: "carbon" },
      "Se ha alcanzado el tope mensual de recortes en el servidor.",
    );
  });

  it("ordenador con recorte fallido: solo avisa (como antes)", () => {
    trasGuardarFotoCarta({ estado: { fase: "fallo", aviso: "x" }, original, tema: "arena", eleccion: "original" }, { tabla: "Vinos", id: "v1" });
    expect(mocks.warning).toHaveBeenCalledTimes(1);
  });

  it("con fondo o «Usar foto original» a propósito: nada que hacer", () => {
    const alNo = vi.fn(async (_d: DatosRecorte, _m: string) => undefined);
    configurarAlNoRecortar(alNo);
    const listo = { fase: "listo" as const, r: { sticker: STICKER, metodo: "navegador" as const } };
    trasGuardarFotoCarta({ estado: listo, original, tema: "arena", eleccion: "carta" }, { tabla: "Vinos", id: "v1" });
    trasGuardarFotoCarta({ estado: listo, original, tema: "arena", eleccion: "original" }, { tabla: "Vinos", id: "v1" });
    expect(alNo).not.toHaveBeenCalled();
    expect(mocks.warning).not.toHaveBeenCalled();
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
