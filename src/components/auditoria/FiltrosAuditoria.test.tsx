import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogFiltros } from "@/hooks/useAuditLog";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { FiltrosAuditoria } from "./FiltrosAuditoria";

const aplicar = vi.fn();
const quitar = vi.fn();
// Como la página: de entrada se ocultan los procesos del servidor.
const INICIALES: AuditLogFiltros = { origen: "sin_servidor" };
function Harness({ conQuitar = false }: { conQuitar?: boolean }) {
  const [pendientes, setPendientes] = useState<AuditLogFiltros>(INICIALES);
  const [activos, setActivos] = useState<AuditLogFiltros>(INICIALES);
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
      onQuitar={
        conQuitar
          ? (campos) => {
              quitar(campos);
              const siguientes = { ...activos };
              for (const campo of campos) delete siguientes[campo];
              setActivos(siguientes);
              setPendientes(siguientes);
            }
          : undefined
      }
    />
  );
}
beforeEach(() => {
  aplicar.mockClear();
  quitar.mockClear();
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
    // El origen va en «Más opciones»: la acción, la sección, la persona y las fechas se ven sin desplegar nada.
    expect(screen.queryByLabelText("Origen de la acción")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Desde")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Más opciones/ }));
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
    // Lo aplicado queda a la vista como chips, igual que en escritorio, y el botón dice cuántos hay.
    expect(
      screen.getByText("Acción: Pregunta a la IA de facturas"),
    ).toBeInTheDocument();
    expect(screen.getByText("Origen: Personas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Filtros/ })).toHaveAccessibleName("Filtros (2 aplicados)");
  });
  it("conserva fechas y resultado al reabrir y permite limpiar todos los filtros", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /^Filtros/ }));
    fireEvent.change(screen.getByLabelText("Desde"), {
      target: { value: "2026-10-13" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Más opciones/ }));
    fireEvent.change(screen.getByLabelText("Resultado"), {
      target: { value: "pendiente" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(screen.getByText("Desde: 13 oct 2026")).toBeInTheDocument();
    expect(screen.getByText("Resultado: Pendiente")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Filtros/ }));
    // «Más opciones» se abre solo si hay alguno puesto.
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
    expect(screen.queryByLabelText("Tipo de acción")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar filtros" }));
    expect(screen.getByLabelText("Tipo de acción")).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Cambiar precio" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Más opciones/ }));
    expect(
      screen.getByRole("option", { name: "Procesos / servidor" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

it("en escritorio recoge sin aplicar ni perder el borrador y mantiene un resumen al aplicar", () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  render(<Harness />);
  const mostrar = screen.getByRole("button", { name: "Mostrar filtros" });
  expect(mostrar).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(mostrar);
  fireEvent.change(screen.getByLabelText("Tipo de acción"), { target: { value: "consulta_ia" } });
  fireEvent.change(screen.getByLabelText("Buscar en auditoría"), { target: { value: "paella" } });
  fireEvent.click(screen.getByRole("button", { name: "Recoger filtros" }));
  expect(aplicar).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Tipo de acción")).not.toBeInTheDocument();
  expect(screen.getByText("Cambios sin aplicar")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Mostrar filtros" }));
  expect(screen.getByLabelText("Buscar en auditoría")).toHaveValue("paella");
  fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
  expect(aplicar).toHaveBeenCalledWith({ origen: "sin_servidor", accion: "consulta_ia", texto: "paella" });
  expect(screen.queryByLabelText("Tipo de acción")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Mostrar filtros" })).toHaveFocus();
  expect(screen.getByText("Acción: Pregunta a la IA de facturas")).toBeInTheDocument();
  expect(screen.getByText("Búsqueda: paella")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros activos" }));
  expect(screen.queryByText("Búsqueda: paella")).not.toBeInTheDocument();
});

it("el buscador está siempre a la vista y busca al pulsar Intro o «Buscar»", () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
  render(<Harness conQuitar />);
  const buscador = screen.getByRole("searchbox", { name: "Buscar en auditoría" });
  expect(screen.queryByRole("button", { name: "Buscar" })).not.toBeInTheDocument();
  fireEvent.change(buscador, { target: { value: "arroz" } });
  fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
  expect(aplicar).toHaveBeenLastCalledWith({ origen: "sin_servidor", texto: "arroz" });
  expect(screen.getByText("Búsqueda: arroz")).toBeInTheDocument();
  fireEvent.change(buscador, { target: { value: "vermut" } });
  fireEvent.submit(buscador);
  expect(aplicar).toHaveBeenLastCalledWith({ origen: "sin_servidor", texto: "vermut" });
  fireEvent.click(screen.getByRole("button", { name: "Borrar la búsqueda" }));
  expect(quitar).toHaveBeenLastCalledWith(["texto"]);
  expect(buscador).toHaveValue("");
});

it("cada filtro aplicado se quita con su «×» y «Limpiar» quita los de los chips", () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  render(<Harness conQuitar />);
  fireEvent.click(screen.getByRole("button", { name: "Mostrar filtros" }));
  fireEvent.change(screen.getByLabelText("Persona / proceso"), { target: { value: "ana" } });
  fireEvent.change(screen.getByLabelText("Sección"), { target: { value: "reservas" } });
  fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
  expect(screen.getByRole("button", { name: "Mostrar filtros" })).toHaveTextContent("2");
  fireEvent.click(screen.getByRole("button", { name: "Quitar el filtro Persona: ana" }));
  expect(quitar).toHaveBeenLastCalledWith(["actor"]);
  expect(screen.queryByText("Persona: ana")).not.toBeInTheDocument();
  expect(screen.getByText("Sección: Reservas")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros activos" }));
  expect(quitar).toHaveBeenLastCalledWith(["tabla"]);
  expect(screen.queryByRole("group", { name: "Filtros aplicados" })).not.toBeInTheDocument();
});

it("no repite como chip lo que ya dice la categoría rápida", () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  render(
    <FiltrosAuditoria
      pendientes={{ origen: "sin_servidor", accion: "actualizar", tabla: "Platos", desde: "2026-10-01" }}
      activos={{ origen: "sin_servidor", accion: "actualizar", tabla: "Platos", desde: "2026-10-01" }}
      tablas={["Platos"]}
      onChange={() => {}}
      onAplicar={() => {}}
      onLimpiar={() => {}}
      ocultarEnResumen={["accion", "tabla"]}
    />,
  );
  expect(screen.getByText("Desde: 1 oct 2026")).toBeInTheDocument();
  expect(screen.queryByText("Sección: Platos")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Mostrar filtros" })).toHaveTextContent("1");
});

it("no busca con menos de 3 letras y lo explica (la búsqueda va por un índice de grupos de 3 letras)", () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
  render(<Harness conQuitar />);
  const buscador = screen.getByRole("searchbox", { name: "Buscar en auditoría" });
  fireEvent.change(buscador, { target: { value: "ia" } });
  expect(screen.getByText("Escribe al menos 3 letras para buscar.")).toBeInTheDocument();
  expect(buscador).toHaveAccessibleDescription("Escribe al menos 3 letras para buscar.");
  expect(screen.getByRole("button", { name: "Buscar" })).toBeDisabled();
  fireEvent.submit(buscador);
  expect(aplicar).not.toHaveBeenCalled();
  fireEvent.change(buscador, { target: { value: "iaf" } });
  expect(screen.queryByText("Escribe al menos 3 letras para buscar.")).not.toBeInTheDocument();
  fireEvent.submit(buscador);
  expect(aplicar).toHaveBeenLastCalledWith({ origen: "sin_servidor", texto: "iaf" });
});
