// Originales de facturas: Drive siempre, Storage solo temporal (05/11/2026).
// Supabase (Storage + tablas + RPC) y Google Drive (fetch) simulados en memoria.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _olvidarTokenDrive,
  archivarDesdeStorage,
  archivarOriginal,
  esOriginalDePagina,
  limpiarPendientesTrabajo,
  nombreEnDrive,
  rutaTemporal,
} from "./archivo.ts";
import { apuntarOriginal } from "./guardado.ts";
import { type FacturaPorPasar, pasarFactura, pasarLote } from "./originalesDrive.ts";

const DRIVE = { clientId: "id", clientSecret: "s", refreshToken: "r", parentFolder: "raiz" };
const URL_DRIVE = "https://drive.google.com/file/d/nuevo/view";

// ─── Drive simulado ─────────────────────────────────────────────────────────
let driveCaido = false;
let subidas: { nombre: string; carpeta: string }[] = [];
function fetchDrive(url: string, init?: RequestInit): Promise<Response> {
  const json = (b: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(b), { status }));
  if (url.startsWith("https://oauth2.googleapis.com/token")) {
    return driveCaido ? json({ error: "invalid_grant" }, 400) : json({ access_token: "tk", expires_in: 3600 });
  }
  if (url.startsWith("https://www.googleapis.com/drive/v3/files?q=")) {
    const q = decodeURIComponent(url);
    const nombre = /name='([^']*)'/.exec(q)?.[1] ?? "";
    return json({ files: [{ id: `carpeta:${nombre}` }] });
  }
  if (url.startsWith("https://www.googleapis.com/drive/v3/files?fields=id")) {
    const b = JSON.parse(String(init?.body));
    subidas.push({ nombre: b.name, carpeta: b.parents[0] });
    return json({ id: "nuevo" });
  }
  if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart")) {
    // Metadatos y contenido en una sola llamada (multipart/related).
    const texto = new TextDecoder().decode(init?.body as Uint8Array);
    const meta = JSON.parse(/\{"name".*?\]\}/.exec(texto)?.[0] ?? "{}");
    subidas.push({ nombre: meta.name, carpeta: meta.parents?.[0] });
    return json({ id: "nuevo", webViewLink: URL_DRIVE });
  }
  return json({ error: `inesperado ${url}` }, 500);
}

// ─── Supabase simulado ──────────────────────────────────────────────────────
interface Op { tabla: string; tipo: "select" | "update"; cambios?: Record<string, unknown>; filtros: [string, string, unknown][] }
function supabaseFalso(
  ficheros: Record<string, Uint8Array>,
  responder: (op: Op) => { data?: unknown; error?: { message: string } | null } = () => ({ data: null }),
) {
  const ops: Op[] = [];
  const rpcs: { nombre: string; args: Record<string, unknown> }[] = [];
  let respuestaRpc: (nombre: string) => unknown = () => null;
  const bucket = {
    upload: async (path: string, blob: Blob) => {
      ficheros[path] = new Uint8Array(await blob.arrayBuffer());
      return { error: null };
    },
    download: async (path: string) =>
      path in ficheros
        ? { data: new Blob([ficheros[path]], { type: "image/jpeg" }), error: null }
        : { data: null, error: { message: "Object not found" } },
    remove: async (paths: string[]) => {
      paths.forEach((p) => delete ficheros[p]);
      return { error: null };
    },
    move: async (a: string, b: string) => {
      if (!(a in ficheros)) return { error: { message: "Object not found" } };
      ficheros[b] = ficheros[a];
      delete ficheros[a];
      return { error: null };
    },
    list: async () => ({ data: [] }),
  };
  const from = (tabla: string) => {
    const op: Op = { tabla, tipo: "select", filtros: [] };
    // deno-lint-ignore no-explicit-any
    const c: any = {
      select: () => c,
      update: (cambios: Record<string, unknown>) => ((op.tipo = "update"), (op.cambios = cambios), c),
      eq: (k: string, v: unknown) => (op.filtros.push(["eq", k, v]), c),
      in: (k: string, v: unknown) => (op.filtros.push(["in", k, v]), c),
      is: (k: string, v: unknown) => (op.filtros.push(["is", k, v]), c),
      maybeSingle: () => c,
      single: () => c,
      then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        ops.push(op);
        return Promise.resolve({ error: null, ...responder(op) }).then(ok, ko);
      },
    };
    return c;
  };
  return {
    cliente: {
      storage: { from: () => bucket },
      from,
      rpc: async (nombre: string, args: Record<string, unknown>) => {
        rpcs.push({ nombre, args });
        return { data: respuestaRpc(nombre), error: null };
      },
    },
    ops,
    rpcs,
    alResponderRpc: (f: (nombre: string) => unknown) => {
      respuestaRpc = f;
    },
  };
}

