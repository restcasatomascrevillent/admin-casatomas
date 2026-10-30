// Buscador de vinos y bebidas de la carta (historia 4093221d, E5 y ADR-9):
// agrupa en «Vinos» y «Bebidas», busca por nombre o categoría, se maneja con
// el teclado y crea la línea con los sulfitos de la carta (vino) o desmarcados
// (bebida).

import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SelectorBebidaCarta } from "@/components/gestion-web/SelectorBebidaCarta";
import type { BebidaDeCarta, VinoDeCarta } from "@/hooks/useBebidasParaMenu";

beforeAll(() => {
  // cmdk desplaza el elemento activo a la vista; jsdom no lo implementa.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const FONDILLON: VinoDeCarta = {
  id: "vino-fondillon",
  nombre: "Fondillón",
  nombre_en: "Fondillon",
  nombre_fr: "Fondillón d'Alicante",
  categoria: "GENEROSOS",
  alergenos_oficiales: ["sulfitos"],
  activado: true,
  restaurante: true,
};
const TINTO: VinoDeCarta = {
  id: "vino-tinto",
  nombre: "Monastrell joven",
  nombre_en: null,
  nombre_fr: null,
  categoria: "TINTOS",
  alergenos_oficiales: null,
  activado: true,
  restaurante: true,
};
const SIN_NOMBRE: VinoDeCarta = { ...TINTO, id: "vino-sin-nombre", nombre: " " };
const APAGADO: VinoDeCarta = { ...TINTO, id: "vino-apagado", nombre: "Vino retirado", activado: false };
const WHISKY: BebidaDeCarta = {
  id: "bebida-whisky-12",
  nombre: "Whisky de malta 12 años",
  nombre_en: "12-year-old malt whisky",
  nombre_fr: null,
  categoria: "Licores",
  activado: true,
  restaurante: true,
};

function montar(props: Partial<Parameters<typeof SelectorBebidaCarta>[0]> = {}) {
  const onElegir = vi.fn();
  render(
    <SelectorBebidaCarta
      vinos={[FONDILLON, TINTO, SIN_NOMBRE, APAGADO]}
      bebidas={[WHISKY]}
      cargando={false}
      onElegir={onElegir}
      {...props}
    />,
  );
  return { onElegir };
}

const abrir = () => fireEvent.click(screen.getByRole("button", { name: "De la carta" }));

describe("SelectorBebidaCarta", () => {
  it("agrupa en Vinos y Bebidas con la categoría y deja fuera lo que no está en la carta", async () => {
    montar();
    abrir();
    const opciones = await screen.findAllByRole("option");
    expect(opciones.map((o) => o.textContent)).toEqual([
      expect.stringContaining("Fondillón"),
      expect.stringContaining("Monastrell joven"),
      expect.stringContaining("Whisky de malta 12 años"),
    ]);
    expect(screen.getByText("Vinos")).toBeInTheDocument();
    expect(screen.getByText("Bebidas")).toBeInTheDocument();
    expect(screen.getByText("GENEROSOS · contiene sulfitos")).toBeInTheDocument();
    expect(screen.getByText("TINTOS")).toBeInTheDocument();
    expect(screen.getByText("Licores")).toBeInTheDocument();
    expect(screen.queryByText("Vino retirado")).not.toBeInTheDocument();
  });

  it("al elegir un vino copia nombre, traducciones y sulfitos de la carta", async () => {
    const { onElegir } = montar();
    abrir();
    fireEvent.click(await screen.findByRole("option", { name: /Fondillón/ }));
    expect(onElegir).toHaveBeenCalledTimes(1);
    expect(onElegir.mock.calls[0][0]).toMatchObject({
      origen: "vino",
      refId: "vino-fondillon",
      nombre: "Fondillón",
      descripcion: null,
      sulfitos: true,
      traducciones: {
        en: { nombre: "Fondillon", descripcion: null },
        fr: { nombre: "Fondillón d'Alicante", descripcion: null },
      },
    });
    // Se cierra al elegir.
    await waitFor(() => expect(screen.queryByRole("option")).not.toBeInTheDocument());
  });

  it("un vino sin sulfitos declarados da false", async () => {
    const { onElegir } = montar();
    abrir();
    fireEvent.click(await screen.findByRole("option", { name: /Monastrell/ }));
    expect(onElegir.mock.calls[0][0]).toMatchObject({ origen: "vino", refId: "vino-tinto", sulfitos: false });
    expect(onElegir.mock.calls[0][0].traducciones).toBeUndefined();
  });

  it("al elegir una bebida la casilla de sulfitos empieza desmarcada", async () => {
    const { onElegir } = montar();
    abrir();
    fireEvent.click(await screen.findByRole("option", { name: /Whisky/ }));
    expect(onElegir.mock.calls[0][0]).toMatchObject({
      origen: "bebida",
      refId: "bebida-whisky-12",
      nombre: "Whisky de malta 12 años",
      sulfitos: false,
      traducciones: { en: { nombre: "12-year-old malt whisky", descripcion: null } },
    });
  });

  it("busca por categoría y se elige con el teclado", async () => {
    const { onElegir } = montar();
    abrir();
    const buscador = await screen.findByRole("combobox", { name: "Buscar vino o bebida en la carta" });
    fireEvent.change(buscador, { target: { value: "licores" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole("option")).toHaveAttribute("aria-selected", "true"));
    fireEvent.keyDown(buscador, { key: "Enter" });
    expect(onElegir).toHaveBeenCalledWith(expect.objectContaining({ refId: "bebida-whisky-12" }));
  });

  it("dice que está cargando, que no hay coincidencias o que la carta falló", async () => {
    const { unmount } = render(
      <SelectorBebidaCarta vinos={[]} bebidas={[]} cargando onElegir={vi.fn()} />,
    );
    abrir();
    expect(await screen.findByText("Cargando la carta...")).toBeInTheDocument();
    unmount();

    render(<SelectorBebidaCarta vinos={[]} bebidas={[]} cargando={false} error onElegir={vi.fn()} />);
    abrir();
    expect(await screen.findByText(/No se pudo cargar la carta/)).toBeInTheDocument();
  });

  it("botón táctil de 44 px, con su etiqueta y deshabilitable", () => {
    montar({ etiqueta: "Elegir de la carta", disabled: true });
    const boton = screen.getByRole("button", { name: "Elegir de la carta" });
    expect(boton).toHaveClass("h-11");
    expect(boton).toBeDisabled();
  });
});
