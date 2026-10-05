import { beforeEach, describe, expect, it, vi } from "vitest";

const estados: string[] = [];
const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            const estado = estados.shift() ?? "completado";
            return { data: { id: "t1", estado, num_paginas: 5, nombre_original: "luga.jpg", error: null, resultado: { success: true, tipo: "factura" }, factura_id: 54, updated_at: "", ocr_trabajo_paginas: [{ numero: 1, estado: "completada" }] }, error: null };
          },
        }),
      }),
    }),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}));

import { describirProgreso, esperarTrabajo, esTerminal, sustituirExistente } from "../documentoLargo";

beforeEach(() => { estados.length = 0; invoke.mockReset(); });

describe("esperarTrabajo", () => {
  it("sondea hasta un estado terminal y avisa de cada cambio", async () => {
    estados.push("pagina1", "paginas", "consolidando", "completado");
    const vistos: string[] = [];
    const t = await esperarTrabajo("t1", (x) => vistos.push(x!.estado), { dormir: async () => {} });
    expect(t.estado).toBe("completado");
    expect(vistos).toEqual(["pagina1", "paginas", "consolidando", "completado"]);
  });
  it("se rinde con un mensaje claro si pasa del tiempo máximo (el trabajo sigue en segundo plano)", async () => {
    estados.push(...Array(50).fill("paginas"));
    await expect(esperarTrabajo("t1", undefined, { dormir: async () => {}, esperaMaxMs: -1 })).rejects.toThrow(/segundo plano/);
  });
  it("describirProgreso y esTerminal", () => {
    expect(esTerminal("duplicado")).toBe(true);
    expect(esTerminal("consolidando")).toBe(false);
    expect(describirProgreso({ estado: "paginas", num_paginas: 5, ocr_trabajo_paginas: [{ estado: "completada" }, { estado: "pendiente" }] } as never)).toBe("Leídos 1 de 5 trozos…");
  });
});

describe("sustituirExistente", () => {
  const s = {
    trabajo_id: "t9",
    existente: { id: 54, numero_documento: "ML/101511", proveedor: "LUGA", fecha: "2025-12-31", total: null, total_origen: null, lineas: 8, alertas: 1, alertas_graves: 1, updated_at: "2026-09-29T15:28:55" },
    nuevo: { total: 3787.53, total_origen: "deducido", lineas: 54, alertas: 1, proveedor: "LUGA", fecha: "2025-12-31" },
  };
  it("manda la factura, el trabajo y lo que vio el usuario (nº de líneas y updated_at)", async () => {
    invoke.mockResolvedValue({ data: { success: true, message: "ok", alertas: [] }, error: null });
    await sustituirExistente(s);
    expect(invoke).toHaveBeenCalledWith("procesar-factura", {
      body: { modo: "sustituir", factura_id: 54, trabajo_id: "t9", esperado: { lineas: 8, updated_at: "2026-09-29T15:28:55" } },
    });
  });
  it("propaga el motivo del servidor", async () => {
    invoke.mockResolvedValue({ data: { success: false, error: "No se ha sustituido nada: la factura 54 tiene ahora 9 líneas" }, error: null });
    await expect(sustituirExistente(s)).rejects.toThrow(/9 líneas/);
  });
});
