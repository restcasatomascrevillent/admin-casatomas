// ============================================================================
//  Escrituras juntas al guardar una factura (18/11/2026)
// ----------------------------------------------------------------------------
//  Cada UPDATE de `facturas` deja su fila de auditoría (con la fila entera) y,
//  con la base cargada, tardaba 1-3 s. Al guardar se hacían tres seguidos de la
//  misma fila (alertas, original y coste); ahora es uno. Aquí: que se junten,
//  que un corte por tiempo se reintente (el de las alertas dispara la
//  autoverificación: las facturas 5167 y 5177 se quedaron sin ella), que el
//  reintento de S-7 siga y que ni el coste ni Drive rompan el guardado.
// ============================================================================

import { describe, expect, it, vi } from "vitest";
import { apuntarOriginal, type ContextoGuardado, escribirFactura, guardarDocumento, validarYGuardarAlertas } from "./guardado.ts";
import { columnasCoste } from "./costeLectura.ts";

const CORTE = { code: "57014", message: "canceling statement due to statement timeout" };
const SIN_ESPERA = { dormir: vi.fn(async () => {}) };
const DRIVE_OFF = { clientId: "", clientSecret: "", refreshToken: "", parentFolder: "" };

type Op = { m: string; a: unknown[] };
/** Supabase simulado. `updates`: lo que contesta cada UPDATE, en orden (por defecto, bien). */
function supaFalso(o: { updates?: ({ error: unknown } | undefined)[]; alertasSql?: unknown[] } = {}) {
  const consultas: { tabla: string; ops: Op[] }[] = [];
  const rpcs: { nombre: string; args: Record<string, unknown> }[] = [];
  const subidas: string[] = [];
  let n = 0;
  const resolver = (tabla: string, ops: Op[]) => {
    const m = ops.map((x) => x.m);
    if (m.includes("update")) return { data: null, ...(o.updates?.[n++] ?? { error: null }) };
    if (tabla === "facturas" && m.includes("insert")) return { data: { id: 101 }, error: null };
    return { data: null, error: null };
  };
  const cadena = (tabla: string, ops: Op[] = []): unknown =>
    new Proxy({}, {
      get(_t, prop: string) {
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
      if (nombre === "validar_cordura_factura") return { data: o.alertasSql ?? [], error: null };
      return { data: null, error: null };
    },
    storage: {
      from: () => ({
        upload: async (path: string) => {
          subidas.push(path);
          return { data: { path }, error: null };
        },
      }),
    },
  };
  const updates = () =>
    consultas.filter((c) => c.ops.some((x) => x.m === "update")).map((c) => ({
      tabla: c.tabla,
      datos: c.ops.find((x) => x.m === "update")!.a[0] as Record<string, unknown>,
      id: c.ops.find((x) => x.m === "eq")?.a[1],
    }));
  return { supabase, consultas, rpcs, subidas, updates };
}

const COSTE = { usd: 0.0123, llamadas: 4, modelo: "gpt-5.6-luna" };

describe("escribirFactura: una escritura, con reintento ante corte por tiempo", () => {
  it("un corte por tiempo se repite tras esperar y entra", async () => {
    const sb = supaFalso({ updates: [{ error: CORTE }] });
    const dormir = vi.fn(async () => {});
    const r = await escribirFactura(sb.supabase, 101, { alertas_validacion: null }, { reintento: { dormir, esperasMs: [3000, 8000] } });
    expect(r.error).toBeNull();
    expect(sb.updates()).toHaveLength(2);
    expect(dormir).toHaveBeenCalledWith(3000);
  });

  it("otro error no se repite (lo decide quien llama) y se devuelve", async () => {
    const sb = supaFalso({ updates: [{ error: { code: "42501", message: "permission denied" } }] });
    const r = await escribirFactura(sb.supabase, 101, { alertas_validacion: null }, { reintento: SIN_ESPERA });
    expect(r.error).toBe("permission denied");
    expect(sb.updates()).toHaveLength(1);
  });

  it("sin las columnas del coste (migración sin aplicar) se guarda lo demás", async () => {
    const sb = supaFalso({ updates: [{ error: { message: 'column "coste_lectura_usd" of relation "facturas" does not exist' } }] });
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await escribirFactura(sb.supabase, 101, { alertas_validacion: null, drive_url: "u", ...columnasCoste(COSTE) });
    aviso.mockRestore();
    expect(r.error).toBeNull();
    expect(sb.updates().map((u) => Object.keys(u.datos).sort())).toEqual([
      ["alertas_validacion", "coste_lectura_usd", "drive_url", "lectura_llamadas", "lectura_modelo"],
      ["alertas_validacion", "drive_url"],
    ]);
  });
});

describe("validarYGuardarAlertas: el UPDATE que dispara la autoverificación", () => {
  it("si la base lo corta por tiempo, se reintenta y las alertas quedan guardadas (facturas 5167 y 5177)", async () => {
    const sb = supaFalso({ updates: [{ error: CORTE }, { error: CORTE }], alertasSql: [{ codigo: "descuadre_cabecera", severidad: "alta" }] });
    const alertas = await validarYGuardarAlertas(sb.supabase, 5167, [], 0, {}, { reintento: SIN_ESPERA });
    expect(alertas.map((a) => a.codigo)).toEqual(["descuadre_cabecera"]);
    const ups = sb.updates();
    expect(ups).toHaveLength(3);
    for (const u of ups) expect(u).toMatchObject({ tabla: "facturas", id: 5167, datos: { alertas_validacion: [{ codigo: "descuadre_cabecera" }] } });
  });

  it("`extra` va en la MISMA escritura (p. ej. el coste al sustituir o añadir página)", async () => {
    const sb = supaFalso();
    await validarYGuardarAlertas(sb.supabase, 352, [], 0, columnasCoste(COSTE));
    expect(sb.updates()).toEqual([
      { tabla: "facturas", id: 352, datos: { alertas_validacion: null, coste_lectura_usd: 0.0123, lectura_llamadas: 4, lectura_modelo: "gpt-5.6-luna" } },
    ]);
  });
});

describe("apuntarOriginal: original + alertas + coste en un UPDATE, con el reintento de S-7", () => {
  const enDrive = { drive_url: "https://drive.google.com/file/d/x/view", archivo_path: null, error: null, drive_error: null };
  const extra = { alertas_validacion: null, ...columnasCoste(COSTE) };

  it("una sola escritura con todo", async () => {
    const sb = supaFalso();
    const r = await apuntarOriginal(sb.supabase, 101, enDrive, { extra });
    expect(r).toEqual({ ok: true, estado: "drive", error: null });
    expect(sb.updates()).toEqual([{ tabla: "facturas", id: 101, datos: { ...extra, drive_url: enDrive.drive_url, archivo_path: null } }]);
  });

  it("S-7: un fallo puntual se reintenta (la misma escritura entera) sin volver a subir nada", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const sb = supaFalso({ updates: [{ error: { message: "fetch failed" } }, { error: { message: "fetch failed" } }] });
    const r = await apuntarOriginal(sb.supabase, 101, enDrive, { extra, esperaMs: 0 });
    error.mockRestore();
    expect(r.estado).toBe("drive");
    const ups = sb.updates();
    expect(ups).toHaveLength(3);
    expect(new Set(ups.map((u) => JSON.stringify(u.datos))).size).toBe(1);
  });

  it("un corte por tiempo que no cede: 3 intentos (3 s y 8 s), no 9; el original queda «perdido» con el motivo", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const sb = supaFalso({ updates: [{ error: CORTE }, { error: CORTE }, { error: CORTE }, { error: CORTE }] });
    const r = await apuntarOriginal(sb.supabase, 101, enDrive, { extra, esperaMs: 0, reintento: SIN_ESPERA });
    const mensajes = error.mock.calls.map((c) => String(c[0]));
    error.mockRestore();
    expect(sb.updates()).toHaveLength(3);
    expect(r).toMatchObject({ ok: false, estado: "perdido" });
    expect(r.error).toContain("statement timeout");
    expect(r.error).toContain(enDrive.drive_url);
    expect(mensajes.some((m) => m.includes("PERDIDA DE LA REFERENCIA") && m.includes("alertas_validacion"))).toBe(true);
  });

  it("copia temporal (Drive falló): misma escritura y se apunta el fallo de Drive", async () => {
    const sb = supaFalso();
    const temporal = { drive_url: null, archivo_path: "temporal/101-a.jpg", error: null, drive_error: "Drive upload 503" };
    const r = await apuntarOriginal(sb.supabase, 101, temporal, { extra });
    expect(sb.updates()).toEqual([{ tabla: "facturas", id: 101, datos: { ...extra, archivo_path: "temporal/101-a.jpg" } }]);
    expect(sb.rpcs.map((x) => x.nombre)).toEqual(["facturas_original_drive_fallo"]);
    expect(r).toMatchObject({ ok: true, estado: "temporal" });
  });

  it("sin original que apuntar, alertas y coste se escriben igual", async () => {
    const sb = supaFalso();
    const nada = { drive_url: null, archivo_path: null, error: "Storage upload: lleno", drive_error: "Drive upload 503" };
    const r = await apuntarOriginal(sb.supabase, 101, nada, { extra });
    expect(sb.updates()).toEqual([{ tabla: "facturas", id: 101, datos: extra }]);
    expect(r).toMatchObject({ ok: false, estado: "perdido", error: "Storage upload: lleno" });
  });
});

