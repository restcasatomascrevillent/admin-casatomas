import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SelectorZona } from "../SelectorZona";
import { InsigniaZona } from "../InterruptoresServiciosOnline";

const SALAS = [
  { id: "salon", nombre: "Salón" },
  { id: "comedor", nombre: "Comedor" },
  { id: "terraza", nombre: "Terraza", exterior: true },
];

describe("SelectorZona", () => {
  it("tocar «Fuera» manda la zona y la Terraza", () => {
    const onCambiar = vi.fn();
    render(<SelectorZona zona={null} espacioId={null} salas={SALAS} servicio={null} onCambiar={onCambiar} />);
    fireEvent.click(screen.getByTestId("zona-fuera"));
    expect(onCambiar).toHaveBeenCalledWith("fuera", "terraza");
  });

  it("tocar la marcada la quita sin tocar la sala", () => {
    const onCambiar = vi.fn();
    render(<SelectorZona zona="dentro" espacioId="salon" salas={SALAS} servicio={null} onCambiar={onCambiar} />);
    fireEvent.click(screen.getByTestId("zona-dentro"));
    expect(onCambiar).toHaveBeenCalledWith(null, "salon");
  });

  it("avisa si la sala elegida no casa con la zona", () => {
    render(<SelectorZona zona="fuera" espacioId="comedor" salas={SALAS} servicio={null} onCambiar={vi.fn()} />);
    expect(screen.getByTestId("aviso-zona-sala")).toHaveTextContent("Has dicho fuera y Comedor es de dentro.");
  });
});

describe("InsigniaZona", () => {
  it("«Fuera» / «Dentro» y nada sin zona", () => {
    const { rerender } = render(<InsigniaZona reserva={{ zona_preferida: "fuera" }} />);
    expect(screen.getByTestId("insignia-zona")).toHaveTextContent("Fuera");
    rerender(<InsigniaZona reserva={{ zona_preferida: "dentro" }} />);
    expect(screen.getByTestId("insignia-zona")).toHaveTextContent("Dentro");
    rerender(<InsigniaZona reserva={{ zona_preferida: null }} />);
    expect(screen.queryByTestId("insignia-zona")).not.toBeInTheDocument();
  });
});
