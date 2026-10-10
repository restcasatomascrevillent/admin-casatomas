/** Zoom del original: los botones cambian la transformación de la imagen. */
import { describe, it, expect } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ImagenZoom } from "../ImagenZoom";

const transform = () => screen.getByTestId("zoom-lienzo").style.transform;

describe("ImagenZoom", () => {
  it("+ / − / Ajustar cambian la escala", () => {
    render(<ImagenZoom src="https://x.test/a.jpg" alt="Factura" />);
    expect(transform()).toContain("scale(1)");
    expect(screen.getByRole("button", { name: "Alejar" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Ampliar" }));
    expect(transform()).toContain("scale(1.5)");
    expect(screen.getByRole("button", { name: /ver al 100/i })).toHaveTextContent("150 %");
    fireEvent.click(screen.getByRole("button", { name: "Ampliar" }));
    expect(transform()).toContain("scale(2.25)");
    fireEvent.click(screen.getByRole("button", { name: "Alejar" }));
    expect(transform()).toContain("scale(1.5)");
    fireEvent.click(screen.getByRole("button", { name: /ajustar a la vista/i }));
    expect(transform()).toContain("scale(1)");
  });

  it("Girar suma 90° y vuelve al ajuste", () => {
    render(<ImagenZoom src="https://x.test/a.jpg" alt="Factura" />);
    fireEvent.click(screen.getByRole("button", { name: "Ampliar" }));
    fireEvent.click(screen.getByRole("button", { name: /girar 90/i }));
    expect(transform()).toContain("rotate(90deg)");
    expect(transform()).toContain("scale(1)");
    fireEvent.click(screen.getByRole("button", { name: /girar 90/i }));
    expect(transform()).toContain("rotate(180deg)");
  });

  it("rueda: con requiereCtrl solo amplía con Ctrl; sin él deja pasar el scroll", () => {
    render(<ImagenZoom src="https://x.test/a.jpg" alt="Factura" requiereCtrl />);
    const marco = screen.getByTestId("zoom-marco");
    const sinCtrl = new WheelEvent("wheel", { deltaY: -200, bubbles: true, cancelable: true });
    act(() => { marco.dispatchEvent(sinCtrl); });
    expect(sinCtrl.defaultPrevented).toBe(false);
    expect(transform()).toContain("scale(1)");
    const conCtrl = new WheelEvent("wheel", { deltaY: -200, ctrlKey: true, bubbles: true, cancelable: true });
    act(() => { marco.dispatchEvent(conCtrl); });
    expect(conCtrl.defaultPrevented).toBe(true);
    expect(transform()).not.toContain("scale(1)");
  });

  it("doble clic alterna ajustar y 2×", () => {
    render(<ImagenZoom src="https://x.test/a.jpg" alt="Factura" />);
    fireEvent.doubleClick(screen.getByTestId("zoom-marco"));
    expect(transform()).toContain("scale(2)");
    fireEvent.doubleClick(screen.getByTestId("zoom-marco"));
    expect(transform()).toContain("scale(1)");
  });
});
