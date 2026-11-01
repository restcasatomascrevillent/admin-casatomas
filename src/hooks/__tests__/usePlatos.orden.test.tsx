import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Platos en BD con `orden` TEXTO (como antes de la migración): "10" va
// alfabéticamente antes que "2", y el panel tiene que ordenarlos por número.
const bd = vi.hoisted(() => ({
  filas: [] as Record<string, unknown>[],
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/rebuild-webs", () => ({ notificarGuardadoYPublicacion: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn(async () => ({ data: { ok: true, translations: {} }, error: null })) },
    from: () => {
      const filtros: [string, unknown][] = [];
      let columnas = "*";
      let pendiente: { tipo: "insert" | "update"; dato: unknown } | null = null;
      const resultado = () => {
        if (pendiente?.tipo === "update") {
          bd.update(pendiente.dato, Object.fromEntries(filtros));
          return { data: [{ id: filtros[0]?.[1] }], error: null };
        }
        const filas = bd.filas
          .filter((f) => filtros.every(([c, v]) => f[c] === v))
          // Orden de texto, como Postgres con una columna text.
          .sort((a, b) => String(a.orden).localeCompare(String(b.orden)) || String(a.id).localeCompare(String(b.id)));
        return {
          data: columnas === "*" ? filas : filas.map((f) => ({ id: f.id, orden: f.orden })),
          error: null,
        };
      };
      const q = {
        select: (c = "*") => {
          if (!pendiente) columnas = c;
          return q;
        },
        order: () => q,
        eq: (c: string, v: unknown) => {
          filtros.push([c, v]);
          return q;
        },
        insert: (dato: unknown) => {
          bd.insert(dato);
          pendiente = { tipo: "insert", dato };
          return q;
        },
        update: (dato: unknown) => {
          pendiente = { tipo: "update", dato };
          return q;
        },
        single: async () => {
          if (pendiente?.tipo === "update") resultado();
          return { data: { id: "nuevo" }, error: null };
        },
        then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resultado()).then(ok, ko),
      };
      return q;
    },
  },
}));

import { usePlatos } from "../usePlatos";
import { notificarGuardadoYPublicacion } from "@/lib/rebuild-webs";

function preparar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return renderHook(() => usePlatos(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  bd.filas = [
    { id: "p1", nombre: "Croquetas", categoria: "Entrantes", orden: "10" },
    { id: "p2", nombre: "Gilda", categoria: "Entrantes", orden: "2" },
    { id: "p3", nombre: "Ensaladilla", categoria: "Entrantes", orden: "1" },
    { id: "p4", nombre: "Torrija", categoria: "Postres", orden: "0" },
    { id: "p5", nombre: "Arroz", categoria: "Arroces", orden: "0" },
  ];
});

describe("Orden de los platos dentro de su categoría", () => {
  it("ordena por número aunque la BD lo devuelva como texto, y las categorías van en orden alfabético", async () => {
    const { result } = preparar();
    await waitFor(() => expect(result.current.platos).toBeDefined());
    const entrantes = result.current.platos!.filter((p) => p.categoria === "Entrantes").map((p) => p.nombre);
    expect(entrantes).toEqual(["Ensaladilla", "Gilda", "Croquetas"]);
    expect(result.current.categorias).toEqual(["Arroces", "Entrantes", "Postres"]);
  });

  it("un plato nuevo va al final de su categoría (mayor orden + 1, como número)", async () => {
    const { result } = preparar();
    await waitFor(() => expect(result.current.platos).toBeDefined());
    await act(async () => {
      await result.current.crearPlato.mutateAsync({
        nombre: "Patatas bravas",
        categoria: "Entrantes",
        precio_eur: 6,
        alergenos_oficiales: ["Sin alérgenos declarados"],
      });
    });
    expect(bd.insert).toHaveBeenCalledWith([expect.objectContaining({ categoria: "Entrantes", orden: 11 })]);
  });

  it("guardarOrden escribe 1, 2, 3… solo en los que cambian y republica la web", async () => {
    const { result } = preparar();
    await waitFor(() => expect(result.current.platos).toBeDefined());
    await act(async () => {
      await result.current.guardarOrden.mutateAsync({ categoria: "Entrantes", idsEnOrden: ["p1", "p3", "p2"] });
    });
    // p1: 10 → 1, p3: 1 → 2, p2: 2 → 3 (los tres cambian).
    expect(bd.update.mock.calls).toEqual([
      [{ orden: 1 }, { id: "p1" }],
      [{ orden: 2 }, { id: "p3" }],
      [{ orden: 3 }, { id: "p2" }],
    ]);
    await waitFor(() =>
      expect(notificarGuardadoYPublicacion).toHaveBeenCalledWith("plato", "Orden de «Entrantes» guardado"),
    );
  });

  it("guardarOrden no escribe nada si el orden no cambia", async () => {
    const { result } = preparar();
    await waitFor(() => expect(result.current.platos).toBeDefined());
    await act(async () => {
      await result.current.guardarOrden.mutateAsync({ categoria: "Entrantes", idsEnOrden: ["p3", "p2", "p1"] });
    });
    // p3 ya es 1 y p2 ya es 2; solo p1 (10 → 3).
    expect(bd.update.mock.calls).toEqual([[{ orden: 3 }, { id: "p1" }]]);
  });

  it("al cambiar de categoría, el plato pasa al final de la nueva", async () => {
    const { result } = preparar();
    await waitFor(() => expect(result.current.platos).toBeDefined());
    await act(async () => {
      await result.current.actualizarPlato.mutateAsync({ id: "p4", categoria: "Entrantes" });
    });
    expect(bd.update).toHaveBeenCalledWith(expect.objectContaining({ categoria: "Entrantes", orden: 11 }), { id: "p4" });
  });

  it("ya no expone «expandir/contraer todos»", () => {
    const { result } = preparar();
    expect(result.current).not.toHaveProperty("expandirTodos");
    expect(result.current).not.toHaveProperty("contraerTodos");
  });
});
