// Embeddings por nombre (20261203100000): solo se pide a OpenAI lo que falta,
// se guarda por nombre en lotes pequeños y un fallo no rompe el guardado.
import { describe, expect, it, vi } from "vitest";
import {
  asegurarVectoresNombres,
  guardarVectoresNombres,
  LOTE_ESCRITURA,
  nombresUnicos,
} from "../procesar-factura/embeddingsNombres.ts";
import { embedOpenAI, rellenarFacturas, rellenarPendientes, textoParaEmbedding } from "./relleno.ts";
import { textoEmbedding } from "../procesar-factura/guardado.ts";

/** Supabase simulado: la tabla productos_nombre_embedding en memoria. */
function supaFalso(inicial: Record<string, string | null>) {
  const tabla = new Map(Object.entries(inicial));
  const upserts: number[] = [];
  const supabase = {
    from(nombreTabla: string) {
      expect(nombreTabla).toBe("productos_nombre_embedding");
      const filtros: { in?: string[]; conVector?: boolean; sinVector?: boolean; limite?: number } = {};
      const q = {
        select: () => q,
        in: (_c: string, v: string[]) => ((filtros.in = v), q),
        not: () => ((filtros.conVector = true), q),
        is: () => ((filtros.sinVector = true), q),
        order: () => q,
        limit: (n: number) => ((filtros.limite = n), q),
        then(res: (r: unknown) => void) {
          let filas = [...tabla.entries()].map(([nombre, embedding]) => ({ nombre, embedding }));
          if (filtros.in) filas = filas.filter((f) => filtros.in!.includes(f.nombre));
          if (filtros.conVector) filas = filas.filter((f) => f.embedding !== null);
          if (filtros.sinVector) filas = filas.filter((f) => f.embedding === null);
          if (filtros.limite) filas = filas.slice(0, filtros.limite);
          res({ data: filas, error: null });
        },
        upsert: async (filas: { nombre: string; embedding: string }[]) => {
          upserts.push(filas.length);
          for (const f of filas) tabla.set(f.nombre, f.embedding);
          return { error: null };
        },
      };
      return q;
    },
  };
  return { supabase, tabla, upserts };
}

