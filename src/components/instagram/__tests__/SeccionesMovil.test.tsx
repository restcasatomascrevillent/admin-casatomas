/**
 * Selector de secciones de Instagram en el móvil: un botón con la sección actual y una hoja inferior con todas.
 */
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SeccionesMovil, type SeccionMovil } from "../SeccionesMovil";

const SECCIONES: SeccionMovil[] = [
  { valor: "estudio", etiqueta: "Estudio", icono: <i /> },
  { valor: "campanas", etiqueta: "Campañas", icono: <i />, contador: 2, etiquetaContador: "2 propuestas nuevas" },
  { valor: "encargos", etiqueta: "Encargos", icono: <i />, contador: 1, etiquetaContador: "1 pendientes" },
];

function Caja({ inicial = "estudio" }: { inicial?: string }) {
  const [valor, setValor] = useState(inicial);
  return <SeccionesMovil secciones={SECCIONES} valor={valor} onCambio={setValor} derecha={<span>marca</span>} pie={<span>cuenta</span>} />;
}

describe("SeccionesMovil", () => {
  it("enseña la sección actual en un botón de 48 px y lo de la derecha", () => {
    render(<Caja />);
    const boton = screen.getByTestId("selector-seccion");
    expect(boton).toHaveTextContent("Estudio");
    expect(boton).toHaveClass("h-12");
    expect(boton).toHaveAccessibleName("Sección: Estudio. Cambiar de sección");
    expect(screen.getByText("marca")).toBeInTheDocument();
  });

  it("avisa con un punto de que hay algo pendiente en otra sección", () => {
    render(<Caja />);
    expect(screen.getByTestId("aviso-otras-secciones")).toBeInTheDocument();
  });

  it("al pulsarlo abre la hoja con todas las secciones (56 px), los contadores y el pie", () => {
    render(<Caja />);
    fireEvent.click(screen.getByTestId("selector-seccion"));
    const hoja = screen.getByTestId("hoja-secciones");
    for (const nombre of ["Estudio", "Campañas", "Encargos"]) expect(within(hoja).getByRole("button", { name: new RegExp(nombre) })).toHaveClass("h-14");
    expect(within(hoja).getByLabelText("2 propuestas nuevas")).toHaveTextContent("2");
    expect(within(hoja).getByRole("button", { name: /Estudio/ })).toHaveAttribute("aria-current", "page");
    expect(within(hoja).getByText("cuenta")).toBeInTheDocument();
  });

  it("elegir una sección cambia el valor y cierra la hoja", () => {
    render(<Caja />);
    fireEvent.click(screen.getByTestId("selector-seccion"));
    fireEvent.click(within(screen.getByTestId("hoja-secciones")).getByRole("button", { name: /Encargos/ }));
    expect(screen.queryByTestId("hoja-secciones")).toBeNull();
    expect(screen.getByTestId("selector-seccion")).toHaveTextContent("Encargos");
    // Con «Encargos» activa, el contador de ESA sección va en el botón.
    expect(within(screen.getByTestId("selector-seccion")).getByLabelText("1 pendientes")).toBeInTheDocument();
  });
});
