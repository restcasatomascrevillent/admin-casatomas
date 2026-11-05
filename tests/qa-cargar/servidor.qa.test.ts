// ============================================================================
//  QA «Cargar» (05/11/2026) · Fallos del lado servidor, YA ARREGLADOS
// ----------------------------------------------------------------------------
//  Antes cada `it` demostraba un fallo del informe (pasaba = el fallo
//  existía). Ahora comprueba el comportamiento correcto. Supabase, OpenAI y
//  Google Drive simulados: no sale nada a la red.
//    npx vitest run tests/qa-cargar/servidor.qa.test.ts
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _olvidarTokenDrive, archivarOriginal, buscarEnDrive, subirADrive } from "../../supabase/functions/procesar-factura/archivo.ts";
import { apuntarOriginal, guardarDocumento } from "../../supabase/functions/procesar-factura/guardado.ts";
import { nombrePieza, procesarConsolidacion } from "../../supabase/functions/procesar-factura/trabajos.ts";
import { fechaIso, normalizarDatos } from "../../supabase/functions/procesar-factura/extraccion.ts";
import { esPdf } from "../../supabase/functions/importar-factura-historica/mapeo.ts";

type Op = { m: string; a: unknown[] };
type Resolver = (tabla: string, ops: Op[]) => { data: unknown; error: unknown; count?: number };

const LIMITE_BUCKET = 20 * 1024 * 1024; // 20261106200000: el bucket admite 20 MB

function supabaseFalso(resolver: Resolver, ficheros = new Map<string, Uint8Array>()) {
  const consultas: { tabla: string; ops: Op[] }[] = [];
  const rpcs: { nombre: string; args: Record<string, unknown> }[] = [];
  const subidas: string[] = [];
  const borrados: string[][] = [];
  const cadena = (tabla: string, ops: Op[] = []): unknown =>
    new Proxy({}, {
      get(_o, prop: string) {
        if (prop === "then") {
          consultas.push({ tabla, ops });
          const r = resolver(tabla, ops);
          return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(r).then(ok, ko);
        }
        return (...a: unknown[]) => cadena(tabla, [...ops, { m: prop, a }]);
      },
    });
  const supabase = {
    from: (t: string) => cadena(t),
    rpc: async (nombre: string, args: Record<string, unknown>) => {
      rpcs.push({ nombre, args });
      if (nombre === "ocr_factura_existente") return { data: null, error: null };
      if (nombre === "validar_cordura_factura") return { data: [], error: null };
      return { data: true, error: null };
    },
    storage: {
      from: () => ({
        upload: async (path: string, blob: Blob) => {
          if (blob.size > LIMITE_BUCKET) return { data: null, error: { message: "The object exceeded the maximum allowed size" } };
          subidas.push(path);
          ficheros.set(path, new Uint8Array(await blob.arrayBuffer()));
          return { data: { path }, error: null };
        },
        download: async (path: string) => {
          const b = ficheros.get(path);
          return b ? { data: new Blob([b]), error: null } : { data: null, error: { message: "Object not found" } };
        },
        list: async () => ({ data: [], error: null }),
        move: async () => ({ error: { message: "no" } }),
        remove: async (paths: string[]) => {
          borrados.push(paths);
          paths.forEach((p) => ficheros.delete(p));
          return { data: paths, error: null };
        },
      }),
    },
  };
  return { supabase, consultas, rpcs, subidas, borrados, ficheros };
}

const openaiFalso = () => ({
  config: { modelo: "m", detalle: "high" },
  uso: { tokensEntrada: 0, tokensSalida: 0, costeUsd: 0, llamadas: 0 },
  embed: vi.fn(async (x: string | string[]) => (Array.isArray(x) ? x : [x]).map(() => [0.1, 0.2])),
});

const DRIVE_ON = { clientId: "c", clientSecret: "s", refreshToken: "r", parentFolder: "RAIZ" };
const DRIVE_OFF = { clientId: "", clientSecret: "", refreshToken: "", parentFolder: "" };
const UID = "11111111-1111-4111-8111-111111111111";
const TID = "22222222-2222-4222-8222-222222222222";
const RUTA = `pendientes/${UID}/${TID}/01.jpg`;
const URL_DRIVE = "https://drive.google.com/file/d/F/view";

