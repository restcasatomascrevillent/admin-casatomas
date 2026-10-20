/**
 * Hooks de Facturas › Productos (migración 20261007160000).
 *
 * Cubre: el periodo llega a las RPC y los numeric se convierten; las líneas
 * «sin clasificar» se piden con producto_id IS NULL y salen de la más reciente
 * a la más antigua; fusionar/asignar llaman a la RPC con sus argumentos e
 * invalidan Productos Y el listado de facturas (la etiqueta de categoría); un
 * 42501 se explica como falta de permiso; la IA con `ok:false` es un error; una
 * categoría que no se actualiza (RLS) no se da por guardada.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/components/facturas/__tests__/dobleSupabaseProductos");
  return { supabase: m.doble.supabase };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { toast } from "sonner";
import { doble, cargarDatos } from "@/components/facturas/__tests__/dobleSupabaseProductos";
import {
  useAsignarLineas,
  useClasificarConIA,
  useFusionarProductos,
  useGuardarCategoria,
  useLineasProducto,
  useResumenProductos,
} from "@/hooks/useProductosCatalogo";

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  const invalidar = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
  return { wrapper, invalidar };
}

beforeEach(() => {
  doble.reiniciar();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  cargarDatos();
});

describe("useResumenProductos", () => {
  it("manda el periodo y el tipo y convierte los numeric", async () => {
    const { wrapper } = montar();
    const { result } = renderHook(() => useResumenProductos({ desde: "2026-09-01", hasta: "2026-09-30", tipo: "factura" }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(doble.rpc).toHaveBeenCalledWith("productos_resumen", { p_desde: "2026-09-01", p_hasta: "2026-09-30", p_tipo: "factura" });
    expect(result.current.data?.[0]).toMatchObject({ producto_id: 10, gasto: 3022.2, cantidades: { ud: 36 }, ultimo_precio: 83.95 });
  });

  it("sin la migración, el error llega a la pantalla (no se reintenta)", async () => {
    doble.reiniciar();
    const { wrapper } = montar();
    const { result } = renderHook(() => useResumenProductos({ desde: null, hasta: null, tipo: null }), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as { code?: string }).code).toBe("PGRST202");
    expect(doble.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("useLineasProducto", () => {
  it("«sin» pide producto_id IS NULL y ordena por fecha del documento", async () => {
    doble.fijarTabla("productos_factura", {
      data: [
        { id: 1, nombre: "vieja", cantidad: "1", unidad: "ud", precio_unitario: null, total: null, producto_id: null, factura_id: 1, facturas: { fecha: "2025-12-01" } },
        { id: 2, nombre: "nueva", cantidad: "2", unidad: "kg", precio_unitario: "3.5", total: "7", producto_id: null, factura_id: 2, facturas: { fecha: "2026-10-01", proveedor: "X" } },
      ],
      error: null,
    });
    const { wrapper } = montar();
    const { result } = renderHook(() => useLineasProducto("sin"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(doble.filtros).toContainEqual({ tabla: "productos_factura", metodo: "is", args: ["producto_id", null] });
    expect(result.current.data?.map((l) => l.nombre)).toEqual(["nueva", "vieja"]);
    expect(result.current.data?.[0]).toMatchObject({ cantidad: 2, total: 7, precio_unitario: 3.5, proveedor: "X" });
  });

  it("null no consulta", () => {
    const { wrapper } = montar();
    renderHook(() => useLineasProducto(null), { wrapper });
    expect(doble.from).not.toHaveBeenCalled();
  });
});

describe("mutaciones", () => {
  it("fusionar llama a la RPC e invalida productos, facturas y albaranes", async () => {
    doble.fijarRpc("productos_fusionar", () => ({ data: { lineas_movidas: 3, productos_borrados: 1 }, error: null }));
    const { wrapper, invalidar } = montar();
    const { result } = renderHook(() => useFusionarProductos(), { wrapper });
    await act(() => result.current.mutateAsync({ origenIds: [11], destinoId: 10 }));
    expect(doble.rpc).toHaveBeenCalledWith("productos_fusionar", { p_origen_ids: [11], p_destino_id: 10 });
    const claves = invalidar.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey[0]);
    expect(claves).toEqual(expect.arrayContaining(["productos", "facturas", "albaranes"]));
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("3 línea(s) movidas"));
  });

  it("asignar a un producto nuevo; un 42501 se explica como falta de permiso", async () => {
    const args: Record<string, unknown>[] = [];
    doble.fijarRpc("productos_asignar_lineas", (a) => {
      args.push(a);
      return { data: null, error: { code: "42501", message: "Clasificar líneas exige permiso de edición en Facturas" } };
    });
    const { wrapper } = montar();
    const { result } = renderHook(() => useAsignarLineas(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ lineaIds: [2001], nombreNuevo: "Gamba roja", categoriaId: 5 }).catch(() => undefined);
    });
    expect(args[0]).toEqual({ p_linea_ids: [2001], p_producto_id: null, p_nombre_nuevo: "Gamba roja", p_categoria_id: 5 });
    expect(toast.error).toHaveBeenCalledWith("No se ha guardado", { description: "No tienes permiso de edición en Facturas." });
  });

  it("clasificar con IA: invoca la función y un ok:false es error", async () => {
    doble.invoke.mockResolvedValueOnce({ data: { ok: false, error: "OpenAI 500" }, error: null } as never);
    const { wrapper } = montar();
    const { result } = renderHook(() => useClasificarConIA(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync().catch(() => undefined);
    });
    expect(doble.invoke).toHaveBeenCalledWith("clasificar-productos", { body: {} });
    expect(toast.error).toHaveBeenCalledWith("No se ha guardado", { description: "OpenAI 500" });

    doble.invoke.mockResolvedValueOnce({ data: { ok: true, aplicado: { lineas_asignadas: 4, productos_creados: 2 } }, error: null } as never);
    await act(() => result.current.mutateAsync());
    expect(toast.success).toHaveBeenCalledWith("4 línea(s) clasificadas · 2 producto(s) nuevos");
  });

  it("una categoría que la RLS no deja actualizar no se da por guardada", async () => {
    doble.fijarTabla("categorias_producto", { data: [], error: null });
    const { wrapper } = montar();
    const { result } = renderHook(() => useGuardarCategoria(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 2, nombre: "Vinos y cavas" }).catch(() => undefined);
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });
});
