import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { TiraCifras } from "../TiraCifras";

describe("TiraCifras", () => {
  it("una cifra por elemento con su etiqueta pequeña y gris, sin tarjetas", () => {
    render(<TiraCifras cifras={[{ etiqueta: "Activas", valor: 26 }, { etiqueta: "Próxima", valor: "13:00", detalle: "hoy" }]} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("Activas")).toHaveClass("text-xs", "text-muted-foreground");
    expect(within(items[0]).getByText("26")).toHaveClass("text-xl", "font-semibold", "tabular-nums");
    expect(within(items[1]).getByText("hoy")).toBeInTheDocument();
    // separador vertical fino entre cifras, ningún fondo ni sombra
    expect(items[1].className).toContain("border-l");
    expect(items[1].className).not.toMatch(/\bbg-|shadow/);
  });

  it("se envuelve en varias líneas si no cabe y recorta la raya de cada inicio de línea", () => {
    const { container } = render(<TiraCifras cifras={[{ etiqueta: "A", valor: 1 }, { etiqueta: "B", valor: 2 }]} data-testid="tira" />);
    const lista = container.querySelector("ul")!;
    expect(lista).toHaveClass("flex", "flex-wrap", "-ml-4");
    expect(screen.getByTestId("tira")).toHaveClass("overflow-hidden");
  });

  it("tono ámbar o rojo solo en la cifra que avisa", () => {
    render(<TiraCifras cifras={[{ etiqueta: "Normal", valor: 1 }, { etiqueta: "Aviso", valor: 2, tono: "ambar" }, { etiqueta: "Fallos", valor: 3, tono: "rojo" }]} />);
    expect(screen.getByText("1").className).not.toMatch(/text-(amber|red)/);
    expect(screen.getByText("2").className).toContain("text-amber-600");
    expect(screen.getByText("3").className).toContain("text-red-600");
  });

  it("con onClick la cifra es un botón de 44 px en táctil", () => {
    const onClick = vi.fn();
    render(<TiraCifras cifras={[{ etiqueta: "Pendientes", valor: 2, onClick }, { etiqueta: "Otras", valor: 5 }]} />);
    const boton = screen.getByRole("button", { name: /Pendientes/ });
    expect(boton.className).toContain("pointer-coarse:min-h-11");
    fireEvent.click(boton);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