const datos = () => ({
  tipo: "factura", proveedor: "Pescados Ría SL", cif: "B12345678", numero_documento: "F-001",
  fecha: "2026-09-03", subtotal: 100, iva: 10, total: 110, observaciones: null, resumen: null,
  productos: [{ nombre: "Merluza", cantidad: 10, unidad: "ud", precio_unitario: 10, total: 100 }],
  avisos: [],
});

/** Drive simulado: carpetas encontradas y subida multipart que va bien (o falla con `status`). */
function driveFalso(status = 200) {
  const llamadas: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string }) => {
    llamadas.push(`${init?.method ?? "GET"} ${url.split("?")[0]}${url.includes("uploadType=multipart") ? "?multipart" : ""}`);
    if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }));
    if (url.includes("/drive/v3/files?q=")) return new Response(JSON.stringify({ files: [{ id: "CARPETA" }] }));
    if (url.includes("/upload/")) {
      return status === 200
        ? new Response(JSON.stringify({ id: "F", webViewLink: URL_DRIVE }))
        : new Response("Service Unavailable", { status });
    }
    return new Response("{}");
  }));
  return llamadas;
}

/** Reintento de una consolidación cuya factura 101 YA existe, sin original (y con líneas). */
function escenarioReintento(ficheros: Map<string, Uint8Array>) {
  const factura: { drive_url: string | null; archivo_path: string | null } = { drive_url: null, archivo_path: null };
  const f = supabaseFalso((tabla, ops) => {
    const m = ops.map((o) => o.m);
    const campos = String(ops.find((o) => o.m === "select")?.a[0] ?? "");
    if (tabla === "facturas" && m.includes("update")) {
      Object.assign(factura, ops.find((o) => o.m === "update")!.a[0]);
      return { data: null, error: null };
    }
    if (tabla === "facturas" && m.includes("select")) {
      if (campos === "id, drive_url, archivo_path" && m.includes("maybeSingle")) return { data: { id: 101, ...factura }, error: null };
      if (campos === "id, drive_url, archivo_path") return { data: [{ id: 101, ...factura }], error: null };
      if (campos === "archivo_path") return { data: [], error: null };
      return { data: null, error: null };
    }
    if (tabla === "productos_factura" && m.includes("select")) return { data: null, error: null, count: 1 };
    if (tabla === "ocr_trabajos" && m.includes("select")) {
      return { data: { original_path: RUTA, coste_usd: 0, modelo: "m" }, error: null };
    }
    if (tabla === "ocr_trabajo_paginas" && m.includes("select")) {
      if (campos === "storage_path") return { data: [{ storage_path: RUTA }], error: null };
      return {
        data: [{
          id: 1, numero: 1, pieza: "pagina", estado: "completada", storage_path: RUTA, mime: "image/jpeg",
          resultado: { documento_unico: true, datos: datos(), alertasPrevias: [], totalOrigen: "leido", intentos: 1 },
        }],
        error: null,
      };
    }
    return { data: null, error: null };
  }, ficheros);
  return { f, factura };
}

