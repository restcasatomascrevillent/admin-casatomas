// Buscador de platos de la carta: el filtro y el orden son nuestros
// (`coincidenciaBusqueda`), no la puntuación difusa de cmdk.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { PlatoDeCarta } from "@/hooks/usePlatosParaMenu";
import { SelectorPlato } from "../SelectorPlato";

beforeAll(() => {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const plato = (id: string, nombre: string, categoria: string, descripcion: string | null = null): PlatoDeCarta => ({
  id,
  nombre,
  nombre_en: null,
  nombre_fr: null,
  descripcion,
  descripcion_en: null,
  descripcion_fr: null,
  categoria,
  imagen_url: null,
  imagen_posicion_y: null,
  alergenos_oficiales: [],
  alergenos_inferidos: [],
  alergenos_notas: null,
  activado: true,
  restaurante: true,
  orden: null,
});

// En el orden de la carta. Los ids y las descripciones llevan letras sueltas
// de «tarta» y «arroz»: con cmdk salían como coincidencias.
const PLATOS = [
  plato("ca1a-7a47-a4b2", "Calamares encebollados al Albariño", "ENTRANTES CALIENTES", "Calamares guisados con cebolla pochada"),
  plato("e2", "Tartar de atún rojo", "ENTRANTES FRÍOS"),
  plato("e3", "Entrecot de ternera nacional", "CARNES", "Los entrecots los sacamos de nuestra selección de chuletones"),
  plato("e4", "Arroz meloso de rape", "ARROCES"),
  plato("e5", "Tarta Santiago", "POSTRES"),
  plato("e6", "Hueva atún almadraba", "SALAZONES"),
  plato("e7", "Atún ijada", "PESCADOS"),
  plato("e8", "Arroz con leche", "POSTRES"),
];

const elegido = vi.fn();
const abrir = () => {
  render(<SelectorPlato platos={PLATOS} cargando={false} onElegir={elegido} />);
  fireEvent.click(screen.getByRole("button", { name: "De la carta" }));
  return screen.getByPlaceholderText("Buscar en la carta...");
};
const buscar = (input: HTMLElement, texto: string) => fireEvent.change(input, { target: { value: texto } });
const nombres = () => screen.queryAllByRole("option").map((o) => o.querySelector("span span")?.textContent);

describe("SelectorPlato", () => {
  it("sin buscar lista toda la carta en su orden", () => {
    abrir();
    expect(nombres()).toEqual(PLATOS.map((p) => p.nombre));
  });

  it("solo salen los platos que coinciden, en el orden de la carta", () => {
    const input = abrir();
    buscar(input, "tarta");
    // Los dos empiezan por «tarta»: a igualdad, el orden de la carta.
    expect(nombres()).toEqual(["Tartar de atún rojo", "Tarta Santiago"]);
    buscar(input, "arroz");
    expect(nombres()).toEqual(["Arroz meloso de rape", "Arroz con leche"]);
  });

  it("no distingue tildes ni mayúsculas", () => {
    const input = abrir();
    buscar(input, "ATUN");
    expect(nombres()).toEqual(["Atún ijada", "Tartar de atún rojo", "Hueva atún almadraba"]);
    buscar(input, "atún");
    expect(nombres()).toEqual(["Atún ijada", "Tartar de atún rojo", "Hueva atún almadraba"]);
  });

  it("también busca por categoría, detrás de los nombres", () => {
    const input = abrir();
    buscar(input, "postres");
    expect(nombres()).toEqual(["Tarta Santiago", "Arroz con leche"]);
  });

  it("cada búsqueda vuelve al principio de la lista", () => {
    const input = abrir();
    const lista = screen.getByRole("listbox");
    lista.scrollTop = 900;
    buscar(input, "a");
    expect(lista.scrollTop).toBe(0);
  });

  it("avisa si nada coincide y elige el plato pulsado", () => {
    const input = abrir();
    buscar(input, "zzz");
    expect(nombres()).toEqual([]);
    expect(screen.getByText("Ningún plato coincide. Puedes escribirlo a mano.")).toBeInTheDocument();
    buscar(input, "ijada");
    fireEvent.click(screen.getByRole("option"));
    expect(elegido).toHaveBeenCalledWith(expect.objectContaining({ id: "e7" }));
  });
});
