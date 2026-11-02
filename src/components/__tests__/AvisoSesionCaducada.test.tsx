import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AvisoSesionCaducada } from "../AvisoSesionCaducada";
import {
  limpiarAvisoSesionCaducada,
  marcarSesionCaducada,
} from "@/lib/aviso-sesion";

afterEach(() => limpiarAvisoSesionCaducada());

describe("AvisoSesionCaducada", () => {
  it("no aparece si la sesión no ha caducado", () => {
    render(<AvisoSesionCaducada />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("aparece con el texto completo cuando la sesión caduca, aunque la pantalla ya esté abierta", () => {
    render(<AvisoSesionCaducada />);
    act(() => marcarSesionCaducada());
    expect(screen.getByRole("alert").textContent).toBe(
      "Tu sesión ha caducado. Vuelve a entrar.",
    );
    expect(screen.queryByText(/bloqueado/i)).toBeNull();
    act(() => limpiarAvisoSesionCaducada());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("sobrevive a recargar la pestaña de login", () => {
    marcarSesionCaducada();
    expect(window.sessionStorage.getItem("panel:sesion-caducada")).toBe("1");
  });
});
