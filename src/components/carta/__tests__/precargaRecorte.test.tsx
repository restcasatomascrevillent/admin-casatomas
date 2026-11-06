/**
 * Precarga del modelo del recorte de fotos (petición del dueño, 2026-11-01):
 * al entrar al panel se baja en segundo plano para no esperar la descarga al
 * añadir la primera foto. Solo en escritorio, sin ahorro de datos, una vez y
 * si no está ya guardado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

const ESCRITORIO = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const nav = (userAgent: string, extra: Record<string, unknown> = {}) =>
  ({ userAgent, maxTouchPoints: 0, deviceMemory: 8, ...extra }) as unknown as Navigator;

/** Worker de mentira: guarda lo que se le manda y deja contestar como el de verdad. */
class WorkerFalso {
  static ultimos: WorkerFalso[] = [];
  mensajes: unknown[] = [];
  terminado = false;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  constructor() {
    WorkerFalso.ultimos.push(this);
  }
  postMessage(m: unknown) {
    this.mensajes.push(m);
  }
  terminate() {
    this.terminado = true;
  }
  responder(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

let modeloGuardado = false;

beforeEach(async () => {
  WorkerFalso.ultimos = [];
  modeloGuardado = false;
  vi.stubGlobal("Worker", WorkerFalso);
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q }));
  vi.stubGlobal("caches", {
    open: vi.fn(async () => ({ match: vi.fn(async () => (modeloGuardado ? new Response("x") : undefined)) })),
  });
  const m = await import("../recorte/quitarFondoNavegador");
  m._reiniciarPrecargaParaPruebas();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("precargarRecorte", () => {
  it("en el escritorio manda al worker bajar el modelo, y solo una vez por pestaña", async () => {
    const { precargarRecorte } = await import("../recorte/quitarFondoNavegador");
    expect(await precargarRecorte(nav(ESCRITORIO))).toBe(true);
    expect(WorkerFalso.ultimos).toHaveLength(1);
    expect(WorkerFalso.ultimos[0].mensajes).toEqual([{ tipo: "precargar" }]);
    expect(await precargarRecorte(nav(ESCRITORIO))).toBe(false);
    expect(WorkerFalso.ultimos[0].mensajes).toHaveLength(1);
  });

  it("no hace nada si el modelo ya está guardado en el navegador", async () => {
    modeloGuardado = true;
    const { precargarRecorte } = await import("../recorte/quitarFondoNavegador");
    expect(await precargarRecorte(nav(ESCRITORIO))).toBe(false);
    expect(WorkerFalso.ultimos).toHaveLength(0);
  });

  it("no en el móvil (allí el recorte no se hace en el navegador) ni con ahorro de datos o 2G", async () => {
    const { precargarRecorte, _reiniciarPrecargaParaPruebas } = await import("../recorte/quitarFondoNavegador");
    expect(await precargarRecorte(nav(ANDROID))).toBe(false);
    _reiniciarPrecargaParaPruebas();
    expect(await precargarRecorte(nav(ESCRITORIO, { connection: { saveData: true } }))).toBe(false);
    _reiniciarPrecargaParaPruebas();
    expect(await precargarRecorte(nav(ESCRITORIO, { connection: { effectiveType: "2g" } }))).toBe(false);
    expect(WorkerFalso.ultimos).toHaveLength(0);
  });

  it("al terminar la precarga suelta el worker en un rato (el modelo queda guardado)", async () => {
    const { precargarRecorte, MS_WORKER_INACTIVO } = await import("../recorte/quitarFondoNavegador");
    vi.useFakeTimers();
    await precargarRecorte(nav(ESCRITORIO));
    const w = WorkerFalso.ultimos[0];
    // Mientras baja, no se termina aunque pase el tiempo de inactividad.
    vi.advanceTimersByTime(MS_WORKER_INACTIVO * 2);
    expect(w.terminado).toBe(false);
    w.responder({ tipo: "precargado", ok: true, desdeCache: false });
    vi.advanceTimersByTime(MS_WORKER_INACTIVO + 1);
    expect(w.terminado).toBe(true);
  });
});

describe("<PrecargaRecorte />", () => {
  const precargar = vi.fn(async () => true);
  // «editar»: Ver + Editar en la carta; «ver»: solo Ver; «nada»: sin la sección.
  let acceso: "editar" | "ver" | "nada" = "editar";

  beforeEach(() => {
    vi.resetModules();
    precargar.mockClear();
    acceso = "editar";
    vi.doMock("@/hooks/useUserRole", () => ({
      useCanAccessSection: (seccion: string, tipo: "view" | "edit" = "view") => ({
        canAccess: seccion === "gestor_carta" && (tipo === "edit" ? acceso === "editar" : acceso !== "nada"),
        loading: false,
      }),
    }));
    vi.doMock("../recorte/quitarFondoNavegador", () => ({ precargarRecorte: precargar }));
  });
  afterEach(() => {
    vi.doUnmock("@/hooks/useUserRole");
    vi.doUnmock("../recorte/quitarFondoNavegador");
  });

  it("con «Editar» en la carta, lanza la precarga unos segundos después de entrar", async () => {
    vi.useFakeTimers();
    const { PrecargaRecorte, ESPERA_PRECARGA_MS } = await import("../recorte/PrecargaRecorte");
    render(<PrecargaRecorte />);
    expect(precargar).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(ESPERA_PRECARGA_MS + 10_000);
      await vi.dynamicImportSettled();
    });
    expect(precargar).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["sin acceso a la carta", "nada"],
    ["con solo «Ver» (no sube fotos, 06/11/2026)", "ver"],
  ] as const)("%s no descarga nada", async (_caso, nivel) => {
    acceso = nivel;
    vi.useFakeTimers();
    const { PrecargaRecorte, ESPERA_PRECARGA_MS } = await import("../recorte/PrecargaRecorte");
    render(<PrecargaRecorte />);
    await act(async () => {
      vi.advanceTimersByTime(ESPERA_PRECARGA_MS + 10_000);
      await vi.dynamicImportSettled();
    });
    expect(precargar).not.toHaveBeenCalled();
  });
});
