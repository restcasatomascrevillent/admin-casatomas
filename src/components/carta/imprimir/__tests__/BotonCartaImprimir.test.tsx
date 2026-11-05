/**
 * «Carta para imprimir»: el diálogo ofrece tamaño, carta (si hay Touza),
 * idioma, categorías y sangrado; la vista previa cuenta las páginas y
 * «Descargar PDF» genera el fichero con su nombre.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Medidor } from "@/lib/carta-pdf/maquetacion";

const m = vi.hoisted(() => ({
  crearPdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
  descargar: vi.fn(),
}));

const medidor: Medidor = {
  ancho: (texto, _fuente, tamano, espaciado = 0) => texto.length * tamano * 0.5 + espaciado * Math.max(0, texto.length - 1),
  limpiar: (texto) => texto,
};

vi.mock("@/lib/carta-pdf/navegador", () => ({
  cargarMotorCarta: async () => ({ medidor, recursos: {} }),
  descargarPdf: m.descargar,
}));
vi.mock("@/lib/carta-pdf/pdf", () => ({ crearPdfCarta: m.crearPdf }));

import { BotonCartaImprimir } from "../BotonCartaImprimir";

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

const plato = (id: string, categoria: string, extra: Record<string, unknown> = {}) => ({
  id,
  nombre: `Plato ${id}`,
  categoria,
  precio_eur: 10,
  descripcion: "Descripción",
  activado: true,
  restaurante: true,
  touza: false,
  orden: Number(id),
  ...extra,
});

const PLATOS = [
  plato("1", "CARNES"),
  plato("2", "CARNES"),
  plato("3", "POSTRES"),
  plato("4", "NOVEDADES DEL DÍA"),
  plato("5", "POSTRES", { activado: false }),
];

async function abrir(props: Parameters<typeof BotonCartaImprimir>[0]) {
  render(<BotonCartaImprimir {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /Carta para imprimir/ }));
  const dialogo = await screen.findByRole("dialog");
  await within(dialogo).findByText(/páginas A5/);
  return dialogo;
}

describe("BotonCartaImprimir", () => {
  it("abre el diálogo con las categorías publicadas, en el orden de la web y todas marcadas", async () => {
    const dialogo = await abrir({ tipo: "platos", platos: PLATOS });
    const casillas = within(dialogo).getAllByRole("checkbox");
    expect(casillas.map((c) => c.closest("li")?.textContent)).toEqual(["Novedades del día1", "Carnes2", "Postres1"]);
    expect(casillas.every((c) => c.getAttribute("data-state") === "checked")).toBe(true);
    // Sin platos en Touza no se ofrece elegir carta; el sangrado empieza apagado.
    expect(within(dialogo).queryByRole("radio", { name: "Touza" })).toBeNull();
    expect(within(dialogo).getByRole("switch", { name: /sangrado/ })).toHaveAttribute("data-state", "unchecked");
    expect(within(dialogo).getByText(/· 4 platos/)).toBeInTheDocument();
  });

  it("quitar una categoría la saca de la carta; sin ninguna, no se puede descargar", async () => {
    const dialogo = await abrir({ tipo: "platos", platos: PLATOS });
    fireEvent.click(within(dialogo).getByRole("checkbox", { name: /Carnes/ }));
    expect(await within(dialogo).findByText(/· 2 platos/)).toBeInTheDocument();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Ninguna" }));
    expect(await within(dialogo).findByText("Elige al menos una categoría.")).toBeInTheDocument();
    expect(within(dialogo).getByRole("button", { name: "Descargar PDF" })).toBeDisabled();
  });

  it("descarga en A4, con sangrado, con el tamaño en el nombre del fichero", async () => {
    const dialogo = await abrir({ tipo: "platos", platos: PLATOS });
    fireEvent.click(within(dialogo).getByRole("radio", { name: /A4/ }));
    expect(await within(dialogo).findByText(/páginas A4/)).toBeInTheDocument();
    fireEvent.click(within(dialogo).getByRole("switch", { name: /sangrado/ }));
    fireEvent.click(within(dialogo).getByRole("button", { name: "Descargar PDF" }));
    await waitFor(() => expect(m.descargar).toHaveBeenCalledTimes(1));
    const [paginas, , opciones] = m.crearPdf.mock.calls[0] as unknown as [{ ancho: number }[], unknown, { tamano: string; sangrado: boolean; idioma: string }];
    expect(paginas[0].ancho).toBeCloseTo(595.28, 1);
    expect(opciones).toMatchObject({ tamano: "A4", sangrado: true, idioma: "es" });
    expect(m.descargar.mock.calls[0][1]).toMatch(/^Carta-Casa-Tomas-platos-es-A4-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it("en vinos ofrece Casa Tomás o Touza y los tipos de vino", async () => {
    const vinos = [
      { id: "v1", nombre: "Tinto solo de casa", categoria: "VINOS TINTOS — RIOJA", precio_eur: 30, activado: true, restaurante: true, touza: false },
      { id: "v2", nombre: "Blanco de Touza", categoria: "VINOS BLANCOS — RUEDA", precio_eur: 20, activado: true, restaurante: false, touza: true },
    ];
    const dialogo = await abrir({ tipo: "vinos", vinos });
    expect(within(dialogo).getByRole("checkbox", { name: /Tintos/ })).toBeInTheDocument();
    expect(within(dialogo).queryByRole("checkbox", { name: /Blancos/ })).toBeNull();
    fireEvent.click(within(dialogo).getByRole("radio", { name: "Touza" }));
    expect(await within(dialogo).findByRole("checkbox", { name: /Blancos/ })).toBeInTheDocument();
    expect(within(dialogo).queryByRole("checkbox", { name: /Tintos/ })).toBeNull();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Descargar PDF" }));
    await waitFor(() => expect(m.descargar).toHaveBeenCalled());
    expect(m.descargar.mock.calls[0][1]).toMatch(/^Carta-Touza-vinos-es-A5-/);
  });
});
