import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { normalizarMargenes } from "@/lib/analisis/margenesCarta";

const mutacion = () => ({ mutate: vi.fn(), isPending: false });
const edicion = { escandallo: mutacion(), vino: mutacion(), revisado: mutacion(), config: mutacion() };
let estado: { isLoading: boolean; isError: boolean; data: unknown; error: unknown; refetch: () => void };

vi.mock("@/hooks/useMargenesCarta", () => ({
  useMargenesCarta: () => estado,
  useEdicionMargenes: () => edicion,
  useBuscarProductos: () => ({ data: [], isFetching: false }),
  useComprasProducto: () => ({ data: [], isLoading: false, isError: false }),
}));

import { MargenesCarta } from "../MargenesCarta";

const DATOS = normalizarMargenes({
  config: { coste_max_plato_pct: 35, multiplicador_min_vino: 2.5, subida_coste_pct: 10, iva_pct: 10, dias_referencia: 90 },
  resumen: {
    platos: { total: 2, con_datos: 2, food_cost_medio: 44.4, food_cost_mediana: 44.4, en_rojo: 1, sube_coste: 0, sin_datos: 0 },
    vinos: { total: 1, con_datos: 1, multiplicador_medio: 1.37, multiplicador_mediana: 1.37, en_rojo: 1, sube_coste: 0, sin_datos: 0 },
  },
  platos: [
    {
      id: "p1", nombre: "Percebes", categoria: "MARISCOS", precio: 19, unidad: "100 g", gramos_venta: 100, venta: 17.2727,
      coste: 10.95, pct: 63.39, margen: 6.32, principal: "Percebe", origen: "estimado", banderas: ["coste_alto"],
      ingredientes: [{ id: 1, producto_id: 301, producto: "Percebe", cantidad: 100, unidad: "g", medida: "kg", eur: 109.5, coste: 10.95, nota: "percebe" }],
    },
    {
      id: "p2", nombre: "Arroz con leche", categoria: "POSTRES", precio: 5.5, unidad: "Unidad", venta: 5, coste: 0.25, pct: 5, margen: 4.75,
      origen: "estimado", banderas: [], ingredientes: [{ id: 2, producto_id: 382, producto: "Leche entera", cantidad: 200, unidad: "ml", medida: "l", eur: 0.92, coste: 0.18 }],
    },
  ],
  vinos: [
    { id: "v1", nombre: "Laurent‑Perrier Millésimé", categoria: "CHAMPAGNE", precio: 110, venta: 100, producto_id: 1785, producto: "LP Millésimé 75 cl",
      coste: 80.4, multiplicador: 1.37, pct: 80.4, margen: 19.6, banderas: ["multiplicador_bajo"] },
  ],
});

const pintar = (puedeEditar = true) =>
  render(
    <MemoryRouter>
      <div style={{ height: 800 }}>
        <MargenesCarta puedeEditar={puedeEditar} />
      </div>
    </MemoryRouter>,
  );

describe("MargenesCarta", () => {
  beforeEach(() => {
    estado = { isLoading: false, isError: false, data: DATOS, error: null, refetch: vi.fn() };
  });

  it("enseña las cifras y solo los platos donde no funciona el margen, con el porqué", () => {
    pintar();
    const resumen = screen.getByTestId("margenes-resumen");
    expect(within(resumen).getByText("44 %")).toBeInTheDocument();
    expect(within(resumen).getByText("1,37×")).toBeInTheDocument();
    const lista = screen.getByTestId("margenes-lista");
    expect(within(lista).getByText(/Percebes: cuesta 110 €\/kg y se vende a 172,73 €\/kg sin IVA → 63 % de coste/)).toBeInTheDocument();
    expect(within(lista).queryByText(/Arroz con leche/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Todos" }));
    expect(within(screen.getByTestId("margenes-lista")).getByText(/Arroz con leche/)).toBeInTheDocument();
  });

  it("pestaña Vinos con el multiplicador", () => {
    pintar();
    fireEvent.click(screen.getByRole("radio", { name: /Vinos/ }));
    expect(within(screen.getByTestId("margenes-lista")).getByText(/la botella cuesta 80,40 € y se vende a 110,00 € → 1,37×/)).toBeInTheDocument();
  });

  it("el detalle deja cambiar los gramos y guardar el escandallo", () => {
    pintar();
    fireEvent.click(within(screen.getByTestId("margenes-lista")).getByRole("button", { name: /Percebes/ }));
    const detalle = screen.getByTestId("detalle-margen");
    const cantidad = within(detalle).getByLabelText("Cantidad de Percebe");
    fireEvent.change(cantidad, { target: { value: "80" } });
    fireEvent.click(within(detalle).getByRole("button", { name: /Guardar escandallo/ }));
    expect(edicion.escandallo.mutate).toHaveBeenCalledWith(
      { platoId: "p1", ingredientes: [{ productoId: 301, producto: "Percebe", cantidad: 80, unidad: "g", nota: "percebe" }] },
      expect.anything(),
    );
  });

  it("sin «Editar», el detalle es de solo lectura", () => {
    pintar(false);
    fireEvent.click(within(screen.getByTestId("margenes-lista")).getByRole("button", { name: /Percebes/ }));
    const detalle = screen.getByTestId("detalle-margen");
    expect(within(detalle).queryByRole("button", { name: /Guardar escandallo/ })).not.toBeInTheDocument();
    expect(within(detalle).getByLabelText("Cantidad de Percebe")).toBeDisabled();
  });

  it("si falla la consulta, lo dice y deja reintentar", () => {
    estado = { isLoading: false, isError: true, data: undefined, error: new Error("Falta aplicar en Supabase la migración"), refetch: vi.fn() };
    pintar();
    expect(screen.getByRole("alert")).toHaveTextContent("Falta aplicar en Supabase la migración");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(estado.refetch).toHaveBeenCalled();
  });
});
