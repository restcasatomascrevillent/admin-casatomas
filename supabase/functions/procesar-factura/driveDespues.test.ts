// ============================================================================
//  Guardar una factura NO espera a Google Drive (18/11/2026)
// ----------------------------------------------------------------------------
//  El original queda en la copia temporal de Storage (temporal/{factura}-…),
//  la factura apunta a ella (archivo_path, sin drive_url) y lo sube después el
//  cron facturas-originales-drive (cada 10 min), que borra la copia. Aquí:
//  que no se llama a Google aunque Drive esté configurado, que no se apunta
//  como fallo de Drive, que un original de un trabajo largo se MUEVE (no se
//  descarga) y que si Storage falla se sube a Drive en el momento.
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _olvidarTokenDrive, dejarParaDrive } from "./archivo.ts";
import { type ContextoGuardado, guardarDocumento } from "./guardado.ts";
import { archivarPiezasExtra } from "./trabajos.ts";

const DRIVE_ON = { clientId: "c", clientSecret: "s", refreshToken: "r", parentFolder: "RAIZ" };
const URL_DRIVE = "https://drive.google.com/file/d/F/view";

type Op = { m: string; a: unknown[] };
function supaFalso(o: { uploadFalla?: boolean; moveFalla?: boolean; proveedorId?: number } = {}) {
  const consultas: { tabla: string; ops: Op[] }[] = [];
  const rpcs: string[] = [];
  const subidas: string[] = [];
  const movidos: string[] = [];
  const descargas: string[] = [];
  const cadena = (tabla: string, ops: Op[] = []): unknown =>
    new Proxy({}, {
      get(_t, prop: string) {
        if (prop === "then") {
          consultas.push({ tabla, ops });
          const m = ops.map((x) => x.m);
          let r: unknown = { data: null, error: null };
          if (tabla === "facturas" && m.includes("insert")) r = { data: { id: 101 }, error: null };
          else if (tabla === "facturas" && m.includes("single")) r = { data: { proveedor_id: o.proveedorId ?? null }, error: null };
          return (ok: (v: unknown) => unknown) => Promise.resolve(r).then(ok);
        }
        return (...a: unknown[]) => cadena(tabla, [...ops, { m: prop, a }]);
      },
    });
  const supabase = {
    from: (t: string) => cadena(t),
    rpc: async (nombre: string) => {
      rpcs.push(nombre);
      if (nombre === "validar_cordura_factura") return { data: [], error: null };
      return { data: null, error: null };
    },
    storage: {
      from: () => ({
        upload: async (path: string) => {
          if (o.uploadFalla) return { data: null, error: { message: "Storage caído" } };
          subidas.push(path);
          return { data: { path }, error: null };
        },
        move: async (desde: string, hasta: string) => {
          if (o.moveFalla) return { error: { message: "no se puede mover" } };
          movidos.push(`${desde} -> ${hasta}`);
          return { error: null };
        },
        list: async () => ({ data: [], error: null }),
        download: async (path: string) => {
          descargas.push(path);
          return { data: new Blob([new Uint8Array([1, 2, 3])]), error: null };
        },
        remove: async (paths: string[]) => ({ data: paths, error: null }),
      }),
    },
  };
  const updatesFacturas = () =>
    consultas.filter((c) => c.tabla === "facturas" && c.ops.some((x) => x.m === "update"))
      .map((c) => c.ops.find((x) => x.m === "update")!.a[0] as Record<string, unknown>);
  return { supabase, consultas, rpcs, subidas, movidos, descargas, updatesFacturas };
}

let google: ReturnType<typeof vi.fn>;
beforeEach(() => {
  _olvidarTokenDrive();
  google = vi.fn(async (url: string) => {
    if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }));
    if (url.includes("/drive/v3/files?q=")) return new Response(JSON.stringify({ files: [{ id: "CARPETA" }] }));
    if (url.includes("/upload/")) return new Response(JSON.stringify({ id: "F", webViewLink: URL_DRIVE }));
    return new Response("{}");
  });
  vi.stubGlobal("fetch", google);
});
afterEach(() => vi.unstubAllGlobals());

const sinProveedor = vi.fn(async () => null);

