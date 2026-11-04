/**
 * Pestaña Carta del Gestor web: sin «Expandir/Contraer todos» y con el modo
 * «Ordenar» (visible con una categoría elegida y sin búsqueda).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  guardarPlatos: vi.fn(),
  guardarBebidas: vi.fn(),
}));

const mutacion = (mutateAsync: ReturnType<typeof vi.fn>) => ({ mutateAsync, mutate: vi.fn(), isPending: false });

vi.mock("@/hooks/usePlatos", () => ({
  usePlatos: () => ({
    platos: [
      { id: "p1", nombre: "Ensaladilla", categoria: "Entrantes", orden: 1, activado: true, imagen_url: null },
      { id: "p2", nombre: "Gilda", categoria: "Entrantes", orden: 2, activado: true, imagen_url: null },
      { id: "p3", nombre: "Torrija", categoria: "Postres", orden: 0, activado: true, imagen_url: null },
    ],
    isLoading: false,
    categorias: ["Entrantes", "Postres"],
    guardarOrden: mutacion(mocks.guardarPlatos),
  }),
}));
vi.mock("@/hooks/useBebidas", () => ({
  useBebidas: () => ({ bebidas: [], isLoading: false, categorias: [], guardarOrden: mutacion(mocks.guardarBebidas) }),
}));
vi.mock("@/hooks/useVinos", () => ({
  useVinos: () => ({ vinos: [], isLoading: false, categorias: [], guardarOrden: mutacion(vi.fn()) }),
}));
vi.mock("@/hooks/useCocteles", () => ({
  useCocteles: () => ({ cocteles: [], isLoading: false, categorias: [], guardarOrden: mutacion(vi.fn()) }),
}));
// Lo que no se prueba aquí, en blanco.
vi.mock("@/components/carta/ListaPlatos", () => ({
  ListaPlatos: ({ platos }: { platos: { nombre: string }[] }) => (
    <ul aria-label="tarjetas">{platos.map((p) => <li key={p.nombre}>{p.nombre}</li>)}</ul>
  ),
}));
vi.mock("@/components/carta/ListaBebidas", () => ({ ListaBebidas: () => null }));
vi.mock("@/components/carta/ListaVinos", () => ({ ListaVinos: () => null }));
vi.mock("@/components/carta/ListaCocteles", () => ({ ListaCocteles: () => null }));
vi.mock("@/components/carta/PlatoForm", () => ({ PlatoForm: () => null }));
vi.mock("@/components/carta/BebidaForm", () => ({ BebidaForm: () => null }));
vi.mock("@/components/carta/VinoForm", () => ({ VinoForm: () => null }));
vi.mock("@/components/carta/CoctelForm", () => ({ CoctelForm: () => null }));
vi.mock("@/components/carta/AjustePreciosModal", () => ({ AjustePreciosModal: () => null }));
vi.mock("@/components/carta/BotonVinoDesdeFoto", () => ({ BotonVinoDesdeFoto: () => null }));
// La votación del vino favorito tiene sus propias pruebas (EncuestaVinoFavorito.test.tsx).
vi.mock("@/components/carta/EncuestaVinoFavorito", () => ({ EncuestaVinoFavorito: () => null }));

import TabCarta from "../tabs/TabCarta";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  // PestanasPagina mide la barra.
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guardarPlatos.mockResolvedValue(2);
});

describe("Pestaña Carta", () => {
  it("ya no tiene «Expandir todos» ni «Contraer todos»", () => {
    render(<TabCarta />);
    expect(screen.queryByRole("button", { name: /expandir todos/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /contraer todos/i })).not.toBeInTheDocument();
  });

  it("«Ordenar» solo aparece con una categoría elegida y sin búsqueda", () => {
    render(<TabCarta />);
    expect(screen.getByRole("button", { name: /Ordenar/ })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Buscar por nombre/), { target: { value: "gil" } });
    expect(screen.queryByRole("button", { name: /Ordenar/ })).not.toBeInTheDocument();
  });

  it("ordena la categoría elegida y guarda con el hook de esa sección", async () => {
    render(<TabCarta />);
    fireEvent.click(screen.getByRole("button", { name: /Ordenar/ }));

    expect(screen.getByRole("heading", { name: "Ordenar «Entrantes»" })).toBeInTheDocument();
    // En el modo ordenar no se ven ni los filtros ni las tarjetas.
    expect(screen.queryByPlaceholderText(/Buscar por nombre/)).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "tarjetas" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Subir Gilda" }));
    fireEvent.click(screen.getByRole("button", { name: /Guardar orden/ }));

    await waitFor(() =>
      expect(mocks.guardarPlatos).toHaveBeenCalledWith({ categoria: "Entrantes", idsEnOrden: ["p2", "p1"] }),
    );
    // Guardado: vuelve a las tarjetas.
    await waitFor(() => expect(screen.getByRole("list", { name: "tarjetas" })).toBeInTheDocument());
  });
});
