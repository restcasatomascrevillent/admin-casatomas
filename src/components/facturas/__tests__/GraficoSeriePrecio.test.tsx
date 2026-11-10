import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { GraficoSeriePrecio } from "../GraficoSeriePrecio";

const SERIE = {
  producto: "Merluza",
  unidad: "kg",
  proveedores: ["Flope", "Pescados Paco"],
  puntos: [
    ["2026-08-01", 10.5, 0],
    ["2026-09-10", 11, 1],
    ["2026-10-02", 12.9, 0],
  ],
  n: 3,
  min: 10.5,
  max: 12.9,
  ultimo: 12.9,
  variacion_pct: 22.9,
};

describe("GraficoSeriePrecio", () => {
  it("resumen: último, mínimo, máximo y variación, con la unidad", () => {
    render(<GraficoSeriePrecio datos={SERIE} />);
    expect(screen.getByText(/evolución del precio · merluza/i)).toBeInTheDocument();
    expect(screen.getAllByText("12,90 €/kg")).toHaveLength(2); // último y máximo
    expect(screen.getByText("10,50 €/kg")).toBeInTheDocument();
    expect(screen.getByText("+22,9 %")).toBeInTheDocument();
    expect(screen.getByTestId("grafico-serie-precio")).toBeInTheDocument();
  });

  it("las cifras van en una fila de texto, sin recuadros", () => {
    render(<GraficoSeriePrecio datos={SERIE} />);
    const fila = screen.getByTestId("cifras-serie-precio");
    expect(fila).toHaveTextContent(/Último\s*12,90 €\/kg.*Mín\s*10,50 €\/kg.*Máx\s*12,90 €\/kg.*Variación\s*\+22,9 %/);
    expect(fila.querySelector('[class*="border"]')).toBeNull();
  });

  it("compacto (ficha de producto): sin el título repetido y con la gráfica más baja", () => {
    render(<GraficoSeriePrecio datos={SERIE} compacto />);
    expect(screen.queryByText(/evolución del precio · merluza/i)).not.toBeInTheDocument();
    expect(screen.getByRole("figure", { name: /evolución del precio de merluza/i })).toBeInTheDocument();
    expect((screen.getByTestId("grafico-serie-precio") as HTMLElement).style.height).toBe("168px");
  });

  it("una leyenda por proveedor, de 44 px, que oculta y muestra su línea", () => {
    render(<GraficoSeriePrecio datos={SERIE} />);
    const grupo = screen.getByRole("group", { name: /proveedores en la gráfica/i });
    const flope = within(grupo).getByRole("button", { name: /flope/i });
    expect(within(grupo).getByRole("button", { name: /pescados paco/i })).toBeInTheDocument();
    expect(flope.className).toContain("min-h-11");
    expect(flope).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(flope);
    expect(flope).toHaveAttribute("aria-pressed", "false");
  });

  it("una sola compra: una frase con precio, fecha y proveedor, sin ejes ni variación", () => {
    render(
      <GraficoSeriePrecio
        datos={{ ...SERIE, puntos: [["2026-10-03", 12.5, 0]], n: 1, min: 12.5, max: 12.5, ultimo: 12.5, variacion_pct: 0 }}
        compacto
      />,
    );
    const estado = screen.getByTestId("serie-sin-evolucion");
    expect(estado).toHaveTextContent(/Solo 1 compra:\s*12,50\s€\/kg el 03\/10\/2026 en Flope/);
    expect(screen.queryByTestId("grafico-serie-precio")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cifras-serie-precio")).not.toBeInTheDocument();
    expect(screen.queryByText(/\+0|−0/)).not.toBeInTheDocument();
  });

  it("sin datos y datos ilegibles: mensaje, sin romper ni ejes vacíos", () => {
    const { rerender } = render(<GraficoSeriePrecio datos={{ sin_datos: true, buscado: "pulpo" }} />);
    expect(screen.getByText(/sin compras con precio de «pulpo»/i)).toBeInTheDocument();
    expect(screen.queryByTestId("grafico-serie-precio")).not.toBeInTheDocument();
    rerender(<GraficoSeriePrecio datos={42} />);
    expect(screen.getByText(/no se ha podido leer/i)).toBeInTheDocument();
  });

  it("varias unidades: chips «kg · 37», la actual marcada, y al tocar otra avisa", () => {
    const elegidas: string[] = [];
    render(
      <GraficoSeriePrecio
        datos={SERIE}
        compacto
        unidades={[{ unidad: "kg", n: 1037 }, { unidad: "ud", n: 12 }]}
        onElegirUnidad={(u) => elegidas.push(u)}
      />,
    );
    const grupo = screen.getByRole("group", { name: /unidad de la gráfica/i });
    const kg = within(grupo).getByRole("button", { name: /precio por kg/i });
    expect(kg).toHaveTextContent("kg · 1.037");
    expect(kg).toHaveAttribute("aria-pressed", "true");
    const ud = within(grupo).getByRole("button", { name: /precio por ud/i });
    expect(ud).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(ud);
    expect(elegidas).toEqual(["ud"]);
  });

  it("una sola unidad: sin selector", () => {
    render(<GraficoSeriePrecio datos={SERIE} unidades={[{ unidad: "kg", n: 3 }]} onElegirUnidad={() => {}} />);
    expect(screen.queryByTestId("selector-unidad-serie")).not.toBeInTheDocument();
  });
});
