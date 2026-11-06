/**
 * Botón secundario de la barra de la carta: nombre accesible completo aunque se
 * vea el texto corto, misma altura que el resto y ayuda emergente con el foco.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Percent } from "lucide-react";
import { BotonHerramientaCarta } from "../BotonHerramientaCarta";

describe("BotonHerramientaCarta", () => {
  it("se llama por su etiqueta larga, lleva la corta para el móvil estrecho y el escritorio compacto, y es de contorno", () => {
    const alPulsar = vi.fn();
    render(<BotonHerramientaCarta icono={<Percent />} etiqueta="Ajustar precios" etiquetaCorta="Precios" ayuda="Sube o baja precios" onClick={alPulsar} />);
    const boton = screen.getByRole("button", { name: "Ajustar precios" });
    expect(boton).toHaveAttribute("type", "button");
    expect(boton.className).toContain("border-input");
    expect(boton.className).toContain("h-10");
    expect(boton.className).toContain("pointer-coarse:h-11");
    expect(boton.textContent).toContain("Precios");
    expect(boton.querySelector("svg")).not.toBeNull();
    fireEvent.click(boton);
    expect(alPulsar).toHaveBeenCalledTimes(1);
  });

  it("enseña la ayuda con el foco del teclado", async () => {
    render(<BotonHerramientaCarta icono={<Percent />} etiqueta="PDF Carta" ayuda="Carta para imprimir: PDF en A5 o A4" />);
    fireEvent.focus(screen.getByRole("button", { name: "PDF Carta" }));
    expect((await screen.findAllByText("Carta para imprimir: PDF en A5 o A4")).length).toBeGreaterThan(0);
  });
});
