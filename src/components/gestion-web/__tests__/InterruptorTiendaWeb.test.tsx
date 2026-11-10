/**
 * Gestor Web › Tienda (10/11/2026, petición del dueño): el interruptor que
 * enciende o apaga la sección «Tienda» de la web. Cambia SOLO
 * `configuracion_tienda.activa` (la misma columna que Tienda › Ajustes), con un
 * Supabase falso en memoria que imita la RLS de la migración 20261103150000.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Fila = Record<string, unknown>;
const h = vi.hoisted(() => ({
  puedeEditar: true,
  bdDejaEditar: true,
  sinMigracion: false,
  config: {} as Fila,
  updates: [] as Fila[],
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: h.toast }));
// «Ver» en Tienda siempre (sin él no sale la pestaña); «Puede editar» según `h.puedeEditar`.
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: (_seccion: string, tipo: string = "view") => ({ canAccess: tipo === "view" || h.puedeEditar, loading: false }),
}));
vi.mock("@/integrations/supabase/client", () => {
  const resolver = (e: { op: string; payload?: Fila }) => {
    if (h.sinMigracion) return { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.configuracion_tienda' in the schema cache" } };
    if (e.op === "update") {
      h.updates.push(e.payload as Fila);
      // La RLS no da error: sin permiso no actualiza ninguna fila.
      if (!h.bdDejaEditar) return { data: [], error: null };
      h.config = { ...h.config, ...e.payload, updated_at: "2026-11-10T12:00:00Z" };
      return { data: [h.config], error: null };
    }
    return { data: h.config, error: null };
  };
  const desde = () => {
    const e: { op: string; payload?: Fila } = { op: "select" };
    const b: Record<string, unknown> = {
      select: () => b,
      update: (p: Fila) => { e.op = "update"; e.payload = p; return b; },
      eq: () => b,
      maybeSingle: async () => resolver(e),
      then: (ok: (r: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(resolver(e)).then(ok, ko),
    };
    return b;
  };
  return { supabase: { from: desde } };
});

import { InterruptorTiendaWeb } from "../InterruptorTiendaWeb";

const NOMBRE = "Mostrar «Tienda» en la web de Casa Tomás";

function pintar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter><InterruptorTiendaWeb /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.puedeEditar = true;
  h.bdDejaEditar = true;
  h.sinMigracion = false;
  h.config = { id: true, activa: true, descuento_pct: 30, vinos_excluidos: ["v9"], aviso: "Aviso", recogida: "En la barra", updated_at: null };
  h.updates = [];
  h.toast.success.mockClear();
  h.toast.error.mockClear();
});

describe("Gestor Web › Tienda: interruptor de la tienda en la web", () => {
  it("enseña si la tienda está visible y la apaga cambiando SOLO `activa`", async () => {
    pintar();
    const interruptor = await screen.findByRole("switch", { name: NOMBRE });
    await waitFor(() => expect(interruptor).toBeEnabled());
    expect(interruptor).toBeChecked();

    fireEvent.click(interruptor);

    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith("Tienda oculta en la web"));
    // Ni el descuento, ni los textos, ni los vinos excluidos: no pisa lo que otra persona edite en Ajustes.
    expect(h.updates).toEqual([{ activa: false }]);
    expect(screen.getByRole("switch", { name: NOMBRE })).not.toBeChecked();
    expect(h.config).toMatchObject({ activa: false, descuento_pct: 30, vinos_excluidos: ["v9"], aviso: "Aviso" });
  });

  it("la enciende si estaba apagada", async () => {
    h.config.activa = false;
    pintar();
    const interruptor = await screen.findByRole("switch", { name: NOMBRE });
    await waitFor(() => expect(interruptor).toBeEnabled());
    expect(interruptor).not.toBeChecked();

    fireEvent.click(interruptor);

    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith("Tienda visible en la web"));
    expect(h.updates).toEqual([{ activa: true }]);
  });

  it("si la base de datos no lo guarda (RLS), vuelve a como estaba y lo dice", async () => {
    h.bdDejaEditar = false;
    pintar();
    const interruptor = await screen.findByRole("switch", { name: NOMBRE });
    await waitFor(() => expect(interruptor).toBeEnabled());

    fireEvent.click(interruptor);

    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith("No se pudo cambiar la tienda en la web", {
        description: "No se ha guardado: tu usuario no tiene permiso para cambiar la tienda.",
      }),
    );
    await waitFor(() => expect(screen.getByRole("switch", { name: NOMBRE })).toBeChecked());
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it("con «Ver» pero sin «Editar» no hay interruptor: el estado y la etiqueta «Solo lectura»", async () => {
    h.puedeEditar = false;
    pintar();
    expect(await screen.findByText("Visible")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByTestId("etiqueta-solo-lectura")).toBeInTheDocument();
  });

  it("sin la migración de la tienda lo avisa y no deja tocar el interruptor", async () => {
    h.sinMigracion = true;
    pintar();
    expect(await screen.findByText("Falta aplicar la actualización de la tienda en la base de datos.")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: NOMBRE })).toBeDisabled();
  });

  it("lleva a la sección Tienda para los vinos, el descuento y los textos", async () => {
    pintar();
    expect(await screen.findByRole("link", { name: "Vinos a la venta, descuento y textos de la tienda" })).toHaveAttribute("href", "/tienda");
  });
});
