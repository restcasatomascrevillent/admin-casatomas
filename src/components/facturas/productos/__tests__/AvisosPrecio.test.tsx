/**
 * Facturas › Productos · umbral del aviso de subida de precio (migración
 * 20261007170000, tabla configuracion_facturas). Con el doble de Supabase de
 * dobleSupabaseProductos.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("../../__tests__/dobleSupabaseProductos");
  return { supabase: m.doble.supabase };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { doble } from "../../__tests__/dobleSupabaseProductos";
import { AvisosPrecio } from "../AvisosPrecio";

function montar(puedeEditar: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AvisosPrecio puedeEditar={puedeEditar} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  doble.reiniciar();
});

describe("AvisosPrecio", () => {
  it("sin la migración (sin fila de configuración) no pinta nada", async () => {
    const { container } = montar(true);
    await waitFor(() => expect(doble.from).toHaveBeenCalledWith("configuracion_facturas"));
    expect(container).toBeEmptyDOMElement();
  });

  it("enseña el umbral y lo guarda con coma decimal", async () => {
    doble.fijarTabla("configuracion_facturas", {
      data: { umbral_subida_precio_pct: "10.00", avisos_subida_precio: true },
      error: null,
    });
    montar(true);
    const boton = await screen.findByRole("button", { name: "Avisos de subida de precio" });
    expect(boton).toHaveTextContent("Avisos > 10 %");
    fireEvent.click(boton);
    const umbral = await screen.findByLabelText("Si sube más de");
    expect(umbral).toHaveValue("10");
    fireEvent.change(umbral, { target: { value: "12,5" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(doble.filtros).toContainEqual({
        tabla: "configuracion_facturas",
        metodo: "update",
        args: [{ umbral_subida_precio_pct: 12.5, avisos_subida_precio: true }],
      }),
    );
  });

  it("un umbral no válido no se puede guardar", async () => {
    doble.fijarTabla("configuracion_facturas", {
      data: { umbral_subida_precio_pct: 10, avisos_subida_precio: true },
      error: null,
    });
    montar(true);
    fireEvent.click(await screen.findByRole("button", { name: "Avisos de subida de precio" }));
    fireEvent.change(await screen.findByLabelText("Si sube más de"), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
  });

  it("sin permiso de edición se ve pero no se cambia", async () => {
    doble.fijarTabla("configuracion_facturas", {
      data: { umbral_subida_precio_pct: 15, avisos_subida_precio: false },
      error: null,
    });
    montar(false);
    const boton = await screen.findByRole("button", { name: "Avisos de subida de precio" });
    expect(boton).toHaveTextContent("Avisos de precio: no");
    fireEvent.click(boton);
    expect(await screen.findByLabelText("Si sube más de")).toBeDisabled();
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Guardar" })).not.toBeInTheDocument();
  });
});
