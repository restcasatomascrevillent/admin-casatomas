import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LeyendaMesasMovil } from "../VistaHoyMovil";

describe("LeyendaMesasMovil", () => {
  it("explica los colores y el candado de las mesas", () => {
    render(<LeyendaMesasMovil />);
    const leyenda = screen.getByRole("list", { name: "Leyenda de colores de las mesas" });
    for (const t of ["Libre", "Reservada", "Sentada", "Fijada"]) expect(leyenda).toHaveTextContent(t);
  });
});
