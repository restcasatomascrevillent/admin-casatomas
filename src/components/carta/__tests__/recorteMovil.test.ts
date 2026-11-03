/**
 * Fallo «no deja subir fotos, cuando las subo se me cierra» (2026-11-01): en
 * el móvil el recorte en el navegador (modelo de 47 MB + cientos de MB al
 * recortar) hacía que el sistema matara la pestaña y la página se recargaba
 * con la foto perdida. Desde el 03-11-2026 el móvil vuelve a recortar en el
 * formulario, con la foto reducida y el servidor de respaldo (quitarFondoMovil.ts). Sin Replicate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navegador: vi.fn(async () => new Blob(["sticker"], { type: "image/png" })),
  movil: vi.fn(async () => ({ sticker: new Blob(["sticker"], { type: "image/png" }), metodo: "navegador" as const })),
  invoke: vi.fn(),
}));
vi.mock("../recorte/quitarFondoMovil", () => ({ quitarFondoMovil: mocks.movil }));

vi.mock("../recorte/quitarFondoNavegador", async (original) => {
  const real = await original<typeof import("../recorte/quitarFondoNavegador")>();
  return { ...real, quitarFondoNavegador: mocks.navegador };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));

import { recorteNavegadorSeguro } from "../recorte/quitarFondoNavegador";
import { navegadorDiag } from "../recorte/diagnostico";
import { quitarFondo } from "../fotoCartaVino";

const ESCRITORIO = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_COMO_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1";

const nav = (userAgent: string, extra: Record<string, unknown> = {}) =>
  ({ userAgent, maxTouchPoints: 0, ...extra }) as unknown as Navigator;

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom no trae Worker ni matchMedia.
  vi.stubGlobal("Worker", class {});
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ blob: async () => new Blob(["png"], { type: "image/png" }) })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("¿Se puede recortar en el navegador de este dispositivo?", () => {
  it("sí en un ordenador de escritorio con memoria", () => {
    expect(recorteNavegadorSeguro(nav(ESCRITORIO, { deviceMemory: 8 }))).toBe(true);
    expect(recorteNavegadorSeguro(nav(ESCRITORIO))).toBe(true);
  });

  it("no en un móvil Android, un iPhone ni un iPad (aunque se presente como Mac)", () => {
    expect(recorteNavegadorSeguro(nav(ANDROID))).toBe(false);
    expect(recorteNavegadorSeguro(nav(IPHONE))).toBe(false);
    expect(recorteNavegadorSeguro(nav(IPAD_COMO_MAC, { maxTouchPoints: 5 }))).toBe(false);
  });

  it("no en un equipo con poca memoria", () => {
    expect(recorteNavegadorSeguro(nav(ESCRITORIO, { deviceMemory: 4 }))).toBe(false);
  });

  it("no en una pantalla táctil sin ratón", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("coarse"), media: q }));
    expect(recorteNavegadorSeguro(nav(ESCRITORIO))).toBe(false);
  });
});

describe("decisión por dispositivo: todos recortan en el formulario", () => {
  it.each([
    ["PC", nav(ESCRITORIO, { deviceMemory: 8 }), "ordenador"],
    ["Android", nav(ANDROID), "movil"],
    ["iPhone (Safari)", nav(IPHONE, { maxTouchPoints: 5 }), "movil"],
    ["iPhone (Chrome, CriOS)", nav(IPHONE_CHROME, { maxTouchPoints: 5 }), "movil"],
    ["iPad que se presenta como Mac", nav(IPAD_COMO_MAC, { maxTouchPoints: 5 }), "movil"],
  ])("%s → quita el fondo en el formulario (%s)", async (_n, n, camino) => {
    vi.stubGlobal("navigator", n);
    const r = await quitarFondo(new Blob(["foto"], { type: "image/jpeg" }));
    expect(r.sticker).toBeInstanceOf(Blob);
    if (camino === "ordenador") {
      expect(mocks.navegador).toHaveBeenCalledTimes(1);
      expect(mocks.movil).not.toHaveBeenCalled();
    } else {
      // Móvil: reducida, en el navegador y, si no puede, en el servidor (quitarFondoMovil).
      expect(mocks.movil).toHaveBeenCalledTimes(1);
      expect(mocks.navegador).not.toHaveBeenCalled();
    }
  });

  it("el diagnóstico dice el navegador (Chrome iOS no es Safari)", () => {
    expect(navegadorDiag(nav(IPHONE_CHROME))).toBe("Chrome iOS (iPhone iOS 18.1)");
    expect(navegadorDiag(nav(IPHONE))).toBe("Safari (iPhone iOS 18.0)");
    expect(navegadorDiag(nav(IPAD_COMO_MAC, { maxTouchPoints: 5 }))).toMatch(/^Safari \(iPad/);
    expect(navegadorDiag(nav(ANDROID))).toBe("Chrome Android");
  });
});

describe("quitarFondo (formulario)", () => {
  it("nunca llama a servicios de pago (Replicate)", async () => {
    vi.stubGlobal("navigator", nav(ANDROID));
    await quitarFondo(new Blob(["foto"], { type: "image/jpeg" }));
    vi.stubGlobal("navigator", nav(ESCRITORIO, { deviceMemory: 8 }));
    const r = await quitarFondo(new Blob(["foto"], { type: "image/jpeg" }));
    expect(r.metodo).toBe("navegador");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
