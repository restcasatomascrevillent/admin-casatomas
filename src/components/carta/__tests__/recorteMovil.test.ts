/**
 * Fallo «no deja subir fotos, cuando las subo se me cierra» (2026-11-01): en
 * el móvil el recorte en el navegador (modelo de 47 MB + cientos de MB al
 * recortar) hacía que el sistema matara la pestaña y la página se recargaba
 * con la foto perdida. En móvil/tablet el formulario no carga el modelo: se
 * recorta DESPUÉS de guardar la foto (recorteEnSegundoPlano.ts). Sin Replicate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navegador: vi.fn(async () => new Blob(["sticker"], { type: "image/png" })),
  invoke: vi.fn(),
}));

vi.mock("../recorte/quitarFondoNavegador", async (original) => {
  const real = await original<typeof import("../recorte/quitarFondoNavegador")>();
  return { ...real, quitarFondoNavegador: mocks.navegador };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));

import { recorteNavegadorSeguro } from "../recorte/quitarFondoNavegador";
import { quitarFondo } from "../fotoCartaVino";

const ESCRITORIO = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_COMO_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

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

describe("quitarFondo (formulario)", () => {
  it("en el móvil NO carga el modelo ni llama a ningún servicio: el recorte va después de guardar", async () => {
    vi.stubGlobal("navigator", nav(ANDROID));
    await expect(quitarFondo(new Blob(["foto"], { type: "image/jpeg" }))).rejects.toMatchObject({ codigo: "movil" });
    expect(mocks.navegador).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("en el escritorio sigue usando el recorte gratis del navegador", async () => {
    vi.stubGlobal("navigator", nav(ESCRITORIO, { deviceMemory: 8 }));
    const r = await quitarFondo(new Blob(["foto"], { type: "image/jpeg" }));
    expect(mocks.navegador).toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(r.metodo).toBe("navegador");
  });
});
