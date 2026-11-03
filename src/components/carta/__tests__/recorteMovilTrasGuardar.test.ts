/**
 * Móvil (Android, iPhone, iPad; mismo camino): después de guardar, el fondo se
 * quita EN EL MÓVIL y, si falla, en el SERVIDOR; si también falla, un ordenador.
 *   - la foto se guarda ANTES; la marca «recorte en curso» (una por ficha)
 *     detecta un panel cerrado a medias y esa foto se retoma en el servidor;
 *   - el toast sale AL MOMENTO (en el iPhone «no pasaba nada»: el Wake Lock
 *     se esperaba antes de enseñar nada y en iOS puede no volver nunca);
 *   - el servidor (fetch simulado): éxito, 401, tope, sin respuesta → trabajo
 *     para un ordenador con el motivo;
 *   - y no queda ninguna llamada a la función de pago recortar-fondo-vino.
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
  ID_PESTANA,
  latirMarcasRecorte,
  leerMarcasRecorte,
  marcaHuerfana,
  marcarMovilSinLocal,
  marcarRecorteEnCurso,
  movilSinLocal,
  MS_MARCA_MUERTA,
  motivoFallo,
  type DatosRecorte,
} from "../recorte/recorteMovil";
import { configurarAlNoRecortar, recortarEnMovil, recuperarRecorteInterrumpido, type DependenciasMovil } from "../recorte/recorteEnSegundoPlano";
import { ErrorFichaCambiada, type OpcionesRecorteGuardado } from "../recorte/recortarFotoGuardada";
import { CLAVE_TOPE, ErrorRecorteServidor, finDelTope, pedirMascaraServidor, topeVigente } from "../recorte/quitarFondoServidor";
import { trasGuardarFotoCarta } from "../recorte/avisoGuardadoSinFondo";
import { anchoReducido, medidasCabecera } from "../recorte/reducirFotoRecorte";

const DATOS: DatosRecorte = { tabla: "Vinos", registroId: "v1", nombre: "Fondillón", rutaOriginal: "v1.jpeg", tema: "arena" };
const OTRA: DatosRecorte = { ...DATOS, registroId: "v2", rutaOriginal: "v2.jpeg" };
const pantalla = async () => () => undefined;
const FOTO = new Blob(["foto"], { type: "image/jpeg" });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  configurarAlNoRecortar(null);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("marcas de recorte en curso (panel cerrado a medias)", () => {
  it("una marca por ficha; la de ESTA pestaña nunca es huérfana; la de otra sin latido sí", () => {
    marcarRecorteEnCurso(DATOS, { ahora: 1_000 });
    marcarRecorteEnCurso(OTRA, { ahora: 1_000 });
    marcarRecorteEnCurso(DATOS, { ahora: 2_000 }); // la misma ficha no se duplica
    const marcas = leerMarcasRecorte();
    expect(marcas.map((m) => m.registroId)).toEqual(["v2", "v1"]);
    const m = marcas[1];
    expect(m).toMatchObject({ ...DATOS, pestana: ID_PESTANA, latido: 2_000 });
    expect(marcaHuerfana(m, 2_000 + MS_MARCA_MUERTA * 10)).toBe(false);
    const otra = { ...m, pestana: "otra" };
    expect(marcaHuerfana(otra, 2_000 + MS_MARCA_MUERTA - 1)).toBe(false);
    expect(marcaHuerfana(otra, 2_000 + MS_MARCA_MUERTA + 1)).toBe(true);
  });

  it("lee también la marca única del formato anterior", () => {
    localStorage.setItem(CLAVE_EN_CURSO, JSON.stringify({ ...DATOS, pestana: "vieja", desde: 1, latido: 1 }));
    expect(leerMarcasRecorte()).toHaveLength(1);
  });

  it("el latido solo lo refresca la pestaña dueña", () => {
    marcarRecorteEnCurso(DATOS, { ahora: 1_000, pestana: "otra" });
    latirMarcasRecorte({ ahora: 9_000 });
    expect(leerMarcasRecorte()[0].latido).toBe(1_000);
    latirMarcasRecorte({ ahora: 9_000, pestana: "otra" });
    expect(leerMarcasRecorte()[0].latido).toBe(9_000);
  });

  it("al abrir el panel con marcas muertas: las quita y retoma esas fotos en el servidor", () => {
    marcarRecorteEnCurso(DATOS, { ahora: 1_000, pestana: "pestana-que-murio" });
    marcarRecorteEnCurso(OTRA, { ahora: 1_000, pestana: "pestana-que-murio" });
    const detectada = vi.fn();
    const retomar = vi.fn();
    recuperarRecorteInterrumpido({ ahora: () => 1_000 + MS_MARCA_MUERTA + 5, alDetectar: detectada, retomar });
    expect(localStorage.getItem(CLAVE_EN_CURSO)).toBeNull();
    expect(detectada).toHaveBeenCalledWith(DATOS);
    expect(retomar).toHaveBeenCalledTimes(2);
    expect(movilSinLocal()).toBeNull(); // sin fase «local»: no fue la memoria
  });

  it("si murió recortando EN EL MÓVIL a la vista (memoria), el móvil queda marcado y se retoma en el servidor", () => {
    const marcas = [
      { ...DATOS, pestana: "murio", desde: 1_000, latido: 1_000, fase: "local", visible: true },
      { ...OTRA, pestana: "murio", desde: 1_000, latido: 1_000, fase: "local", visible: false },
    ];
    localStorage.setItem(CLAVE_EN_CURSO, JSON.stringify(marcas.slice(1)));
    const retomar = vi.fn();
    recuperarRecorteInterrumpido({ ahora: () => 1_000 + MS_MARCA_MUERTA + 5, retomar });
    expect(movilSinLocal()).toBeNull(); // oculta: el usuario salió, no es memoria
    localStorage.setItem(CLAVE_EN_CURSO, JSON.stringify(marcas.slice(0, 1)));
    recuperarRecorteInterrumpido({ ahora: () => 1_000 + MS_MARCA_MUERTA + 5, retomar });
    expect(movilSinLocal()?.motivo).toMatch(/memoria/);
    expect(retomar).toHaveBeenCalledTimes(2);
  });

  it("con la marca aún reciente espera y vuelve a mirar; si la otra pestaña sigue latiendo no hace nada", () => {
    vi.useFakeTimers();
    let t = 1_000;
    marcarRecorteEnCurso(DATOS, { ahora: t, pestana: "viva" });
    const detectada = vi.fn();
    recuperarRecorteInterrumpido({ ahora: () => t, alDetectar: detectada });
    t += MS_MARCA_MUERTA + 2_000;
    latirMarcasRecorte({ ahora: t, pestana: "viva" });
    vi.advanceTimersByTime(MS_MARCA_MUERTA + 2_000);
    expect(detectada).not.toHaveBeenCalled();
  });
});

/** Como recortarFotoGuardada, pero solo pasa la foto por `quitar` (sin Storage ni canvas). */
function recortarFalso() {
  return vi.fn(async (_d: DatosRecorte, o: OpcionesRecorteGuardado = {}) => {
    await o.quitar!(FOTO, o.onProgreso);
    return "https://x/v1-carta-jpeg.webp";
  });
}

