import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

let coste: { costeUsd: number; llamadas: number | null; modelo: string | null } | null = null;
vi.mock("@/hooks/useEstadisticasLectura", () => ({
  useCosteLecturaFactura: (id: number | null | undefined) => ({ data: id ? coste : undefined }),
}));

import { CosteLecturaDocumento, CosteLecturaFactura } from "../CosteLecturaDocumento";

describe("CosteLecturaDocumento", () => {
  it("texto pequeño gris «lectura X cént.» con el detalle en el tooltip", () => {
    render(<CosteLecturaDocumento costeUsd={0.03488} llamadas={5} modelo="gpt-5.6-luna" />);
    const el = screen.getByTestId("coste-lectura");
    expect(el).toHaveTextContent("lectura 3,2 cént.");
    expect(el.className).toContain("text-muted-foreground");
    expect(el.className).toContain("text-xs");
    expect(el).toHaveAttribute("title", "Coste de leer este documento con IA: 0,0349 $ · 5 llamadas · gpt-5.6-luna");
  });

  it("sin coste no pinta nada (null, undefined o no numérico)", () => {
    const { container, rerender } = render(<CosteLecturaDocumento costeUsd={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<CosteLecturaDocumento costeUsd={undefined} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<CosteLecturaDocumento costeUsd={Number.NaN} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("un coste de 0 sí se enseña (no es «sin dato»)", () => {
    render(<CosteLecturaDocumento costeUsd={0} />);
    expect(screen.getByTestId("coste-lectura")).toHaveTextContent("lectura 0 cént.");
  });

  it("CosteLecturaFactura: busca el coste de la factura (para la ficha)", () => {
    coste = { costeUsd: 0.0043, llamadas: 1, modelo: "gpt-5.6-luna" };
    const { rerender } = render(<CosteLecturaFactura facturaId={39} />);
    expect(screen.getByTestId("coste-lectura")).toHaveTextContent("lectura 0,4 cént.");
    coste = null;
    rerender(<CosteLecturaFactura facturaId={39} />);
    expect(screen.queryByTestId("coste-lectura")).toBeNull();
  });
});
