import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogFiltros } from "@/hooks/useAuditLog";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { FiltrosAuditoria } from "./FiltrosAuditoria";

const aplicar = vi.fn();
function Harness() {
  const [pendientes, setPendientes] = useState<AuditLogFiltros>({});
  const [activos, setActivos] = useState<AuditLogFiltros>({});
  return (
    <FiltrosAuditoria
      pendientes={pendientes}
      activos={activos}
      tablas={["Platos", "reservas"]}
      onChange={setPendientes}
      onAplicar={() => {
        aplicar(pendientes);
        setActivos(pendientes);
      }}
      onLimpiar={() => {
        setPendientes({});
        setActivos({});
      }}
    />
  );
}
beforeEach(() => {
  aplicar.mockClear();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 375,
  });
});
afterEach(cleanup);
describe("filtros móviles de auditoría", () => {
  it("abre un panel accesible y aplica el tipo de acción y el origen seleccionados", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Filtros/ }));
    expect(
      screen.getByRole("dialog", { name: "Filtrar auditoría" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Tipo de acción"), {
      target: { value: "consulta_ia" },
    });
    fireEvent.change(screen.getByLabelText("Origen de la acción"), {
      target: { value: "usuario" },
    });
    expect(aplicar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(aplicar).toHaveBeenCalledWith({
      accion: "consulta_ia",
      origen: "usuario",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByText("Tipo: Pregunta a la IA de facturas"),
    ).toBeInTheDocument();
  });
  it("conserva fechas y resultado al reabrir y permite limpiar todos los filtros", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /^Filtros/ }));
    fireEvent.click(screen.getByRole("button", { name: /Persona, fechas/ }));
    fireEvent.change(screen.getByLabelText("Desde"), {
      target: { value: "2026-10-13" },
    });
    fireEvent.change(screen.getByLabelText("Resultado"), {
      target: { value: "pendiente" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    fireEvent.click(screen.getByRole("button", { name: /^Filtros/ }));
    expect(screen.getByLabelText("Desde")).toHaveValue("2026-10-13");
    expect(screen.getByLabelText("Resultado")).toHaveValue("pendiente");
    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(aplicar).toHaveBeenLastCalledWith({});
  });
  it("ofrece el formulario en escritorio sin abrir un panel", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1280,
    });
    render(<Harness />);
    expect(screen.getByLabelText("Tipo de acción")).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Cambiar precio" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Procesos / servidor" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
