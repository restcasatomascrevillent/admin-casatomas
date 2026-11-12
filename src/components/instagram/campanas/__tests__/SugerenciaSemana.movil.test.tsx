/**
 * «Sugerencia de la semana» en el móvil: con varias fechas señaladas se resumen en una línea y se despliegan.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({ fechas: [] as Array<{ titulo: string; desde: string; verificacion: string }> }));
vi.mock("../api", async (original) => ({ ...(await original<typeof import("../api")>()), fechasEntre: () => Promise.resolve(api.fechas), pedirIdeasSemana: vi.fn() }));

import { SugerenciaSemana } from "../SugerenciaSemana";

const FECHAS = ["San Martín", "Día del Pilar", "Todos los Santos"].map((titulo, i) => ({ titulo, desde: `2026-11-0${i + 1}`, verificacion: "sin verificar" }));
const anchoOriginal = window.innerWidth;

function pintar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SugerenciaSemana marca="casa-tomas" semana="2026-11-04" destacada />
    </QueryClientProvider>,
  );
}

describe("SugerenciaSemana en el móvil", () => {
  beforeEach(() => Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 390 }));
  afterAll(() => Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: anchoOriginal }));

  it("varias fechas: una línea «3 fechas esta semana» de 48 px y las píldoras ocultas hasta pulsarla", async () => {
    api.fechas = FECHAS;
    pintar();
    const resumen = await screen.findByTestId("resumen-fechas");
    expect(resumen).toHaveTextContent("3 fechas esta semana");
    expect(resumen).toHaveClass("h-12");
    expect(resumen).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("Fechas señaladas de la semana")).toHaveClass("hidden");
    fireEvent.click(resumen);
    expect(resumen).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Fechas señaladas de la semana")).not.toHaveClass("hidden");
    expect(screen.getAllByText("(sin verificar)")).toHaveLength(3);
  });

  it("una sola fecha: se ve tal cual, sin resumen", async () => {
    api.fechas = FECHAS.slice(0, 1);
    pintar();
    expect(await screen.findAllByText("San Martín")).not.toHaveLength(0);
    expect(screen.queryByTestId("resumen-fechas")).toBeNull();
  });
});
