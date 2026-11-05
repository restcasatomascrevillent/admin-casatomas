import { beforeEach, describe, expect, it, vi } from "vitest";

const estados: string[] = [];
const invoke = vi.fn();
const upload = vi.fn();
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
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
  descartarTrabajo,
  describirParado,
  describirProgreso,
  errorSubida,
  esperarTrabajo,
  esTerminal,
  iniciarDocumentoUnico,
  anadirComoPagina,
  FacturaCambiada,
  leerErrorFuncion,
  mensajePorEstado,
  motivoBloqueo,
  planificarGrupo,
  reintentarTrabajo,
  rpcNoExiste,
  SesionOPermiso,
  SigueEnServidor,
  SinDocumentosLargos,
  sustituirExistente,
  trabajoParado,
} from "../documentoLargo";

beforeEach(() => {
  estados.length = 0;
  invoke.mockReset();
  rpc.mockReset();
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
  it("UI-1: pasado el tiempo normal NO falla: avisa «lento» y sigue mirando EL MISMO trabajo, más despacio", async () => {
    estados.push("paginas", "paginas", "paginas", "completado");
    const esperas: number[] = [];
    const lentos: boolean[] = [];
    const t = await esperarTrabajo("t1", (_x, info) => lentos.push(info.lento), {
      dormir: async (ms) => { esperas.push(ms); },
      esperaMaxMs: -1,
      sondeoLentoMs: 30_000,
    });
    expect(t.estado).toBe("completado");
    expect(lentos).toEqual([true, true, true, true]);
    expect(esperas).toEqual([30_000, 30_000, 30_000]);
  });
  it("UI-1: solo tras la espera total lanza SigueEnServidor (no es un fallo, el trabajo sigue)", async () => {
    estados.push(...Array(5).fill("paginas"));
    const err = await esperarTrabajo("t1", undefined, { dormir: async () => {}, esperaMaxMs: -1, esperaTotalMs: -1 }).catch((e) => e);
    expect(err).toBeInstanceOf(SigueEnServidor);
    expect(err.message).toMatch(/Sigue en el servidor/);
    expect(err.trabajo?.estado).toBe("paginas");
  });
  it("UI-9: un trabajo activo que pasó su límite (o sin movimiento) está PARADO; uno reciente, no", () => {
    const ahora = Date.parse("2026-11-05T12:00:00Z");
    expect(trabajoParado({ estado: "pagina1", limite_at: "2026-11-05T11:00:00Z" }, ahora)).toBe(true);
    expect(trabajoParado({ estado: "pagina1", limite_at: "2026-11-05T11:58:00Z" }, ahora)).toBe(false); // dentro del margen
    expect(trabajoParado({ estado: "pagina1", updated_at: "2026-11-04T16:00:00Z" }, ahora)).toBe(true); // 20 h sin moverse
    expect(trabajoParado({ estado: "paginas", updated_at: "2026-11-05T11:59:00Z" }, ahora)).toBe(false);
    expect(trabajoParado({ estado: "fallido", updated_at: "2026-11-01T00:00:00Z" }, ahora)).toBe(false);
    expect(describirParado({ updated_at: "2026-11-04T16:00:00Z" }, new Date(ahora))).toMatch(/^Parado en el servidor: no avanza desde el 04\/11/);
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
  });
  it("UI-5: un 403/RLS o JWT caducado de Storage es sesión caducada o sin permiso, NO «servidor antiguo»", async () => {
    upload.mockResolvedValue({ data: null, error: { message: "new row violates row-level security policy", statusCode: "403" } });
    const rls = await iniciarDocumentoUnico(foto()).catch((e) => e);
    expect(rls).toBeInstanceOf(SesionOPermiso);
    expect(rls).not.toBeInstanceOf(SinDocumentosLargos);
    expect(rls.message).toMatch(/sesión ha caducado o no tienes permiso/);
    upload.mockResolvedValue({ data: null, error: { message: "jwt expired", statusCode: "400" } });
    const jwt = await iniciarDocumentoUnico(foto()).catch((e) => e);
    expect(jwt).toBeInstanceOf(SesionOPermiso);
    expect(jwt.message).toMatch(/Tu sesión ha caducado/);
    expect(invoke).not.toHaveBeenCalled(); // no se crea trabajo ni se cae al síncrono
  });
  it("UI-12: Storage 413 en español, sin el texto en inglés", async () => {
    upload.mockResolvedValue({ data: null, error: { message: "The object exceeded the maximum allowed size", statusCode: "413" } });
    const e = await iniciarDocumentoUnico(foto()).catch((x) => x);
    expect(e.message).toMatch(/foto\.jpg pesa demasiado para subirlo \(máximo 10 MB\)/);
    expect(e.message).not.toMatch(/exceeded|maximum allowed/);
  });
  it("otros errores del servidor se propagan tal cual", async () => {
    invoke.mockResolvedValue({ data: { success: false, error: "No se encuentra en Storage: x" }, error: null });
    await expect(iniciarDocumentoUnico(foto())).rejects.toThrow("No se encuentra en Storage: x");
  });
  it("UI-3: FunctionsHttpError → el motivo del servidor (cuerpo JSON) o un texto en español por código", async () => {
    const httpError = (status: number, cuerpo: string) => ({
      name: "FunctionsHttpError",
      message: "Edge Function returned a non-2xx status code",
      context: new Response(cuerpo, { status }),
    });
    invoke.mockResolvedValue({ data: null, error: httpError(403, JSON.stringify({ success: false, error: "Sin permisos sobre facturas" })) });
    await expect(iniciarDocumentoUnico(foto())).rejects.toThrow("Sin permisos sobre facturas");
    invoke.mockResolvedValue({ data: null, error: httpError(401, "<html>no</html>") });
    await expect(iniciarDocumentoUnico(foto())).rejects.toThrow(/Tu sesión ha caducado/);
    invoke.mockResolvedValue({ data: null, error: httpError(500, "<html>Internal Server Error</html>") });
    await expect(iniciarDocumentoUnico(foto())).rejects.toThrow(/El servidor ha fallado/);
    invoke.mockResolvedValue({ data: null, error: { name: "FunctionsFetchError", message: "Failed to send a request to the Edge Function" } });
    await expect(iniciarDocumentoUnico(foto())).rejects.toThrow(/No se ha podido conectar con el servidor/);
  });
});

