import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

// Última factura de cada producto (20261128140000): sin original guardado, para que el visor no pida nada.
const factura = (id: number, proveedor: string, fecha: string, extra: Record<string, unknown>) => ({
  id, linea_id: id * 10, fecha, proveedor, numero_documento: `F-${id}`, tipo: "factura", local: "casa_tomas", total: 500,
  drive_url: null, archivo_path: null, cantidad: 2, ...extra,
});
const F_PERCEBE = factura(33, "CETAREA ANGELMAR S.L.", "2026-10-03", { nombre_linea: "PERCEBE", unidad_compra: "kg", precio_unidad: 110, medida: "kg", eur_base: 110, importe: 220 });
const F_CHAMPAN = factura(44, "VINOS DEL MUNDO", "2026-09-20", { nombre_linea: "LP MILLESIME", unidad_compra: "caja", precio_unidad: 482.4, medida: "l", eur_base: 107.2, importe: 482.4 });

const DATOS = normalizarMargenes({
  coste_desde: "ultima_factura",
  config: { coste_max_plato_pct: 35, multiplicador_min_vino: 2.5, subida_coste_pct: 10, iva_pct: 10, dias_referencia: 90 },
  resumen: {
    platos: { total: 2, con_datos: 2, food_cost_medio: 44.4, food_cost_mediana: 44.4, en_rojo: 1, sube_coste: 0, sin_datos: 0 },
    vinos: { total: 1, con_datos: 1, multiplicador_medio: 1.37, multiplicador_mediana: 1.37, en_rojo: 1, sube_coste: 0, sin_datos: 0 },
  },
  platos: [
    {
      id: "p1", nombre: "Percebes", categoria: "MARISCOS", precio: 19, unidad: "100 g", gramos_venta: 100, venta: 17.2727,
      coste: 10.95, pct: 63.39, margen: 6.32, principal: "Percebe", origen: "estimado", banderas: ["coste_alto"],
      factura: F_PERCEBE,
      ingredientes: [{ id: 1, producto_id: 301, producto: "Percebe", cantidad: 100, unidad: "g", medida: "kg", eur: 109.5, coste: 10.95, nota: "percebe",
        eur_mediana: 105, factura: F_PERCEBE }],
    },
    {
      id: "p2", nombre: "Arroz con leche", categoria: "POSTRES", precio: 5.5, unidad: "Unidad", venta: 5, coste: 0.25, pct: 5, margen: 4.75,
      origen: "estimado", banderas: [], ingredientes: [{ id: 2, producto_id: 382, producto: "Leche entera", cantidad: 200, unidad: "ml", medida: "l", eur: 0.92, coste: 0.18 }],
    },
  ],
  vinos: [
    { id: "v1", nombre: "Laurent‑Perrier Millésimé", categoria: "CHAMPAGNE", precio: 110, venta: 100, producto_id: 1785, producto: "LP Millésimé 75 cl",
      coste: 80.4, multiplicador: 1.37, pct: 80.4, margen: 19.6, banderas: ["multiplicador_bajo", "tienda_bajo"], factura: F_CHAMPAN,
      coste_mediana: 75, ultima: "2026-09-20",
      en_tienda: true, precio_tienda: 77, venta_tienda: 63.64, multiplicador_tienda: 0.79, coste_iva: 97.28, iva_origen: "factura", iva_compra_pct: 21 },
  ],
  peso: [
    { id: "p1", nombre: "Percebes", categoria: "MARISCOS", precio: 19, unidad: "100 g", gramos_venta: 100, venta_kg_iva: 190, venta_kg: 172.73,
      producto_id: 301, producto: "Percebe", compra_kg: 110, multiplicador: 1.57, pct: 63.68, ultimo_proveedor: "CETAREA ANGELMAR S.L.",
      ultima_fecha: "2026-10-03", banderas: ["multiplicador_bajo"], factura: F_PERCEBE, compra_kg_mediana: 105, ultima: "2026-10-03" },
    { id: "p9", nombre: "Bogavante de la ría", categoria: "MARISCOS", precio: 95, unidad: "kg", gramos_venta: 1000, venta_kg_iva: 95, venta_kg: 86.36,
      producto_id: 218, producto: "Bogavante", compra_kg: 25, multiplicador: 3.45, pct: 28.95, banderas: [] },
    { id: "p8", nombre: "Calamar Bahía plancha", categoria: "ENTRANTES", precio: 70, unidad: "kg", gramos_venta: 1000, venta_kg_iva: 70, venta_kg: 63.64,
      motivo: "No hay compras de calamar de bahía fresco", banderas: ["sin_mapear"] },
  ],
});

