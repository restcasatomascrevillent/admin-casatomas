import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: h.rpc } }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { AvisosAbreviaturas } from "../AvisosAbreviaturas";

const aviso = {
  id: "a1", proveedor_id: 1, proveedor: "Bodegas de Lujo", abreviatura: "lp", propuesta: "Laurent-Perrier",
  texto_linea: "c/6b lp la cuvee 0,75l", producto_id: 7, producto: "La Cuvée 75 cl", created_at: "2026-11-17T10:00:00Z",
};
const montar = (puedeEditar = true) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AvisosAbreviaturas puedeEditar={puedeEditar} />
    </QueryClientProvider>,
  );

describe("AvisosAbreviaturas (pantalla de subida)", () => {
  beforeEach(() => {
    h.rpc.mockReset();
    h.rpc.mockImplementation(async (nombre: string) =>
      nombre === "abreviaturas_avisos_pendientes" ? { data: [aviso], error: null } : { data: { estado: "confirmada", producto_renombrado: true, nombre_producto: "Laurent-Perrier La Cuvée 75 cl" }, error: null });
  });

  it("muestra «LP parece Laurent-Perrier. ¿Confirmar?» con proveedor, línea y producto", async () => {
    montar();
    expect(await screen.findByText("«LP» parece Laurent-Perrier. ¿Confirmar?")).toBeInTheDocument();
    expect(screen.getByText(/Bodegas de Lujo · línea «c\/6b lp la cuvee 0,75l» · producto «La Cuvée 75 cl»/)).toBeInTheDocument();
  });

  it("Confirmar llama a la RPC con 'confirmar'", async () => {
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar LP = Laurent-Perrier/ }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("abreviaturas_resolver", { p_aviso: "a1", p_accion: "confirmar", p_expansion: null }));
  });

  it("Corregir pide la marca y la guarda como la escribe la persona", async () => {
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Corregir LP" }));
    const campo = screen.getByLabelText("Marca completa de LP");
    fireEvent.change(campo, { target: { value: "Laurent Perrier Champagne" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("abreviaturas_resolver", { p_aviso: "a1", p_accion: "corregir", p_expansion: "Laurent Perrier Champagne" }));
  });

  it("«No es» la descarta", async () => {
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "LP no es una abreviatura" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("abreviaturas_resolver", expect.objectContaining({ p_accion: "descartar" })));
  });

  it("sin permiso de edición no pregunta nada ni pinta nada", async () => {
    const { container } = montar(false);
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("si la RPC no existe todavía (sin migración) no pinta nada", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    const { container } = montar();
    await waitFor(() => expect(h.rpc).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
