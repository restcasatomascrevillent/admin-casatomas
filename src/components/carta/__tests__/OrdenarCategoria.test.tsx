import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { OrdenarCategoria, type ElementoOrdenable } from "../OrdenarCategoria";

const elementos: ElementoOrdenable[] = [
  { id: "a", nombre: "Croquetas", imagen_url: "https://x/a.webp", activado: true },
  { id: "b", nombre: "Ensaladilla", imagen_url: null, activado: false },
  { id: "c", nombre: "Gilda", imagen_url: null, activado: true },
];

function nombresEnOrden() {
  const lista = screen.getByRole("list", { name: /en orden/ });
  return within(lista)
    .getAllByRole("listitem")
    .map((li) => li.querySelector("p")?.textContent);
}

function montar(props: Partial<Parameters<typeof OrdenarCategoria>[0]> = {}) {
  const onGuardar = vi.fn(async () => undefined);
  const onSalir = vi.fn();
  render(
    <OrdenarCategoria
      categoria="Entrantes"
      elementos={elementos}
      nombrePlural="platos"
      guardando={false}
      onGuardar={onGuardar}
      onSalir={onSalir}
      {...props}
    />,
  );
  return { onGuardar, onSalir };
}

describe("Modo «Ordenar» de una categoría", () => {
  it("enseña la categoría en lista compacta y no deja guardar sin cambios", () => {
    montar();
    expect(screen.getByRole("heading", { name: "Ordenar «Entrantes»" })).toBeInTheDocument();
    expect(nombresEnOrden()).toEqual(["Croquetas", "Ensaladilla", "Gilda"]);
    expect(screen.getByText("Oculto en la web")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Guardar orden/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Subir Croquetas" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Bajar Gilda" })).toBeDisabled();
    // Asa de arrastre (ratón, dedo y teclado) en cada fila.
    expect(screen.getByRole("button", { name: "Arrastrar Ensaladilla" })).toBeInTheDocument();
  });

  it("sube y baja con las flechas y guarda los ids en el orden nuevo", async () => {
    const { onGuardar, onSalir } = montar();
    fireEvent.click(screen.getByRole("button", { name: "Subir Gilda" }));
    expect(nombresEnOrden()).toEqual(["Croquetas", "Gilda", "Ensaladilla"]);
    fireEvent.click(screen.getByRole("button", { name: "Bajar Croquetas" }));
    expect(nombresEnOrden()).toEqual(["Gilda", "Croquetas", "Ensaladilla"]);

    fireEvent.click(screen.getByRole("button", { name: /Guardar orden/ }));
    await waitFor(() => expect(onGuardar).toHaveBeenCalledWith(["c", "a", "b"]));
    await waitFor(() => expect(onSalir).toHaveBeenCalled());
  });

  it("si el guardado falla, se queda en el modo ordenar para reintentar", async () => {
    const onGuardar = vi.fn(async () => {
      throw new Error("sin red");
    });
    const { onSalir } = montar({ onGuardar });
    fireEvent.click(screen.getByRole("button", { name: "Subir Gilda" }));
    fireEvent.click(screen.getByRole("button", { name: /Guardar orden/ }));
    await waitFor(() => expect(onGuardar).toHaveBeenCalled());
    expect(onSalir).not.toHaveBeenCalled();
    expect(nombresEnOrden()).toEqual(["Croquetas", "Gilda", "Ensaladilla"]);
  });

  it("«Cancelar» sale sin guardar", () => {
    const { onGuardar, onSalir } = montar();
    fireEvent.click(screen.getByRole("button", { name: "Subir Gilda" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onSalir).toHaveBeenCalled();
    expect(onGuardar).not.toHaveBeenCalled();
  });
});
