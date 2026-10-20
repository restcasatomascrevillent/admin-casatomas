// ============================================================================
//  Páginas sueltas, duplicados, «Sustituir» seguro, «Añadir como página»,
//  números provisionales y reintento de consolidación (revisión 10/10/2026).
//  Sin OpenAI real ni base de datos: clientes simulados.
// ============================================================================

import { describe, expect, it, vi } from "vitest";
import { decidirCoincidencia, leerPagina, lineasYaIncluidas, paginaDeTexto } from "./paginasDocumento.ts";
import {
  anadirPagina,
  type ContextoGuardado,
  type DocumentoPendiente,
  numeroProvisionalLibre,
  ofertasDuplicado,
  sustituirFactura,
} from "./guardado.ts";
import { soltarConsolidacion } from "./trabajos.ts";

const DRIVE_OFF = { clientId: "", clientSecret: "", refreshToken: "", parentFolder: "" };

describe("leerPagina", () => {
  it("usa el campo `pagina` y, si no viene, las observaciones", () => {
    expect(leerPagina({ pagina: { actual: 2, total: 2 } })).toEqual({ actual: 2, total: 2 });
    expect(leerPagina({ pagina: { actual: null, total: 2 }, observaciones: "PÁGINA Nº 1/2" })).toEqual({ actual: 1, total: 2 });
    expect(paginaDeTexto("Hoja 1 de 3, sigue")).toEqual({ actual: 1, total: 3 });
    expect(leerPagina({ pagina: { actual: 1, total: 1 } })).toBeNull();
    expect(leerPagina({ pagina: { actual: 3, total: 2 } })).toBeNull();
    expect(leerPagina({ observaciones: "pago a 30/60 días" })).toBeNull();
    expect(leerPagina(null)).toBeNull();
  });
});

describe("decidirCoincidencia", () => {
  const ex = { id: 352, lineas: 2, paginas: 1, paginas_lineas: [1], totales_lineas: [311.22, 356], trabajo_pendiente: false, created_at: new Date().toISOString() };
  const pag2 = { pagina: { actual: 2, total: 2 }, productos: [{ total: 267 }] };

  it("factura 352: la página 2/2 con otras líneas → añadir como página, NUNCA sustituir", () => {
    expect(decidirCoincidencia(pag2, ex)).toEqual({ tipo: "pagina", pagina: { actual: 2, total: 2 } });
  });
  it("la misma página otra vez (mismas líneas) es un duplicado", () => {
    const d = decidirCoincidencia({ pagina: { actual: 1, total: 2 }, productos: [{ total: 311.22 }, { total: 356 }] }, ex);
    expect(d).toEqual({ tipo: "duplicado", sustituible: true, motivo: null });
  });
  it("una página no sustituye a un documento que ya tiene varias", () => {
    const d = decidirCoincidencia({ pagina: { actual: 2, total: 2 }, productos: [{ total: 267 }] }, { ...ex, paginas: 2, paginas_lineas: [1, 2], totales_lineas: [311.22, 356, 267] });
    expect(d).toMatchObject({ tipo: "duplicado", sustituible: false });
    expect(decidirCoincidencia({ productos: [{ total: 1 }] }, { ...ex, paginas: 2 })).toMatchObject({ sustituible: false });
  });
  it("sin «Sustituir» si la existente aún se guarda o no tiene líneas", () => {
    expect(decidirCoincidencia({ productos: [] }, { ...ex, trabajo_pendiente: true })).toMatchObject({ sustituible: false, motivo: expect.stringMatching(/guardando/) });
    expect(decidirCoincidencia({ productos: [] }, { ...ex, lineas: 0 })).toMatchObject({ sustituible: false, motivo: expect.stringMatching(/no tiene líneas/) });
  });
  it("una coincidencia antigua (más de 30 días) no se toma por otra página", () => {
    const vieja = { ...ex, created_at: new Date(Date.now() - 40 * 864e5).toISOString() };
    expect(decidirCoincidencia(pag2, vieja).tipo).toBe("duplicado");
  });
  it("lineasYaIncluidas cuenta repeticiones", () => {
    expect(lineasYaIncluidas([10, 10], [10])).toBe(false);
    expect(lineasYaIncluidas([10, 20, 30], [10, 20, 99])).toBe(true);
    expect(lineasYaIncluidas([], [1])).toBe(false);
  });
});