describe("guardarDocumento: tras insertar, UN solo UPDATE de la factura", () => {
  const datos = () => ({
    tipo: "albaran", proveedor: "Pescados Ría SL", cif: "B12345678", numero_documento: "A-1", fecha: "2026-11-18",
    subtotal: 100, iva: 10, total: 110, observaciones: null, resumen: "r",
    productos: [{ nombre: "Merluza", cantidad: 1, unidad: "kg", precio_unitario: 100, total: 100 }],
    avisos: [],
  });
  const ctx = (sb: ReturnType<typeof supaFalso>) => ({
    supabase: sb.supabase,
    openai: { embed: vi.fn(async (t: string | string[]) => (Array.isArray(t) ? t : [t]).map(() => [0.1])) },
    drive: DRIVE_OFF,
  }) as unknown as ContextoGuardado;
  const entrada = (extra: Record<string, unknown> = {}) => ({
    datos: datos() as never, alertasPrevias: [], totalOrigen: "leido" as const,
    original: { tipo: "base64" as const, b64: btoa("hola"), mime: "image/jpeg", nombre: "a.jpg" }, ...extra,
  });

  it("alertas, original y coste juntos; las alertas no se escriben antes del original", async () => {
    const sb = supaFalso();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const g = await guardarDocumento(ctx(sb), entrada({ costeLectura: () => COSTE }));
    error.mockRestore();
    expect(g).toMatchObject({ estado: "guardado", facturaId: 101, coste: COSTE });
    const ups = sb.updates().filter((u) => u.tabla === "facturas");
    expect(ups).toHaveLength(1);
    expect(ups[0].datos).toEqual({ alertas_validacion: null, archivo_path: "temporal/101-a.jpg", ...columnasCoste(COSTE) });
  });

  it("si calcular el coste falla, la factura se guarda igual (sin coste)", async () => {
    const sb = supaFalso();
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const g = await guardarDocumento(ctx(sb), entrada({ costeLectura: () => { throw new Error("ocr_trabajos: corte"); } }));
    aviso.mockRestore();
    error.mockRestore();
    expect(g).toMatchObject({ estado: "guardado", coste: null });
    expect(sb.updates().filter((u) => u.tabla === "facturas").map((u) => u.datos)).toEqual([
      { alertas_validacion: null, archivo_path: "temporal/101-a.jpg" },
    ]);
  });
});
