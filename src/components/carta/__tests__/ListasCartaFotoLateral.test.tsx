import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ListaVinos } from "../ListaVinos";
import { ListaBebidas } from "../ListaBebidas";
import { ListaCocteles } from "../ListaCocteles";
import type { Vino } from "@/hooks/useVinos";
import type { Bebida } from "@/hooks/useBebidas";
import type { Coctel } from "@/hooks/useCocteles";

const mutacion = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
// Puntuaciones Parker con fuente (08/11/2026): la lista las lee con react-query; aquí, ninguna.
vi.mock("@/components/carta/parker/usePuntuacionesParker", () => ({
  usePuntuacionesParker: () => ({
    filas: [], isLoading: false, porVino: () => [],
    guardar: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    confirmar: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    borrar: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock("@/hooks/useVinos", () => ({
  useVinos: () => ({
    eliminarVino: mutacion(), toggleExpanded: mutacion(),
    toggleRestaurante: mutacion(), toggleTouza: mutacion(), actualizarVino: mutacion(), categorias: [],
  }),
}));
vi.mock("@/hooks/useBebidas", () => ({
  useBebidas: () => ({
    eliminarBebida: mutacion(), actualizarBebida: mutacion(), toggleActivado: mutacion(),
    toggleRestaurante: mutacion(), toggleTouza: mutacion(), categorias: [],
  }),
}));
vi.mock("@/hooks/useCocteles", () => ({
  useCocteles: () => ({
    eliminarCoctel: mutacion(), actualizarCoctel: mutacion(), toggleActivado: mutacion(),
    toggleRestaurante: mutacion(), toggleTouza: mutacion(), categorias: [],
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const carta = "https://x.supabase.co/storage/v1/object/public/vinos/a-carta-webp.webp";
const antigua = "https://x.supabase.co/storage/v1/object/public/vinos/b.jpg";
const vino = (p: Partial<Vino>) =>
  ({ id: "v", nombre: "Albariño", categoria: "Blancos", precio_eur: 24, activado: true, expanded: true, restaurante: true, touza: false, imagen_url: null, imagen_posicion_y: 50, alergenos_oficiales: [], ubicacion_pais: "España", ubicacion_region: "Cambados, Pontevedra", ...p }) as Vino;

describe("Tarjetas de la carta con la foto en el lateral", () => {
  it("vinos: las fotos empiezan ocultas y el ojo las enseña en la columna lateral", () => {
    render(<ListaVinos vinos={[vino({ id: "1", nombre: "Albariño", imagen_url: carta }), vino({ id: "2", nombre: "Mencía", imagen_url: antigua })]} />);
    expect(screen.queryByTestId("foto-lateral")).not.toBeInTheDocument();
    for (const ojo of screen.getAllByRole("button", { name: "Mostrar foto" })) fireEvent.click(ojo);
    const marcos = screen.getAllByTestId("foto-lateral");
    expect(marcos.map((m) => m.getAttribute("data-foto"))).toEqual(["carta", "antigua"]);
    const img = within(marcos[0]).getByRole("img", { name: "Albariño" });
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("decoding", "async");
    expect(img).toHaveAttribute("width", "900");
    // Los controles de siempre siguen ahí, con su texto (en vinos, sin «Activo»: un interruptor por carta).
    expect(screen.queryByText("Activo (se publica en la web)")).not.toBeInTheDocument();
    expect(screen.getAllByRole("switch", { name: "Restaurante" })).toHaveLength(2);
    expect(screen.getAllByRole("switch", { name: /Foto expandida en carta web/ })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Ajustar posición de imagen" })).toHaveLength(2);
    // Ocultar de nuevo quita la columna.
    fireEvent.click(screen.getAllByRole("button", { name: "Ocultar foto" })[0]);
    expect(screen.getAllByTestId("foto-lateral")).toHaveLength(1);
  });

  it("vinos: la foto abre la vista grande y un vino sin foto no deja hueco", () => {
    render(<ListaVinos vinos={[vino({ id: "1", nombre: "Albariño", imagen_url: carta }), vino({ id: "2", nombre: "Sin foto" })]} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Mostrar foto" })[0]);
    expect(screen.getAllByTestId("foto-lateral")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Este vino no tiene foto" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Ver la foto de Albariño en grande" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("bebidas: foto de carta en el lateral", () => {
    const bebida = { id: "b", nombre: "IPA", categoria: "Cervezas", precio_eur: 4, activado: true, restaurante: true, touza: false, imagen_url: carta, tamano: "33 cl", descripcion: null } as Bebida;
    render(<ListaBebidas bebidas={[bebida]} />);
    fireEvent.click(screen.getByRole("button", { name: "Mostrar foto" }));
    expect(screen.getByTestId("foto-lateral")).toHaveAttribute("data-foto", "carta");
    expect(screen.getByRole("img", { name: "IPA" })).toBeInTheDocument();
    expect(screen.getByText("33 cl")).toBeInTheDocument();
    expect(screen.getByText("Activo (se publica en la web)")).toBeInTheDocument();
  });

  it("cócteles: foto antigua entera en el lateral", () => {
    const coctel = { id: "c", nombre: "Gin tonic", categoria: "Combinados", precio_eur: 9, activado: true, restaurante: true, touza: false, imagen_url: antigua, alergenos_oficiales: ["sulfitos"] } as Coctel;
    render(<ListaCocteles cocteles={[coctel]} />);
    fireEvent.click(screen.getByRole("button", { name: "Mostrar foto" }));
    expect(screen.getByTestId("foto-lateral")).toHaveAttribute("data-foto", "antigua");
    expect(screen.getByRole("img", { name: "Gin tonic" }).className).toContain("object-contain");
    expect(screen.getByRole("button", { name: "Ocultar foto" })).toBeInTheDocument();
  });
});
