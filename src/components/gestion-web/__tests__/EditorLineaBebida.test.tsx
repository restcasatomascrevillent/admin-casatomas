// Una bebida del maridaje o de la cata (historia 4093221d, ADR-9 y E6):
// - vino de la carta: los sulfitos se ven y no se editan;
// - bebida de la carta: casilla, desmarcada al elegirla;
// - a mano: «Vino, cava o champagne» / «Otra bebida» y después la casilla.
// Nombre editable solo a mano, descripción corta, Quitar y Cambiar.

import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { EditorLineaBebida, ElegirLineaBebida } from "@/components/gestion-web/EditorLineaBebida";
import type { LineaBebidaNovedad } from "@/lib/menu-novedad";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const VINO: LineaBebidaNovedad = {
  id: "m2",
  origen: "vino",
  refId: "vino-fondillon",
  nombre: "Fondillón",
  descripcion: null,
  sulfitos: true,
  traducciones: { en: { nombre: "Fondillon", descripcion: null } },
};
const BEBIDA: LineaBebidaNovedad = {
  id: "c1",
  origen: "bebida",
  refId: "bebida-whisky-12",
  nombre: "Whisky de malta 12 años",
  descripcion: "Solo",
  sulfitos: false,
  traducciones: { en: { nombre: "12-year-old malt whisky", descripcion: "Neat" } },
};
const LIBRE: LineaBebidaNovedad = {
  id: "m1",
  origen: "libre",
  refId: null,
  nombre: "Cava brut nature",
  descripcion: "Bien frío",
  sulfitos: true,
  traducciones: { en: { nombre: "Brut nature cava", descripcion: "Well chilled" } },
};

let ultima: LineaBebidaNovedad | null;

function Harness({
  inicial,
  onQuitar = vi.fn(),
  onCambiar,
  disabled,
}: {
  inicial: LineaBebidaNovedad | null;
  onQuitar?: () => void;
  onCambiar?: () => void;
  disabled?: boolean;
}) {
  const [linea, setLinea] = useState<LineaBebidaNovedad | null>(inicial);
  ultima = linea;
  if (!linea) {
    return <ElegirLineaBebida vinos={[]} bebidas={[]} cargando={false} onElegir={setLinea} titulo="Bebida del maridaje" />;
  }
  return (
    <EditorLineaBebida
      linea={linea}
      onChange={setLinea}
      onQuitar={() => {
        setLinea(null);
        onQuitar();
      }}
      onCambiar={onCambiar}
      titulo="Bebida del maridaje"
      disabled={disabled}
    />
  );
}

const nombre = () => screen.getByLabelText("Nombre");
const descripcion = () => screen.getByLabelText("Descripción corta (opcional)");

describe("EditorLineaBebida · vino de la carta", () => {
  it("los sulfitos se ven y no se editan; el nombre es el de la carta", () => {
    render(<Harness inicial={VINO} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByTestId("sulfitos-carta")).toHaveTextContent("Según la carta: contiene sulfitos");
    expect(screen.getByText("Vino de la carta")).toBeInTheDocument();
    expect(nombre()).toHaveValue("Fondillón");
    expect(nombre()).toHaveAttribute("readonly");
  });

  it("un vino que no declara sulfitos lo dice", () => {
    render(<Harness inicial={{ ...VINO, sulfitos: false }} />);
    expect(screen.getByTestId("sulfitos-carta")).toHaveTextContent("La carta no declara sulfitos");
  });

  it("la descripción corta se escribe en el panel y vacía se guarda null", () => {
    render(<Harness inicial={VINO} />);
    fireEvent.change(descripcion(), { target: { value: "Alicante, dulce" } });
    expect(ultima).toMatchObject({ descripcion: "Alicante, dulce", sulfitos: true });
    // El nombre de la carta y su traducción se conservan.
    expect(ultima?.traducciones?.en).toEqual({ nombre: "Fondillon", descripcion: null });
    fireEvent.change(descripcion(), { target: { value: "" } });
    expect(ultima?.descripcion).toBeNull();
  });
});

describe("EditorLineaBebida · bebida de la carta", () => {
  it("lleva casilla de sulfitos editable y lo explica", () => {
    render(<Harness inicial={BEBIDA} />);
    const casilla = screen.getByRole("checkbox", { name: "Contiene sulfitos" });
    expect(casilla).not.toBeChecked();
    expect(casilla).toHaveAccessibleDescription(/La carta de bebidas no indica alérgenos/);
    fireEvent.click(casilla);
    expect(ultima?.sulfitos).toBe(true);
    expect(screen.getByRole("checkbox", { name: "Contiene sulfitos" })).toBeChecked();
    // Pulsar la etiqueta también la cambia (zona táctil grande).
    fireEvent.click(screen.getByText("Contiene sulfitos"));
    expect(ultima?.sulfitos).toBe(false);
    expect(nombre()).toHaveAttribute("readonly");
  });

  it("al cambiar la descripción conserva el nombre traducido y pierde la descripción traducida", () => {
    render(<Harness inicial={BEBIDA} />);
    fireEvent.change(descripcion(), { target: { value: "Con hielo" } });
    expect(ultima?.traducciones).toEqual({ en: { nombre: "12-year-old malt whisky", descripcion: null } });
  });
});