describe("dejarParaDrive", () => {
  it("base64 → copia temporal; ni Google ni el proveedor; no es un fallo de Drive", async () => {
    const sb = supaFalso();
    const r = await dejarParaDrive(DRIVE_ON, sb.supabase, { tipo: "base64", b64: btoa("hola"), mime: "image/jpeg", nombre: "Albarán 7.jpg" }, "2026-11-18", 101, sinProveedor);
    expect(r).toEqual({ drive_url: null, archivo_path: "temporal/101-Albaran_7.jpg", error: null, drive_error: null });
    expect(google).not.toHaveBeenCalled();
    expect(sinProveedor).not.toHaveBeenCalled();
  });

  it("de un trabajo largo (pendientes/) se MUEVE, sin descargarlo", async () => {
    const sb = supaFalso();
    const r = await dejarParaDrive(DRIVE_ON, sb.supabase, { tipo: "storage", path: "pendientes/u/t/original.pdf", mime: "application/pdf", nombre: "largo.pdf" }, "2026-11-18", 101, sinProveedor);
    expect(r.archivo_path).toBe("temporal/101-largo.pdf");
    expect(sb.movidos).toEqual(["pendientes/u/t/original.pdf -> temporal/101-largo.pdf"]);
    expect(sb.descargas).toEqual([]);
    expect(google).not.toHaveBeenCalled();
  });

  it("si Storage falla, se sube a Drive en el momento (no se pierde)", async () => {
    const sb = supaFalso({ uploadFalla: true });
    const proveedor = vi.fn(async () => "PESCADOS RÍA");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await dejarParaDrive(DRIVE_ON, sb.supabase, { tipo: "base64", b64: btoa("hola"), mime: "image/jpeg", nombre: "a.jpg" }, "2026-11-18", 101, proveedor);
    error.mockRestore();
    expect(r).toEqual({ drive_url: URL_DRIVE, archivo_path: null, error: null, drive_error: null });
    expect(proveedor).toHaveBeenCalledTimes(1);
  });

  it("si no se puede mover, el de siempre: a Drive ya (y si Drive falla, queda donde estaba)", async () => {
    const sb = supaFalso({ moveFalla: true });
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await dejarParaDrive(DRIVE_ON, sb.supabase, { tipo: "storage", path: "pendientes/u/t/original.pdf", mime: "application/pdf", nombre: "largo.pdf" }, "2026-11-18", 101, sinProveedor);
    aviso.mockRestore();
    expect(r.drive_url).toBe(URL_DRIVE);
  });
});

describe("guardarDocumento con Drive configurado: no espera a Drive", () => {
  const datos = () => ({
    tipo: "albaran", proveedor: "Pescados Ría SL", cif: "B12345678", numero_documento: "A-1", fecha: "2026-11-18",
    subtotal: 100, iva: 10, total: 110, observaciones: null, resumen: "r",
    productos: [{ nombre: "Merluza", cantidad: 1, unidad: "kg", precio_unitario: 100, total: 100 }], avisos: [],
  });
  const ctx = (sb: ReturnType<typeof supaFalso>) => ({
    supabase: sb.supabase,
    openai: { embed: vi.fn(async (t: string | string[]) => (Array.isArray(t) ? t : [t]).map(() => [0.1])) },
    drive: DRIVE_ON,
  }) as unknown as ContextoGuardado;

  it("la factura apunta a la copia temporal; el panel recibe «en_cola», sin error ni aviso", async () => {
    const sb = supaFalso({ proveedorId: 9 });
    const g = await guardarDocumento(ctx(sb), {
      datos: datos() as never, alertasPrevias: [], totalOrigen: "leido",
      original: { tipo: "base64", b64: btoa("hola"), mime: "image/jpeg", nombre: "a.jpg" },
    });
    expect(google).not.toHaveBeenCalled();
    // Ni las dos lecturas del proveedor para la carpeta de Drive.
    expect(sb.consultas.filter((c) => c.tabla === "proveedores")).toEqual([]);
    expect(sb.rpcs).not.toContain("facturas_original_drive_fallo");
    expect(sb.updatesFacturas()).toEqual([{ alertas_validacion: null, archivo_path: "temporal/101-a.jpg" }]);
    expect(g.respuesta).toMatchObject({ archivo_guardado: true, archivo_error: null, archivo_estado: "en_cola" });
  });
});

describe("trabajo de fotos unidas sin PDF: las piezas 2..N también se mueven a temporal/ (Drive, el cron)", () => {
  const ctx2 = (sb: ReturnType<typeof supaFalso>) => ({ supabase: sb.supabase, openai: {}, drive: DRIVE_ON }) as unknown as ContextoGuardado;
  const piezas = [
    { numero: 2, storage_path: "pendientes/u/t/02.jpg", mime: "image/jpeg", pieza: "pagina", pagina_doc: 2 },
    { numero: 3, storage_path: "pendientes/u/t/03.jpg", mime: "image/jpeg", pieza: "pagina", pagina_doc: 3 },
  ];

  it("se mueven como «{factura}-pagN-…», sin llamar a Google", async () => {
    const sb = supaFalso();
    await archivarPiezasExtra(ctx2(sb), 101, { fecha: "2026-11-18", proveedor: "P" }, "foto.jpg", piezas, 3);
    expect(google).not.toHaveBeenCalled();
    expect(sb.movidos).toEqual([
      "pendientes/u/t/02.jpg -> temporal/101-pag2-foto-pag2.jpg",
      "pendientes/u/t/03.jpg -> temporal/101-pag3-foto-pag3.jpg",
    ]);
  });

  it("si no se pueden mover, se suben a Drive ya (no se quedan en pendientes/, que se borra al terminar)", async () => {
    const sb = supaFalso({ moveFalla: true });
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    await archivarPiezasExtra(ctx2(sb), 101, { fecha: "2026-11-18", proveedor: "P" }, "foto.jpg", piezas, 3);
    aviso.mockRestore();
    expect(google.mock.calls.filter((c) => String(c[0]).includes("/upload/"))).toHaveLength(2);
  });
});
