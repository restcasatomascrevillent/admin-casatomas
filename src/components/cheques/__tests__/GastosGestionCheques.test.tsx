import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ from: vi.fn(), update: vi.fn(), edit: true, fila: {} as Record<string, unknown>, error: null as unknown }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from } }));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: mock.edit }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { GastosGestionCheques } from "../GastosGestionCheques";

describe("Gastos de gestión de los cheques", () => {
  beforeEach(() => {
    mock.edit = true; mock.error = null; mock.update.mockReset();
    mock.fila = { gastos_gestion_activos: false, gastos_gestion_porcentaje: 1.5, gastos_gestion_fijo_eur: 0.25 };
    mock.update.mockReturnValue({ eq: () => ({ select: () => ({ single: async () => ({ data: { id: true }, error: null }) }) }) });
    mock.from.mockReturnValue({
      select: () => ({ eq: () => ({ single: async () => ({ data: mock.error ? null : mock.fila, error: mock.error }) }) }),
      update: mock.update,
    });
  });

  it("arranca apagado, enseña ejemplos y guarda solo sus columnas al activarlo", async () => {
    render(<GastosGestionCheques />);
    await waitFor(() => expect(screen.queryByText("Cargando gastos de gestión…")).toBeNull());
    const interruptor = screen.getByRole("switch", { name: "Cobrar gastos de gestión en la compra online" });
    expect(interruptor).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/^51,02\s€$/)).toBeTruthy(); // cheque de 50 € con 1,5 % + 0,25 €
    expect(screen.getByRole("columnheader", { name: "Te queda" })).toBeTruthy();
    expect(screen.getAllByText(/^50,00\s€$/)).toHaveLength(2); // el cheque de 50 € y lo que queda tras la comisión
    expect(screen.getByRole("button", { name: "Guardar gastos de gestión" })).toBeDisabled();
    fireEvent.click(interruptor);
    fireEvent.change(screen.getByLabelText("Porcentaje (%)"), { target: { value: "2.8" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar gastos de gestión" }));
    await waitFor(() => expect(mock.update).toHaveBeenCalledTimes(1));
    const cambios = mock.update.mock.calls[0][0];
    expect(cambios).toMatchObject({ gastos_gestion_activos: true, gastos_gestion_porcentaje: 2.8, gastos_gestion_fijo_eur: 0.25 });
    expect(Object.keys(cambios).sort()).toEqual(["actualizado_en", "gastos_gestion_activos", "gastos_gestion_fijo_eur", "gastos_gestion_porcentaje"]);
  });

  it("no guarda valores fuera de los límites de la base de datos", async () => {
    render(<GastosGestionCheques />);
    await waitFor(() => expect(screen.queryByText("Cargando gastos de gestión…")).toBeNull());
    fireEvent.change(screen.getByLabelText("Parte fija (€)"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar gastos de gestión" }));
    await new Promise(r => setTimeout(r, 0));
    expect(mock.update).not.toHaveBeenCalled();
  });

  it("solo lectura no puede cambiarlos", async () => {
    mock.edit = false;
    render(<GastosGestionCheques />);
    await waitFor(() => expect(screen.queryByText("Cargando gastos de gestión…")).toBeNull());
    expect(screen.getByRole("switch", { name: "Cobrar gastos de gestión en la compra online" })).toBeDisabled();
  });

  it("avisa si falta la migración", async () => {
    mock.error = { code: "42703", message: "column plantilla_cheques_regalo.gastos_gestion_activos does not exist" };
    render(<GastosGestionCheques />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Cobrar gastos de gestión en la compra online" })).toBeDisabled();
  });
});
