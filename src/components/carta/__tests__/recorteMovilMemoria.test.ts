/**
 * iPhone que no recorta (03-11-2026, producción v0.137):
 *   - la descarga del modelo usa UN solo buffer (antes ~140 MB transitorios) y
 *     guardarlo en Cache Storage no lo copia ni lo neutraliza;
 *   - el móvil solo se marca «no recorta» por MEMORIA con la página a la
 *     vista; ni por fallos de red/descarga ni si murió estando oculta;
 *   - el aviso dice la causa real;
 *   - «Varias botellas» en el móvil no dice «sin recorte»: el fondo se pone al
 *     guardar cada botella (trasGuardarFotoCarta, como en la ficha suelta).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  loading: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  dismiss: vi.fn(),
  leer: vi.fn(),
  hacerFotoCarta: vi.fn(),
  destino: vi.fn(() => "movil"),
}));
vi.mock("sonner", () => ({ toast: { loading: mocks.loading, success: mocks.success, warning: mocks.warning, dismiss: mocks.dismiss, error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("../leerVinoFoto", () => ({ leerVinoDeFoto: mocks.leer }));
vi.mock("../fotoCartaVino", () => ({ hacerFotoCarta: mocks.hacerFotoCarta }));
vi.mock("../recorte/useRecorteVino", () => ({ destinoRecorteActual: mocks.destino }));

import { descargarModelo, ErrorDescargaModelo, leerEnUnBuffer, longitudContenido } from "../recorte/descargaModelo";
import {
  CLAVE_EN_CURSO,
  causaFallo,
  dispositivoNoRecorta,
  leerMarcaRecorte,
  marcarRecorteEnCurso,
  MS_MARCA_MUERTA,
  type DatosRecorte,
} from "../recorte/recorteMovil";
import { configurarAlNoRecortar, recortarEnMovil, recuperarRecorteInterrumpido, textoProgresoMovil } from "../recorte/recorteEnSegundoPlano";
import { useLoteVinos } from "../useLoteVinos";
import { textoListo } from "../LoteVinosFoto";

const DATOS: DatosRecorte = { tabla: "Vinos", registroId: "v1", nombre: "Fondillón", rutaOriginal: "v1.jpeg", tema: "arena" };

/** Stream que entrega `datos` en trozos de `trozo` bytes. */
function stream(datos: Uint8Array, trozo = 7): ReadableStream<Uint8Array> {
  let o = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (o >= datos.length) return c.close();
      c.enqueue(datos.slice(o, o + trozo));
      o += trozo;
    },
  });
}
function datosPrueba(n: number): Uint8Array {
  const d = new Uint8Array(n);
  for (let i = 0; i < n; i++) d[i] = (i * 31) % 251;
  return d;
}
/** Comparación rápida de buffers grandes (toEqual va byte a byte y tarda). */
const iguales = (a: Uint8Array, b: Uint8Array) => a.length === b.length && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.length), Buffer.from(b.buffer, b.byteOffset, b.length)) === 0;

