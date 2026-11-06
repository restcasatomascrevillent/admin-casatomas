import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EstadoDocumento, agruparAlertas, etiquetaAlerta } from "../EstadoDocumento";

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

  it("las etiquetas que salían en crudo, traducidas (QA C-16)", () => {
    expect(etiquetaAlerta("extraccion_historica")).toBe("Aviso de importación");
    expect(etiquetaAlerta("numero_ausente")).toBe("Sin número");
    expect(etiquetaAlerta("linea_sin_importe")).toBe("Línea sin importe");
    expect(etiquetaAlerta("total_deducido")).toBe("Total calculado");
    expect(etiquetaAlerta("cliente_ajeno")).toBe("Otro cliente");
    expect(etiquetaAlerta("algo_nuevo")).toBe("Algo nuevo");
  });

  it("avisos repetidos juntos: «Línea mal ×2» (y la severidad más grave)", () => {
    expect(
      agruparAlertas([
        { codigo: "descuadre_linea", severidad: "media" },
        { codigo: "iva_incoherente", severidad: "media" },
        { codigo: "descuadre_linea", severidad: "alta" },
      ]),
    ).toEqual([
      { etiqueta: "Línea mal", n: 2, severidad: "alta" },
      { etiqueta: "IVA no cuadra", n: 1, severidad: "media" },
    ]);
    render(
      <EstadoDocumento
        alertas={[
          { codigo: "descuadre_linea", severidad: "media", mensaje: "a" },
          { codigo: "descuadre_linea", severidad: "media", mensaje: "b" },
        ]}
        verificada
        origen="manual"
        onRevisar={vi.fn()}
        compacto={false}
      />,
    );
    const insignia = screen.getByRole("button", { name: "Línea mal (2): ver el aviso completo" });
    expect(insignia).toHaveTextContent("Línea mal×2");
  });

  it("sin permiso de edición (sin onRevisar), «Sin revisar» es una marca y no un botón (QA C-09)", () => {
    render(<EstadoDocumento alertas={[]} verificada={false} />);
    expect(screen.getByText("Sin revisar")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sin revisar/ })).not.toBeInTheDocument();
  });
});
