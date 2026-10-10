import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card, CardTitle } from "../card";

describe("Card", () => {
  it("por defecto es la tarjeta de siempre", () => {
    render(<Card data-testid="c" />);
    expect(screen.getByTestId("c")).toHaveClass("rounded-lg", "border", "bg-card", "shadow-sm");
  });

  it("variante «plana»: sin borde, sombra ni redondeo, solo la raya de abajo", () => {
    render(<Card variante="plana" data-testid="c" />);
    const c = screen.getByTestId("c");
    expect(c).toHaveClass("border-b");
    expect(c.className).not.toMatch(/rounded|shadow|(^|\s)border(\s|$)/);
  });

  it("CardTitle baja a text-base y el llamador puede pedir otro tamaño", () => {
    render(
      <>
        <CardTitle>Normal</CardTitle>
        <CardTitle className="text-2xl">Grande</CardTitle>
      </>,
    );
    expect(screen.getByText("Normal")).toHaveClass("text-base", "font-semibold");
    expect(screen.getByText("Grande")).toHaveClass("text-2xl");
    expect(screen.getByText("Grande")).not.toHaveClass("text-base");
  });
});
