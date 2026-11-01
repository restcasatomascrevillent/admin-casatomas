import { beforeEach, describe, expect, it, vi } from "vitest";

const bd = vi.hoisted(() => ({
  updates: [] as { tabla: string; dato: unknown; id: unknown }[],
  filas: [] as unknown[],
  fallarIds: new Set<string>(),
  errorSelect: null as unknown,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabla: string) => ({
      select: () => ({
        eq: async () => (bd.errorSelect ? { data: null, error: bd.errorSelect } : { data: bd.filas, error: null }),
      }),
      update: (dato: unknown) => ({
        eq: (_col: string, id: string) => ({
          select: async () => {
            bd.updates.push({ tabla, dato, id });
            return bd.fallarIds.has(id) ? { data: [], error: null } : { data: [{ id }], error: null };
          },
        }),
      }),
    }),
  },
}));

import {
  cambiosDeOrden,
  categoriasOrdenadas,
  consultarSiguienteOrden,
  guardarOrdenEnTabla,
  ordenarPorOrden,
  siguienteOrden,
  valorOrden,
} from "@/lib/orden-carta";

beforeEach(() => {
  bd.updates = [];
  bd.filas = [];
  bd.fallarIds = new Set();
  bd.errorSelect = null;
});

describe("valorOrden", () => {
  it("lee enteros guardados como texto o número y descarta lo demás", () => {
    expect(valorOrden("3")).toBe(3);
    expect(valorOrden(" 12 ")).toBe(12);
    expect(valorOrden(7)).toBe(7);
    expect(valorOrden("0")).toBe(0);
    expect(valorOrden(null)).toBeNull();
    expect(valorOrden("")).toBeNull();
    expect(valorOrden("abc")).toBeNull();
    expect(valorOrden("2.5")).toBeNull();
    expect(valorOrden(2.5)).toBeNull();
  });
});

describe("ordenarPorOrden", () => {
  it("ordena por número aunque venga como texto (2 antes que 10) y deja los null al final", () => {
    const items = [
      { id: "a", orden: "10" },
      { id: "b", orden: null },
      { id: "c", orden: "2" },
      { id: "d", orden: 1 },
    ];
    expect(ordenarPorOrden(items).map((i) => i.id)).toEqual(["d", "c", "a", "b"]);
  });

  it("es estable: a igual orden (categoría sin ordenar, todo a 0) respeta el orden de llegada", () => {
    const items = [
      { id: "x", orden: "0" },
      { id: "y", orden: "0" },
      { id: "z", orden: "0" },
    ];
    expect(ordenarPorOrden(items).map((i) => i.id)).toEqual(["x", "y", "z"]);
  });
});

describe("categoriasOrdenadas", () => {
  it("devuelve las categorías únicas en orden alfabético, sin vacías", () => {
    expect(
      categoriasOrdenadas([
        { categoria: "Postres" },
        { categoria: "arroces" },
        { categoria: null },
        { categoria: "Entrantes" },
        { categoria: "Postres" },
        { categoria: "" },
      ]),
    ).toEqual(["arroces", "Entrantes", "Postres"]);
  });
});

describe("siguienteOrden y cambiosDeOrden", () => {
  it("un alta va detrás del mayor orden de su categoría", () => {
    expect(siguienteOrden([])).toBe(1);
    expect(siguienteOrden(["0", "0"])).toBe(1);
    expect(siguienteOrden(["1", "2", "10", null])).toBe(11);
  });

  it("solo escribe los que cambian de posición, con enteros desde 1", () => {
    const items = [
      { id: "a", orden: "1" },
      { id: "b", orden: "2" },
      { id: "c", orden: "3" },
    ];
    expect(cambiosDeOrden(items, ["a", "c", "b"])).toEqual([
      { id: "c", orden: 2 },
      { id: "b", orden: 3 },
    ]);
    expect(cambiosDeOrden([{ id: "x", orden: 0 }, { id: "y", orden: 0 }], ["y", "x"])).toEqual([
      { id: "y", orden: 1 },
      { id: "x", orden: 2 },
    ]);
  });
});

describe("consultarSiguienteOrden", () => {
  it("pregunta a la base de datos (sin contar el propio elemento)", async () => {
    bd.filas = [
      { id: "p1", orden: "4" },
      { id: "p2", orden: "9" },
    ];
    expect(await consultarSiguienteOrden("Platos", "Entrantes", [])).toBe(10);
    expect(await consultarSiguienteOrden("Platos", "Entrantes", [], "p2")).toBe(5);
  });

  it("si la consulta falla, calcula con la caché de esa categoría", async () => {
    bd.errorSelect = { message: "sin red" };
    const cache = [
      { id: "a", categoria: "Entrantes", orden: "3" },
      { id: "b", categoria: "Postres", orden: "8" },
    ];
    expect(await consultarSiguienteOrden("Platos", "Entrantes", cache)).toBe(4);
  });
});

describe("guardarOrdenEnTabla", () => {
  it("escribe un UPDATE por elemento con el orden como número", async () => {
    await guardarOrdenEnTabla("Platos", [
      { id: "a", orden: 1 },
      { id: "b", orden: 2 },
    ]);
    expect(bd.updates).toEqual([
      { tabla: "Platos", dato: { orden: 1 }, id: "a" },
      { tabla: "Platos", dato: { orden: 2 }, id: "b" },
    ]);
  });

  it("lanza si alguna fila no se guarda (RLS: 0 filas afectadas) y dice cuántas", async () => {
    bd.fallarIds = new Set(["b"]);
    await expect(
      guardarOrdenEnTabla("Vinos", [
        { id: "a", orden: 1 },
        { id: "b", orden: 2 },
      ]),
    ).rejects.toThrow("1 de 2");
  });
});
