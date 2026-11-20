// ============================================================================
//  Los INSERT del guardado se reintentan si la base los corta por tiempo
//  (20/11/2026). Medido en producción: media de 2,2 s y máximo de 6 s en el
//  INSERT de una cabecera que, con la base tranquila, tarda 0,05 s; y 7,9 s de
//  máximo en el de las líneas contra el tope de 8 s. El 19/11 tres intentos
//  seguidos fallaron así y el trabajo quedó «fallido» 31 minutos.
//  Postgres deshace la sentencia cortada: repetirla es seguro.
// ============================================================================

import { describe, expect, it, vi } from "vitest";
import { type ContextoGuardado, guardarDocumento } from "./guardado.ts";

const CORTE = { code: "57014", message: "canceling statement due to statement timeout" };
const DRIVE_OFF = { clientId: "", clientSecret: "", refreshToken: "", parentFolder: "" };

type Respuesta = { data?: unknown; error: unknown } | undefined;

/** Supabase simulado: lo que contesta cada INSERT de cada tabla, en orden (por defecto, bien). */
function supaFalso(inserts: { facturas?: Respuesta[]; productos_factura?: Respuesta[] } = {}) {
  const hechos: { tabla: string; filas: unknown }[] = [];
  const contador: Record<string, number> = {};
  const cadena = (tabla: string, op = ""): unknown =>
    new Proxy({}, {
      get(_t, prop: string) {
        if (prop === "then") {
          let r: { data?: unknown; error: unknown } = { data: null, error: null };
          if (op === "insert") {
            const n = (contador[tabla] = (contador[tabla] ?? 0) + 1);
            const guion = (inserts as Record<string, Respuesta[]>)[tabla]?.[n - 1];
            r = guion ?? (tabla === "facturas" ? { data: { id: 101 }, error: null } : { data: null, error: null });
          }
          return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(r).then(ok, ko);
        }
        return (...a: unknown[]) => {
          if (prop === "insert") hechos.push({ tabla, filas: a[0] });
          return cadena(tabla, prop === "insert" ? "insert" : op);
        };
      },
    });
  const supabase = {
    from: (t: string) => cadena(t),
    rpc: async () => ({ data: null, error: null }),
    storage: { from: () => ({ upload: async (path: string) => ({ data: { path }, error: null }) }) },
  };
  return { supabase, hechos, intentos: (t: string) => hechos.filter((h) => h.tabla === t).length };
}

const datos = () => ({
  tipo: "albaran", proveedor: "Pescados Ría SL", cif: "B12345678", numero_documento: "A-1", fecha: "2026-11-18",
  subtotal: 100, iva: 10, total: 110, observaciones: null, resumen: "r",
  productos: [
    { nombre: "Merluza", cantidad: 1, unidad: "kg", precio_unitario: 60, total: 60 },
    { nombre: "Rape", cantidad: 1, unidad: "kg", precio_unitario: 40, total: 40 },
  ],
  avisos: [],
});
const ctx = (sb: ReturnType<typeof supaFalso>, dormir = vi.fn(async () => {})) => ({
  supabase: sb.supabase,
  openai: { embed: vi.fn(async (t: string | string[]) => (Array.isArray(t) ? t : [t]).map(() => [0.1])) },
  drive: DRIVE_OFF,
  reintento: { dormir },
}) as unknown as ContextoGuardado;
const entrada = () => ({
  datos: datos() as never, alertasPrevias: [], totalOrigen: "leido" as const,
  original: { tipo: "base64" as const, b64: btoa("hola"), mime: "image/jpeg", nombre: "a.jpg" },
});
const callar = () => [vi.spyOn(console, "warn").mockImplementation(() => {}), vi.spyOn(console, "error").mockImplementation(() => {})];

describe("guardarDocumento: INSERT cortados por tiempo", () => {
  it("la cabecera cortada se repite tras 3 s y entra; el guardado sigue y no compensa nada", async () => {
    const mudos = callar();
    const sb = supaFalso({ facturas: [{ error: CORTE }] });
    const dormir = vi.fn(async () => {});
    const g = await guardarDocumento(ctx(sb, dormir), entrada());
    mudos.forEach((m) => m.mockRestore());
    expect(g).toMatchObject({ estado: "guardado", facturaId: 101 });
    expect(sb.hechos.filter((h) => h.tabla === "facturas" && Array.isArray(h.filas) === false && (h.filas as { numero_documento?: string }).numero_documento === "A-1")).toHaveLength(2);
    expect(dormir).toHaveBeenCalledWith(3000);
  });

  it("las líneas cortadas dos veces entran a la tercera, en la MISMA forma (una sola sentencia con las 2 líneas)", async () => {
    const mudos = callar();
    const sb = supaFalso({ productos_factura: [{ error: CORTE }, { error: CORTE }] });
    const dormir = vi.fn(async () => {});
    const g = await guardarDocumento(ctx(sb, dormir), entrada());
    mudos.forEach((m) => m.mockRestore());
    expect(g).toMatchObject({ estado: "guardado", facturaId: 101 });
    const intentos = sb.hechos.filter((h) => h.tabla === "productos_factura");
    expect(intentos).toHaveLength(3);
    expect(new Set(intentos.map((h) => JSON.stringify(h.filas))).size).toBe(1);
    expect((intentos[0].filas as unknown[]).length).toBe(2);
    expect(dormir.mock.calls.map((c) => c[0])).toEqual([3000, 8000]);
    // Nada se compensó: no hubo DELETE de la factura.
    expect(sb.hechos.every((h) => h.tabla !== "historial_precios")).toBe(true);
  });

  it("un error que no es de tiempo no se repite: falla a la primera y se compensa la cabecera", async () => {
    const mudos = callar();
    const sb = supaFalso({ productos_factura: [{ error: { code: "23505", message: "duplicate key value" } }] });
    const dormir = vi.fn(async () => {});
    await expect(guardarDocumento(ctx(sb, dormir), entrada())).rejects.toThrow(/insert productos: duplicate key/);
    mudos.forEach((m) => m.mockRestore());
    expect(sb.intentos("productos_factura")).toBe(1);
    expect(dormir).not.toHaveBeenCalled();
  });

  it("si el corte persiste tras los tres intentos, falla con el mensaje de siempre (el trabajo lo reintentará)", async () => {
    const mudos = callar();
    const sb = supaFalso({ facturas: [{ error: CORTE }, { error: CORTE }, { error: CORTE }] });
    await expect(guardarDocumento(ctx(sb), entrada())).rejects.toThrow(/insert factura: canceling statement/);
    mudos.forEach((m) => m.mockRestore());
    expect(sb.intentos("facturas")).toBe(3);
    expect(sb.intentos("productos_factura")).toBe(0);
  });
});
