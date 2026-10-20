/**
 * Facturas › Productos (pantalla). Con el doble de Supabase de
 * dobleSupabaseProductos.ts (datos de la carga inicial del 07/10/2026).
 *
 * Cubre: lista con categoría, compras, cantidades y gasto; totales por
 * categoría madre (Bebidas = Vinos + Licores); buscar y filtrar con las
 * tarjetas; seleccionar dos y fusionar (queda el de más gasto); «Sin
 * clasificar» enseña las líneas sin producto; sin permiso de edición no hay
 * casillas ni botones; sin la migración, un aviso claro en vez de la lista.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("./dobleSupabaseProductos");
  return { supabase: m.doble.supabase };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
const permiso = vi.hoisted(() => ({ editar: true }));
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: () => ({ canAccess: permiso.editar, loading: false }),
}));

import { doble, cargarDatos } from "./dobleSupabaseProductos";
import { TabProductos } from "../productos/TabProductos";

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <div style={{ height: 800 }}>
        <TabProductos />
      </div>
    </QueryClientProvider>,
  );
}

const lista = () => screen.getByTestId("lista-productos");
const nombresVisibles = () =>
  within(lista())
    .queryAllByRole("listitem")
    .map((li) => li.querySelector("button span span")?.textContent)
    .filter(Boolean);

beforeEach(() => {
  doble.reiniciar();
  permiso.editar = true;
  cargarDatos();
});

describe("TabProductos", () => {
  it("lista los productos con categoría y los totales por categoría madre", async () => {
    montar();
    expect(await screen.findByText("Flor de Pingus")).toBeInTheDocument();
    expect(nombresVisibles()).toEqual([
      "Flor de Pingus", "Centolla hembra 1-1,5 kg", "Tanqueray 70 cl", "Flor de Pingus Magnum", "Portes",
    ]);
    // Ruta de categoría bajo el nombre.
    expect(within(lista()).getAllByText(/Bebidas › Vinos/).length).toBe(2);
    // Tarjetas: Bebidas suma Vinos + Licores; «Sin clasificar» con su nº de líneas.
    const tarjetas = screen.getByRole("toolbar", { name: "Gasto por categoría" });
    const bebidas = within(tarjetas).getByRole("button", { name: /Bebidas/ });
    expect(bebidas.textContent?.replace(/\s/g, " ")).toMatch(/3\.?483,20/);
    expect(within(tarjetas).getByRole("button", { name: /Sin clasificar/ }).textContent).toMatch(/1 línea/);
    // Botón de la IA con las líneas pendientes.
    expect(screen.getByRole("button", { name: "Clasificar 1 con IA" })).toBeInTheDocument();
  });

  it("buscar y filtrar por tarjeta de categoría", async () => {
    montar();
    await screen.findByText("Flor de Pingus");
    fireEvent.change(screen.getByLabelText("Buscar producto"), { target: { value: "pingús" } });
    expect(nombresVisibles()).toEqual(["Flor de Pingus", "Flor de Pingus Magnum"]);
    fireEvent.change(screen.getByLabelText("Buscar producto"), { target: { value: "" } });
    fireEvent.click(within(screen.getByRole("toolbar", { name: "Gasto por categoría" })).getByRole("button", { name: /Pescado y marisco/ }));
    expect(nombresVisibles()).toEqual(["Centolla hembra 1-1,5 kg"]);
  });

  it("seleccionar dos y fusionar: queda el de más gasto", async () => {
    doble.fijarRpc("productos_fusionar", () => ({ data: { lineas_movidas: 1, productos_borrados: 1 }, error: null }));
    montar();
    await screen.findByText("Flor de Pingus");
    fireEvent.click(screen.getByRole("checkbox", { name: "Seleccionar Flor de Pingus Magnum" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Seleccionar Flor de Pingus" }));
    fireEvent.click(screen.getByRole("button", { name: /Fusionar/ }));
    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText(/Queda «Flor de Pingus»/)).toBeInTheDocument();
    fireEvent.click(within(dialogo).getByRole("button", { name: /Fusionar/ }));
    await waitFor(() =>
      expect(doble.rpc).toHaveBeenCalledWith("productos_fusionar", { p_origen_ids: [11], p_destino_id: 10 }),
    );
  });

  it("«Sin clasificar» enseña las líneas sin producto", async () => {
    montar();
    await screen.findByText("Flor de Pingus");
    fireEvent.click(within(screen.getByRole("toolbar", { name: "Gasto por categoría" })).getByRole("button", { name: /Sin clasificar/ }));
    expect(await screen.findByText("Gambas rojas extra")).toBeInTheDocument();
    expect(doble.filtros).toContainEqual({ tabla: "productos_factura", metodo: "is", args: ["producto_id", null] });
    expect(screen.getByRole("button", { name: "Clasificar con IA ahora" })).toBeInTheDocument();
  });

  it("abrir un producto enseña su ficha", async () => {
    montar();
    fireEvent.click(await screen.findByText("Tanqueray 70 cl"));
    const ficha = await screen.findByRole("dialog");
    expect(within(ficha).getByText(/Bebidas › Licores y destilados · 2 compra/)).toBeInTheDocument();
    expect(within(ficha).getByLabelText("Nombre")).toHaveValue("Tanqueray 70 cl");
  });

  it("sin permiso de edición: ni casillas ni botones de cambio", async () => {
    permiso.editar = false;
    montar();
    await screen.findByText("Flor de Pingus");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Categorías/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /con IA/ })).not.toBeInTheDocument();
  });

  it("sin la migración aplicada, lo dice en vez de enseñar una lista vacía", async () => {
    doble.reiniciar();
    montar();
    expect(await screen.findByText("El catálogo de productos aún no está activado")).toBeInTheDocument();
    expect(screen.getByText(/20261007160000_productos_catalogo_categorias/)).toBeInTheDocument();
  });
});
