// Vinos y bebidas de la carta para el maridaje y la cata (historia 4093221d,
// E5 y R7): columnas mínimas, solo lo que está «en la carta» (activado AND
// restaurante) y con nombre, Vinos por lotes si pasa de 1000 filas, y caché
// compartida sin consultas de más.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

type Fila = Record<string, unknown>;
interface Consulta {
  tabla: string;
  columnas?: string;
  opciones?: { count?: string };
  eq: Array<[string, unknown]>;
  order: string[];
  range?: [number, number];
}

const estado = vi.hoisted(() => ({
  filas: { Vinos: [] as Fila[], Bebidas: [] as Fila[] } as Record<string, Fila[]>,
  consultas: [] as Consulta[],
  error: null as null | { message: string },
}));

// Supabase simulado: aplica los `eq`, el `range` y el tope de 1000 filas de PostgREST.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabla: string) => {
      const consulta: Consulta = { tabla, eq: [], order: [] };
      estado.consultas.push(consulta);
      const responder = () => {
        if (estado.error) return { data: null, error: estado.error, count: null };
        const filtradas = (estado.filas[tabla] ?? []).filter((fila) =>
          consulta.eq.every(([columna, valor]) => fila[columna] === valor),
        );
        const desde = consulta.range?.[0] ?? 0;
        const hasta = consulta.range ? consulta.range[1] + 1 : filtradas.length;
        return {
          data: filtradas.slice(desde, hasta).slice(0, 1000),
          error: null,
          count: consulta.opciones?.count === "exact" ? filtradas.length : null,
        };
      };
      const q = {
        select: (columnas: string, opciones?: { count?: string }) => {
          consulta.columnas = columnas;
          consulta.opciones = opciones;
          return q;
        },
        eq: (columna: string, valor: unknown) => {
          consulta.eq.push([columna, valor]);
          return q;
        },
        order: (columna: string) => {
          consulta.order.push(columna);
          return q;
        },
        range: (primera: number, ultima: number) => {
          consulta.range = [primera, ultima];
          return q;
        },
        abortSignal: () => q,
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(responder()).then(ok, ko),
      };
      return q;
    },
  },
}));

import { COLUMNAS_BEBIDAS, COLUMNAS_VINOS, useBebidasParaMenu } from "@/hooks/useBebidasParaMenu";

const vino = (id: string, extra: Fila = {}): Fila => ({
  id,
  nombre: `Vino ${id}`,
  nombre_en: null,
  nombre_fr: null,
  categoria: "TINTOS",
  alergenos_oficiales: ["sulfitos"],
  activado: true,
  restaurante: true,
  ...extra,
});
const bebida = (id: string, extra: Fila = {}): Fila => ({
  id,
  nombre: `Bebida ${id}`,
  nombre_en: null,
  nombre_fr: null,
  categoria: "Licores",
  activado: true,
  restaurante: true,
  ...extra,
});

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}

const consultasA = (tabla: string) => estado.consultas.filter((c) => c.tabla === tabla);

beforeEach(() => {
  estado.filas = { Vinos: [], Bebidas: [] };
  estado.consultas = [];
  estado.error = null;
});

describe("useBebidasParaMenu", () => {
  it("pide solo las columnas mínimas y lo que está en la carta, sin filas sin nombre", async () => {
    estado.filas.Vinos = [
      vino("v1", { nombre: "Fondillón", nombre_en: "Fondillon" }),
      vino("v-apagado", { activado: false }),
      vino("v-touza", { restaurante: false }),
      vino("v-sin-nombre", { nombre: "  " }),
    ];
    estado.filas.Bebidas = [bebida("b1", { nombre: "Whisky de malta 12 años" }), bebida("b-apagada", { activado: null })];

    const { wrapper } = montar();
    const { result } = renderHook(() => useBebidasParaMenu(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.vinos.map((v) => v.id)).toEqual(["v1"]);
    expect(result.current.vinos[0]).toMatchObject({ nombre: "Fondillón", nombre_en: "Fondillon" });
    expect(result.current.bebidas.map((b) => b.id)).toEqual(["b1"]);
    expect(result.current.truncado).toBe(false);

    const [consultaVinos] = consultasA("Vinos");
    expect(consultaVinos.columnas).toBe(COLUMNAS_VINOS);
    expect(COLUMNAS_VINOS).toBe("id, nombre, nombre_en, nombre_fr, categoria, alergenos_oficiales, activado, restaurante");
    expect(consultaVinos.eq).toEqual([
      ["activado", true],
      ["restaurante", true],
    ]);
    // Orden total (el id desempata) para poder leer por lotes sin saltos.
    expect(consultaVinos.order).toEqual(["orden", "id"]);

    const [consultaBebidas] = consultasA("Bebidas");
    expect(consultaBebidas.columnas).toBe(COLUMNAS_BEBIDAS);
    expect(COLUMNAS_BEBIDAS).not.toContain("alergenos");
    expect(consultaBebidas.eq).toEqual([
      ["activado", true],
      ["restaurante", true],
    ]);
  });

  it("con menos de 1000 vinos hace una sola consulta a cada tabla", async () => {
    estado.filas.Vinos = Array.from({ length: 999 }, (_, i) => vino(`v${String(i).padStart(4, "0")}`));
    const { wrapper } = montar();
    const { result } = renderHook(() => useBebidasParaMenu(), { wrapper });
    await waitFor(() => expect(result.current.vinos).toHaveLength(999));
    expect(consultasA("Vinos")).toHaveLength(1);
    expect(consultasA("Bebidas")).toHaveLength(1);
  });

  it("si Vinos pasa de 1000 filas, las lee por lotes y no pierde ninguna", async () => {
    estado.filas.Vinos = Array.from({ length: 1500 }, (_, i) => vino(`v${String(i).padStart(4, "0")}`));
    const { wrapper } = montar();
    const { result } = renderHook(() => useBebidasParaMenu(), { wrapper });
    await waitFor(() => expect(result.current.vinos).toHaveLength(1500));

    expect(consultasA("Vinos").map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1499],
    ]);
    // El recuento solo se pide en el primer lote.
    expect(consultasA("Vinos").map((c) => c.opciones?.count ?? null)).toEqual(["exact", null]);
    expect(new Set(result.current.vinos.map((v) => v.id)).size).toBe(1500);
  });

  it("comparte la caché: dos editores montados no repiten las consultas", async () => {
    estado.filas.Vinos = [vino("v1")];
    estado.filas.Bebidas = [bebida("b1")];
    const { wrapper } = montar();
    const primero = renderHook(() => [useBebidasParaMenu(), useBebidasParaMenu()], { wrapper });
    await waitFor(() => expect(primero.result.current[1].vinos).toHaveLength(1));

    const segundo = renderHook(() => useBebidasParaMenu(), { wrapper });
    expect(segundo.result.current.bebidas).toHaveLength(1);
    expect(consultasA("Vinos")).toHaveLength(1);
    expect(consultasA("Bebidas")).toHaveLength(1);
  });

  it("deshabilitado no consulta nada ni dice que está cargando", () => {
    const { wrapper } = montar();
    const { result } = renderHook(() => useBebidasParaMenu(false), { wrapper });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.vinos).toEqual([]);
    expect(estado.consultas).toHaveLength(0);
  });

  it("si la carta no se puede leer, devuelve el error y listas vacías", async () => {
    estado.error = { message: "permission denied for table Vinos" };
    const { wrapper } = montar();
    const { result } = renderHook(() => useBebidasParaMenu(), { wrapper });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.vinos).toEqual([]);
    expect(result.current.bebidas).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });
});