describe("recortarEnMovil (después de guardar la foto original)", () => {
  it("el toast sale AL MOMENTO aunque el Wake Lock no conteste nunca (iPhone: «no pasaba nada»)", async () => {
    const nunca = () => new Promise<() => void>(() => undefined);
    const recortar = vi.fn(async () => "url");
    const p = recortarEnMovil(DATOS, FOTO, { recortar, pantalla: nunca });
    // Antes de cualquier espera.
    expect(mocks.loading).toHaveBeenCalled();
    expect(mocks.loading.mock.calls[0][0]).toMatch(/Poniendo el fondo de carta a Fondillón/);
    expect(await p).toBe(true); // y no se queda colgado esperando al Wake Lock
    expect(recortar).toHaveBeenCalled();
  });

  it("deja la marca mientras recorta, la quita al acabar y avisa", async () => {
    let marcaDurante: unknown = null;
    const recortar = vi.fn(async () => {
      marcaDurante = leerMarcasRecorte()[0];
      return "https://x/v1-carta-jpeg.webp";
    });
    expect(await recortarEnMovil(DATOS, FOTO, { recortar, pantalla })).toBe(true);
    expect(marcaDurante).toMatchObject(DATOS);
    expect(recortar).toHaveBeenCalledWith(DATOS, expect.objectContaining({ original: FOTO, quitar: expect.any(Function) }));
    expect(localStorage.getItem(CLAVE_EN_CURSO)).toBeNull();
    expect(mocks.success).toHaveBeenCalled();
  });

  it("varias fotos a la vez van al servidor de una en una", async () => {
    const orden: string[] = [];
    let soltar!: () => void;
    const primera = new Promise<void>((r) => (soltar = r));
    const recortar = vi.fn(async (d: DatosRecorte) => {
      orden.push(`empieza ${d.registroId}`);
      if (d.registroId === "v1") await primera;
      orden.push(`acaba ${d.registroId}`);
      return "url";
    });
    const a = recortarEnMovil(DATOS, FOTO, { recortar, pantalla });
    const b = recortarEnMovil(OTRA, FOTO, { recortar, pantalla });
    expect(leerMarcasRecorte()).toHaveLength(2);
    await new Promise((r) => setTimeout(r, 10));
    soltar();
    await Promise.all([a, b]);
    expect(orden).toEqual(["empieza v1", "acaba v1", "empieza v2", "acaba v2"]);
  });

  it("si la ficha ya tiene otra foto no pisa nada ni avisa de error", async () => {
    const recortar = vi.fn(async () => {
      throw new ErrorFichaCambiada();
    });
    const alNo = vi.fn(async (_d: DatosRecorte, _m: string) => undefined);
    configurarAlNoRecortar(alNo);
    expect(await recortarEnMovil(DATOS, null, { recortar, pantalla })).toBe(false);
    expect(alNo).not.toHaveBeenCalled();
    expect(mocks.warning).not.toHaveBeenCalled();
  });

  it("si el servidor no encuentra el producto avisa, pero no lo manda al ordenador (usa el mismo modelo)", async () => {
    const alNo = vi.fn(async (_d: DatosRecorte, _m: string) => undefined);
    configurarAlNoRecortar(alNo);
    const recortar = vi.fn(async () => {
      throw new ErrorRecorteServidor("No se encontró el producto en la foto", "sin-producto", 422);
    });
    await recortarEnMovil(DATOS, null, { recortar, pantalla });
    expect(alNo).not.toHaveBeenCalled();
    expect(mocks.warning.mock.calls[0][1].description).toMatch(/no encontró el producto/);
  });
});

