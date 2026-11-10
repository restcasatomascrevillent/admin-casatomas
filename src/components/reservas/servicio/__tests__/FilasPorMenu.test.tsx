import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { FilasPorMenu } from "../FilasPorMenu";

const filas = [
  { reserva: { id: "a", hora: "14:00:00", numero_comensales: 2, menu_del_dia: true } },
  { reserva: { id: "b", hora: "13:00:00", numero_comensales: 4, menu_del_dia: false } },
  { reserva: { id: "c", hora: "13:30:00", numero_comensales: 3, menu_del_dia: null } },
  { reserva: { id: "d", hora: "13:00:00", numero_comensales: 5, menu_del_dia: true } },
];
const pintar = (f: (typeof filas)[number]) => <li key={f.reserva.id}>{f.reserva.id}</li>;

describe("FilasPorMenu", () => {
  it("comida de un martes: bloques con cabecera fina y total de pax", () => {
    render(<FilasPorMenu filas={filas} servicio={{ fecha: "2026-11-10", filtroTurno: "comida" }} pintar={pintar} />);
    const menu = screen.getByRole("group", { name: "Menú del día: 2 · 7 pax" });
    expect(within(menu).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["d", "a"]);
    expect(screen.getByRole("group", { name: "Carta: 1 · 4 pax" })).toHaveTextContent("b");
    expect(screen.getByRole("group", { name: "Resto: 1 · 3 pax" })).toHaveTextContent("c");
  });

  it("la cena o un viernes: una sola lista, como siempre", () => {
    const { rerender } = render(<FilasPorMenu filas={filas} servicio={{ fecha: "2026-11-10", filtroTurno: "cena" }} pintar={pintar} />);
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["a", "b", "c", "d"]);
    rerender(<FilasPorMenu filas={filas} servicio={{ fecha: "2026-11-13", filtroTurno: "comida" }} pintar={pintar} />);
    expect(screen.queryByRole("group")).toBeNull();
  });
});
