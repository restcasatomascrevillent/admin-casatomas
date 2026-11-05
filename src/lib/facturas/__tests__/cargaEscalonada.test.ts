import { describe, expect, it, vi } from "vitest";
import { cargarEscalonado, type CacheEscalonada } from "../cargaEscalonada";

type Doc = { id: number };
const docs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: n - i }));

function servidor(todas: Doc[], maxRows = 1000) {
  const leer = vi.fn(async (primera: number, ultima: number) =>
    todas.slice(primera, Math.min(ultima + 1, primera + maxRows)),
  );
  return leer;
}

function cache(inicial?: Doc[]) {
  let datos = inicial;
  const escrituras: number[] = [];
  const c: CacheEscalonada<Doc> = {
    getQueryData: () => datos,
    setQueryData: (_k, d) => {
      datos = d;
      escrituras.push(d.length);
    },
  };
  return { c, escrituras };
}

describe("cargarEscalonado", () => {
  it("lee todas por tandas aunque haya más de 1.000 (max-rows)", async () => {
    const todas = docs(2345);
    const leer = servidor(todas);
    const { c } = cache();
    const r = await cargarEscalonado(c, ["facturas"], leer, { primeraTanda: 150, tanda: 1000 });
    expect(r).toHaveLength(2345);
    expect(r.map((d) => d.id)).toEqual(todas.map((d) => d.id));
    expect(leer.mock.calls).toEqual([[0, 149], [150, 1149], [1150, 2149], [2150, 3149]]);
  });

  it("en la carga inicial va publicando cada tanda en la caché", async () => {
    const { c, escrituras } = cache();
    await cargarEscalonado(c, ["facturas"], servidor(docs(2345)), { primeraTanda: 150, tanda: 1000 });
    // La última tanda (corta) la devuelve la función: React Query la guarda al acabar.
    expect(escrituras).toEqual([150, 1150, 2150]);
  });

  it("en un refresco no toca la caché hasta el final", async () => {
    const { c, escrituras } = cache(docs(10));
    const r = await cargarEscalonado(c, ["facturas"], servidor(docs(2345)));
    expect(escrituras).toEqual([]);
    expect(r).toHaveLength(2345);
  });

  it("descarta repetidas entre tandas", async () => {
    const leer = vi.fn(async (primera: number) =>
      primera === 0 ? [{ id: 5 }, { id: 4 }] : [{ id: 4 }, { id: 3 }].slice(0, 1),
    );
    const { c } = cache();
    const r = await cargarEscalonado(c, ["k"], leer, { primeraTanda: 2, tanda: 2 });
    expect(r.map((d) => d.id)).toEqual([5, 4]);
  });

  it("una sola tanda corta y sin datos", async () => {
    const { c, escrituras } = cache();
    expect(await cargarEscalonado(c, ["k"], servidor([]))).toEqual([]);
    expect(escrituras).toEqual([]);
  });

  it("se para al cancelar", async () => {
    const ctrl = new AbortController();
    const leer = vi.fn(async (primera: number, ultima: number) => {
      ctrl.abort();
      return docs(5000).slice(primera, ultima + 1);
    });
    const { c } = cache();
    await cargarEscalonado(c, ["k"], leer, { signal: ctrl.signal });
    expect(leer).toHaveBeenCalledTimes(1);
  });
});