describe("primero en el móvil y, si falla, en el servidor", () => {
  it("si el móvil puede, no se llama al servidor y se suelta la memoria del modelo", async () => {
    const local = vi.fn(async () => new Blob(["sticker"]));
    const servidor = vi.fn();
    const liberar = vi.fn();
    expect(await recortarEnMovil(DATOS, FOTO, { recortar: recortarFalso(), pantalla, local, servidor, liberar })).toBe(true);
    expect(local).toHaveBeenCalledTimes(1);
    expect(servidor).not.toHaveBeenCalled();
    expect(liberar).toHaveBeenCalled();
  });

  it("si el móvil se queda sin memoria: servidor, el móvil queda marcado y la siguiente va directa al servidor", async () => {
    const local = vi.fn(async () => {
      throw new RangeError("Out of memory");
    });
    const servidor = vi.fn(async () => new Blob(["sticker"]));
    const deps: DependenciasMovil = { recortar: recortarFalso(), pantalla, local, servidor, liberar: vi.fn() };
    expect(await recortarEnMovil(DATOS, FOTO, deps)).toBe(true);
    expect(servidor).toHaveBeenCalledTimes(1);
    expect(movilSinLocal()?.motivo).toMatch(/memoria/);
    await recortarEnMovil(OTRA, FOTO, deps);
    expect(local).toHaveBeenCalledTimes(1);
    expect(servidor).toHaveBeenCalledTimes(2);
  });

  it("otro fallo en el móvil (descarga, etc.): servidor, sin marcar el móvil", async () => {
    const local = vi.fn(async () => {
      throw new Error("No se pudo descargar el recortador (Load failed)");
    });
    const servidor = vi.fn(async () => new Blob(["sticker"]));
    expect(await recortarEnMovil(DATOS, FOTO, { recortar: recortarFalso(), pantalla, local, servidor, liberar: vi.fn() })).toBe(true);
    expect(movilSinLocal()).toBeNull();
  });

  it("si local y servidor fallan: a un ordenador con el motivo del servidor", async () => {
    const alNo = vi.fn(async (_d: DatosRecorte, _m: string) => undefined);
    configurarAlNoRecortar(alNo);
    marcarMovilSinLocal("prueba");
    const servidor = vi.fn(async () => {
      throw new ErrorRecorteServidor("caído", "servidor", 500);
    });
    expect(await recortarEnMovil(DATOS, FOTO, { recortar: recortarFalso(), pantalla, servidor })).toBe(false);
    expect(alNo).toHaveBeenCalledWith(DATOS, expect.stringMatching(/El servidor no pudo quitar el fondo/));
  });
});

