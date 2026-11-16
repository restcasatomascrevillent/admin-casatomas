// Embeddings por nombre (20261203100000): solo se pide a OpenAI lo que falta,
// se guarda por nombre en lotes pequeños y un fallo no rompe el guardado.
import { describe, expect, it, vi } from "vitest";
import {
  asegurarVectoresNombres,
  guardarVectoresNombres,
  LOTE_ESCRITURA,
  nombresUnicos,
} from "../procesar-factura/embeddingsNombres.ts";
import { embedOpenAI, rellenarPendientes, textoParaEmbedding } from "./relleno.ts";

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
