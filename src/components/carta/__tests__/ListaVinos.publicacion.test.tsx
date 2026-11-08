/**
 * Tarjeta de vino: un interruptor por carta (04/11/2026, dueño: «que el toggle
 * de restaurante o touza sea para si está activo en web o no, el otro toggle
 * quítalo para no duplicar, pon una explicación breve») y vinos sin origen
 * claro marcados «Origen por confirmar», con los interruptores bloqueados.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Vino } from "@/hooks/useVinos";

const m = vi.hoisted(() => ({ restaurante: vi.fn(), touza: vi.fn() }));
const mutacion = (mutate = vi.fn()) => ({ mutate, mutateAsync: vi.fn(), isPending: false });
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
    eliminarVino: mutacion(),
    toggleExpanded: mutacion(),
    toggleRestaurante: mutacion(m.restaurante),
    toggleTouza: mutacion(m.touza),
    actualizarVino: mutacion(),
    categorias: [],
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { ListaVinos } from "../ListaVinos";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});
beforeEach(() => vi.clearAllMocks());

const vino = (p: Partial<Vino>) =>
  ({
    id: "v", nombre: "Albariño", categoria: "VINOS BLANCOS — RÍAS BAIXAS", precio_eur: 24, activado: true,
    expanded: false, restaurante: true, touza: false, imagen_url: null, imagen_posicion_y: 50, alergenos_oficiales: [],
    ubicacion_pais: "España", ubicacion_region: "Cambados, Pontevedra", ...p,
  }) as Vino;

const tarjeta = (nombre: string) => screen.getByRole("heading", { name: nombre }).closest(".rounded-lg") as HTMLElement;

describe("Publicación de un vino: Restaurante y Touza", () => {
  it("sin el interruptor «Activo»; explicación una vez y qué hace cada tarjeta", () => {
    render(
      <ListaVinos
        vinos={[
          vino({ id: "1", nombre: "Ambas", restaurante: true, touza: true }),
          vino({ id: "2", nombre: "Solo casa", restaurante: true, touza: false }),
          vino({ id: "3", nombre: "Solo bar", restaurante: false, touza: true }),
          vino({ id: "4", nombre: "Ninguna", restaurante: false, touza: false, activado: false }),
        ]}
      />,
    );
    expect(screen.queryByText(/Activo \(se publica en la web\)/)).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /despublicar|publicar en la web/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("switch", { name: "Restaurante" })).toHaveLength(4);
    expect(screen.getAllByRole("switch", { name: "Touza" })).toHaveLength(4);
    expect(
      screen.getAllByText(/^Restaurante: sale en la carta de la web de Casa Tomás\. Touza: sale en la carta de Touza\. Con los dos apagados no se publica\./),
    ).toHaveLength(1);

    expect(within(tarjeta("Ambas")).getByText("Sale en la carta de Casa Tomás y en la de Touza.")).toBeInTheDocument();
    expect(within(tarjeta("Solo casa")).getByText("Sale solo en la carta de la web de Casa Tomás.")).toBeInTheDocument();
    expect(within(tarjeta("Solo bar")).getByText("Sale solo en la carta de Touza.")).toBeInTheDocument();
    expect(within(tarjeta("Ninguna")).getByText("No sale en ninguna carta.")).toBeInTheDocument();
    expect(tarjeta("Ninguna").className).toContain("opacity-60");
    expect(tarjeta("Solo bar").className).not.toContain("opacity-60");
    // El interruptor queda descrito por su línea.
    const sw = within(tarjeta("Solo casa")).getByRole("switch", { name: "Restaurante" });
    expect(document.getElementById(sw.getAttribute("aria-describedby")!)).toHaveTextContent("Sale solo en la carta de la web de Casa Tomás.");
  });

  it("cada interruptor guarda su carta y la otra tal como se ve", () => {
    render(<ListaVinos vinos={[vino({ id: "1", nombre: "Albariño", restaurante: true, touza: false })]} />);
    fireEvent.click(screen.getByRole("switch", { name: "Touza" }));
    expect(m.touza).toHaveBeenCalledWith({ id: "1", touza: true, restaurante: true });
    fireEvent.click(screen.getByRole("switch", { name: "Restaurante" }));
    expect(m.restaurante).toHaveBeenCalledWith({ id: "1", restaurante: false, touza: false });
  });

  it("con la BD aún sin migrar, un vino con activado = false se ve apagado en las dos (como en la web)", () => {
    render(<ListaVinos vinos={[vino({ id: "1", nombre: "Oculto", restaurante: true, touza: true, activado: false })]} />);
    expect(screen.getByRole("switch", { name: "Restaurante" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Touza" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("switch", { name: "Restaurante" }));
    expect(m.restaurante).toHaveBeenCalledWith({ id: "1", restaurante: true, touza: false });
  });
});

describe("Vinos sin origen claro: «Origen por confirmar»", () => {
  it("categoría «ORIGEN PENDIENTE»: marcado, interruptores apagados y bloqueados, y qué hacer", () => {
    render(
      <ListaVinos
        vinos={[
          vino({ id: "1", nombre: "Burbujas", categoria: "VINOS ESPUMOSOS — ORIGEN PENDIENTE", restaurante: false, touza: false, activado: false }),
          vino({ id: "2", nombre: "Con origen" }),
        ]}
      />,
    );
    const t = tarjeta("Burbujas");
    expect(within(t).getByText("Origen por confirmar")).toBeInTheDocument();
    expect(within(t).getByRole("switch", { name: "Restaurante" })).toBeDisabled();
    expect(within(t).getByRole("switch", { name: "Touza" })).toBeDisabled();
    expect(
      within(t).getByText("No se puede publicar: falta elegir su categoría con la denominación de origen. Pulsa «Editar» y complétalo."),
    ).toBeInTheDocument();
    expect(t.className).toContain("border-amber-500/60");
    // No se atenúa: el aviso tiene que leerse.
    expect(t.className).not.toContain("opacity-60");
    // El de al lado, normal.
    expect(within(tarjeta("Con origen")).queryByText("Origen por confirmar")).not.toBeInTheDocument();
    expect(within(tarjeta("Con origen")).getByRole("switch", { name: "Touza" })).toBeEnabled();
  });

  it("un vino antiguo publicado sin país: se puede apagar, no encender", () => {
    render(<ListaVinos vinos={[vino({ id: "1", nombre: "Antiguo", ubicacion_pais: null, restaurante: true, touza: false })]} />);
    const t = tarjeta("Antiguo");
    expect(within(t).getByText("Origen por confirmar")).toBeInTheDocument();
    expect(
      within(t).getByText("Sale solo en la carta de la web de Casa Tomás. No se puede publicar: falta el país. Pulsa «Editar» y complétalo."),
    ).toBeInTheDocument();
    expect(within(t).getByRole("switch", { name: "Touza" })).toBeDisabled();
    const restaurante = within(t).getByRole("switch", { name: "Restaurante" });
    expect(restaurante).toBeEnabled();
    fireEvent.click(restaurante);
    expect(m.restaurante).toHaveBeenCalledWith({ id: "1", restaurante: false, touza: false });
  });
});