describe("servidor (fetch simulado)", () => {
  // Móvil ya marcado: va directo al servidor.
  beforeEach(() => marcarMovilSinLocal("prueba"));
  const conFetch = (f: typeof fetch, msTiempo = 2_000): DependenciasMovil => ({
    recortar: recortarFalso(),
    pantalla,
    servidor: (foto: Blob, p?: (x: never) => void) => pedirMascaraServidor(foto, { fetch: f, token: "jwt", msTiempo, onProgreso: p }),
  });

  it("éxito: manda la foto con el JWT y la ficha queda con fondo", async () => {
    const f = vi.fn(async () => new Response(new Blob(["png"], { type: "image/png" }), { status: 200 }));
    expect(await recortarEnMovil(DATOS, FOTO, conFetch(f as unknown as typeof fetch))).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/recortar-foto");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt");
    expect(init.body).toBe(FOTO);
    expect(mocks.success).toHaveBeenCalled();
  });

  it("401: la foto se queda y va a un ordenador con el motivo (sesión)", async () => {
    const alNo = vi.fn(async (_d: DatosRecorte, _m: string) => undefined);
    configurarAlNoRecortar(alNo);
    const f = vi.fn(async () => new Response(JSON.stringify({ error: "Sesión no válida o caducada" }), { status: 401 }));
    expect(await recortarEnMovil(DATOS, FOTO, conFetch(f as unknown as typeof fetch))).toBe(false);
    expect(alNo).toHaveBeenCalledWith(DATOS, expect.stringMatching(/sesión/));
  });

  it("sin respuesta a tiempo: se corta y va a un ordenador («tardó demasiado»)", async () => {
    const alNo = vi.fn(async (_d: DatosRecorte, _m: string) => undefined);
    configurarAlNoRecortar(alNo);
    const colgado = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise<Response>((_ok, ko) => init.signal?.addEventListener("abort", () => ko(new DOMException("Aborted", "AbortError")))),
    );
    expect(await recortarEnMovil(DATOS, FOTO, conFetch(colgado as unknown as typeof fetch, 30))).toBe(false);
    expect(alNo).toHaveBeenCalledWith(DATOS, expect.stringMatching(/tardó demasiado/));
  });

  it("429 (tope de gasto): va a un ordenador con «tope mensual» y no vuelve a llamar este mes", async () => {
    const alNo = vi.fn(async (_d: DatosRecorte, _m: string) => undefined);
    configurarAlNoRecortar(alNo);
    const f = vi.fn(async () => new Response(JSON.stringify({ error: "x", tope: "mes" }), { status: 429 }));
    await recortarEnMovil(DATOS, FOTO, conFetch(f as unknown as typeof fetch));
    expect(alNo.mock.calls[0][1]).toBe("Se ha alcanzado el tope mensual de recortes en el servidor.");
    expect(topeVigente()).toBe("mes");
    await recortarEnMovil(OTRA, FOTO, conFetch(f as unknown as typeof fetch));
    expect(f).toHaveBeenCalledTimes(1); // la segunda foto ya no llama al servidor
    expect(alNo).toHaveBeenCalledTimes(2);
    expect(JSON.parse(localStorage.getItem(CLAVE_TOPE)!).hasta).toBe(finDelTope("mes"));
  });

  it("el tope diario caduca a medianoche y el mensual el día 1", () => {
    const d = new Date(2026, 10, 3, 18, 0);
    expect(new Date(finDelTope("dia", d))).toEqual(new Date(2026, 10, 4));
    expect(new Date(finDelTope("mes", d))).toEqual(new Date(2026, 11, 1));
    expect(motivoFallo(new ErrorRecorteServidor("Failed to fetch", "red"))).toMatch(/No se pudo conectar/);
  });
});

