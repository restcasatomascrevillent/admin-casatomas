import { useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorReel, EstudioReel, VistaPreviaReel, crearReelDesdeBase, type ReelPieza } from "..";

function ConEstado({ inicial, onCambio, ...resto }: { inicial: ReelPieza; onCambio?: (r: ReelPieza) => void } & Partial<Parameters<typeof EditorReel>[0]>) {
  const [reel, setReel] = useState(inicial);
  return (
    <EditorReel
      reel={reel}
      onChange={(r) => {
        setReel(r);
        onCambio?.(r);
      }}
      {...resto}
    />
  );
}

const filas = () => within(screen.getByRole("list", { name: "Escenas del reel" })).getAllByRole("listitem");

describe("EditorReel", () => {
  it("añade y quita escenas", () => {
    const onCambio = vi.fn();
    render(<ConEstado inicial={crearReelDesdeBase("del-mar")} onCambio={onCambio} />);
    expect(filas()).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: /Añadir escena/ }));
    expect(filas()).toHaveLength(6);
    expect(onCambio.mock.lastCall![0].escenas).toHaveLength(6);
    // la nueva va detrás de la seleccionada (la 1.ª) y queda seleccionada
    expect(screen.getByRole("heading", { name: "Escena 2" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Quitar «Ostras»" }));
    fireEvent.click(screen.getByRole("button", { name: "Quitar «Bogavante»" }));
    expect(filas()).toHaveLength(4);
    expect(onCambio.mock.lastCall![0].escenas.map((e: { id: string }) => e.id)).toEqual(["gancho", "e6", "atun", "salazones"]);
  });

  it("no deja quitar la última escena", () => {
    const reel = crearReelDesdeBase("libre");
    reel.escenas = [reel.escenas[0]];
    render(<ConEstado inicial={reel} />);
    expect(screen.getByRole("button", { name: "Quitar «Intro»" })).toBeDisabled();
  });

  it("reordena con las flechas", () => {
    const onCambio = vi.fn();
    render(<ConEstado inicial={crearReelDesdeBase("del-mar")} onCambio={onCambio} />);
    fireEvent.click(screen.getByRole("button", { name: "Bajar «Gancho»" }));
    expect(onCambio.mock.lastCall![0].escenas[1].id).toBe("gancho");
  });

  it("cambia textos y duración y enseña la duración total", () => {
    const onCambio = vi.fn();
    render(<ConEstado inicial={crearReelDesdeBase("del-mar")} onCambio={onCambio} />);
    expect(screen.getByText("20,5 s")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Título/), { target: { value: "¿Y tú?" } });
    expect(onCambio.mock.lastCall![0].escenas[0].rotulo.titulo).toBe("¿Y tú?");
    fireEvent.change(screen.getByLabelText("Duración (s)"), { target: { value: "5" } });
    expect(screen.getByText("22,5 s")).toBeInTheDocument();
  });

  it("elige foto con la prop elegirFoto y avisa si es pequeña", async () => {
    const elegirFoto = vi.fn().mockResolvedValue({ id: "drive:xyz", url: "https://x/tmp/a.jpg", ancho: 1000, alto: 1500 });
    const onFotoElegida = vi.fn();
    const onCambio = vi.fn();
    render(<ConEstado inicial={crearReelDesdeBase("del-mar")} elegirFoto={elegirFoto} onFotoElegida={onFotoElegida} onCambio={onCambio} />);
    fireEvent.click(screen.getByRole("button", { name: /Cambiar foto/ }));
    await waitFor(() => expect(onCambio).toHaveBeenCalled());
    expect(elegirFoto).toHaveBeenCalledWith(expect.objectContaining({ marca: "casa-tomas", escena: 0, nombre: "Gancho" }));
    expect(onFotoElegida).toHaveBeenCalledWith(expect.objectContaining({ id: "drive:xyz" }));
    expect(onCambio.mock.lastCall![0].escenas[0].foto).toBe("drive:xyz");
    expect(await screen.findByText(/1000×1500/)).toBeInTheDocument();
  });

  it("enseña los problemas (texto que se sale)", () => {
    render(<ConEstado inicial={crearReelDesdeBase("del-mar")} />);
    fireEvent.change(screen.getByLabelText(/Título/), { target: { value: "Supercalifragilísticoespialidoso" } });
    expect(screen.getByText(/no cabe a lo ancho/)).toBeInTheDocument();
  });

  it("cambia de base tras confirmar", () => {
    const onCambio = vi.fn();
    render(<ConEstado inicial={crearReelDesdeBase("del-mar")} onCambio={onCambio} />);
    fireEvent.change(screen.getByLabelText("Empezar desde una base"), { target: { value: "touza" } });
    fireEvent.click(screen.getByRole("button", { name: "Sustituir el reel" }));
    expect(onCambio.mock.lastCall![0].base).toBe("touza");
    expect(filas()).toHaveLength(6);
  });
});

describe("VistaPreviaReel", () => {
  it("pinta el reel, conmuta la zona segura y mueve el instante", () => {
    const { container } = render(<VistaPreviaReel reel={crearReelDesdeBase("del-mar")} />);
    expect(container.querySelector("[data-zona-segura]")).not.toBeNull();
    fireEvent.click(screen.getByRole("switch"));
    expect(container.querySelector("[data-zona-segura]")).toBeNull();
    fireEvent.change(screen.getByLabelText("Instante del reel"), { target: { value: "19" } });
    expect(container.querySelector("[data-reel]")?.getAttribute("data-reel-t")).toBe("19.0000");
    expect(screen.getByText("Reservar mesa")).toBeInTheDocument();
  });

  it("play/pausa avanza el tiempo", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    try {
      const { container } = render(<VistaPreviaReel reel={crearReelDesdeBase("del-mar")} />);
      fireEvent.click(screen.getByRole("button", { name: "Reproducir" }));
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      const t = Number(container.querySelector("[data-reel]")?.getAttribute("data-reel-t"));
      expect(t).toBeGreaterThan(0.5);
      fireEvent.click(screen.getByRole("button", { name: "Pausar" }));
      expect(screen.getByRole("button", { name: "Reproducir" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("EstudioReel", () => {
  it("monta editor y vista previa; la foto elegida se ve en la vista previa", async () => {
    function Envoltorio() {
      const [reel, setReel] = useState(crearReelDesdeBase("touza"));
      return <EstudioReel reel={reel} onChange={setReel} elegirFoto={async () => ({ id: "drive:nueva", url: "https://x/tmp/nueva.jpg" })} />;
    }
    const { container } = render(<Envoltorio />);
    fireEvent.click(screen.getByRole("button", { name: /Cambiar foto/ }));
    await waitFor(() => expect(container.querySelector('[data-reel] img[src="https://x/tmp/nueva.jpg"]')).not.toBeNull());
  });
});
