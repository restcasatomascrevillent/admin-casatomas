/**
 * Precio de compra en la tarjeta de vino (25/11/2026, dueño: «que aparte del precio en carta aparezca
 * en cada tarjeta el precio de compra con IVA; solo lo podrán ver los usuarios que tengan permiso a
 * editar la carta»). Sale de vinos_precio_compra (migración 20261222140000).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { Vino } from "@/hooks/useVinos";
import { normalizarPrecioCompra, type PrecioCompraVino } from "../precioCompraVino";

const h = vi.hoisted(() => ({ precios: new Map<string, unknown>(), pedido: [] as boolean[] }));
vi.mock("@/components/carta/usePreciosCompraVinos", () => ({
  usePreciosCompraVinos: (puedeEditar: boolean) => {
    h.pedido.push(puedeEditar);
    return puedeEditar ? h.precios : new Map();
  },
}));
vi.mock("@/components/carta/parker/usePuntuacionesParker", () => ({
  usePuntuacionesParker: () => ({
    filas: [], isLoading: false, porVino: () => [],
    guardar: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    confirmar: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    borrar: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
  }),
}));
const mutacion = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
vi.mock("@/hooks/useVinos", () => ({
  useVinos: () => ({
    eliminarVino: mutacion(), toggleExpanded: mutacion(), toggleRestaurante: mutacion(), toggleTouza: mutacion(),
    actualizarVino: mutacion(), categorias: [],
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { ListaVinos } from "../ListaVinos";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const vino = (p: Partial<Vino>) =>
  ({
    id: "v", nombre: "Albariño", categoria: "VINOS BLANCOS — RÍAS BAIXAS", precio_eur: 24, activado: true,
    expanded: false, restaurante: true, touza: false, imagen_url: null, imagen_posicion_y: 50, alergenos_oficiales: [],
    ubicacion_pais: "España", ubicacion_region: "Cambados, Pontevedra", ...p,
  }) as Vino;

const precio = (p: Record<string, unknown>) =>
  normalizarPrecioCompra({
    vino_id: "lagar", precio_compra: 11.45, precio_compra_iva: 13.85, coste_efectivo: 9.5417, coste_efectivo_iva: 11.55,
    iva_pct: 21, iva_origen: "linea", botellas_sin_cargo: 3, proveedor: "Distribuciones Guillén, S.L.", fecha: "2026-09-30",
    numero_documento: "002111F2", tipo_documento: "factura", estado: "bajo", iva_venta_pct: 10, multiplicador_min: 2.3, ...p,
  }) as PrecioCompraVino;

const tarjeta = (nombre: string) => screen.getByRole("heading", { name: nombre }).closest(".rounded-lg") as HTMLElement;

beforeEach(() => {
  h.precios = new Map([
    ["lagar", precio({})],
    ["arana", precio({ vino_id: "arana", precio_compra: 15, precio_compra_iva: 18.15, coste_efectivo: 15, coste_efectivo_iva: 18.15, botellas_sin_cargo: 0, estado: "bien" })],
  ]);
  h.pedido = [];
});

describe("Tarjeta de vino: precio de compra", () => {
  it("quien edita la carta ve «Compra» con IVA, el multiplicador y de qué factura sale", () => {
    render(
      <ListaVinos
        vinos={[
          vino({ id: "lagar", nombre: "Lagar de Cervera 2024", precio_eur: 21.9 }),
          vino({ id: "arana", nombre: "Viña Arana", precio_eur: 52 }),
          vino({ id: "sin", nombre: "Sin factura", precio_eur: 30 }),
        ]}
      />,
    );
    expect(h.pedido.every(Boolean)).toBe(true);
    const lagar = within(tarjeta("Lagar de Cervera 2024")).getByTestId("precio-compra-vino");
    expect(lagar).toHaveTextContent("Compra: 13,85 € (IVA incl.)");
    // 21,90 € → 19,91 sin IVA ÷ 9,5417 = 2,09×: por debajo de 2,3×, en rojo.
    expect(within(lagar).getByTestId("multiplicador-compra")).toHaveTextContent("2,09×");
    expect(within(lagar).getByTestId("multiplicador-compra").className).toContain("text-destructive");
    expect(lagar).toHaveTextContent("Con 3 sin cargo: 11,55 €");
    expect(lagar).toHaveTextContent("Distribuciones Guillén, S.L.");
    expect(lagar.getAttribute("title")).toMatch(/11,45 € sin IVA \+ 21 % de IVA = 13,85 €/);

    const arana = within(tarjeta("Viña Arana")).getByTestId("precio-compra-vino");
    expect(arana).toHaveTextContent("Compra: 18,15 € (IVA incl.)");
    expect(within(arana).getByTestId("multiplicador-compra")).toHaveTextContent("3,15×");
    expect(within(arana).getByTestId("multiplicador-compra").className).not.toContain("text-destructive");
    expect(arana).not.toHaveTextContent("sin cargo");

    // Sin precio de factura: nada.
    expect(within(tarjeta("Sin factura")).queryByTestId("precio-compra-vino")).not.toBeInTheDocument();
  });

  it("con solo «Ver» en la carta no se pide ni se enseña", () => {
    render(<ListaVinos vinos={[vino({ id: "lagar", nombre: "Lagar de Cervera 2024", precio_eur: 21.9 })]} soloLectura />);
    expect(h.pedido.every((p) => p === false)).toBe(true);
    expect(screen.queryByTestId("precio-compra-vino")).not.toBeInTheDocument();
    expect(screen.queryByText(/Compra:/)).not.toBeInTheDocument();
  });

  it("dato por revisar en Márgenes (otro formato): precio de compra sí, multiplicador no", () => {
    h.precios = new Map([["lagar", precio({ estado: "revisar" })]]);
    render(<ListaVinos vinos={[vino({ id: "lagar", nombre: "Lagar de Cervera 2024 (Magnum)", precio_eur: 39.5 })]} />);
    const p = screen.getByTestId("precio-compra-vino");
    expect(p).toHaveTextContent("Compra: 13,85 € (IVA incl.)");
    expect(screen.queryByTestId("multiplicador-compra")).not.toBeInTheDocument();
    expect(p.getAttribute("title")).toMatch(/por revisar/);
  });
});