describe("QA Cargar · servidor (arreglado)", () => {
  beforeEach(() => _olvidarTokenDrive());
  afterEach(() => vi.unstubAllGlobals());

  it("S-1: reintento de consolidación con la factura ya creada SIN original → se archiva en Drive (no se pierde)", async () => {
    const ficheros = new Map([[RUTA, new Uint8Array([1, 2, 3])]]);
    const { f, factura } = escenarioReintento(ficheros);
    const llamadas = driveFalso();
    await procesarConsolidacion(
      { supabase: f.supabase, openai: openaiFalso() as never, drive: DRIVE_ON },
      { id: TID, num_paginas: 1, nombre_original: "foto.jpg", original_path: RUTA, original_mime: "image/jpeg" },
    );
    const terminar = f.rpcs.find((r) => r.nombre === "ocr_terminar_trabajo")!;
    expect(terminar.args.p_estado).toBe("completado");
    expect((terminar.args.p_resultado as Record<string, unknown>).archivo_guardado).toBe(true);
    expect((terminar.args.p_resultado as Record<string, unknown>).archivo_estado).toBe("drive");
    expect(llamadas.some((l) => l.endsWith("?multipart"))).toBe(true); // de verdad se subió a Drive
    expect(factura.drive_url).toBe(URL_DRIVE); // y la factura apunta a él
  });

  it("S-1: con Drive caído, el original queda apuntado y NO se borra de pendientes/", async () => {
    const ficheros = new Map([[RUTA, new Uint8Array([1, 2, 3])]]);
    const { f, factura } = escenarioReintento(ficheros);
    driveFalso(503);
    await procesarConsolidacion(
      { supabase: f.supabase, openai: openaiFalso() as never, drive: DRIVE_ON },
      { id: TID, num_paginas: 1, nombre_original: "foto.jpg", original_path: RUTA, original_mime: "image/jpeg" },
    );
    // Copia temporal (pendiente de Drive) o, como poco, la de pendientes/ apuntada.
    expect(factura.archivo_path).toBeTruthy();
    expect(ficheros.has(factura.archivo_path!) || f.subidas.includes(factura.archivo_path!)).toBe(true);
    const terminar = f.rpcs.find((r) => r.nombre === "ocr_terminar_trabajo")!;
    expect((terminar.args.p_resultado as Record<string, unknown>).archivo_estado).toBe("temporal");
  });

  it("S-2: reintento tras morir entre cabecera y líneas → se insertan las líneas que faltan", async () => {
    const f = supabaseFalso((tabla, ops) => {
      const m = ops.map((o) => o.m);
      if (tabla === "facturas" && m.includes("select")) return { data: { id: 101, drive_url: URL_DRIVE, archivo_path: null }, error: null };
      if (tabla === "productos_factura" && m.includes("select")) return { data: null, error: null, count: 0 };
      return { data: null, error: null };
    });
    const r = await guardarDocumento(
      { supabase: f.supabase, openai: openaiFalso() as never, drive: DRIVE_OFF },
      {
        datos: datos() as never, alertasPrevias: [], totalOrigen: "leido",
        original: { tipo: "storage", path: RUTA, mime: "image/jpeg", nombre: "x.jpg" }, paginas: 2, ocrTrabajoId: TID,
      },
    );
    expect(r.estado).toBe("guardado");
    const insert = f.consultas.find((c) => c.tabla === "productos_factura" && c.ops.some((o) => o.m === "insert"));
    expect(insert).toBeTruthy();
    const filas = insert!.ops.find((o) => o.m === "insert")!.a[0] as { factura_id: number; nombre: string }[];
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ factura_id: 101, nombre: "Merluza" });
  });

  it("S-7: si el UPDATE de la factura falla, apuntarOriginal lo reintenta y, si no puede, devuelve el error", async () => {
    const f = supabaseFalso((tabla, ops) =>
      tabla === "facturas" && ops.some((o) => o.m === "update")
        ? { data: null, error: { message: "canceling statement due to statement timeout" } }
        : { data: null, error: null }
    );
    const r = await apuntarOriginal(f.supabase, 101, {
      drive_url: URL_DRIVE, archivo_path: null, error: null, drive_error: null,
    }, { esperaMs: 0 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/statement timeout/);
    expect(r.error).toContain(URL_DRIVE); // el enlace no se pierde: queda en el error/log
    expect(f.consultas.filter((c) => c.tabla === "facturas" && c.ops.some((o) => o.m === "update"))).toHaveLength(3);
  });

  it("S-7: un corte puntual del UPDATE no hace perder la referencia (al 2.º intento, ok)", async () => {
    let n = 0;
    const f = supabaseFalso((tabla, ops) =>
      tabla === "facturas" && ops.some((o) => o.m === "update") && n++ === 0
        ? { data: null, error: { message: "fetch failed" } }
        : { data: null, error: null }
    );
    const r = await apuntarOriginal(f.supabase, 101, { drive_url: URL_DRIVE, archivo_path: null, error: null, drive_error: null }, { esperaMs: 0 });
    expect(r).toEqual({ ok: true, error: null, estado: "drive" });
  });

  it("S-8: si Drive falla al subir, NO queda un fichero vacío (una sola llamada multipart, sin metadatos sueltos)", async () => {
    const llamadas = driveFalso(503);
    for (let i = 0; i < 2; i++) {
      await expect(subirADrive(DRIVE_ON, new Uint8Array([1]), "a.pdf", "application/pdf", "2026-09-03", "P")).rejects.toThrow(/503/);
    }
    // Ningún «crear fichero con metadatos» aparte (el que dejaba el vacío)…
    expect(llamadas.filter((l) => l === "POST https://www.googleapis.com/drive/v3/files")).toHaveLength(0);
    // …y cada intento es UNA llamada que, si falla, no crea nada.
    expect(llamadas.filter((l) => l.endsWith("?multipart"))).toHaveLength(2);
  });

  it("S-11: dos subidas a la vez para un proveedor/mes nuevo crean UNA carpeta de proveedor y UNA de mes", async () => {
    let creadas = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      await new Promise((r) => setTimeout(r, 5));
      if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }));
      if (url.includes("/drive/v3/files?q=")) return new Response(JSON.stringify({ files: [] })); // aún no existe
      if (url.includes("/drive/v3/files?fields=id")) return new Response(JSON.stringify({ id: `X${++creadas}` }));
      if (url.includes("/upload/")) return new Response(JSON.stringify({ id: "f", webViewLink: "https://d/f" }));
      return new Response("{}");
    }));
    await Promise.all([
      subirADrive(DRIVE_ON, new Uint8Array([1]), "a.pdf", "application/pdf", "2026-11-03", "Proveedor Nuevo SL"),
      subirADrive(DRIVE_ON, new Uint8Array([2]), "b.pdf", "application/pdf", "2026-11-04", "Proveedor Nuevo SL"),
    ]);
    expect(creadas).toBe(2); // 1 proveedor + 1 mes (los ficheros van por multipart)
  });

  it("S-6: Drive caído y PDF de 11 MB (la importación admite hasta 20 MB) → copia temporal, no se pierde", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const f = supabaseFalso(() => ({ data: null, error: null }));
    const b64 = Buffer.from(new Uint8Array(11 * 1024 * 1024)).toString("base64");
    const r = await archivarOriginal(DRIVE_ON, f.supabase, b64, "grande.pdf", "application/pdf", "2026-09-03", 7, "P");
    expect(r.drive_url).toBeNull();
    expect(r.archivo_path).toBe("temporal/7-grande.pdf");
    expect(r.error).toBeNull();
  });

  it("S-10: fotos unidas sin PDF → cada pieza va a Drive con su nombre de página, no solo la 1", () => {
    expect(nombrePieza("albaran.jpg", { storage_path: "p/u/t/01.png", pagina_doc: 1, numero: 1, pieza: "pagina" }, 3))
      .toBe("albaran-pag1.png");
    expect(nombrePieza("albaran.jpg", { storage_path: "p/u/t/03.jpg", pagina_doc: 2, numero: 3, pieza: "franja", franja: 2 }, 3))
      .toBe("albaran-pag2-franja2.jpg");
  });

  it("S-14: fecha no ISO del modelo → se entiende dd/mm/aaaa y, si no, aviso fecha_ausente (no hoy callando)", () => {
    expect(fechaIso("03/09/2026")).toBe("2026-09-03");
    expect(fechaIso("2026-02-31")).toBeNull();
    const d = normalizarDatos({ ...datos(), fecha: "sin fecha" });
    expect(d.avisos.some((a: { codigo: string }) => a.codigo === "fecha_ausente")).toBe(true);
    const ok = normalizarDatos({ ...datos(), fecha: "2026-09-03" });
    expect(ok.avisos.some((a: { codigo: string }) => a.codigo === "fecha_ausente")).toBe(false);
  });

  it("Rescate a mano: buscarEnDrive busca ficheros por nombre exacto (sin carpetas ni papelera)", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(decodeURIComponent(url));
      if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }));
      return new Response(JSON.stringify({ files: [{ id: "A1", name: "anterior-x.jpeg", webViewLink: "https://d/A1" }] }));
    }));
    const r = await buscarEnDrive(DRIVE_ON, "anterior-x.jpeg");
    expect(r).toEqual([{ id: "A1", name: "anterior-x.jpeg", webViewLink: "https://d/A1", createdTime: undefined }]);
    const q = urls.find((u) => u.includes("/drive/v3/files?q="))!;
    expect(q).toContain("name='anterior-x.jpeg'");
    expect(q).toContain("mimeType!='application/vnd.google-apps.folder'");
    expect(q).toContain("trashed=false");
  });

  it("Histórica: solo admite PDF de verdad (bytes mágicos «%PDF-»)", () => {
    expect(esPdf(Buffer.from("%PDF-1.7\n...").toString("base64"))).toBe(true);
    expect(esPdf(Buffer.from("<html>no</html>").toString("base64"))).toBe(false);
    expect(esPdf("no es base64 ***")).toBe(false);
  });
});