describe("leerErrorFuncion y mensajes en español", () => {
  it("nunca deja pasar «Edge Function returned a non-2xx status code»", async () => {
    const m = await leerErrorFuncion({ message: "Edge Function returned a non-2xx status code" }, "No se pudo");
    expect(m).toBe("No se pudo");
    expect(mensajePorEstado(403, "x")).toMatch(/No tienes permiso/);
    expect(mensajePorEstado(502, "x")).toMatch(/El servidor ha fallado/);
  });
  it("errorSubida: red y 5xx en español", () => {
    expect(errorSubida({ message: "Failed to fetch" }, "a.pdf").message).toMatch(/No se ha podido conectar/);
    expect(errorSubida({ message: "Bad Gateway", status: 502 }, "a.pdf").message).toMatch(/El servidor ha fallado/);
    expect(errorSubida({ message: "Something odd" }, "a.pdf").message).toBe("No se pudo subir a.pdf. Inténtalo de nuevo.");
  });
});

describe("RPC ocr_descartar_trabajo / ocr_reintentar_trabajo", () => {
  it("con la RPC: devuelve ok/estado/motivo", async () => {
    rpc.mockResolvedValueOnce({ data: { ok: true, estado: "reanudado" }, error: null });
    expect(await reintentarTrabajo("t1")).toEqual({ disponible: true, ok: true, estado: "reanudado" });
    expect(rpc).toHaveBeenCalledWith("ocr_reintentar_trabajo", { p_trabajo_id: "t1" });
    rpc.mockResolvedValueOnce({ data: { ok: false, motivo: "Ya está consolidando" }, error: null });
    expect(await descartarTrabajo("t2")).toEqual({ disponible: true, ok: false, motivo: "Ya está consolidando" });
    expect(rpc).toHaveBeenLastCalledWith("ocr_descartar_trabajo", { p_trabajo_id: "t2" });
  });
  it("sin la RPC (PGRST202 / 404 / «Could not find the function») → disponible:false (se cae a lo de antes)", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "Could not find the function public.ocr_descartar_trabajo" } });
    expect((await descartarTrabajo("t")).disponible).toBe(false);
    rpc.mockResolvedValueOnce({ data: null, error: { status: 404, message: "Not Found" } });
    expect((await reintentarTrabajo("t")).disponible).toBe(false);
    expect(rpcNoExiste({ message: "Could not find the function x in the schema cache" })).toBe(true);
  });
  it("otro error: motivo en español", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST301", message: "JWT expired" } });
    expect(await descartarTrabajo("t")).toEqual({ disponible: true, ok: false, motivo: expect.stringMatching(/Tu sesión ha caducado/) });
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
    const err = await sustituirExistente(s).catch((e) => e);
    expect(err).toBeInstanceOf(FacturaCambiada);
    expect(err.message).toMatch(/revisa los datos y confirma de nuevo.*9 líneas/);
  });
});

