import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EstadoDocumento } from "../EstadoDocumento";

describe("EstadoDocumento", () => {
  it("distingue la revisión automática de la humana", () => {
    const { rerender } = render(
      <EstadoDocumento alertas={[]} verificada origen="auto" onRevisar={vi.fn()} />,
    );
    expect(screen.getByText("Revisada auto")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /no la ha mirado nadie/i })).toBeInTheDocument();

    rerender(<EstadoDocumento alertas={[]} verificada origen="manual" onRevisar={vi.fn()} />);
    expect(screen.getByText("Revisada")).toBeInTheDocument();
    expect(screen.queryByText("Revisada auto")).not.toBeInTheDocument();
  });

  it("sin verificar sigue mostrando «Sin revisar»", () => {
    render(<EstadoDocumento alertas={[]} verificada={false} onRevisar={vi.fn()} />);
    expect(screen.getByText("Sin revisar")).toBeInTheDocument();
  });
});
