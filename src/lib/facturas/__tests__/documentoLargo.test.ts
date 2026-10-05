import { beforeEach, describe, expect, it, vi } from "vitest";

const estados: string[] = [];
const invoke = vi.fn();
const upload = vi.fn();
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
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    storage: { from: () => ({ upload: (...a: unknown[]) => upload(...a) }) },
  },
}));

import {
  describirProgreso,
  esperarTrabajo,
  esTerminal,
  iniciarDocumentoUnico,
  SinDocumentosLargos,
  sustituirExistente,
} from "../documentoLargo";

beforeEach(() => {
  estados.length = 0;
  invoke.mockReset();
  upload.mockReset();
  upload.mockResolvedValue({ data: {}, error: null });
});

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
  it("describirProgreso de un documento de una página no habla de trozos", () => {
    const t = (estado: string, intentos = 1) => ({ estado, num_paginas: 1, ocr_trabajo_paginas: [{ estado: "procesando", intentos }] }) as never;
    expect(describirProgreso(t("pendiente"))).toBe("En cola…");
    expect(describirProgreso(t("pagina1"))).toBe("Leyendo el documento…");
    expect(describirProgreso(t("pagina1", 2))).toBe("Leyendo el documento (reintento)…");
    expect(describirProgreso(t("paginas"))).toBe("Comprobando importes y guardando…");
    expect(describirProgreso(t("consolidando"))).toBe("Comprobando importes y guardando…");
  });
});

describe("iniciarDocumentoUnico (una página en segundo plano)", () => {
  const foto = () => new File(["abcdef"], "foto.jpg", { type: "image/jpeg" });
  it("sube el fichero UNA vez como pieza única (que es también el original) y crea el trabajo", async () => {
    invoke.mockResolvedValue({ data: { success: true, trabajo_id: "x", estado: "pagina1", num_paginas: 1 }, error: null });
    const r = await iniciarDocumentoUnico(foto());
    expect(upload).toHaveBeenCalledTimes(1);
    const [path, , opciones] = upload.mock.calls[0] as [string, File, Record<string, unknown>];
    expect(path).toMatch(/^pendientes\/u1\/[0-9a-f-]{36}\/01\.jpg$/);
    expect(opciones).toEqual({ contentType: "image/jpeg", upsert: false });
    const body = (invoke.mock.calls[0] as [string, { body: Record<string, unknown> }])[1].body;
    const pieza = { path, mime: "image/jpeg", bytes: 6 };
    expect(body).toEqual({
      modo: "iniciar", trabajo_id: r.trabajoId, nombre: "foto.jpg", origen: "imagen", original: pieza,
      piezas: [{ numero: 1, ...pieza, pieza: "pagina", pagina_doc: 1, franja: null, franjas_pagina: null }],
    });
    expect(r.numPiezas).toBe(1);
  });
  it("un PDF va con origen pdf", async () => {
    invoke.mockResolvedValue({ data: { success: true }, error: null });
    await iniciarDocumentoUnico(new File(["%PDF"], "a.pdf", { type: "application/pdf" }));
    const body = (invoke.mock.calls[0] as [string, { body: { origen: string; piezas: { path: string }[] } }])[1].body;
    expect(body.origen).toBe("pdf");
    expect(body.piezas[0].path).toMatch(/\/01\.pdf$/);
  });
  it("servidor sin trabajos de una pieza (o sin modo) → SinDocumentosLargos, para caer al síncrono", async () => {
    invoke.mockResolvedValue({ data: { success: false, error: "Un documento de una sola pieza va por el camino normal" }, error: null });
    await expect(iniciarDocumentoUnico(foto())).rejects.toBeInstanceOf(SinDocumentosLargos);
    invoke.mockResolvedValue({ data: { success: false, error: "No se recibió ningún archivo" }, error: null });
    await expect(iniciarDocumentoUnico(foto())).rejects.toBeInstanceOf(SinDocumentosLargos);
    upload.mockResolvedValue({ data: null, error: { message: "new row violates row-level security policy" } });
    await expect(iniciarDocumentoUnico(foto())).rejects.toBeInstanceOf(SinDocumentosLargos);
  });
  it("otros errores del servidor se propagan tal cual", async () => {
    invoke.mockResolvedValue({ data: { success: false, error: "No se encuentra en Storage: x" }, error: null });
    await expect(iniciarDocumentoUnico(foto())).rejects.toThrow("No se encuentra en Storage: x");
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
