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

describe("SelectorBebidaCarta — orden por coincidencia (QA DEMO 31-10-2026)", () => {
  const vino = (id: string, nombre: string, categoria = "TINTOS"): VinoDeCarta => ({ ...TINTO, id, nombre, categoria });
  const bebida = (id: string, nombre: string, categoria = "Cervezas"): BebidaDeCarta => ({ ...WHISKY, id, nombre, categoria });
  const VINOS = [
    vino("v-consolacion", "Consolación crianza"),
    vino("v-marques", "Marqués de Solar"),
    vino("v-lagar", "Lagar de Cervera", "BLANCOS"),
    vino("v-solea", "Soleá fino", "GENEROSOS"),
  ];
  const BEBIDAS = [
    bebida("b-lagavulin-16", "Lagavulin 16 años", "Whiskys"),
    bebida("b-whisky-8", "Whisky Lagavulin 8", "Whiskys"),
    bebida("b-lagavulin-8", "Lagavulin 8 años", "Whiskys"),
    bebida("b-sol", "Sol"),
  ];

  const buscar = async (texto: string) => {
    abrir();
    const buscador = await screen.findByPlaceholderText("Buscar vino o bebida...");
    fireEvent.change(buscador, { target: { value: texto } });
    return buscador;
  };
  const nombres = () => screen.getAllByRole("option").map((opcion) => opcion.textContent ?? "");

  it("«Sol»: exacta, empieza por, palabra y contiene; la cerveza sale la primera e Intro la elige", async () => {
    const { onElegir } = montar({ vinos: VINOS, bebidas: BEBIDAS });
    const buscador = await buscar("Sol");
    await waitFor(() => expect(nombres()[0]).toMatch(/^Sol/));
    expect(nombres().map((n) => n.split(/Cervezas|TINTOS|GENEROSOS/)[0])).toEqual([
      "Sol",
      "Soleá fino",
      "Marqués de Solar",
      "Consolación crianza",
    ]);
    await waitFor(() => expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true"));
    fireEvent.keyDown(buscador, { key: "Enter" });
    expect(onElegir).toHaveBeenCalledWith(expect.objectContaining({ origen: "bebida", refId: "b-sol", nombre: "Sol" }));
  });

  it("«Lagavulin 8»: solo lo que coincide, la mejor primero, e Intro elige la buena", async () => {
    const { onElegir } = montar({ vinos: VINOS, bebidas: BEBIDAS });
    const buscador = await buscar("Lagavulin 8");
    await waitFor(() => expect(nombres()).toHaveLength(2));
    expect(nombres()[0]).toMatch(/^Lagavulin 8 años/);
    expect(nombres()[1]).toMatch(/^Whisky Lagavulin 8/);
    expect(screen.queryByRole("group", { name: "Vinos" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true"));
    fireEvent.keyDown(buscador, { key: "Enter" });
    expect(onElegir).toHaveBeenCalledWith(expect.objectContaining({ refId: "b-lagavulin-8" }));
  });

  it("sin tildes y por categoría también encuentra", async () => {
    montar({ vinos: VINOS, bebidas: BEBIDAS });
    await buscar("solea");
    await waitFor(() => expect(nombres()[0]).toMatch(/^Soleá fino/));
    fireEvent.change(screen.getByPlaceholderText("Buscar vino o bebida..."), { target: { value: "blancos" } });
    await waitFor(() => expect(nombres()).toEqual([expect.stringMatching(/^Lagar de Cervera/)]));
  });
});

