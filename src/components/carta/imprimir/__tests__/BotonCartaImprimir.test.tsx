/**
 * «Carta para imprimir»: el diálogo ofrece tamaño, carta (si hay Touza),
 * idioma, categorías y sangrado; la vista previa cuenta las páginas y
 * «Descargar PDF» genera el fichero con su nombre. Cada sección va en su cara:
 * si una no cabe, avisa (sección y tamaño) y no descarga hasta revisarla.
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
  fireEvent.click(screen.getByRole("button", { name: /PDF Carta/ }));
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

  it("una sección por cara: tres categorías, tres páginas entre portada y contraportada", async () => {
    const dialogo = await abrir({ tipo: "platos", platos: PLATOS });
    expect(within(dialogo).getByText(/^5 páginas A5/)).toBeInTheDocument();
    expect(within(dialogo).queryByRole("alert")).toBeNull();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Descargar PDF" }));
    await waitFor(() => expect(m.descargar).toHaveBeenCalledTimes(1));
    const [paginas] = m.crearPdf.mock.calls[0] as unknown as [{ tipo: string; seccion?: string }[]];
    expect(paginas.filter((p) => p.tipo === "interior").map((p) => p.seccion)).toEqual(["NOVEDADES DEL DÍA", "CARNES", "POSTRES"]);
  });

  describe("si una sección no cabe en una cara", () => {
    // 24 mariscos con descripción de dos líneas: en A5 no caben en una cara; en A4, a dos columnas, sí.
    const MARISCOS = [
      ...Array.from({ length: 24 }, (_, i) =>
        plato(String(100 + i), "MARISCOS", {
          nombre: `Marisco ${i + 1}`,
          descripcion: "Una descripción que ocupa dos líneas en la carta impresa, como las de verdad.",
        }),
      ),
      plato("1", "CARNES"),
    ];

    it("avisa con la sección y el tamaño, y no deja descargar", async () => {
      const dialogo = await abrir({ tipo: "platos", platos: MARISCOS });
      const aviso = await within(dialogo).findByRole("alert");
      expect(aviso).toHaveTextContent("Una sección no cabe en una cara A5");
      expect(aviso).toHaveTextContent(/Mariscos · A5: 24 platos/);
      expect(within(dialogo).getByText(/Mariscos no cabe en una cara A5: revísalo antes de descargar/)).toBeInTheDocument();
      expect(within(dialogo).getByRole("button", { name: "Descargar PDF" })).toBeDisabled();
      expect(within(dialogo).getByRole("button", { name: /Ver en grande: Página 2 de 4 \(no cabe\)/ })).toBeInTheDocument();
      // «Ver página» abre esa página en grande.
      fireEvent.click(within(aviso).getByRole("button", { name: /Ver página/ }));
      expect(await within(dialogo).findByText(/No cabe en una cara A5: lo que se ve es lo que entra/)).toBeInTheDocument();
    });

    it("se puede repartir a propósito en las caras que necesita, y deshacerlo", async () => {
      const dialogo = await abrir({ tipo: "platos", platos: MARISCOS });
      const aviso = await within(dialogo).findByRole("alert");
      const repartir = within(aviso).getByRole("button", { name: /Repartir en \d+ caras/ });
      const caras = Number(repartir.textContent!.match(/(\d+) caras/)![1]);
      expect(caras).toBeGreaterThan(1);
      fireEvent.click(repartir);
      await waitFor(() => expect(within(dialogo).queryByRole("alert")).toBeNull());
      expect(within(dialogo).getByText(new RegExp(`ocupa ${caras} caras A5, repartida a petición tuya`))).toBeInTheDocument();
      expect(within(dialogo).getByText(new RegExp(`^${caras + 3} páginas A5`))).toBeInTheDocument();
      fireEvent.click(within(dialogo).getByRole("button", { name: "Descargar PDF" }));
      await waitFor(() => expect(m.descargar).toHaveBeenCalledTimes(1));
      fireEvent.click(within(dialogo).getByRole("button", { name: /Volver a una cara/ }));
      expect(await within(dialogo).findByRole("alert")).toHaveTextContent("Mariscos");
    });

    it("se pueden quitar platos de esa sección o pasar al tamaño en el que sí cabe", async () => {
      const dialogo = await abrir({ tipo: "platos", platos: MARISCOS });
      const aviso = await within(dialogo).findByRole("alert");
      fireEvent.click(within(aviso).getByRole("button", { name: /Elegir platos/ }));
      expect(within(aviso).getByText(/Marcados 24 de 24 · en una cara caben unos \d+/)).toBeInTheDocument();
      fireEvent.click(within(aviso).getByRole("checkbox", { name: /^Marisco 24\s*·/ }));
      expect(await within(aviso).findByText(/Marcados 23 de 24/)).toBeInTheDocument();
      expect(within(dialogo).getByText(/· 24 platos/)).toBeInTheDocument();

      fireEvent.click(within(aviso).getByRole("button", { name: "En A4 sí cabe: pasar a A4" }));
      await waitFor(() => expect(within(dialogo).queryByRole("alert")).toBeNull());
      expect(within(dialogo).getByText(/páginas A4/)).toBeInTheDocument();
      // Lo quitado se recuerda y se puede recuperar.
      expect(within(dialogo).getByText(/1 plato quitado de la carta impresa/)).toBeInTheDocument();
      fireEvent.click(within(dialogo).getByRole("button", { name: /Recuperarlos/ }));
      expect(await within(dialogo).findByText(/· 25 platos/)).toBeInTheDocument();
      expect(within(dialogo).getByRole("button", { name: "Descargar PDF" })).toBeEnabled();
    });

    it("si se quitan todos, lo dice y deja recuperarlos", async () => {
      const dialogo = await abrir({ tipo: "platos", platos: MARISCOS });
      fireEvent.click(within(dialogo).getByRole("checkbox", { name: /^Carnes/ }));
      const aviso = await within(dialogo).findByRole("alert");
      fireEvent.click(within(aviso).getByRole("button", { name: /Elegir platos/ }));
      // Al quitar unos, la sección pasa a caber y la lista sigue abierta en el recuadro de lo decidido.
      for (let i = 0; i < 24; i++) {
        const [marcada] = within(dialogo).queryAllByRole("checkbox", { name: /^Marisco \d+/, checked: true });
        if (!marcada) break;
        fireEvent.click(marcada);
      }
      expect(await within(dialogo).findByText("Has quitado todos los platos de lo elegido.")).toBeInTheDocument();
      expect(within(dialogo).getByRole("button", { name: "Descargar PDF" })).toBeDisabled();
      fireEvent.click(within(dialogo).getByRole("button", { name: "Recuperar los quitados" }));
      expect(await within(dialogo).findByText(/· 24 platos/)).toBeInTheDocument();
      // Veinticuatro clics, cada uno vuelve a maquetar la carta: con la máquina cargada pasa de 5 s.
    }, 20_000);
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