describe("fotos unidas como un documento", () => {
  const foto = (n: string, tipo = "image/jpeg") => new File([n], n, { type: tipo });
  it("una página por foto, en orden, con el PDF como original", async () => {
    const pdf = new File(["%PDF"], "a-2pag.pdf", { type: "application/pdf" });
    const plan = await planificarGrupo([foto("a.jpg"), foto("b.png", "image/png")], { hacerPdf: async () => pdf });
    expect(plan.paginasDocumento).toBe(2);
    expect(plan.original).toBe(pdf);
    expect(plan.piezas.map((p) => [p.pieza, p.pagina_doc, p.mime])).toEqual([["pagina", 1, "image/jpeg"], ["pagina", 2, "image/png"]]);
  });
  it("sin PDF el original queda en null; un PDF suelto no se une", async () => {
    const plan = await planificarGrupo([foto("a.jpg"), foto("b.jpg")], { hacerPdf: async () => null });
    expect(plan.original).toBeNull();
    await expect(planificarGrupo([foto("a.jpg"), foto("b.pdf", "application/pdf")])).rejects.toThrow(/no es una foto/);
    await expect(planificarGrupo([foto("a.jpg")])).rejects.toThrow(/al menos dos/);
  });
});

describe("añadir como página / bloqueos", () => {
  const a = {
    trabajo_id: "t7",
    existente: { id: 352, numero_documento: "P26/24306", proveedor: "NyV", fecha: "2026-10-09", total: 1029.64, total_origen: "leido", lineas: 2, alertas: 0, alertas_graves: 0, updated_at: "u0" },
    pagina: { actual: 1, total: 2 },
    nuevo: { total: null, total_origen: null, lineas: 2, alertas: 1, proveedor: "NyV", fecha: "2026-10-09" },
  };
  it("manda modo anadir_pagina con lo que el usuario vio", async () => {
    invoke.mockResolvedValue({ data: { success: true, message: "Página 1 añadida", alertas: [] }, error: null });
    await anadirComoPagina(a, { lineas: 3, updated_at: "u1" });
    expect(invoke.mock.calls[0][1].body).toEqual({ modo: "anadir_pagina", factura_id: 352, trabajo_id: "t7", esperado: { lineas: 3, updated_at: "u1" } });
  });
  it("factura cambiada → FacturaCambiada; otro error, tal cual", async () => {
    invoke.mockResolvedValue({ data: { success: false, error: "No se ha añadido nada: la factura 352 ha cambiado desde que la viste. Revisa y confirma de nuevo." }, error: null });
    await expect(anadirComoPagina(a)).rejects.toBeInstanceOf(FacturaCambiada);
    invoke.mockResolvedValue({ data: { success: false, error: "Sin permiso" }, error: null });
    await expect(anadirComoPagina(a)).rejects.toThrow("Sin permiso");
  });
  it("no se sustituye una existente sin líneas o que aún se está guardando", () => {
    expect(motivoBloqueo({ lineas: 0, trabajo_pendiente: false }, "sustituir")).toMatch(/no tiene líneas/);
    expect(motivoBloqueo({ lineas: 4, trabajo_pendiente: true }, "sustituir")).toMatch(/aún se está guardando/);
    expect(motivoBloqueo({ lineas: 0, trabajo_pendiente: false }, "anadir")).toBeNull();
    expect(motivoBloqueo({ lineas: 4, trabajo_pendiente: false }, "sustituir")).toBeNull();
  });
});
