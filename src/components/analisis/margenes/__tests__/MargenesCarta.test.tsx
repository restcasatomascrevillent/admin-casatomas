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
      coste: 80.4, multiplicador: 1.37, pct: 80.4, margen: 19.6, banderas: ["multiplicador_bajo", "tienda_bajo"],
      en_tienda: true, precio_tienda: 77, venta_tienda: 63.64, multiplicador_tienda: 0.79, coste_iva: 97.28, iva_origen: "factura", iva_compra_pct: 21 },
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
    // Mediana del multiplicador al peso (1,57 y 3,45) y de vinos; el food cost estimado de platos ya no sale.
    expect(within(resumen).getByText("2,51×")).toBeInTheDocument();
    expect(within(resumen).getByText("1,37×")).toBeInTheDocument();
    expect(within(resumen).queryByText("44 %")).not.toBeInTheDocument();
    const lista = screen.getByTestId("margenes-lista");
    expect(
      within(lista).getByText("Percebes: lo compras a 110,00 €/kg y lo vendes a 172,73 €/kg sin IVA (190 €/kg en carta) → ×1,57, 64 % de coste."),
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
    expect(within(screen.getByTestId("margenes-lista")).getByText(/la botella cuesta 80,40 € y se vende a .* sin IVA \(110,00 € en carta\) → 1,37×/)).toBeInTheDocument();
  });

  it("Vinos: margen de la tienda (desactivada) e interruptor «Con IVA»", () => {
    pintar();
    fireEvent.click(screen.getByRole("radio", { name: /Vinos/ }));
    expect(screen.getByTestId("aviso-tienda")).toHaveTextContent("La tienda de vinos está desactivada");
    const lista = screen.getByTestId("margenes-lista");
    expect(within(lista).getByText(/Tienda: 0,79×/)).toHaveTextContent("tienda desactivada");
    expect(within(lista).queryByTestId("linea-con-iva")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Ver costes y precios con IVA" }));
    expect(within(lista).getByTestId("linea-con-iva")).toHaveTextContent("Con IVA: coste 97,28 € · carta 110,00 € · tienda 77,00 €");
    expect(within(lista).getByText("IVA supuesto")).toBeInTheDocument();
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

  it("en el móvil (11/11/2026): el gráfico y la lista caben, las cifras no se cortan y los filtros ocupan dos filas", () => {
    pintar();
    // La columna de la rejilla no puede crecer con el texto: si no, el gráfico y la lista se salían por la derecha.
    const cuerpo = screen.getByTestId("margenes-cuerpo");
    expect(cuerpo).toHaveClass("grid-cols-[minmax(0,1fr)]", "min-w-0");
    for (const s of cuerpo.querySelectorAll("section")) expect(s).toHaveClass("min-w-0");
    expect(cuerpo.innerHTML).not.toMatch(/(?:^|[\s"])(min-w|w)-\[\d+px\]/);
    // El texto de la lista envuelve.
    expect(within(screen.getByTestId("margenes-lista")).getByText(/^Percebes: lo compras/)).toHaveClass("break-words");
    // Tarjetas: versión corta en el móvil, que envuelve (sin «…»); la larga, desde sm y para lectores de pantalla.
    const [peso] = screen.getAllByTestId("margenes-cifra");
    const corta = within(peso).getByText("Al peso (mediana)");
    expect(corta).toHaveClass("sm:hidden");
    expect(within(peso).getByText("Al peso: multiplicador (mediana)")).toHaveClass("max-sm:sr-only");
    expect(corta.parentElement).toHaveClass("line-clamp-2", "sm:truncate");
    expect(corta.parentElement).not.toHaveClass("truncate");
    // Filtros: «Qué enseñar» baja a su fila, a todo el ancho; «Umbrales», solo icono en el móvil.
    expect(screen.getByRole("group", { name: "Qué enseñar" })).toHaveClass("max-sm:order-last", "max-sm:w-full");
    expect(screen.getByRole("radio", { name: "Platos (borrador)" })).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: "Umbrales" })).getByText("Umbrales")).toHaveClass("hidden", "sm:inline");
  });

  it("si falla la consulta, lo dice y deja reintentar", () => {
    estado = { isLoading: false, isError: true, data: undefined, error: new Error("Falta aplicar en Supabase la migración"), refetch: vi.fn() };
    pintar();
    expect(screen.getByRole("alert")).toHaveTextContent("Falta aplicar en Supabase la migración");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(estado.refetch).toHaveBeenCalled();
  });
});
