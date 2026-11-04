import { describe, expect, it, vi } from "vitest";
import { bloqueIndicacionesProveedor, cargarIndicaciones, conIndicaciones, MAX_CARACTERES_INDICACIONES } from "./indicaciones.ts";
import { VISION_SYSTEM_PROMPT } from "./prompts.ts";
import type { ClienteOpenAI } from "./openai.ts";

const NARE = { nombre: "Hermanos Narejos", cif: "B03000000", notas_ia: "Los mejillones son LATAS, no kg." };

describe("bloqueIndicacionesProveedor", () => {
  it("vacío sin notas", () => {
    expect(bloqueIndicacionesProveedor([])).toBe("");
    expect(bloqueIndicacionesProveedor(null)).toBe("");
    expect(bloqueIndicacionesProveedor([{ nombre: "X", notas_ia: "  " }])).toBe("");
  });
  it("incluye nombre, CIF, nota y la regla de aplicar solo al emisor", () => {
    const b = bloqueIndicacionesProveedor([NARE]);
    expect(b).toContain("Hermanos Narejos [CIF B03000000]: Los mejillones son LATAS");
    expect(b).toMatch(/SOLO si el proveedor que EMITE/);
  });
  it("máx. 30 proveedores, 4000 caracteres y 500 por nota", () => {
    const muchos = Array.from({ length: 50 }, (_, i) => ({ nombre: `P${i}`, notas_ia: "a" }));
    expect(bloqueIndicacionesProveedor(muchos).split("\n").filter((l) => l.startsWith("- ")).length).toBe(30);
    const largos = Array.from({ length: 30 }, (_, i) => ({ nombre: `P${i}`, notas_ia: "x".repeat(900) }));
    const lineas = bloqueIndicacionesProveedor(largos).split("\n").filter((l) => l.startsWith("- "));
    expect(lineas.every((l) => l.length <= 520)).toBe(true);
    expect(lineas.join("\n").length).toBeLessThanOrEqual(MAX_CARACTERES_INDICACIONES);
    expect(lineas.length).toBeLessThan(30);
  });
});

describe("cargarIndicaciones", () => {
  it("si la consulta falla (columna sin migrar) devuelve []", async () => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "not", "neq", "order"]) q[m] = () => q;
    q.limit = () => Promise.resolve({ data: null, error: { message: "column notas_ia does not exist" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await cargarIndicaciones({ from: () => q })).toEqual([]);
    warn.mockRestore();
  });
});

describe("conIndicaciones", () => {
  const falso = () => {
    const llamarVision = vi.fn(async (..._a: unknown[]) => ({}));
    return {
      llamarVision,
      cliente: { config: {}, uso: {}, llamarVision, verificarPie: vi.fn(), contarFilas: vi.fn(), embed: vi.fn() } as unknown as ClienteOpenAI,
    };
  };
  it("añade el bloque al prompt de extracción sin mutar el array del llamante y lee las notas una vez", async () => {
    const { cliente, llamarVision } = falso();
    const obtener = vi.fn(async () => [NARE]);
    const c = conIndicaciones(cliente, obtener);
    const msgs = [{ role: "system", content: VISION_SYSTEM_PROMPT }, { role: "user", content: "x" }];
    await c.llamarVision(msgs);
    await c.llamarVision(msgs);
    const enviado = llamarVision.mock.calls[0][0] as { content: string }[];
    expect(enviado[0].content).toContain("mejillones son LATAS");
    expect(msgs[0].content).toBe(VISION_SYSTEM_PROMPT);
    expect(obtener).toHaveBeenCalledTimes(1);
  });
  it("no toca otras llamadas ni rompe si obtener falla", async () => {
    const { cliente, llamarVision } = falso();
    const c = conIndicaciones(cliente, async () => {
      throw new Error("x");
    });
    const otros = [{ role: "system", content: "otro" }];
    await c.llamarVision(otros);
    expect(llamarVision.mock.calls[0][0]).toBe(otros);
    const msgs = [{ role: "system", content: VISION_SYSTEM_PROMPT }];
    await c.llamarVision(msgs);
    expect(llamarVision.mock.calls[1][0]).toBe(msgs);
  });
});
