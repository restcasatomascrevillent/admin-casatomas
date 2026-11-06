// Tarjetas de la carta con solo «Ver» (06/11/2026): sin interruptores ni botones que escriban
// (Foto, Editar, Eliminar, posición de la foto), con la publicación en texto. Ver la foto (el ojo
// y la vista grande) sigue: no escribe nada.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ListaVinos } from "../ListaVinos";
import { ListaBebidas } from "../ListaBebidas";
import { ListaCocteles } from "../ListaCocteles";
import { ListaPlatos } from "../ListaPlatos";
import type { Vino } from "@/hooks/useVinos";
import type { Bebida } from "@/hooks/useBebidas";
import type { Coctel } from "@/hooks/useCocteles";
import type { Plato } from "@/hooks/usePlatos";

const mutacion = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
vi.mock("@/hooks/useVinos", () => ({
  useVinos: () => ({ eliminarVino: mutacion(), toggleExpanded: mutacion(), toggleRestaurante: mutacion(), toggleTouza: mutacion(), actualizarVino: mutacion(), categorias: [] }),
}));
vi.mock("@/hooks/useBebidas", () => ({
  useBebidas: () => ({ eliminarBebida: mutacion(), actualizarBebida: mutacion(), toggleActivado: mutacion(), toggleRestaurante: mutacion(), toggleTouza: mutacion(), categorias: [] }),
}));
vi.mock("@/hooks/useCocteles", () => ({
  useCocteles: () => ({ eliminarCoctel: mutacion(), actualizarCoctel: mutacion(), toggleActivado: mutacion(), toggleRestaurante: mutacion(), toggleTouza: mutacion(), categorias: [] }),
}));
vi.mock("@/hooks/usePlatos", () => ({
  usePlatos: () => ({ toggleExpanded: mutacion(), toggleActivado: mutacion(), eliminarPlato: mutacion(), actualizarPlato: mutacion(), categorias: [] }),
}));
vi.mock("../potente/useVideosPendientesCarta", () => ({ useVideosPendientesCarta: () => new Set() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const foto = "https://x.supabase.co/storage/v1/object/public/vinos/a-carta-webp.webp";
const sinBotonesDeEscritura = () => {
  expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  for (const nombre of [/^Foto$/, /^Editar$/, /^Eliminar$/, /Ajustar posición/]) {
    expect(screen.queryByRole("button", { name: nombre })).not.toBeInTheDocument();
  }
};

describe("Tarjetas de la carta en solo lectura", () => {
  it("cócteles: estado en texto y sin botones; con «Editar», como siempre", () => {
    const coctel = { id: "c", nombre: "Mojito", categoria: "Clásicos", precio_eur: 9, activado: false, restaurante: true, touza: false, imagen_url: null, alergenos_oficiales: [] } as unknown as Coctel;
    const { rerender } = render(<ListaCocteles cocteles={[coctel]} soloLectura />);
    sinBotonesDeEscritura();
    expect(screen.getByTestId("estado-lectura")).toHaveTextContent("Despublicado (no sale en la web)");
    expect(screen.getByTestId("estado-lectura")).toHaveTextContent("Casa Tomás: sí · Touza: no");
    expect(screen.getByText("9.00")).toBeInTheDocument();
    rerender(<ListaCocteles cocteles={[coctel]} />);
    expect(screen.getByRole("button", { name: /^Editar$/ })).toBeInTheDocument();
    expect(screen.getAllByRole("switch").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("estado-lectura")).not.toBeInTheDocument();
  });

  it("bebidas: el ojo de la foto sigue (solo enseña), sin botones que escriban", () => {
    const bebida = { id: "b", nombre: "IPA", categoria: "Cervezas", precio_eur: 4, activado: true, restaurante: true, touza: true, imagen_url: foto, tamano: "33 cl", descripcion: null } as Bebida;
    render(<ListaBebidas bebidas={[bebida]} soloLectura />);
    sinBotonesDeEscritura();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar foto" }));
    expect(screen.getByTestId("foto-lateral")).toBeInTheDocument();
    expect(screen.getByTestId("estado-lectura")).toHaveTextContent("Activo (se publica en la web)");
  });

  it("vinos: en qué carta sale, el aviso de origen y sin la explicación de los interruptores", () => {
    const vino = (p: Partial<Vino>) => ({ id: "v", nombre: "Albariño", categoria: "Blancos", precio_eur: 24, activado: true, expanded: true, restaurante: true, touza: true, imagen_url: foto, imagen_posicion_y: 50, alergenos_oficiales: [], ubicacion_pais: "España", ubicacion_region: "Cambados, Pontevedra", ...p }) as Vino;
    render(<ListaVinos vinos={[vino({}), vino({ id: "v2", nombre: "Sin origen", ubicacion_pais: null, ubicacion_region: null, restaurante: false, touza: false })]} soloLectura />);
    sinBotonesDeEscritura();
    const estados = screen.getAllByTestId("estado-lectura");
    expect(estados[0]).toHaveTextContent("Sale en la carta de Casa Tomás y en la de Touza.");
    expect(estados[0]).toHaveTextContent("Foto expandida en la carta web");
    expect(estados[1]).toHaveTextContent("No sale en ninguna carta.");
    expect(screen.queryByText(/Restaurante: sale en la carta de la web/)).not.toBeInTheDocument();
  });

  it("platos: sin ajustar la posición de la foto ni interruptores", () => {
    const plato = { id: "p", nombre: "Croquetas", categoria: "Entrantes", precio_eur: 9, activado: true, expanded: false, imagen_url: foto, alergenos_oficiales: [] } as unknown as Plato;
    render(<ListaPlatos platos={[plato]} soloLectura />);
    sinBotonesDeEscritura();
    expect(screen.getByRole("button", { name: "Mostrar foto" })).toBeInTheDocument();
    expect(screen.getByTestId("estado-lectura")).toHaveTextContent("Activo (se publica en la web)");
  });
});