describe("embeddings por nombre", () => {
  it("nombresUnicos: tal cual (sin normalizar), sin vacíos ni repetidos", () => {
    expect(nombresUnicos(["Tomate", "tomate", "Tomate", " ", null, undefined, "Pulpo"])).toEqual(["Tomate", "tomate", "Pulpo"]);
  });

  it("solo pide a OpenAI los nombres sin vector y los guarda", async () => {
    const { supabase, tabla } = supaFalso({ Tomate: "[1,2]", Pulpo: null });
    const embed = vi.fn(async (t: string | string[]) => (t as string[]).map(() => [0.5, 0.25]));
    const r = await asegurarVectoresNombres({ supabase, openai: { embed } }, ["Tomate", "Pulpo", "Merluza", "Pulpo"]);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledWith(["Pulpo", "Merluza"]);
    expect(r).toEqual({ calculados: 2, error: null });
    expect(tabla.get("Merluza")).toBe("[0.5,0.25]");
    expect(tabla.get("Tomate")).toBe("[1,2]");
  });

  it("si todos tienen vector, no llama a OpenAI", async () => {
    const { supabase } = supaFalso({ Tomate: "[1]" });
    const embed = vi.fn();
    expect(await asegurarVectoresNombres({ supabase, openai: { embed } }, ["Tomate"])).toEqual({ calculados: 0, error: null });
    expect(embed).not.toHaveBeenCalled();
  });

  it("un fallo de OpenAI no lanza: queda para el cron", async () => {
    const { supabase, tabla } = supaFalso({});
    const embed = vi.fn(async () => {
      throw new Error("OpenAI embeddings 429");
    });
    const r = await asegurarVectoresNombres({ supabase, openai: { embed } }, ["Merluza"]);
    expect(r.calculados).toBe(0);
    expect(r.error).toContain("429");
    expect(tabla.has("Merluza")).toBe(false);
  });

  it("guarda en lotes de LOTE_ESCRITURA", async () => {
    const { supabase, upserts } = supaFalso({});
    const nombres = Array.from({ length: LOTE_ESCRITURA * 2 + 3 }, (_, i) => `n${i}`);
    await guardarVectoresNombres(supabase, nombres, nombres.map(() => [0]));
    expect(upserts).toEqual([LOTE_ESCRITURA, LOTE_ESCRITURA, 3]);
  });

  it("lotes de 10 (antes 50: con la base cargada pasaban de los 8 s)", () => {
    expect(LOTE_ESCRITURA).toBe(10);
  });

  it("al guardar una factura no se reintenta: un corte por tiempo queda para el cron", async () => {
    const { supabase } = supaFalso({});
    const upsert = vi.fn(async () => ({ error: { code: "57014", message: "canceling statement due to statement timeout" } }));
    const q = supabase.from("productos_nombre_embedding") as unknown as Record<string, unknown>;
    const supaCorte = { from: () => ({ ...q, upsert }) };
    const embed = vi.fn(async (t: string | string[]) => (t as string[]).map(() => [0.1]));
    const r = await asegurarVectoresNombres({ supabase: supaCorte, openai: { embed } }, ["Merluza"]);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(r.error).toContain("statement timeout");
  });

  it("el cron reintenta un lote cortado por tiempo y sigue con el resto", async () => {
    const { supabase, tabla } = supaFalso({ A: null, B: null });
    const q = supabase.from("productos_nombre_embedding") as unknown as Record<string, unknown> & { upsert: (f: unknown[]) => Promise<unknown> };
    let cortes = 1;
    const upsert = vi.fn(async (filas: { nombre: string; embedding: string }[]) => {
      if (cortes-- > 0) return { error: { code: "57014", message: "canceling statement due to statement timeout" } };
      return q.upsert(filas);
    });
    const supaCorte = { from: () => ({ ...supabase.from("productos_nombre_embedding"), upsert }) };
    const embed = vi.fn(async (t: string[]) => t.map(() => [0.3]));
    const dormir = vi.fn(async () => {});
    expect(await rellenarPendientes({ supabase: supaCorte, embed, dormir, esperasReintentoMs: [4] })).toEqual({ pendientes: 2, guardados: 2 });
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(dormir).toHaveBeenCalledWith(4);
    expect(tabla.get("A")).toBe("[0.3]");
  });

  it("rellenarPendientes: una llamada con todos los pendientes; sin pendientes, ninguna", async () => {
    const { supabase, tabla } = supaFalso({ A: null, B: "[1]", C: null });
    const embed = vi.fn(async (t: string[]) => t.map(() => [0.1]));
    expect(await rellenarPendientes({ supabase, embed })).toEqual({ pendientes: 2, guardados: 2 });
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledWith(["A", "C"]);
    expect(tabla.get("A")).toBe("[0.1]");
    expect(await rellenarPendientes({ supabase, embed })).toEqual({ pendientes: 0, guardados: 0 });
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it("embedOpenAI: ordena por index y comprueba el número de vectores", async () => {
    const f = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ index: 1, embedding: [2] }, { index: 0, embedding: [1] }], usage: { prompt_tokens: 3 } }))
    );
    const alUsar = vi.fn();
    expect(await embedOpenAI(["a", "b"], { apiKey: "k", fetch: f as unknown as typeof fetch, alUsar })).toEqual([[1], [2]]);
    expect(alUsar).toHaveBeenCalledWith({ prompt_tokens: 3 });
    const cuerpo = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(cuerpo).toEqual({ model: "text-embedding-3-small", input: ["a", "b"] });
    await expect(embedOpenAI(["a", "b", "c"], { apiKey: "k", fetch: f as unknown as typeof fetch })).rejects.toThrow(/2 vectores/);
  });

  it("un nombre en blanco se manda como «(sin nombre)»", () => {
    expect(textoParaEmbedding("  ")).toBe("(sin nombre)");
    expect(textoParaEmbedding("Pulpo")).toBe("Pulpo");
  });
});