const pintar = (puedeEditar = true) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <div style={{ height: 800 }}>
          <MargenesCarta puedeEditar={puedeEditar} />
        </div>
      </MemoryRouter>
    </QueryClientProvider>,
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
    // Lo primero y destacado, la última factura; después, en sencillo, el porqué; la mediana, en pequeño.
    expect(within(lista).getByTestId("ultima-factura")).toHaveTextContent("Última factura: CETAREA ANGELMAR S.L., 03/10 · 110,00 €/kg");
    expect(
      within(lista).getByText(
        "Lo vendes a 190 € el kilo (172,73 € sin IVA) y el kilo te cuesta 110,00 €: cobras 1,57 veces lo que pagas (mínimo 2). De cada 100 € que cobras, 64 € se van en comprarlo.",
      ),
    ).toBeInTheDocument();
    expect(within(lista).getByTestId("mediana")).toHaveTextContent("Mediana de 3 meses: 105,00 €/kg");
    const fila = within(lista).getByTestId("ultima-factura").closest("li") as HTMLElement;
    expect(within(fila).getByText("Percebes")).toBeInTheDocument();
    expect(screen.getByTestId("como-se-lee")).toHaveTextContent("Es un % del precio de venta, no del coste");
    expect(within(lista).queryByText(/Bogavante/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Sin datos/ }));
    const sinDatos = screen.getByTestId("margenes-lista");
    expect(within(sinDatos).getByText("Calamar Bahía plancha")).toBeInTheDocument();
    expect(within(sinDatos).getByText("No hay compras de calamar de bahía fresco.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Todos" }));
    const todos = within(screen.getByTestId("margenes-lista")).getAllByRole("listitem").map((b) => b.textContent ?? "");
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
    const lista = screen.getByTestId("margenes-lista");
    expect(within(lista).getByText(/La botella te cuesta 80,40 € y la vendes a 110 € \(100,00 € sin IVA\): cobras 1,37 veces lo que pagas/)).toBeInTheDocument();
    expect(within(lista).getByTestId("ultima-factura")).toHaveTextContent("Última factura: VINOS DEL MUNDO, 20/09 · 482,40 € la caja (107,20 €/l)");
    expect(within(lista).getByTestId("mediana")).toHaveTextContent("Mediana de 3 meses: 75,00 € la botella");
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

  it("la fila tiene un botón para abrir el original de la última factura", () => {
    pintar();
    fireEvent.click(within(screen.getByTestId("margenes-lista")).getByRole("button", { name: "Abrir la última factura de Percebes" }));
    const visor = screen.getByTestId("visor-documento");
    expect(within(visor).getByRole("heading", { name: "CETAREA ANGELMAR S.L." })).toBeInTheDocument();
    expect(visor).toHaveTextContent("nº F-33");
  });

  it("el detalle empieza por la última factura de cada ingrediente, con «Ver factura» y la mediana en pequeño", () => {
    pintar();
    fireEvent.click(within(screen.getByTestId("margenes-lista")).getAllByRole("button", { name: /Percebes/ })[0]);
    const detalle = screen.getByTestId("detalle-margen");
    const bloque = within(detalle).getByTestId("detalle-ultima-factura");
    expect(bloque).toHaveTextContent("Última factura de Percebe");
    expect(bloque).toHaveTextContent("CETAREA ANGELMAR S.L., 03/10 · 110,00 €/kg");
    expect(bloque).toHaveTextContent("Mediana de 3 meses: 105 €/kg");
    expect(within(bloque).getByRole("button", { name: /Ver factura/ })).toBeInTheDocument();
    expect(within(detalle).getByText("% de coste sobre el precio de venta (sin IVA)")).toBeInTheDocument();
    expect(within(detalle).getByText("Te cuesta (última factura)")).toBeInTheDocument();
  });

  it("el detalle del vino: la última factura destacada y la factura anterior como contexto", () => {
    pintar();
    fireEvent.click(screen.getByRole("radio", { name: /Vinos/ }));
    fireEvent.click(within(screen.getByTestId("margenes-lista")).getAllByRole("button", { name: /Laurent/ })[0]);
    const bloque = within(screen.getByTestId("detalle-margen")).getByTestId("detalle-ultima-factura");
    expect(bloque).toHaveTextContent("Última factura (de aquí sale lo que te cuesta)");
    expect(bloque).toHaveTextContent("VINOS DEL MUNDO, 20/09 · 482,40 € la caja (107,20 €/l)");
    expect(bloque).toHaveTextContent("Mediana de 3 meses: 75,00 € la botella");
  });

  it("el detalle deja cambiar los gramos y guardar el escandallo", () => {
    pintar();
    fireEvent.click(within(screen.getByTestId("margenes-lista")).getAllByRole("button", { name: /Percebes/ })[0]);
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
    fireEvent.click(within(screen.getByTestId("margenes-lista")).getAllByRole("button", { name: /Percebes/ })[0]);
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
