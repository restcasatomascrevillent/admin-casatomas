/**
 * Gestor Web › Carta › Vinos: el desplegable de categorías se cambia por las
 * píldoras de la carta de la web (04/11/2026, dueño: «en vez del desplegable
 * para filtrar vinos que esté la misma opción que hay en carta»): fila por
 * tipo y, al elegir tipo, fila por denominación, con contador. Convive con el
 * buscador, la visibilidad y «Ordenar»; «Origen por confirmar» junta los vinos
 * que hay que corregir.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

const mutacion = () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false });
const ORIGEN = { ubicacion_pais: "España", ubicacion_region: "Sitio" };
const VINOS = [
  { id: "rd1", nombre: "Pago de Carraovejas", categoria: "VINOS TINTOS — RIBERA DEL DUERO", orden: 1, restaurante: true, touza: true, activado: true, ...ORIGEN },
  { id: "rd2", nombre: "Pesquera", categoria: "VINOS TINTOS — RIBERA DEL DUERO", orden: 2, restaurante: true, touza: false, activado: true, ...ORIGEN },
  { id: "ri1", nombre: "Viña Pomal", categoria: "VINOS TINTOS — RIOJA", orden: 1, restaurante: false, touza: false, activado: false, ...ORIGEN },
  { id: "tp1", nombre: "Tinto dudoso", categoria: "VINOS TINTOS — ORIGEN PENDIENTE", orden: 1, restaurante: false, touza: false, activado: false, ...ORIGEN },
  { id: "rb1", nombre: "Albariño", categoria: "VINOS BLANCOS — RÍAS BAIXAS", orden: 1, restaurante: true, touza: true, activado: true, ...ORIGEN },
  { id: "ch1", nombre: "Krug", categoria: "VINOS ESPUMOSOS — CHAMPAGNE", orden: 1, restaurante: true, touza: true, activado: true, ...ORIGEN },
];
const m = vi.hoisted(() => ({ vinoForm: vi.fn() }));

vi.mock("@/hooks/usePlatos", () => ({
  usePlatos: () => ({ platos: [], isLoading: false, categorias: [], guardarOrden: mutacion() }),
}));
vi.mock("@/hooks/useBebidas", () => ({
  useBebidas: () => ({ bebidas: [], isLoading: false, categorias: [], guardarOrden: mutacion() }),
}));
vi.mock("@/hooks/useVinos", async () => {
  const { categoriasOrdenadas } = await import("@/lib/orden-carta");
  return {
    useVinos: () => ({ vinos: VINOS, isLoading: false, categorias: categoriasOrdenadas(VINOS), guardarOrden: mutacion() }),
  };
});
vi.mock("@/hooks/useCocteles", () => ({
  useCocteles: () => ({ cocteles: [], isLoading: false, categorias: [], guardarOrden: mutacion() }),
}));
vi.mock("@/components/carta/ListaVinos", () => ({
  ListaVinos: ({ vinos }: { vinos: { nombre: string }[] }) => (
    <ul aria-label="vinos">{vinos.map((v) => <li key={v.nombre}>{v.nombre}</li>)}</ul>
  ),
}));
vi.mock("@/components/carta/ListaPlatos", () => ({ ListaPlatos: () => null }));
vi.mock("@/components/carta/ListaBebidas", () => ({ ListaBebidas: () => null }));
vi.mock("@/components/carta/ListaCocteles", () => ({ ListaCocteles: () => null }));
vi.mock("@/components/carta/PlatoForm", () => ({ PlatoForm: () => null }));
vi.mock("@/components/carta/BebidaForm", () => ({ BebidaForm: () => null }));
vi.mock("@/components/carta/VinoForm", () => ({
  VinoForm: (props: { categoriaInicial?: string }) => {
    m.vinoForm(props.categoriaInicial);
    return null;
  },
}));
vi.mock("@/components/carta/CoctelForm", () => ({ CoctelForm: () => null }));
vi.mock("@/components/carta/AjustePreciosModal", () => ({ AjustePreciosModal: () => null }));
vi.mock("@/components/carta/BotonVinoDesdeFoto", () => ({ BotonVinoDesdeFoto: () => null }));

import TabCarta from "../tabs/TabCarta";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
beforeEach(() => vi.clearAllMocks());

function abrirVinos() {
  render(<TabCarta />);
  fireEvent.mouseDown(screen.getByRole("tab", { name: /Vinos/ }));
  fireEvent.click(screen.getByRole("tab", { name: /Vinos/ }));
}
const tipos = () => screen.getByRole("group", { name: "Filtrar vinos por tipo" });
const denominaciones = () => screen.queryByRole("group", { name: "Filtrar vinos por denominación" });
const nombres = () => within(screen.getByRole("list", { name: "vinos" })).getAllByRole("listitem").map((li) => li.textContent);
const pildora = (grupo: HTMLElement, texto: RegExp) => within(grupo).getByRole("button", { name: texto });

describe("Vinos: filtro con píldoras como en la carta de la web", () => {
  it("sin desplegable de categoría; empieza en «Todos» con contadores por tipo", () => {
    abrirVinos();
    expect(screen.queryByRole("combobox", { name: "Categoría" })).not.toBeInTheDocument();
    expect(within(tipos()).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Todos 6",
      "Tintos 4",
      "Blancos 1",
      "Espumosos 1, Champagnes y espumosos",
      "Origen por confirmar 1, Vinos sin origen claro: no se pueden publicar hasta completarlo",
    ]);
    expect(pildora(tipos(), /^Todos 6/)).toHaveAttribute("aria-pressed", "true");
    expect(denominaciones()).not.toBeInTheDocument();
    // Agrupados como en la carta: tintos (por denominación y orden), blancos, espumosos.
    expect(nombres()).toEqual(["Tinto dudoso", "Pago de Carraovejas", "Pesquera", "Viña Pomal", "Albariño", "Krug"]);
    // Con varias categorías no se puede ordenar.
    expect(screen.queryByRole("button", { name: /Ordenar/ })).not.toBeInTheDocument();
  });

  it("al elegir tipo sale la fila de denominaciones; con una denominación, «Ordenar»", () => {
    abrirVinos();
    fireEvent.click(pildora(tipos(), /^Tintos 4/));
    expect(pildora(tipos(), /^Tintos 4/)).toHaveAttribute("aria-pressed", "true");
    expect(nombres()).toEqual(["Tinto dudoso", "Pago de Carraovejas", "Pesquera", "Viña Pomal"]);
    const fila = denominaciones()!;
    expect(within(fila).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Todas 4",
      "Origen por confirmar 1",
      "Ribera del Duero 2",
      "Rioja 1",
    ]);
    expect(pildora(fila, /^Todas 4/)).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(pildora(fila, /^Ribera del Duero 2/));
    expect(nombres()).toEqual(["Pago de Carraovejas", "Pesquera"]);
    expect(pildora(tipos(), /^Tintos 4/)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Ordenar/ })).toBeInTheDocument();
    // «Añadir vino» propone esa categoría.
    expect(m.vinoForm).toHaveBeenLastCalledWith("VINOS TINTOS — RIBERA DEL DUERO");

    fireEvent.click(pildora(tipos(), /^Todos 6/));
    expect(denominaciones()).not.toBeInTheDocument();
    expect(nombres()).toHaveLength(6);
  });

  it("«Origen por confirmar» junta los vinos que hay que corregir; no se propone esa categoría al añadir", () => {
    abrirVinos();
    fireEvent.click(pildora(tipos(), /^Origen por confirmar 1/));
    expect(nombres()).toEqual(["Tinto dudoso"]);
    fireEvent.click(pildora(tipos(), /^Tintos/));
    fireEvent.click(pildora(denominaciones()!, /^Origen por confirmar 1/));
    expect(nombres()).toEqual(["Tinto dudoso"]);
    expect(m.vinoForm).toHaveBeenLastCalledWith("");
  });

  it("convive con el buscador y la visibilidad: los contadores cuentan lo que queda", () => {
    abrirVinos();
    fireEvent.click(pildora(tipos(), /^Tintos/));
    fireEvent.change(screen.getByPlaceholderText(/Buscar por nombre/), { target: { value: "pe" } });
    // La búsqueda se suma al tipo elegido (como en la web).
    expect(nombres()).toEqual(["Pesquera"]);
    expect(pildora(tipos(), /^Todos 1/)).toBeInTheDocument();
    expect(pildora(tipos(), /^Tintos 1/)).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByPlaceholderText(/Buscar por nombre/), { target: { value: "" } });
    expect(pildora(tipos(), /^Todos 6/)).toBeInTheDocument();
  });
});
