import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { AvisoSinConexion } from "../AvisoSinConexion";
import { esErrorDeRed } from "@/hooks/useEnLinea";

afterEach(() => vi.restoreAllMocks());

const LAS_2130 = new Date(2026, 10, 7, 21, 30).getTime();

describe("AvisoSinConexion", () => {
  it("con red y sin fallos no pinta nada (no roba altura)", () => {
    const { container } = render(<AvisoSinConexion actualizadoEn={LAS_2130} falloRed={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("si la lectura falló por red: «Sin conexión · datos de las HH:MM»", () => {
    render(<AvisoSinConexion actualizadoEn={LAS_2130} falloRed />);
    expect(screen.getByRole("status")).toHaveTextContent("Sin conexión · datos de las 21:30");
  });

  it("aparece y se va con los eventos offline/online del navegador", () => {
    const enLinea = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<AvisoSinConexion actualizadoEn={LAS_2130} falloRed={false} />);
    expect(screen.queryByTestId("aviso-sin-conexion")).not.toBeInTheDocument();

    enLinea.mockReturnValue(false);
    act(() => void window.dispatchEvent(new Event("offline")));
    expect(screen.getByTestId("aviso-sin-conexion")).toHaveTextContent("datos de las 21:30");

    enLinea.mockReturnValue(true);
    act(() => void window.dispatchEvent(new Event("online")));
    expect(screen.queryByTestId("aviso-sin-conexion")).not.toBeInTheDocument();
  });

  it("sin datos nunca: solo «Sin conexión»", () => {
    render(<AvisoSinConexion actualizadoEn={0} falloRed />);
    expect(screen.getByRole("status")).toHaveTextContent(/^Sin conexión$/);
  });
});

describe("esErrorDeRed", () => {
  it.each([
    [{ message: "TypeError: Failed to fetch" }, true],
    [{ message: "NetworkError when attempting to fetch resource." }, true],
    [{ message: "Load failed" }, true],
    [new TypeError("Failed to fetch"), true],
    [{ message: "permission denied for table reservas", code: "42501" }, false],
    [null, false],
  ])("%j → %s", (error, esperado) => {
    expect(esErrorDeRed(error)).toBe(esperado);
  });
});
