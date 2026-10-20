/**
 * Barra de herramientas del editor de plano, pensada para el DEDO:
 * botones de ≥ 44 px, etiquetas siempre visibles (sin tooltip de ratón) y una
 * alternativa en pantalla para todo lo que antes pedía teclado.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToolbarDibujo, pistaDeHerramienta, type ToolType } from "../ToolbarDibujo";

function montar(props: Partial<React.ComponentProps<typeof ToolbarDibujo>> = {}) {
  const base = {
    activeTool: "select" as ToolType,
    onToolChange: vi.fn(),
    onDeleteSelected: vi.fn(),
    hasSelection: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onToggleModoMano: vi.fn(),
    onToggleSeleccionMultiple: vi.fn(),
    onToggleAnguloLibre: vi.fn(),
    onTerminarPared: vi.fn(),
    onCancelarDibujo: vi.fn(),
    onToggleMeasurements: vi.fn(),
    onCenterPlan: vi.fn(),
  };
  const todas = { ...base, ...props };
  render(<ToolbarDibujo {...todas} />);
  return todas;
}

describe("ToolbarDibujo · táctil", () => {
  it("cada herramienta enseña su nombre en pantalla (no solo en un tooltip) y mide ≥ 44 px", () => {
    montar();
    for (const nombre of ["Seleccionar", "Sala", "Pared", "Área", "Mesa", "Redonda", "Puerta"]) {
      const boton = screen.getByRole("button", { name: nombre });
      expect(boton).toHaveTextContent(nombre);
      expect(boton.className).toMatch(/\bh-14\b/); // 56 px
      expect(boton.className).toMatch(/min-w-\[56px\]/);
    }
  });

  it("deshacer, rehacer y eliminar son botones con texto, no atajos de teclado", () => {
    const p = montar({ puedeDeshacer: true, puedeRehacer: true, hasSelection: true });
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    fireEvent.click(screen.getByRole("button", { name: "Rehacer" }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(p.onUndo).toHaveBeenCalledTimes(1);
    expect(p.onRedo).toHaveBeenCalledTimes(1);
    expect(p.onDeleteSelected).toHaveBeenCalledTimes(1);
  });

  it("deshacer/rehacer/eliminar salen deshabilitados cuando no hay nada que hacer", () => {
    montar({ puedeDeshacer: false, puedeRehacer: false, hasSelection: false });
    expect(screen.getByRole("button", { name: "Deshacer" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rehacer" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeDisabled();
  });

  it("Mano, Varias y Ángulo libre son interruptores (Espacio, Mayús+clic y Mayús sin teclado)", () => {
    const p = montar({ modoMano: true, seleccionMultiple: false, anguloLibre: true });
    const mano = screen.getByRole("button", { name: "Mano" });
    const varias = screen.getByRole("button", { name: "Varias" });
    const libre = screen.getByRole("button", { name: "Ángulo libre" });
    expect(mano).toHaveAttribute("aria-pressed", "true");
    expect(varias).toHaveAttribute("aria-pressed", "false");
    expect(libre).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(mano);
    fireEvent.click(varias);
    fireEvent.click(libre);
    expect(p.onToggleModoMano).toHaveBeenCalledTimes(1);
    expect(p.onToggleSeleccionMultiple).toHaveBeenCalledTimes(1);
    expect(p.onToggleAnguloLibre).toHaveBeenCalledTimes(1);
  });

  it("la herramienta activa se marca con aria-pressed", () => {
    montar({ activeTool: "wall" });
    expect(screen.getByRole("button", { name: "Pared" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Seleccionar" })).toHaveAttribute("aria-pressed", "false");
  });

  it("«Terminar pared» y «Cancelar» solo aparecen con una pared a medias; terminar pide ≥ 2 puntos", () => {
    const { rerender } = render(
      <ToolbarDibujo activeTool="wall" onToolChange={() => {}} onDeleteSelected={() => {}} hasSelection={false} />,
    );
    expect(screen.queryByRole("button", { name: /Terminar pared/ })).toBeNull();
    rerender(
      <ToolbarDibujo
        activeTool="wall"
        onToolChange={() => {}}
        onDeleteSelected={() => {}}
        hasSelection={false}
        puntosPared={1}
        onTerminarPared={() => {}}
        onCancelarDibujo={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Terminar pared/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Cancelar/ })).toBeEnabled();
  });

  it("con 2+ puntos se puede terminar la pared con un toque (sin doble clic) o cancelarla (sin Esc)", () => {
    const p = montar({ activeTool: "wall", puntosPared: 3 });
    fireEvent.click(screen.getByRole("button", { name: /Terminar pared/ }));
    fireEvent.click(screen.getByRole("button", { name: /Cancelar/ }));
    expect(p.onTerminarPared).toHaveBeenCalledTimes(1);
    expect(p.onCancelarDibujo).toHaveBeenCalledTimes(1);
  });

  it("no ofrece terminar pared con otra herramienta aunque quedaran puntos", () => {
    montar({ activeTool: "mesa-rect", puntosPared: 3 });
    expect(screen.queryByRole("button", { name: /Terminar pared/ })).toBeNull();
  });

  it("la pista de la herramienta activa está siempre en pantalla y no pide teclado ni ratón", () => {
    montar({ activeTool: "room" });
    expect(screen.getByText(/Arrastra en diagonal/)).toBeVisible();
    const todas: ToolType[] = ["select", "room", "wall", "area", "mesa-rect", "mesa-circular", "door"];
    for (const t of todas) {
      const pista = pistaDeHerramienta(t, 2);
      expect(pista.length, t).toBeGreaterThan(10);
      expect(pista, t).not.toMatch(/doble clic|Esc\b|Shift|Mayús|Ctrl|rueda/i);
    }
  });

  it("elegir una herramienta avisa al padre", () => {
    const p = montar();
    fireEvent.click(screen.getByRole("button", { name: "Puerta" }));
    expect(p.onToolChange).toHaveBeenCalledWith("door");
  });
});