let visibilidad: DocumentVisibilityState = "visible";
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  configurarAlNoRecortar(null);
  visibilidad = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibilidad });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("descarga del modelo en un solo buffer", () => {
  it("con Content-Length reserva UN buffer de ese tamaño y escribe el stream dentro", async () => {
    const datos = datosPrueba(1000);
    const progreso: number[] = [];
    const bytes = await leerEnUnBuffer(stream(datos), 1000, (r) => progreso.push(r));
    expect(bytes.buffer.byteLength).toBe(1000); // ni trozos ni copia: el buffer es exactamente el modelo
    expect(bytes.byteOffset).toBe(0);
    expect(bytes).toEqual(datos);
    expect(progreso.at(-1)).toBe(1000);
  });

  it("sin Content-Length (o comprimido) junta los trozos como antes", async () => {
    const datos = datosPrueba(333);
    expect(await leerEnUnBuffer(stream(datos), null)).toEqual(datos);
    expect(longitudContenido(new Headers({ "Content-Length": "333" }))).toBe(333);
    expect(longitudContenido(new Headers({ "Content-Length": "333", "Content-Encoding": "gzip" }))).toBeNull();
    expect(longitudContenido(new Headers())).toBeNull();
  });

  it("si el servidor manda más de lo anunciado, crece y no se pierde nada", async () => {
    const datos = datosPrueba(500);
    expect(await leerEnUnBuffer(stream(datos), 300)).toEqual(datos);
    expect(await leerEnUnBuffer(stream(datos), 800)).toEqual(datos);
  });

  it("guarda en Cache Storage sin copiar en JS ni neutralizar el buffer que usa ORT", async () => {
    const datos = datosPrueba(3 * 1024 * 1024 + 5);
    const guardado: Uint8Array[] = [];
    const cache = {
      match: vi.fn(async () => undefined),
      put: vi.fn(async (_u: string, r: Response) => {
        guardado.push(new Uint8Array(await r.arrayBuffer()));
      }),
    } as unknown as Cache;
    const fetchFalso = vi.fn(async () => new Response(stream(datos, 64 * 1024), { headers: { "Content-Length": String(datos.length) } }));
    const r = await descargarModelo("/m.onnx", { abrirCache: async () => cache, fetch: fetchFalso as unknown as typeof fetch });
    expect(r.desdeCache).toBe(false);
    expect(r.bytes.byteLength).toBe(datos.length); // no se transfirió (seguiría a 0)
    expect(r.bytes.buffer.byteLength).toBe(datos.length);
    expect(iguales(r.bytes, datos)).toBe(true);
    expect(iguales(guardado[0], datos)).toBe(true);
  });

  it("si ya está en la caché no descarga", async () => {
    const datos = datosPrueba(10);
    const cache = { match: vi.fn(async () => new Response(datos)), put: vi.fn() } as unknown as Cache;
    const fetchFalso = vi.fn();
    const r = await descargarModelo("/m.onnx", { abrirCache: async () => cache, fetch: fetchFalso as unknown as typeof fetch });
    expect(r).toMatchObject({ desdeCache: true });
    expect(r.bytes).toEqual(datos);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("un fallo de red o HTTP sale como ErrorDescargaModelo (causa «descarga»)", async () => {
    const sinRed = vi.fn(async () => Promise.reject(new TypeError("Load failed")));
    const e1 = await descargarModelo("/m.onnx", { fetch: sinRed as unknown as typeof fetch }).catch((e) => e);
    expect(e1).toBeInstanceOf(ErrorDescargaModelo);
    expect(causaFallo(e1)).toBe("descarga");
    const http = vi.fn(async () => new Response("x", { status: 503 }));
    const e2 = await descargarModelo("/m.onnx", { fetch: http as unknown as typeof fetch }).catch((e) => e);
    expect(e2.message).toMatch(/503/);
    // Como llega desde el worker (solo nombre y mensaje):
    const desdeWorker = Object.assign(new Error("No se pudo descargar el recortador (Load failed)"), { name: "ErrorDescargaModelo" });
    expect(causaFallo(desdeWorker)).toBe("descarga");
    expect(causaFallo(new Error("no available backend found. ERR: [wasm] TypeError: Failed to fetch"))).toBe("descarga");
  });
});

describe("cuándo se marca el móvil como «no recorta»", () => {
  const liberar = vi.fn();
  const pantalla = vi.fn(async () => vi.fn());

  it("fallo de red/descarga: NO marca y el aviso dice que fue la descarga", async () => {
    const alNo = vi.fn(async (_d: DatosRecorte, _m: string) => undefined);
    configurarAlNoRecortar(alNo);
    const recortar = vi.fn(async () => {
      throw Object.assign(new Error("Se cortó la descarga del recortador (network connection was lost)"), { name: "ErrorDescargaModelo" });
    });
    expect(await recortarEnMovil(DATOS, null, { recortar, liberar, pantalla })).toBe(false);
    expect(dispositivoNoRecorta()).toBeNull();
    expect(alNo.mock.calls[0][1]).toMatch(/No se pudo descargar el recortador/);
  });

  it("sin memoria con la página a la vista: SÍ marca y lo dice", async () => {
    const alNo = vi.fn(async (_d: DatosRecorte, _m: string) => undefined);
    configurarAlNoRecortar(alNo);
    const recortar = vi.fn(async () => {
      throw new RangeError("Out of memory");
    });
    await recortarEnMovil(DATOS, null, { recortar, liberar, pantalla });
    expect(dispositivoNoRecorta()?.motivo).toMatch(/memoria/);
    expect(alNo.mock.calls[0][1]).toMatch(/sin memoria/);
  });

  it("sin memoria pero la página se ocultó mientras recortaba: NO marca («saliste del panel»)", async () => {
    const alNo = vi.fn(async (_d: DatosRecorte, _m: string) => undefined);
    configurarAlNoRecortar(alNo);
    const recortar = vi.fn(async () => {
      visibilidad = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
      expect(leerMarcaRecorte()?.visible).toBe(false); // se anota al momento, sin esperar al latido
      throw new RangeError("Out of memory");
    });
    await recortarEnMovil(DATOS, null, { recortar, liberar, pantalla });
    expect(dispositivoNoRecorta()).toBeNull();
    expect(alNo.mock.calls[0][1]).toMatch(/Saliste del panel/);
  });

  it("mantiene la pantalla encendida mientras recorta y enseña el progreso de la descarga en MB", async () => {
    const soltar = vi.fn();
    const recortar = vi.fn(async (_d: DatosRecorte, o: { onProgreso?: (p: never) => void }) => {
      o.onProgreso?.({ fase: "descargando", pct: 50, recibidos: 23 * 1024 * 1024, total: 47 * 1024 * 1024 } as never);
      return "url";
    });
    await recortarEnMovil(DATOS, null, { recortar: recortar as never, liberar, pantalla: async () => soltar });
    expect(mocks.loading.mock.calls.some((c) => c[0] === "Descargando el recortador: 23/47 MB")).toBe(true);
    expect(mocks.loading.mock.calls.some((c) => /No salgas del panel/.test(c[1]?.description))).toBe(true);
    expect(soltar).toHaveBeenCalled();
    expect(textoProgresoMovil({ fase: "recortando" }, "Rioja").titulo).toBe("Quitando el fondo a Rioja…");
  });

  it("al reabrir: si la pestaña murió estando OCULTA no marca; solo manda la foto al ordenador", () => {
    const alNo = vi.fn(async (_d: DatosRecorte, _m: string) => undefined);
    configurarAlNoRecortar(alNo);
    marcarRecorteEnCurso(DATOS, { ahora: 1_000, pestana: "murio", visible: false });
    recuperarRecorteInterrumpido({ ahora: () => 1_000 + MS_MARCA_MUERTA + 5 });
    expect(localStorage.getItem(CLAVE_EN_CURSO)).toBeNull();
    expect(dispositivoNoRecorta()).toBeNull();
    expect(alNo).toHaveBeenCalledWith(DATOS, expect.stringMatching(/Saliste del panel/));
  });

  it("al reabrir: si murió A LA VISTA (memoria) sí marca", () => {
    marcarRecorteEnCurso(DATOS, { ahora: 1_000, pestana: "murio", visible: true });
    recuperarRecorteInterrumpido({ ahora: () => 1_000 + MS_MARCA_MUERTA + 5 });
    expect(dispositivoNoRecorta()?.motivo).toMatch(/Memoria/);
  });
});

describe("«Varias botellas» en el móvil", () => {
  it("no lanza el recorte en el lote (memoria) y la fila queda «el fondo se pone al guardar»", async () => {
    mocks.destino.mockReturnValue("movil");
    const foto = new File(["x"], "b.jpg", { type: "image/jpeg" });
    mocks.leer.mockResolvedValue({ datos: { nombre: "Rioja" }, foto });
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
    const { result } = renderHook(() => useLoteVinos([]));
    act(() => result.current.añadir([foto]));
    await waitFor(() => expect(result.current.filas[0]?.estado).toBe("listo"));
    expect(result.current.filas[0].recorte).toBe("diferido");
    // Sin promesa de recorte: el formulario pasa a «diferido» y al guardar lanza recortarEnMovil / el trabajo del ordenador.
    expect(result.current.filas[0].resultado?.recorte).toBeUndefined();
    expect(mocks.hacerFotoCarta).not.toHaveBeenCalled();
    expect(textoListo("diferido")).toBe("Listo · el fondo se pone al guardar");
    expect(textoListo("fallo")).not.toMatch(/sin recorte/);
  });

  it("en el ordenador sigue recortando en el lote", async () => {
    mocks.destino.mockReturnValue("formulario");
    mocks.hacerFotoCarta.mockResolvedValue({ sticker: new Blob(["s"]) });
    const foto = new File(["x"], "b.jpg", { type: "image/jpeg" });
    mocks.leer.mockResolvedValue({ datos: { nombre: "Rioja" }, foto });
    const { result } = renderHook(() => useLoteVinos([]));
    act(() => result.current.añadir([foto]));
    await waitFor(() => expect(result.current.filas[0]?.recorte).toBe("listo"));
    expect(mocks.hacerFotoCarta).toHaveBeenCalledTimes(1);
  });
});
