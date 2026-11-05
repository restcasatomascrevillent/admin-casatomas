/**
 * Trabajador de render y el bloque A de la evaluación: sección propia
 * (A6) y borrado de los vídeos anteriores de la pieza al terminar (A5).
 */
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error módulo .mjs sin tipos
import { anterioresValidos, borrarAnteriores, SECCION_RENDER } from "../render-reels.mjs";

const PIEZA = "3f2b8a52-6c1e-4d7a-9b0f-1a2b3c4d5e6f";

describe("render-reels: seguridad", () => {
  it("entra con su sección propia, no con Marketing", () => {
    expect(SECCION_RENDER).toBe("instagram_render");
  });

  it("solo borra rutas reels/AAAA-MM/<pieza>-<8 hex>.mp4|.jpg (como mucho 20)", () => {
    const buenas = [`reels/2026-10/${PIEZA}-0000beef.mp4`, `reels/2026-10/${PIEZA}-0000beef.jpg`];
    expect(anterioresValidos([...buenas, "audio/x.mp3", "reels/../x.mp4", `piezas/2026-10/${PIEZA}.jpg`, 7, null])).toEqual(buenas);
    expect(anterioresValidos(undefined)).toEqual([]);
    expect(anterioresValidos(Array.from({ length: 30 }, (_, i) => `reels/2026-10/${PIEZA}-${String(i).padStart(8, "0")}.mp4`))).toHaveLength(20);
  });

  it("borra los anteriores del cubo instagram-video; si falla, no rompe (lo hará la limpieza)", async () => {
    const remove = vi.fn(async (rutas: string[]) => ({ data: rutas.map((name) => ({ name })), error: null }));
    const sb = { storage: { from: vi.fn(() => ({ remove })) } };
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await borrarAnteriores(sb, [`reels/2026-10/${PIEZA}-0000beef.mp4`, "audio/x.mp3"])).toBe(1);
    expect(sb.storage.from).toHaveBeenCalledWith("instagram-video");
    expect(remove).toHaveBeenCalledWith([`reels/2026-10/${PIEZA}-0000beef.mp4`]);
    expect(await borrarAnteriores(sb, [])).toBe(0);
    const malo = { storage: { from: () => ({ remove: async () => ({ data: null, error: { message: "new row violates row-level security policy" } }) }) } };
    expect(await borrarAnteriores(malo, [`reels/2026-10/${PIEZA}-0000beef.mp4`])).toBe(0);
  });
});
