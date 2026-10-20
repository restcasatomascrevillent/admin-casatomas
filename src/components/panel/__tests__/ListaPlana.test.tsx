import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Trash2 } from "lucide-react";
import { FilaPlana, ListaPlana } from "../ListaPlana";

describe("ListaPlana + FilaPlana", () => {
  it("lista con separador fino, y con `scroll` toma el alto que sobra", () => {
    render(
      <ListaPlana aria-label="Cosas" scroll>
        <FilaPlana titulo="Una" />
        <FilaPlana titulo="Dos" />
      </ListaPlana>,
    );
    const lista = screen.getByRole("list", { name: "Cosas" });
    expect(lista).toHaveClass("divide-y", "flex-1", "min-h-0", "overflow-y-auto");
    expect(within(lista).getAllByRole("listitem")).toHaveLength(2);
  });

  it("sin filas pinta `vacio` en lugar de la lista", () => {
    render(<ListaPlana vacio={<p>Nada todavía</p>} aria-label="Cosas">{[]}</ListaPlana>);
    expect(screen.getByText("Nada todavía")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("título y subtítulo «a · b · c» truncados; los huecos se saltan", () => {
    render(<ListaPlana><FilaPlana titulo="ana@ejemplo.es" subtitulo={["Ana Pérez", null, "Reserva web", false, ""]} /></ListaPlana>);
    expect(screen.getByText("ana@ejemplo.es")).toHaveClass("truncate");
    const sub = screen.getByText(/Ana Pérez/);
    expect(sub).toHaveClass("truncate");
    expect(sub.textContent).toBe("Ana Pérez · Reserva web");
  });

  it("fila de ~56 px, con importe y estado (punto de color + texto)", () => {
    render(
      <ListaPlana>
        <FilaPlana titulo="Factura 1" derecha="12,50 €" estado={{ texto: "Pagada", tono: "verde" }} onSeleccionar={() => {}} />
      </ListaPlana>,
    );
    expect(screen.getByRole("button", { name: /Factura 1/ })).toHaveClass("min-h-14");
    expect(screen.getByText("12,50 €")).toHaveClass("tabular-nums");
    const estado = screen.getByText("Pagada");
    expect(estado.querySelector("span")).toHaveClass("bg-emerald-500", "rounded-full");
  });

  it("seleccionable: marca la fila con aria-current y avisa al tocar", () => {
    const onSeleccionar = vi.fn();
    const { rerender } = render(<ListaPlana><FilaPlana titulo="Uno" onSeleccionar={onSeleccionar} /></ListaPlana>);
    expect(screen.getByRole("listitem")).not.toHaveAttribute("aria-current");
    fireEvent.click(screen.getByRole("button", { name: "Uno" }));
    expect(onSeleccionar).toHaveBeenCalledTimes(1);
    rerender(<ListaPlana><FilaPlana titulo="Uno" seleccionada onSeleccionar={onSeleccionar} /></ListaPlana>);
    expect(screen.getByRole("listitem")).toHaveAttribute("aria-current", "true");
  });

  it("acción primaria: única con color dorado, independiente de la selección", () => {
    const onSeleccionar = vi.fn();
    const onClick = vi.fn();
    render(<ListaPlana><FilaPlana titulo="Uno" onSeleccionar={onSeleccionar} accion={{ etiqueta: "Abrir", onClick }} /></ListaPlana>);
    const abrir = screen.getByRole("button", { name: "Abrir" });
    expect(abrir.className).toContain("bg-accent");
    fireEvent.click(abrir);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onSeleccionar).not.toHaveBeenCalled();
  });

  it("menú «⋯»: abre las demás acciones y ejecuta la elegida", async () => {
    const borrar = vi.fn();
    render(<ListaPlana><FilaPlana titulo="Uno" menu={[{ etiqueta: "Eliminar", onClick: borrar, icono: Trash2, destructiva: true }]} /></ListaPlana>);
    const disparador = screen.getByRole("button", { name: "Más acciones" });
    expect(disparador.className).toContain("pointer-coarse:h-11");
    fireEvent.pointerDown(disparador, { button: 0, ctrlKey: false });
    const opcion = await screen.findByRole("menuitem", { name: "Eliminar" });
    expect(opcion).toHaveClass("text-destructive");
    fireEvent.click(opcion);
    expect(borrar).toHaveBeenCalledTimes(1);
  });

  it("sin menú ni acción no pinta botones", () => {
    render(<ListaPlana><FilaPlana titulo="Uno" /></ListaPlana>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