describe("rellenarFacturas (facturas.embedding)", () => {
  type Fila = { id: number; tipo: string; proveedor: string | null; fecha: string; total: number; resumen: string | null; embedding: string | null };
  function supaFacturas(facturas: Fila[], lineas: { factura_id: number; nombre: string }[], fallaId?: number) {
    return {
      from(t: string) {
        const f: { limite?: number } = {};
        const q = {
          select: () => q,
          is: () => q,
          in: () => q,
          order: () => q,
          limit: (n: number) => ((f.limite = n), q),
          update: (v: { embedding: string }) => ({
            eq: async (_c: string, id: number) => {
              if (id === fallaId) return { error: { message: "boom" } };
              facturas.find((x) => x.id === id)!.embedding = v.embedding;
              return { error: null };
            },
          }),
          then(res: (r: unknown) => void) {
            res({ data: t === "facturas" ? facturas.filter((x) => x.embedding === null).slice(0, f.limite) : lineas, error: null });
          },
        };
        return q;
      },
    };
  }
  const base = { tipo: "factura", proveedor: "Makro", fecha: "2026-10-01", total: 12.5, embedding: null };

  it("usa el MISMO texto que textoEmbedding (con y sin resumen) y guarda con update", async () => {
    const fs: Fila[] = [{ id: 1, ...base, resumen: null }, { id: 2, ...base, proveedor: null, resumen: "Resumen X" }];
    const lineas = [{ factura_id: 1, nombre: "Pulpo" }, { factura_id: 1, nombre: "Tomate" }];
    const embed = vi.fn(async (t: string[]) => t.map(() => [0.5]));
    const r = await rellenarFacturas({ supabase: supaFacturas(fs, lineas), embed });
    expect(embed).toHaveBeenCalledTimes(1);
    const esperado = textoEmbedding({
      tipo: "factura", proveedor: "Makro", fecha: "2026-10-01", total: 12.5, resumen: null,
      productos: [{ nombre: "Pulpo" }, { nombre: "Tomate" }],
    } as never);
    expect(embed.mock.calls[0][0]).toEqual([esperado, "Resumen X"]);
    expect(esperado).toBe("factura de Makro, 2026-10-01, total 12.5€. Productos: Pulpo, Tomate");
    expect(r).toEqual({ facturasPendientes: 2, facturasGuardadas: 2, facturasFallidas: 0 });
    expect(fs[0].embedding).toBe("[0.5]");
  });

  it("sin pendientes no llama a OpenAI", async () => {
    const embed = vi.fn();
    const r = await rellenarFacturas({ supabase: supaFacturas([{ id: 1, ...base, resumen: null, embedding: "[1]" }], []), embed });
    expect(r.facturasPendientes).toBe(0);
    expect(embed).not.toHaveBeenCalled();
  });

  it("si un update falla, el resto se guarda", async () => {
    const fs: Fila[] = [{ id: 1, ...base, resumen: "a" }, { id: 2, ...base, resumen: "b" }];
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await rellenarFacturas({ supabase: supaFacturas(fs, [], 1), embed: async (t) => t.map(() => [1]) });
    expect(r).toEqual({ facturasPendientes: 2, facturasGuardadas: 1, facturasFallidas: 1 });
    expect(fs[1].embedding).toBe("[1]");
    err.mockRestore();
  });

  it("limita a 200 por pasada", async () => {
    const fs: Fila[] = Array.from({ length: 250 }, (_, i) => ({ id: i + 1, ...base, resumen: "r" }));
    const embed = vi.fn(async (t: string[]) => t.map(() => [1]));
    const r = await rellenarFacturas({ supabase: supaFacturas(fs, []), embed });
    expect(r.facturasPendientes).toBe(200);
    expect(embed).toHaveBeenCalledTimes(1);
  });
});