const bytes = (s: string) => new TextEncoder().encode(s);
const b64 = (s: string) => btoa(s);

beforeEach(() => {
  driveCaido = false;
  subidas = [];
  _olvidarTokenDrive();
  vi.stubGlobal("fetch", vi.fn(fetchDrive));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("rutas", () => {
  it("la copia temporal va a temporal/{factura}-{nombre seguro}", () => {
    expect(rutaTemporal(42, "Factura Nº Ángel.pdf")).toBe("temporal/42-Factura_N_Angel.pdf");
  });
  it("reconoce el original de una página añadida y el nombre para Drive", () => {
    expect(esOriginalDePagina("temporal/352-pag2-5e8dab44-foto.jpeg")).toBe(true);
    expect(esOriginalDePagina("2026/10/352-sust-5e8dab44-foto.jpeg")).toBe(false);
    expect(esOriginalDePagina("2026/10/352-foto.jpeg")).toBe(false);
    expect(nombreEnDrive("2026/10/352-WhatsApp_Image.jpeg")).toBe("WhatsApp_Image.jpeg");
  });
});

describe("archivarOriginal (subida normal e importación)", () => {
  it("Drive OK → enlace de Drive y NADA en Storage", async () => {
    const fich: Record<string, Uint8Array> = {};
    const sb = supabaseFalso(fich);
    const r = await archivarOriginal(DRIVE, sb.cliente, b64("pdf"), "f.pdf", "application/pdf", "2026-03-14", 7, "PESCADOS MOLTO");
    expect(r).toEqual({ drive_url: URL_DRIVE, archivo_path: null, error: null, drive_error: null });
    expect(Object.keys(fich)).toEqual([]);
    expect(subidas).toEqual([{ nombre: "f.pdf", carpeta: "carpeta:2026-03 Marzo" }]);
  });

  it("Drive KO → copia TEMPORAL en Storage y el motivo", async () => {
    driveCaido = true;
    const fich: Record<string, Uint8Array> = {};
    const r = await archivarOriginal(DRIVE, supabaseFalso(fich).cliente, b64("pdf"), "f.pdf", "application/pdf", "2026-03-14", 7);
    expect(r.drive_url).toBeNull();
    expect(r.archivo_path).toBe("temporal/7-f.pdf");
    expect(r.drive_error).toMatch(/Drive token 400/);
    expect(Object.keys(fich)).toEqual(["temporal/7-f.pdf"]);
  });

  it("sin secretos de Drive también queda temporal (y lo dice)", async () => {
    const fich: Record<string, Uint8Array> = {};
    const r = await archivarOriginal({ ...DRIVE, refreshToken: "" }, supabaseFalso(fich).cliente, b64("x"), "f.jpg", "image/jpeg", "2026-03-14", 8);
    expect(r.archivo_path).toBe("temporal/8-f.jpg");
    expect(r.drive_error).toMatch(/Drive no configurado/);
  });
});

describe("archivarDesdeStorage (documentos largos, sustituir, añadir página)", () => {
  const PEND = "pendientes/u/t/original.pdf";
  it("Drive OK → se borra de pendientes/ y no queda nada en Storage", async () => {
    const fich: Record<string, Uint8Array> = { [PEND]: bytes("pdf") };
    const r = await archivarDesdeStorage(DRIVE, supabaseFalso(fich).cliente, PEND, "largo.pdf", "application/pdf", "2026-02-01", 9, "X");
    expect(r.drive_url).toBe(URL_DRIVE);
    expect(r.archivo_path).toBeNull();
    expect(fich).toEqual({});
  });

  it("Drive KO → se MUEVE a la ruta temporal (pendiente de Drive)", async () => {
    driveCaido = true;
    const fich: Record<string, Uint8Array> = { [PEND]: bytes("pdf") };
    const r = await archivarDesdeStorage(DRIVE, supabaseFalso(fich).cliente, PEND, "largo.pdf", "application/pdf", "2026-02-01", 9, "X");
    expect(r.drive_url).toBeNull();
    expect(r.archivo_path).toBe("temporal/9-largo.pdf");
    expect(Object.keys(fich)).toEqual(["temporal/9-largo.pdf"]);
  });
});

describe("apuntarOriginal (guardado)", () => {
  it("Drive OK → drive_url y archivo_path a null, sin marcar pendiente", async () => {
    const sb = supabaseFalso({});
    const r = await apuntarOriginal(sb.cliente, 5, { drive_url: URL_DRIVE, archivo_path: null, error: null, drive_error: null });
    expect(r).toEqual({ ok: true, error: null, estado: "drive" });
    expect(sb.ops[0].cambios).toEqual({ drive_url: URL_DRIVE, archivo_path: null });
    expect(sb.rpcs).toEqual([]);
  });

  it("Drive KO → archivo_path temporal + facturas_original_drive_fallo", async () => {
    const sb = supabaseFalso({});
    const r = await apuntarOriginal(sb.cliente, 5, { drive_url: null, archivo_path: "temporal/5-f.pdf", error: null, drive_error: "Drive token 400" });
    expect(r.ok).toBe(true);
    expect(r.error).toMatch(/pendiente de subir a Drive/);
    expect(sb.ops[0].cambios).toEqual({ archivo_path: "temporal/5-f.pdf" });
    expect(sb.rpcs).toEqual([{ nombre: "facturas_original_drive_fallo", args: { p_factura_id: 5, p_error: "Drive token 400" } }]);
  });
});

describe("pasarFactura (reintento del cron y rescate)", () => {
  const base: FacturaPorPasar = { id: 11, archivo_path: "temporal/11-f.jpg", drive_url: null, fecha: "2026-10-03", proveedor: "Candela, S.L.", existe: true };

  it("reintento OK → sube, guarda drive_url, BORRA de Storage y archivo_path a null", async () => {
    const fich: Record<string, Uint8Array> = { "temporal/11-f.jpg": bytes("jpg") };
    const sb = supabaseFalso(fich);
    expect(await pasarFactura(sb.cliente, DRIVE, base)).toBe("subida");
    expect(fich).toEqual({});
    expect(subidas).toEqual([{ nombre: "f.jpg", carpeta: "carpeta:2026-10 Octubre" }]);
    const cambios = sb.ops.map((o) => o.cambios);
    expect(cambios[0]).toMatchObject({ drive_url: URL_DRIVE, drive_intentos: 0 });
    expect(cambios[1]).toMatchObject({ archivo_path: null });
    // Solo si sigue apuntando a ese fichero (idempotente con otra pasada a la vez).
    expect(sb.ops[1].filtros).toContainEqual(["eq", "archivo_path", "temporal/11-f.jpg"]);
  });

  it("con drive_url → solo borra la copia (no sube nada)", async () => {
    const fich: Record<string, Uint8Array> = { "2026/10/11-f.jpg": bytes("jpg") };
    const sb = supabaseFalso(fich);
    const r = await pasarFactura(sb.cliente, DRIVE, { ...base, archivo_path: "2026/10/11-f.jpg", drive_url: "https://drive/x" });
    expect(r).toBe("copia_borrada");
    expect(subidas).toEqual([]);
    expect(fich).toEqual({});
    expect(sb.ops.map((o) => o.cambios)).toEqual([{ archivo_path: null, drive_intentos: 0, drive_error: null, drive_intento_at: null }]);
  });

  it("página añadida con drive_url → se sube antes de borrarla y no pisa el drive_url", async () => {
    const p = "temporal/11-pag2-5e8dab44-f.jpg";
    const fich: Record<string, Uint8Array> = { [p]: bytes("jpg") };
    const sb = supabaseFalso(fich);
    expect(await pasarFactura(sb.cliente, DRIVE, { ...base, archivo_path: p, drive_url: "https://drive/p1" })).toBe("subida");
    expect(subidas.map((s) => s.nombre)).toEqual(["pag2-5e8dab44-f.jpg"]);
    expect(sb.ops.every((o) => !("drive_url" in (o.cambios ?? {})))).toBe(true);
    expect(fich).toEqual({});
  });

  it("Drive KO → apunta el fallo y la copia temporal NO se borra", async () => {
    driveCaido = true;
    const fich: Record<string, Uint8Array> = { "temporal/11-f.jpg": bytes("jpg") };
    const sb = supabaseFalso(fich);
    await expect(pasarFactura(sb.cliente, DRIVE, base)).rejects.toThrow(/Drive token 400/);
    expect(Object.keys(fich)).toEqual(["temporal/11-f.jpg"]);
    expect(sb.rpcs.map((r) => r.nombre)).toEqual(["facturas_original_drive_fallo"]);
    expect(sb.ops).toEqual([]);
  });

  it("el fichero ya no está → se quita la referencia rota", async () => {
    const sb = supabaseFalso({});
    expect(await pasarFactura(sb.cliente, DRIVE, { ...base, existe: false })).toBe("sin_fichero");
    expect(sb.ops[0].cambios).toMatchObject({ archivo_path: null });
  });
});

describe("pasarLote", () => {
  it("con Drive caído no gasta varios intentos de la misma factura en una llamada", async () => {
    driveCaido = true;
    const fich: Record<string, Uint8Array> = { "temporal/11-f.jpg": bytes("jpg") };
    const sb = supabaseFalso(fich);
    sb.alResponderRpc((n) =>
      n === "facturas_originales_por_pasar"
        ? { facturas: [{ id: 11, archivo_path: "temporal/11-f.jpg", drive_url: null, fecha: null, proveedor: null, existe: true }], huerfanos: [], pendientes: [] }
        : 1
    );
    const inf = await pasarLote({ supabase: sb.cliente, drive: DRIVE });
    expect(inf.facturas.errores).toHaveLength(1);
    expect(sb.rpcs.filter((r) => r.nombre === "facturas_original_drive_fallo")).toHaveLength(1);
  });

  it("huérfanos a Drive («anterior-…») y pendientes de trabajos terminados borrados", async () => {
    const fich: Record<string, Uint8Array> = {
      "2026/10/352-sust-5e8dab44-foto.jpeg": bytes("a"),
      "pendientes/u/t/01.jpg": bytes("b"),
      "pendientes/u/t/02.jpg": bytes("c"),
    };
    const sb = supabaseFalso(fich);
    let llamadas = 0;
    sb.alResponderRpc(() =>
      llamadas++ === 0
        ? {
          facturas: [],
          huerfanos: [{ name: "2026/10/352-sust-5e8dab44-foto.jpeg", factura_id: 352, fecha: "2026-10-01", proveedor: "Y" }],
          pendientes: ["pendientes/u/t/01.jpg", "pendientes/u/t/02.jpg"],
        }
        : { facturas: [], huerfanos: [], pendientes: [] }
    );
    const inf = await pasarLote({ supabase: sb.cliente, drive: DRIVE });
    expect(inf.huerfanos.subidos).toBe(1);
    expect(inf.pendientes.borrados).toBe(2);
    expect(subidas.map((s) => s.nombre)).toEqual(["anterior-sust-5e8dab44-foto.jpeg"]);
    expect(fich).toEqual({});
  });
});

describe("pasarHuerfano", () => {
  it("si es el original de una factura que no tiene ninguno, se le pone como drive_url", async () => {
    const fich: Record<string, Uint8Array> = { "2026/10/354-foto.jpeg": bytes("a") };
    const sb = supabaseFalso(fich);
    const { pasarHuerfano } = await import("./originalesDrive.ts");
    await pasarHuerfano(sb.cliente, DRIVE, { name: "2026/10/354-foto.jpeg", factura_id: 354, fecha: "2026-10-10", proveedor: "Z", es_su_original: true });
    expect(subidas.map((s) => s.nombre)).toEqual(["foto.jpeg"]);
    expect(sb.ops[0].cambios).toEqual({ drive_url: URL_DRIVE, drive_intentos: 0, drive_error: null });
    expect(sb.ops[0].filtros).toEqual([["eq", "id", 354], ["is", "drive_url", null], ["is", "archivo_path", null]]);
    expect(fich).toEqual({});
  });
});

describe("limpiarPendientesTrabajo (al terminar o fallar un trabajo)", () => {
  it("borra piezas y original de pendientes/ salvo lo que use una factura", async () => {
    const fich: Record<string, Uint8Array> = {
      "pendientes/u/t/01.jpg": bytes("1"),
      "pendientes/u/t/02.jpg": bytes("2"),
      "pendientes/u/t/original.pdf": bytes("o"),
    };
    const sb = supabaseFalso(fich, (op) => {
      if (op.tabla === "ocr_trabajos") return { data: { original_path: "pendientes/u/t/original.pdf" } };
      if (op.tabla === "ocr_trabajo_paginas") return { data: [{ storage_path: "pendientes/u/t/01.jpg" }, { storage_path: "pendientes/u/t/02.jpg" }] };
      if (op.tabla === "facturas") return { data: [{ archivo_path: "pendientes/u/t/01.jpg" }] };
      return { data: null };
    });
    expect(await limpiarPendientesTrabajo(sb.cliente, "t")).toBe(2);
    expect(Object.keys(fich)).toEqual(["pendientes/u/t/01.jpg"]);
  });
});
