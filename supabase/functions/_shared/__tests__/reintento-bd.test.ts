// Reintento cuando la base corta una operación por tiempo (CAS-7, 18/11/2026).
import { describe, expect, it, vi } from "vitest";
import { conReintentoPorTiempo, esCortePorTiempo, ESPERAS_REINTENTO_MS } from "../reintento-bd.ts";

const CORTE = { code: "57014", message: "canceling statement due to statement timeout" };

describe("esCortePorTiempo", () => {
  it("reconoce el corte por tiempo y la espera de bloqueo (por código o por mensaje)", () => {
    expect(esCortePorTiempo(CORTE)).toBe(true);
    expect(esCortePorTiempo({ code: "55P03", message: "lock timeout" })).toBe(true);
    expect(esCortePorTiempo({ message: "canceling statement due to lock timeout" })).toBe(true);
  });
  it("no confunde otros errores", () => {
    expect(esCortePorTiempo(null)).toBe(false);
    expect(esCortePorTiempo({ code: "23505", message: "duplicate key value violates unique constraint" })).toBe(false);
    expect(esCortePorTiempo({ code: "42501", message: "permission denied" })).toBe(false);
  });
});

describe("conReintentoPorTiempo", () => {
  it("por defecto espera 3 s y 8 s", () => {
    expect(ESPERAS_REINTENTO_MS).toEqual([3000, 8000]);
  });

  it("repite tras cada espera mientras sea un corte por tiempo y devuelve el primer resultado bueno", async () => {
    const llamada = vi.fn()
      .mockResolvedValueOnce({ data: null, error: CORTE })
      .mockResolvedValueOnce({ data: { ok: 1 }, error: null });
    const dormir = vi.fn(async () => {});
    const alReintentar = vi.fn();
    const r = await conReintentoPorTiempo(llamada, { esperasMs: [5, 10], dormir, alReintentar });
    expect(r).toEqual({ data: { ok: 1 }, error: null });
    expect(llamada).toHaveBeenCalledTimes(2);
    expect(dormir).toHaveBeenCalledWith(5);
    expect(alReintentar).toHaveBeenCalledWith(1, 5, CORTE);
  });

  it("si nunca entra, devuelve el último error tras agotar las esperas", async () => {
    const llamada = vi.fn(async () => ({ data: null, error: CORTE }));
    const dormir = vi.fn(async () => {});
    const r = await conReintentoPorTiempo(llamada, { esperasMs: [1, 2], dormir });
    expect(r.error).toEqual(CORTE);
    expect(llamada).toHaveBeenCalledTimes(3);
    expect(dormir.mock.calls).toEqual([[1], [2]]);
  });

  it("otro error no se reintenta", async () => {
    const otro = { code: "23505", message: "duplicate key" };
    const llamada = vi.fn(async () => ({ data: null, error: otro }));
    const dormir = vi.fn(async () => {});
    expect((await conReintentoPorTiempo(llamada, { esperasMs: [1], dormir })).error).toEqual(otro);
    expect(llamada).toHaveBeenCalledTimes(1);
    expect(dormir).not.toHaveBeenCalled();
  });

  it("sin esperas no reintenta", async () => {
    const llamada = vi.fn(async () => ({ data: null, error: CORTE }));
    await conReintentoPorTiempo(llamada, { esperasMs: [] });
    expect(llamada).toHaveBeenCalledTimes(1);
  });
});
