import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { SelectorSubrayado } from "../SelectorSubrayado";
import { Plegable } from "../Plegable";
import { ChipsSubnivel } from "../ChipsSubnivel";

describe("SelectorSubrayado", () => {
  const opciones = [
    { valor: "30", etiqueta: "30 días" },
    { valor: "90", etiqueta: "90 días" },
  ];

  it("la opción elegida lleva subrayado (no dorado) y tocar otra avisa; no deja sin selección", () => {
    const onCambio = vi.fn();
    render(<SelectorSubrayado aria-label="Periodo" valor="30" onCambio={onCambio} opciones={opciones} />);
    const activa = screen.getByRole("radio", { name: "30 días" });
    expect(activa.className).toContain("data-[state=on]:border-foreground");
    expect(activa.className).not.toContain("38,59%");
    expect(activa.className).toContain("pointer-coarse:h-11");
    fireEvent.click(screen.getByRole("radio", { name: "90 días" }));
    expect(onCambio).toHaveBeenCalledWith("90");
    onCambio.mockClear();
    fireEvent.click(activa); // volver a tocar la activa no la deselecciona
    expect(onCambio).not.toHaveBeenCalled();
  });
});

describe("Plegable", () => {
  it("empieza plegado, con disparador de 44 px, y se abre al pulsarlo", () => {
    render(
      <Plegable titulo="Configuración" forzarMontaje>
        <p>Contenido interno</p>
      </Plegable>,
    );
    const disparador = screen.getByRole("button", { name: /Configuración/ });
    expect(disparador).toHaveAttribute("aria-expanded", "false");
    expect(disparador.className).toContain("min-h-11");
    expect(screen.getByText("Contenido interno").parentElement).toHaveClass("hidden");
    fireEvent.click(disparador);
    expect(disparador).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Contenido interno").parentElement).not.toHaveClass("hidden");
  });

  it("sin forzarMontaje no pinta el contenido hasta abrir", () => {
    render(
      <Plegable titulo="Ayuda">
        <p>Instrucciones</p>
      </Plegable>,
    );
    expect(screen.queryByText("Instrucciones")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ayuda/ }));
    expect(screen.getByText("Instrucciones")).toBeInTheDocument();
  });
});

describe("ChipsSubnivel", () => {
  it("chips redondos de 36 px (44 con dedo); el activo con fondo suave y sin dorado", () => {
    render(
      <Tabs defaultValue="a">
        <ChipsSubnivel chips={[{ valor: "a", etiqueta: "Bebidas" }, { valor: "b", etiqueta: "Comida" }]} />
        <TabsContent value="a">A</TabsContent>
        <TabsContent value="b">B</TabsContent>
      </Tabs>,
    );
    const chip = screen.getByRole("tab", { name: "Bebidas" });
    expect(chip.className).toContain("rounded-full");
    expect(chip.className).toContain("pointer-coarse:h-11");
    expect(chip.className).toContain("data-[state=active]:bg-primary/10");
    expect(chip.className).not.toContain("38,59%");
    expect(screen.getByRole("tab", { name: "Comida" })).toBeInTheDocument();
  });
});