describe("trasGuardarFotoCarta", () => {
  const original = new File(["x"], "foto.JPEG", { type: "image/jpeg" });

  it("en el ordenador con recorte fallido solo avisa (como antes)", () => {
    trasGuardarFotoCarta({ estado: { fase: "fallo", aviso: "x" }, original, tema: "arena", eleccion: "original" }, { tabla: "Vinos", id: "v1" });
    expect(mocks.warning).toHaveBeenCalledTimes(1);
  });

  it("móvil: lanza el recorte en el servidor con la ruta original guardada y enseña el progreso al momento", async () => {
    const alNo = vi.fn(async (_d: DatosRecorte, _m: string) => undefined);
    configurarAlNoRecortar(alNo);
    trasGuardarFotoCarta({ estado: { fase: "diferido" }, original, tema: "carbon", eleccion: "carta" }, { tabla: "Platos", id: "p9", nombre: " Arroz " });
    expect(mocks.loading).toHaveBeenCalled(); // síncrono: nada de import() que pueda fallar en silencio
    expect(leerMarcasRecorte()[0]).toMatchObject({ tabla: "Platos", registroId: "p9", nombre: "Arroz", rutaOriginal: "p9.jpeg", tema: "carbon" });
    // Sin sesión en la prueba: acaba en el trabajo para un ordenador, con motivo.
    await vi.waitFor(() => expect(alNo).toHaveBeenCalled());
  });

  it("«Usar foto original» en el móvil: no hace nada después", async () => {
    trasGuardarFotoCarta({ estado: { fase: "diferido" }, original, tema: "arena", eleccion: "original" }, { tabla: "Vinos", id: "v1" });
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.loading).not.toHaveBeenCalled();
    expect(mocks.warning).not.toHaveBeenCalled();
  });

  it("móvil sin foto original: avisa (nunca en silencio)", () => {
    trasGuardarFotoCarta({ estado: { fase: "diferido" }, original: null, tema: "arena", eleccion: "carta" }, { tabla: "Vinos", id: "v1" });
    expect(mocks.warning).toHaveBeenCalledTimes(1);
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
