/**
 * Etiqueta de categoría en cada línea de la vista de factura (solo lectura; se
 * cambia en Facturas › Productos).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { EtiquetaCategoria, FilaProducto } from "../FilaProducto";
import type { ProductoFactura } from "@/hooks/useFacturas";

const linea = (extra: Partial<ProductoFactura> = {}): ProductoFactura => ({
  id: 1, producto_nombre: "NATOP (20% nata animal de 35mg) 2 L -Debic-", precio: 99.46, cantidad: 24, unidad: "kg",
  proveedor: null, precio_unitario: 4.14, ...extra,
});

describe("EtiquetaCategoria", () => {
  it("enseña la subcategoría con la ruta y el producto canónico de título", () => {
    render(<EtiquetaCategoria p={linea({ categoria: { nombre: "Vinos", ruta: "Bebidas › Vinos" }, producto_canonico: "Flor de Pingus" })} />);
    expect(screen.getByText("Vinos")).toHaveAttribute("title", "Bebidas › Vinos · Flor de Pingus");
  });

  it("sin categoría no pinta nada", () => {
    const { container } = render(<EtiquetaCategoria p={linea()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("sale en la fila de la factura (móvil)", () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <FilaProducto p={linea({ categoria: { nombre: "Lácteos y huevos", ruta: "Lácteos y huevos" } })} isMobile allDocs={[]} />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Lácteos y huevos")).toBeInTheDocument();
  });
});