// ── Supabase simulado ───────────────────────────────────────────────────────
type Op = { m: string; a: unknown[] };
function supabaseFalso(o: { trabajo?: unknown; rpc?: Record<string, unknown>; rpcError?: Record<string, string>; existente?: (n: string) => unknown }) {
  const orden: string[] = [];
  const consultas: { tabla: string; ops: Op[] }[] = [];
  const rpcs: { nombre: string; args: Record<string, unknown> }[] = [];
  const cadena = (tabla: string, ops: Op[] = []): unknown =>
    new Proxy({}, {
      get(_o, prop: string) {
        if (prop === "then") {
          consultas.push({ tabla, ops });
          if (ops.some((x) => x.m === "update")) orden.push(`update:${tabla}`);
          let data: unknown = null;
          if (tabla === "ocr_trabajos" && ops.some((x) => x.m === "select")) {
            const campos = String(ops.find((x) => x.m === "select")!.a[0]);
            data = campos.startsWith("coste_usd") ? { coste_usd: 0.004, modelo: "m", llamadas: 3 } : o.trabajo;
          }
          if (tabla === "facturas" && ops.some((x) => x.m === "select")) data = { coste_lectura_usd: 0.005, lectura_llamadas: 4, lectura_modelo: "m" };
          return (ok: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(ok);
        }
        return (...a: unknown[]) => cadena(tabla, [...ops, { m: prop, a }]);
      },
    });
  const supabase = {
    from: (t: string) => cadena(t),
    rpc: async (nombre: string, args: Record<string, unknown>) => {
      rpcs.push({ nombre, args });
      orden.push(`rpc:${nombre}`);
      if (o.rpcError?.[nombre]) return { data: null, error: { message: o.rpcError[nombre] } };
      if (nombre === "ocr_factura_existente") return { data: o.existente?.(String(args.p_numero)) ?? null, error: null };
      if (nombre === "validar_cordura_factura") return { data: [], error: null };
      return { data: o.rpc?.[nombre] ?? null, error: null };
    },
    storage: {
      from: () => ({
        move: async (desde: string, hasta: string) => {
          orden.push(`move:${desde}->${hasta}`);
          return { error: null };
        },
        list: async () => ({ data: [], error: null }),
      }),
    },
  };
  return { supabase, orden, consultas, rpcs };
}

function openaiFalso() {
  return {
    config: { modelo: "m", detalle: "high" },
    uso: { tokensEntrada: 0, tokensSalida: 0, costeUsd: 0, llamadas: 0, llamadasEmbeddings: 0, tokensEmbeddings: 0, costeEmbeddingsUsd: 0 },
    embed: vi.fn(async (t: string | string[]) => (Array.isArray(t) ? t : [t]).map(() => [0.1, 0.2])),
  };
}

const datos = (extra: Record<string, unknown> = {}) => ({
  tipo: "albaran", proveedor: "NICOLAS Y VALERO", cif: "B06805246", numero_documento: "P26/24306", fecha: "2026-10-09",
  subtotal: null, iva: null, total: null, observaciones: null, resumen: null, pagina: { actual: 1, total: 2 },
  productos: [
    { nombre: "ATUN ROJO", cantidad: 7.41, unidad: "kg", precio_unitario: 42, total: 311.22, pagina: 1, orden: 0, albaran_ref: null },
    { nombre: "GAMBA ROJA", cantidad: 2, unidad: "kg", precio_unitario: 178, total: 356, pagina: 1, orden: 1, albaran_ref: null },
  ],
  avisos: [],
  ...extra,
});
const existente = { id: 352, numero_documento: "P26/24306", proveedor: "NyV", fecha: "2026-10-09", total: 1029.64, total_origen: "leido", lineas: 2, alertas: 0, alertas_graves: 0, paginas: 1, paginas_lineas: [1], totales_lineas: [267, 1.82], trabajo_pendiente: false, created_at: new Date().toISOString() };

describe("ofertasDuplicado", () => {
  it("otra página → anadible (y el pendiente recuerda la página); nunca sustituible", () => {
    const p: DocumentoPendiente = { datos: datos() as never, alertasPrevias: [], totalOrigen: null, paginas: 1, existente: existente as never };
    const o = ofertasDuplicado(p, "t1");
    expect(o.sustituible).toBeNull();
    expect(o.anadible).toMatchObject({ trabajo_id: "t1", pagina: { actual: 1, total: 2 }, existente: { id: 352 } });
    expect(p.pagina).toEqual({ actual: 1, total: 2 });
  });
});

describe("sustituirFactura", () => {
  const trabajo = (pend: Partial<DocumentoPendiente> = {}) => ({
    id: "t1", estado: "duplicado", original_path: "pendientes/u/t1/01.jpg", original_mime: "image/jpeg", nombre_original: "f.jpg",
    documento_pendiente: { datos: datos({ pagina: null }), alertasPrevias: [], totalOrigen: null, paginas: 1, existente, ...pend },
  });

  it("mueve el original SOLO después de que la RPC salga bien", async () => {
    const sb = supabaseFalso({ trabajo: trabajo(), rpc: { ocr_sustituir_factura: { lineas_antes: 2, lineas: 2 } } });
    const ctx = { supabase: sb.supabase, openai: openaiFalso(), drive: DRIVE_OFF } as unknown as ContextoGuardado;
    await sustituirFactura(ctx, { trabajoId: "t1", facturaId: 352, userId: "u", esperado: {} });
    const iRpc = sb.orden.indexOf("rpc:ocr_sustituir_factura");
    const iMove = sb.orden.findIndex((x) => x.startsWith("move:"));
    expect(iRpc).toBeGreaterThanOrEqual(0);
    expect(iMove).toBeGreaterThan(iRpc);
    expect(sb.rpcs.find((r) => r.nombre === "ocr_sustituir_factura")!.args.p_archivo_path).toMatch(/^2026\/10\/352-sust-t1-/);
  });

  it("si la RPC aborta no mueve nada y el mensaje es claro", async () => {
    const sb = supabaseFalso({
      trabajo: trabajo(),
      rpcError: { ocr_sustituir_factura: "SUSTITUCIÓN ABORTADA: la factura 352 ha cambiado desde que la viste. Revisa y confirma de nuevo." },
    });
    const ctx = { supabase: sb.supabase, openai: openaiFalso(), drive: DRIVE_OFF } as unknown as ContextoGuardado;
    await expect(sustituirFactura(ctx, { trabajoId: "t1", facturaId: 352, userId: "u", esperado: { lineas: 2 } }))
      .rejects.toThrow(/^No se ha sustituido nada: la factura 352 ha cambiado/);
    expect(sb.orden.some((x) => x.startsWith("move:"))).toBe(false);
  });

  it("nunca entre páginas distintas", async () => {
    const sb = supabaseFalso({ trabajo: trabajo({ pagina: { actual: 2, total: 2 } }) });
    const ctx = { supabase: sb.supabase, openai: openaiFalso(), drive: DRIVE_OFF } as unknown as ContextoGuardado;
    await expect(sustituirFactura(ctx, { trabajoId: "t1", facturaId: 352, userId: "u", esperado: {} })).rejects.toThrow(/Añadir como página/);
    expect(sb.rpcs.some((r) => r.nombre === "ocr_sustituir_factura")).toBe(false);
  });
});

describe("anadirPagina", () => {
  it("manda las líneas con su página, mueve el original tras la RPC, suma el coste y recalcula avisos", async () => {
    const t = {
      id: "t2", estado: "duplicado", original_path: "pendientes/u/t2/01.jpg", nombre_original: "pag1.jpg",
      documento_pendiente: {
        datos: datos(), alertasPrevias: [{ codigo: "pagina_suelta", mensaje: "x" }, { codigo: "otro", mensaje: "y" }],
        totalOrigen: null, paginas: 1, existente, pagina: { actual: 1, total: 2 },
      },
    };
    const sb = supabaseFalso({
      trabajo: t,
      rpc: {
        ocr_anadir_pagina: {
          lineas_antes: 2, lineas_anadidas: 2, total: 1029.64, total_origen: "leido", paginas_lineas: [1, 2],
          alertas_antes: [{ codigo: "pagina_suelta", mensaje: "Es la página 2 de 2" }, { codigo: "descuadre_cabecera", mensaje: "d" }],
        },
      },
    });
    const ctx = { supabase: sb.supabase, openai: openaiFalso(), drive: DRIVE_OFF } as unknown as ContextoGuardado;
    const r = await anadirPagina(ctx, { trabajoId: "t2", facturaId: 352, userId: "u", esperado: { lineas: 2 } });
    const args = sb.rpcs.find((x) => x.nombre === "ocr_anadir_pagina")!.args;
    expect(args).toMatchObject({ p_factura_id: 352, p_pagina: 1, p_paginas_total: 2, p_esperado: { lineas: 2 } });
    expect((args.p_lineas as { pagina: number }[]).map((l) => l.pagina)).toEqual([1, 1]);
    expect(sb.orden.findIndex((x) => x.startsWith("move:"))).toBeGreaterThan(sb.orden.indexOf("rpc:ocr_anadir_pagina"));
    // Coste: 0,005 que ya tenía + 0,004 de la lectura de la página.
    const coste = sb.consultas.find((c) => c.tabla === "facturas" && c.ops.some((x) => x.m === "update" && (x.a[0] as Record<string, unknown>).coste_lectura_usd !== undefined));
    expect((coste!.ops.find((x) => x.m === "update")!.a[0] as Record<string, number>).coste_lectura_usd).toBeCloseTo(0.009, 6);
    // Con las dos páginas dentro ya no queda el aviso de página suelta.
    const avisos = sb.consultas.filter((c) => c.tabla === "facturas" && c.ops.some((x) => x.m === "update" && "alertas_validacion" in (x.a[0] as object)));
    const finales = (avisos.at(-1)!.ops.find((x) => x.m === "update")!.a[0] as { alertas_validacion: { codigo: string }[] }).alertas_validacion;
    expect(finales.map((a) => a.codigo)).toEqual(["descuadre_cabecera", "otro"]);
    expect(r.pagina_anadida).toBe(true);
    expect(r.message).toMatch(/Página 1 añadida a la factura P26\/24306/);
  });

  it("no añade si el documento no es una página de esa factura", async () => {
    const sb = supabaseFalso({ trabajo: { id: "t3", estado: "duplicado", documento_pendiente: { datos: datos(), existente, paginas: 1 } } });
    const ctx = { supabase: sb.supabase, openai: openaiFalso(), drive: DRIVE_OFF } as unknown as ContextoGuardado;
    await expect(anadirPagina(ctx, { trabajoId: "t3", facturaId: 352, userId: "u", esperado: {} })).rejects.toThrow(/no es otra página/);
  });
});

describe("notas sin número (SN-…)", () => {
  const nota = (total: number) => datos({ numero_documento: "SN-NAREJOS-20261010", total, pagina: null }) as never as { numero_documento: string };
  it("dos notas distintas del mismo proveedor y día: la segunda pasa a -2", async () => {
    const sb = supabaseFalso({ existente: (n) => (n === "SN-NAREJOS-20261010" ? { id: 1, numero_documento: n, total: 99 } : null) });
    const d = nota(50);
    expect(await numeroProvisionalLibre(sb.supabase, d as never)).toBeNull();
    expect(d.numero_documento).toBe("SN-NAREJOS-20261010-2");
  });
  it("la misma nota otra vez (mismo total) es un duplicado", async () => {
    const sb = supabaseFalso({ existente: (n) => (n === "SN-NAREJOS-20261010-2" ? { id: 2, numero_documento: n, total: 50 } : n === "SN-NAREJOS-20261010" ? { id: 1, numero_documento: n, total: 99 } : null) });
    const ex = await numeroProvisionalLibre(sb.supabase, nota(50) as never);
    expect(ex).toMatchObject({ id: 2 });
  });
});

describe("carga masiva: consolidación que falla por saturación", () => {
  it("apunta el error y suelta el lease ya (el cron la reintenta en ~1 min)", async () => {
    const sb = supabaseFalso({});
    await soltarConsolidacion(sb.supabase, "t9", "insert productos: canceling statement due to statement timeout");
    const upd = sb.consultas.find((c) => c.tabla === "ocr_trabajos")!;
    const cambio = upd.ops.find((x) => x.m === "update")!.a[0] as { error: string; lease_hasta: string };
    expect(cambio.error).toMatch(/se reintenta.*statement timeout/);
    expect(Math.abs(Date.parse(cambio.lease_hasta) - Date.now())).toBeLessThan(5000);
    expect(upd.ops.filter((x) => x.m === "eq").map((x) => x.a)).toEqual([["id", "t9"], ["estado", "consolidando"]]);
  });
});
