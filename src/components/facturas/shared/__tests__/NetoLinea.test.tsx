/**
 * Coste real (neto) de cada línea: el neto es la cifra principal y lo impreso
 * queda como desglose (gris y tachado).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { FilaProducto } from "../FilaProducto";
import { desgloseNeto, difiereNeto, textoNetoImpreso } from "../formatters";
import { aResumen } from "@/lib/facturas/productos";
import type { ProductoFactura } from "@/hooks/useFacturas";

const linea = (extra: Partial<ProductoFactura> = {}): ProductoFactura => ({
  id: 1, producto_nombre: "SOLOMILLO", precio: 41.56, cantidad: 2, unidad: "kg", proveedor: null, precio_unitario: 20.78, ...extra,
});

const pintar = (p: ProductoFactura, isMobile: boolean) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      {isMobile ? (
        <FilaProducto p={p} isMobile />
      ) : (
        <table>
          <tbody>
            <FilaProducto p={p} />
          </tbody>
        </table>
      )}
    </QueryClientProvider>,
  );

describe.each([
  ["móvil", true],
  ["escritorio", false],
])("FilaProducto con importe_neto (%s)", (_n, isMobile) => {
  it("neto distinto del impreso: Neto como cifra principal, impreso tachado y descuento", () => {
    pintar(linea({ importe_neto: 24.97 }), isMobile);
    expect(screen.getByText("Neto 24,97 €")).toBeInTheDocument();
    const impreso = screen.getByText("41,56 €");
    expect(impreso).toHaveClass("line-through");
    expect(screen.getByText(/−16,59 € de descuento/)).toBeInTheDocument();
  });

  it("línea de descuento ya repartida: gris y con su nota", () => {
    pintar(linea({ precio: -10, precio_unitario: -10, cantidad: 1, importe_neto: 0 }), isMobile);
    expect(screen.getByText("descuento repartido en sus productos")).toBeInTheDocument();
    expect(screen.queryByText(/Neto/)).toBeNull();
  });

  it("neto 0 con importe impreso: regalo / 100 % de descuento", () => {
    pintar(linea({ importe_neto: 0 }), isMobile);
    expect(screen.getByText("Regalo / 100 % de descuento")).toBeInTheDocument();
  });

  it("sin neto o igual al impreso: nada extra", () => {
    const a = pintar(linea(), isMobile);
    expect(screen.queryByText(/Neto|de descuento/)).toBeNull();
    a.unmount();
    pintar(linea({ importe_neto: 41.56 }), isMobile);
    expect(screen.queryByText(/Neto|de descuento/)).toBeNull();
  });
});

describe("desglose neto / impreso", () => {
  it("desgloseNeto", () => {
    expect(desgloseNeto({ precio: 10 })).toBeNull();
    expect(desgloseNeto({ precio: 10, importe_neto: 10 })).toBeNull();
    expect(desgloseNeto({ precio: -5, importe_neto: 0 })).toEqual({ tipo: "repartido" });
    expect(desgloseNeto({ precio: 5, importe_neto: 0 })).toEqual({ tipo: "regalo" });
    expect(desgloseNeto({ precio: 41.56, importe_neto: 24.97 })).toMatchObject({ tipo: "descuento", neto: 24.97 });
  });

  it("difiereNeto exige más de 1 céntimo", () => {
    expect(difiereNeto(25.02, 41.85)).toBe(true);
    expect(difiereNeto(25.02, 25.025)).toBe(false);
    expect(difiereNeto(25, null)).toBe(false);
    expect(textoNetoImpreso(25.02, 41.85)).toMatch(/^25,02\s€ neto · 41,85\s€ impreso$/);
  });

  it("aResumen lee las columnas nuevas y, sin ellas, toma el neto como impreso", () => {
    const base = { producto_id: 1, nombre: "X", gasto: "10013", ultimo_precio: "25.02" };
    expect(aResumen({ ...base, gasto_impreso: "16394", ultimo_precio_impreso: "41.85" })).toMatchObject({ gasto_impreso: 16394, ultimo_precio_impreso: 41.85 });
    expect(aResumen(base)).toMatchObject({ gasto_impreso: 10013, ultimo_precio_impreso: 25.02 });
  });
});
