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
  peso: [
    { id: "p1", nombre: "Percebes", categoria: "MARISCOS", precio: 19, unidad: "100 g", gramos_venta: 100, venta_kg_iva: 190, venta_kg: 172.73,
      producto_id: 301, producto: "Percebe", compra_kg: 110, multiplicador: 1.57, pct: 63.68, ultimo_proveedor: "CETAREA ANGELMAR S.L.",
      ultima_fecha: "2026-10-03", banderas: ["multiplicador_bajo"] },
    { id: "p9", nombre: "Bogavante de la ría", categoria: "MARISCOS", precio: 95, unidad: "kg", gramos_venta: 1000, venta_kg_iva: 95, venta_kg: 86.36,
      producto_id: 218, producto: "Bogavante", compra_kg: 25, multiplicador: 3.45, pct: 28.95, banderas: [] },
    { id: "p8", nombre: "Calamar Bahía plancha", categoria: "ENTRANTES", precio: 70, unidad: "kg", gramos_venta: 1000, venta_kg_iva: 70, venta_kg: 63.64,
      motivo: "No hay compras de calamar de bahía fresco", banderas: ["sin_mapear"] },
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

  it("por defecto «Por peso»: cifras de peso y vinos, y el porqué en €/kg", () => {
    pintar();
    expect(screen.getByRole("radio", { name: /Por peso/ })).toHaveAttribute("aria-checked", "true");
    const resumen = screen.getByTestId("margenes-resumen");
    // Mediana del multiplicador al peso (1,57 y 3,45) y de vinos (sin IVA: 100 / 80,40); el food cost estimado de platos ya no sale.
    expect(within(resumen).getByText("2,51×")).toBeInTheDocument();
    expect(within(resumen).getByText("1,24×")).toBeInTheDocument();
    expect(within(resumen).queryByText("44 %")).not.toBeInTheDocument();
    const lista = screen.getByTestId("margenes-lista");
    expect(
      within(lista).getByText("Percebes: lo compras a 110,00 €/kg sin IVA y lo vendes a 172,73 €/kg sin IVA (190 €/kg en carta) → ×1,57, 64 % de coste."),
    ).toBeInTheDocument();
    expect(within(lista).getByText(/última compra 03\/10\/26, CETAREA ANGELMAR/)).toBeInTheDocument();
    expect(within(lista).queryByText(/Bogavante/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Sin datos/ }));
    expect(within(screen.getByTestId("margenes-lista")).getByText(/Calamar Bahía plancha: No hay compras de calamar de bahía fresco/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Todos" }));
    const todos = within(screen.getByTestId("margenes-lista")).getAllByRole("button").map((b) => b.textContent ?? "");
    expect(todos[0]).toMatch(/^1,57×Percebes/);
    expect(todos[1]).toMatch(/Bogavante/);
  });

  it("«Platos (borrador)»: aviso de gramos estimados y no cuentan hasta «Revisado»", () => {
    pintar();
    fireEvent.click(screen.getByRole("radio", { name: /Platos \(borrador\)/ }));
    expect(screen.getByTestId("aviso-borrador")).toHaveTextContent(/estimación pendiente de revisar/);
    expect(screen.queryByTestId("margenes-lista")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Todos" }));
    const lista = screen.getByTestId("margenes-lista");
    expect(within(lista).getByText(/Arroz con leche/)).toBeInTheDocument();
    // Percebes se vende al peso: no está en el borrador.
    expect(within(lista).queryByText(/Percebes/)).not.toBeInTheDocument();
  });

  it("pestaña Vinos con el multiplicador", () => {
    pintar();
    fireEvent.click(screen.getByRole("radio", { name: /Vinos/ }));
    expect(
      within(screen.getByTestId("margenes-lista")).getByText(/la botella te cuesta 80,40 € sin IVA y la vendes a 100,00 € sin IVA \(110,00 € en carta\) → ×1,24/),
    ).toBeInTheDocument();
  });

  it("«Con IVA» cambia todas las cifras y lo explica", () => {
    localStorage.removeItem("margenes-modo-iva");
    pintar();
    expect(screen.getByRole("radio", { name: "Sin IVA (base)" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("explicacion-iva")).toHaveTextContent(/lo que de verdad ganas/);
    fireEvent.click(screen.getByRole("radio", { name: "Con IVA" }));
    expect(screen.getByTestId("explicacion-iva")).toHaveTextContent(/con el impuesto dentro/);
    expect(within(screen.getByTestId("margenes-resumen")).getByText(/multiplicador con IVA/)).toBeInTheDocument();
    const lista = screen.getByTestId("margenes-lista");
    expect(within(lista).getByText(/Percebes: lo compras a 121,00 €\/kg con IVA \(IVA 10 %, supuesto\) y en carta lo vendes a 190 €\/kg con IVA/)).toBeInTheDocument();
    fireEvent.click(within(lista).getByRole("button", { name: /Percebes/ }));
    const detalle = screen.getByTestId("detalle-margen");
    expect(within(detalle).getByTestId("cifras-margen")).toHaveTextContent(/Precio de carta \(con IVA\)\s*19,00 €/);
    expect(within(detalle).getByTestId("explicacion-margen")).toHaveTextContent(/De cada 100 € que cobras con IVA/);
    // Se recuerda en este navegador.
    expect(localStorage.getItem("margenes-modo-iva")).toBe("con");
    localStorage.removeItem("margenes-modo-iva");
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