describe("EditorLineaBebida · a mano", () => {
  it("«Vino, cava o champagne» crea la línea con sulfitos y después sale la casilla", () => {
    render(<Harness inicial={null} />);
    const grupo = within(screen.getByRole("group", { name: "Bebida del maridaje" }));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(grupo.getByRole("button", { name: "Vino, cava o champagne" }));
    expect(ultima).toMatchObject({ origen: "libre", refId: null, nombre: "", sulfitos: true });
    expect(screen.getByRole("checkbox", { name: "Contiene sulfitos" })).toBeChecked();
    expect(screen.getByText("Sin nombre no se guarda.")).toBeInTheDocument();
    expect(nombre()).toHaveAttribute("aria-invalid", "true");
  });

  it("«Otra bebida» empieza sin sulfitos y la casilla se puede marcar", () => {
    render(<Harness inicial={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Otra bebida" }));
    expect(ultima).toMatchObject({ origen: "libre", sulfitos: false });
    fireEvent.click(screen.getByRole("checkbox", { name: "Contiene sulfitos" }));
    expect(ultima?.sulfitos).toBe(true);
  });

  it("el nombre se escribe y, si cambia, se pierden las traducciones viejas", () => {
    render(<Harness inicial={LIBRE} />);
    expect(screen.getByText("Escrita a mano")).toBeInTheDocument();
    expect(nombre()).not.toHaveAttribute("readonly");
    fireEvent.change(nombre(), { target: { value: "Cava rosado" } });
    expect(ultima?.nombre).toBe("Cava rosado");
    expect(ultima?.traducciones).toBeUndefined();
    expect(screen.queryByText("Sin nombre no se guarda.")).not.toBeInTheDocument();
    // La casilla de una línea a mano no la toca nadie más que el usuario.
    expect(ultima?.sulfitos).toBe(true);
  });
});

describe("EditorLineaBebida · acciones y accesibilidad", () => {
  it("Quitar la línea, con nombre accesible", () => {
    const onQuitar = vi.fn();
    render(<Harness inicial={VINO} onQuitar={onQuitar} />);
    fireEvent.click(screen.getByRole("button", { name: "Quitar «Fondillón»" }));
    expect(onQuitar).toHaveBeenCalledTimes(1);
    expect(ultima).toBeNull();
  });

  it("Cambiar solo sale si se puede", () => {
    const { unmount } = render(<Harness inicial={VINO} />);
    expect(screen.queryByRole("button", { name: /Cambiar/ })).not.toBeInTheDocument();
    unmount();
    const onCambiar = vi.fn();
    render(<Harness inicial={VINO} onCambiar={onCambiar} />);
    fireEvent.click(screen.getByRole("button", { name: "Cambiar «Fondillón»" }));
    expect(onCambiar).toHaveBeenCalledTimes(1);
  });

  it("es un grupo con nombre, táctil de 44 px y sin ancho mínimo que desborde a 390 px", () => {
    render(<Harness inicial={LIBRE} onCambiar={vi.fn()} />);
    const grupo = screen.getByRole("group", { name: "Bebida del maridaje: Cava brut nature" });
    expect(grupo).toHaveClass("min-w-0");
    for (const boton of within(grupo).getAllByRole("button", { name: /Quitar|Cambiar/ })) {
      expect(boton).toHaveClass("h-11");
    }
    expect(nombre()).toHaveClass("h-11");
    expect(descripcion()).toHaveClass("h-11");
    expect(descripcion()).toHaveAttribute("maxLength", "80");
  });

  it("deshabilitado no deja editar nada", () => {
    render(<Harness inicial={LIBRE} disabled />);
    expect(nombre()).toBeDisabled();
    expect(descripcion()).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Contiene sulfitos" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Quitar «Cava brut nature»" })).toBeDisabled();
  });
});

describe("EditorLineaBebida — la insignia de origen no se encoge (QA DEMO 31-10-2026, 390 px)", () => {
  it.each([
    [VINO, "Vino de la carta"],
    [LIBRE, "Escrita a mano"],
  ])("«%s» va en una sola línea y su columna no se encoge por debajo de ella", (linea, texto) => {
    render(<Harness inicial={linea} onCambiar={vi.fn()} />);
    const insignia = screen.getByTestId("origen-linea");
    expect(insignia).toHaveTextContent(texto as string);
    expect(insignia).toHaveClass("shrink-0", "whitespace-nowrap");
    // Con min-w-0 la columna se encogía hasta 64 px y la insignia se partía en tres líneas.
    expect(insignia.parentElement).not.toHaveClass("min-w-0");
  });
});
