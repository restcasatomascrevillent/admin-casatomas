import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ sentarFuera: vi.fn(), quitarFuera: vi.fn() }));
vi.mock("@/hooks/useAccionesServicioReserva", () => ({
  useAccionesServicioReserva: () => ({ sentarFuera: h.sentarFuera, quitarFuera: h.quitarFuera }),
}));

import { BotonSentarFuera, EtiquetaFuera } from "../SentarFuera";

const base = { id: "r1", nombre: "García", hora: "21:00:00", numero_comensales: 4, estado: "confirmada", espacio_id: "comedor" };

beforeEach(() => {
  h.sentarFuera.mockReset().mockResolvedValue(true);
  h.quitarFuera.mockReset().mockResolvedValue(true);
});

describe("«Sentar fuera»", () => {
  it("el botón azul abre el diálogo con Touza elegida y sienta fuera con la mesa", async () => {
    render(<BotonSentarFuera reserva={base} />);
    const boton = screen.getByTestId("boton-sentar-fuera");
    expect(boton.className).toContain("bg-[#0050FF]");
    fireEvent.click(boton);
    expect(screen.getByRole("radio", { name: "Touza" })).toHaveAttribute("aria-checked", "true");
    fireEvent.change(screen.getByLabelText(/Mesa o nota/), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /Sentar fuera · Touza/ }));
    await waitFor(() => expect(h.sentarFuera).toHaveBeenCalledWith(base, { lugar: "Touza", mesa: "4" }));
  });

  it("«Otro sitio» con texto libre; sin texto no deja guardar", async () => {
    render(<BotonSentarFuera reserva={base} />);
    fireEvent.click(screen.getByTestId("boton-sentar-fuera"));
    fireEvent.click(screen.getByRole("radio", { name: "Otro sitio" }));
    expect(screen.getByRole("button", { name: "Elige dónde" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Escribe dónde"), { target: { value: "Barra" } });
    fireEvent.click(screen.getByRole("button", { name: /Sentar fuera · Barra/ }));
    await waitFor(() => expect(h.sentarFuera).toHaveBeenCalledWith(base, { lugar: "Barra", mesa: "" }));
  });

  it("una ya fuera: viene con su sitio y se puede volver dentro", async () => {
    const fuera = { ...base, estado: "completada", espacio_id: null, fuera_lugar: "Terraza Touza", fuera_mesa: "3", fuera_espacio_previo_id: "comedor" };
    render(<BotonSentarFuera reserva={fuera} />);
    fireEvent.click(screen.getByTestId("boton-sentar-fuera"));
    expect(screen.getByRole("radio", { name: "Terraza Touza" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText(/Mesa o nota/)).toHaveValue("3");
    fireEvent.click(screen.getByRole("button", { name: /Sentar dentro/ }));
    await waitFor(() => expect(h.quitarFuera).toHaveBeenCalledWith(fuera));
  });

  it("la etiqueta solo sale si está fuera", () => {
    const { rerender } = render(<EtiquetaFuera reserva={{ estado: "completada", fuera_lugar: "Touza", fuera_mesa: "4" }} />);
    expect(screen.getByTestId("etiqueta-fuera")).toHaveTextContent("Fuera · Touza · Mesa 4");
    rerender(<EtiquetaFuera reserva={{ estado: "confirmada", fuera_lugar: "Touza" }} />);
    expect(screen.queryByTestId("etiqueta-fuera")).toBeNull();
  });
});
