/**
 * La Lista vista como el libro (10/11/2026, petición del dueño: «hacer o simular como el libro, que tenga
 * hojas que vas pasando»): una hoja por día que se pasa con las flechas, deslizando el dedo o con «Hoy», y
 * tocar una reserva abre su editor (el mismo que la tabla).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { claveDia, pasarHoja, tituloHoja } from "@/lib/reservas/libroReservas";

const h = vi.hoisted(() => ({
  pedidas: [] as string[],
  porDia: {} as Record<string, unknown[]>,
  editada: vi.fn(),
}));

vi.mock("@/hooks/useReservasServicioDia", () => ({
  CLAVE_RESERVAS_SERVICIO_DIA: "reservas-servicio-dia",
  useReservasServicioDia: (fecha: string) => {
    h.pedidas.push(fecha);
    return { data: h.porDia[fecha] ?? [], isLoading: false, isError: false, refetch: vi.fn() };
  },
}));
vi.mock("@/hooks/useEspaciosReserva", () => ({
  useEspaciosReserva: () => ({ data: [{ id: "s1", nombre: "Salón" }] }),
}));
vi.mock("@/components/reservas/EditarReservaDialog", () => ({
  EditarReservaDialog: ({ reservaId }: { reservaId: string }) => {
    h.editada(reservaId);
    return <div data-testid="editor-reserva">{reservaId}</div>;
  },
}));

import { ListaComoLibro } from "@/components/reservas/libro/ListaComoLibro";

const hoy = claveDia(new Date());
const titulo = () => screen.getByRole("button", { name: "Elegir día" });
const hojas = () => screen.getAllByRole("article");

beforeEach(() => {
  h.pedidas = [];
  h.porDia = {};
  h.editada.mockClear();
});

describe("ListaComoLibro · pasar hojas", () => {
  it("abre en la hoja de hoy (una sola hoja en tablet)", () => {
    render(<ListaComoLibro />);
    expect(titulo()).toHaveTextContent(tituloHoja(hoy));
    expect(hojas()).toHaveLength(1);
    expect(hojas()[0]).toHaveAccessibleName(`Hoja del ${tituloHoja(hoy)}`);
    expect(screen.getByRole("button", { name: "Hoy" })).toBeDisabled();
  });

  it("las flechas pasan a la hoja siguiente y a la anterior, y «Hoy» vuelve", () => {
    render(<ListaComoLibro />);
    fireEvent.click(screen.getByRole("button", { name: "Hoja siguiente" }));
    expect(titulo()).toHaveTextContent(tituloHoja(pasarHoja(hoy, 1)));
    expect(screen.getByTestId("libro-lista").firstElementChild).toHaveAttribute("data-sentido", "siguiente");
    expect(h.pedidas).toContain(pasarHoja(hoy, 1));

    fireEvent.click(screen.getByRole("button", { name: "Hoja anterior" }));
    fireEvent.click(screen.getByRole("button", { name: "Hoja anterior" }));
    expect(titulo()).toHaveTextContent(tituloHoja(pasarHoja(hoy, -1)));
    expect(screen.getByTestId("libro-lista").firstElementChild).toHaveAttribute("data-sentido", "anterior");

    fireEvent.click(screen.getByRole("button", { name: "Hoy" }));
    expect(titulo()).toHaveTextContent(tituloHoja(hoy));
  });

  it("deslizar el dedo a la izquierda pasa a la hoja siguiente; a la derecha, a la anterior", () => {
    render(<ListaComoLibro />);
    const libro = screen.getByTestId("libro-lista");
    fireEvent.touchStart(libro, { touches: [{ clientX: 400, clientY: 200 }] });
    fireEvent.touchEnd(libro, { changedTouches: [{ clientX: 250, clientY: 210 }] });
    expect(titulo()).toHaveTextContent(tituloHoja(pasarHoja(hoy, 1)));

    fireEvent.touchStart(libro, { touches: [{ clientX: 100, clientY: 200 }] });
    fireEvent.touchEnd(libro, { changedTouches: [{ clientX: 300, clientY: 200 }] });
    expect(titulo()).toHaveTextContent(tituloHoja(hoy));
  });

  it("un gesto corto o vertical (bajar por la hoja) no pasa hoja", () => {
    render(<ListaComoLibro />);
    const libro = screen.getByTestId("libro-lista");
    fireEvent.touchStart(libro, { touches: [{ clientX: 300, clientY: 100 }] });
    fireEvent.touchEnd(libro, { changedTouches: [{ clientX: 270, clientY: 100 }] });
    fireEvent.touchStart(libro, { touches: [{ clientX: 300, clientY: 100 }] });
    fireEvent.touchEnd(libro, { changedTouches: [{ clientX: 220, clientY: 400 }] });
    expect(titulo()).toHaveTextContent(tituloHoja(hoy));
  });
});

describe("ListaComoLibro · las reservas de la hoja", () => {
  it("enseña Comida y Cena y, al tocar una reserva, abre su editor", () => {
    h.porDia[hoy] = [
      { id: "r1", nombre: "Esther", hora: "14:15:00", numero_comensales: 2, estado: "confirmada", espacio_id: "s1" },
      { id: "r2", nombre: "Paco", hora: "21:00:00", numero_comensales: 4, estado: "pendiente", espacio_id: null },
    ];
    render(<ListaComoLibro />);
    const hoja = hojas()[0];
    expect(within(hoja).getByRole("region", { name: "Comida" })).toHaveTextContent("Esther");
    expect(within(hoja).getByRole("region", { name: "Cena" })).toHaveTextContent("Paco");
    expect(within(hoja).getByText("Salón")).toBeInTheDocument();
    expect(screen.queryByTestId("editor-reserva")).not.toBeInTheDocument();

    fireEvent.click(within(hoja).getByRole("button", { name: /Abrir la reserva de Esther/ }));
    expect(screen.getByTestId("editor-reserva")).toHaveTextContent("r1");
    expect(h.editada).toHaveBeenCalledWith("r1");
  });

  it("hoja sin reservas: «Hoja en blanco»", () => {
    render(<ListaComoLibro />);
    expect(within(hojas()[0]).getByText(/Hoja en blanco/)).toBeInTheDocument();
  });
});

describe("ListaComoLibro · libro abierto en pantallas anchas", () => {
  it("desde 1280 px se ven dos hojas: el día y el siguiente", () => {
    const antes = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    try {
      render(<ListaComoLibro />);
      expect(hojas().map((a) => a.getAttribute("aria-label"))).toEqual([
        `Hoja del ${tituloHoja(hoy)}`,
        `Hoja del ${tituloHoja(pasarHoja(hoy, 1))}`,
      ]);
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: antes });
    }
  });
});
