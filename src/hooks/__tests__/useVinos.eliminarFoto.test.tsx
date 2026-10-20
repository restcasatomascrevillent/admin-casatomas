/**
 * Regresión (auditoría 18/10/2026): eliminar un vino borraba su foto de
 * Storage ANTES de borrar la fila y sin mirar si otra ficha la usaba. En
 * producción la botella normal y la Magnum comparten foto (9 pares, p. ej.
 * «Vega Sicilia Valbuena 2018» y su Magnum): retirar la Magnum dejaba sin foto
 * a la botella normal en la web. Y si el borrado de la fila fallaba, la foto
 * ya no existía aunque el vino siguiera en la carta.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

type Fila = { id: string; nombre: string; imagen_url: string | null };
const mock = vi.hoisted(() => ({
  filas: [] as Fila[],
  llamadas: [] as string[],
  errorBorrado: null as null | { message: string },
  filasBorradas: undefined as undefined | { id: string }[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    from: (tabla: string) => {
      let operacion = "select";
      let excluido: string | undefined;
      let patron = "";
      let idBorrado: string | undefined;
      const consulta = {
        select: () => consulta,
        order: () => Promise.resolve({ data: mock.filas, error: null }),
        delete: () => { operacion = "delete"; return consulta; },
        eq: (_c: string, valor: string) => { idBorrado = valor; return consulta; },
        neq: (_c: string, valor: string) => { excluido = valor; return consulta; },
        like: (_c: string, valor: string) => { patron = valor.replace(/%/g, ""); return consulta; },
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
          if (operacion === "delete") {
            mock.llamadas.push(`borrar fila ${tabla} ${idBorrado}`);
            const respuesta = mock.errorBorrado
              ? { data: null, error: mock.errorBorrado }
              : { data: mock.filasBorradas ?? [{ id: idBorrado }], error: null };
            return Promise.resolve(respuesta).then(ok, ko);
          }
          mock.llamadas.push(`consultar uso ${tabla}`);
          const data = mock.filas.filter((f) => f.id !== excluido && (f.imagen_url ?? "").includes(patron));
          return Promise.resolve({ data, error: null }).then(ok, ko);
        },
      };
      return consulta;
    },
    storage: {
      from: (bucket: string) => ({
        remove: (rutas: string[]) => {
          mock.llamadas.push(`borrar foto ${bucket}/${rutas.join(",")}`);
          return Promise.resolve({ error: null });
        },
      }),
    },
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/rebuild-webs", () => ({ notificarGuardadoYPublicacion: vi.fn() }));

import { useVinos } from "@/hooks/useVinos";

const URL = "https://x.supabase.co/storage/v1/object/public/vinos";
const normal: Fila = { id: "normal", nombre: "Valbuena 2018", imagen_url: `${URL}/normal.webp?t=1` };
const magnum: Fila = { id: "magnum", nombre: "Valbuena 2018 (Magnum)", imagen_url: `${URL}/normal.webp?t=1` };
const solo: Fila = { id: "solo", nombre: "Pazo", imagen_url: `${URL}/solo.webp` };

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  return renderHook(() => useVinos(), { wrapper });
}

describe("Eliminar un vino y su foto", () => {
  beforeEach(() => {
    mock.filas = [normal, magnum, solo];
    mock.llamadas = [];
    mock.errorBorrado = null;
    mock.filasBorradas = undefined;
  });

  it("conserva la foto que comparte con otra ficha (botella normal y Magnum)", async () => {
    const { result } = montar();
    await waitFor(() => expect(result.current.vinos).toHaveLength(3));
    await act(async () => { await result.current.eliminarVino.mutateAsync("magnum"); });
    expect(mock.llamadas).toContain("borrar fila Vinos magnum");
    expect(mock.llamadas.some((l) => l.startsWith("borrar foto"))).toBe(false);
  });

  it("borra primero la fila y después su foto si nadie más la usa", async () => {
    const { result } = montar();
    await waitFor(() => expect(result.current.vinos).toHaveLength(3));
    await act(async () => { await result.current.eliminarVino.mutateAsync("solo"); });
    const fila = mock.llamadas.indexOf("borrar fila Vinos solo");
    const foto = mock.llamadas.indexOf("borrar foto vinos/solo.webp");
    expect(fila).toBeGreaterThanOrEqual(0);
    expect(foto).toBeGreaterThan(fila);
  });

  it("si no se puede borrar la fila, la foto sigue intacta", async () => {
    mock.errorBorrado = { message: "sin conexión" };
    const { result } = montar();
    await waitFor(() => expect(result.current.vinos).toHaveLength(3));
    await act(async () => { await expect(result.current.eliminarVino.mutateAsync("solo")).rejects.toBeTruthy(); });
    expect(mock.llamadas.some((l) => l.startsWith("borrar foto"))).toBe(false);
  });

  it("un borrado que no afecta a ninguna fila (permisos, ya no existe) no se da por hecho", async () => {
    mock.filasBorradas = [];
    const { result } = montar();
    await waitFor(() => expect(result.current.vinos).toHaveLength(3));
    await act(async () => { await expect(result.current.eliminarVino.mutateAsync("solo")).rejects.toThrow(/no se ha eliminado/i); });
    expect(mock.llamadas.some((l) => l.startsWith("borrar foto"))).toBe(false);
  });
});
