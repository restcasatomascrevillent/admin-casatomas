// Bloque «Botones» del editor de novedades (historia 4073221d, criterios 1, 4
// y 5): «Sin botones» por defecto, hasta 2 sin repetir, orden con subir/bajar
// y «Échale un vistazo» solo con un plato de la carta enlazado.

import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BloqueBotonesNovedad, TEXTO_AYUDA_PLATO } from "@/components/gestion-web/BloqueBotonesNovedad";
import { indexarPlatos, type PlatoDeCarta } from "@/hooks/usePlatosParaMenu";
import {
  estadoPlatoEnlazado,
  menuNovedadVacio,
  validarBotonesNovedad,
  type MenuNovedad,
  type TipoBoton,
} from "@/lib/menu-novedad";

beforeAll(() => {
  // cmdk desplaza el elemento activo a la vista; jsdom no lo implementa.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const plato = (id: string, nombre: string, extra: Partial<PlatoDeCarta> = {}): PlatoDeCarta => ({
  id,
  nombre,
  nombre_en: null,
  nombre_fr: null,
  descripcion: null,
  descripcion_en: null,
  descripcion_fr: null,
  categoria: "Entrantes",
  imagen_url: null,
  imagen_posicion_y: null,
  alergenos_oficiales: [],
  alergenos_inferidos: [],
  alergenos_notas: null,
  activado: true,
  restaurante: true,
  orden: null,
  ...extra,
});

const PLATOS = [
  plato("p-pulpo", "Pulpo a feira"),
  plato("p-off", "Croquetas de ayer", { activado: false }),
  plato("p-tienda", "Empanada para llevar", { restaurante: false }),
];

let ultimo: { botones: TipoBoton[]; platoId: string | null; menu: MenuNovedad };

function Harness({
  inicial = [],
  platoInicial = null,
  platoRetirado = false,
}: {
  inicial?: TipoBoton[];
  platoInicial?: string | null;
  platoRetirado?: boolean;
}) {
  const [botones, setBotones] = useState<TipoBoton[]>(inicial);
  const [platoId, setPlatoId] = useState<string | null>(platoInicial);
  const [menu, setMenu] = useState<MenuNovedad>(menuNovedadVacio);
  ultimo = { botones, platoId, menu };
  const platosPorId = indexarPlatos(PLATOS);
  const errores = validarBotonesNovedad({
    botones,
    menu,
    estadoPlato: estadoPlatoEnlazado(platoId, platosPorId, true),
  });
  return (
    <BloqueBotonesNovedad
      botones={botones}
      onBotonesChange={setBotones}
      platoId={platoId}
      onPlatoChange={setPlatoId}
      menu={menu}
      onMenuChange={setMenu}
      platos={PLATOS}
      platosPorId={platosPorId}
      cargandoPlatos={false}
      errorPlatos={null}
      platoRetirado={platoRetirado}
      errores={errores}
    />
  );
}

const anadir = () => within(screen.getByRole("group", { name: "Añadir botón" }));
const filas = () =>
  within(screen.getByRole("list", { name: "Botones de la tarjeta, en orden" }))
    .getAllByRole("listitem")
    .map((li) => li.textContent ?? "");

describe("BloqueBotonesNovedad", () => {
  it("por defecto no hay botones y la tarjeta se queda como hasta ahora", () => {
    render(<Harness />);
    expect(screen.getByText("Sin botones: la tarjeta se ve como hasta ahora.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /botones de la tarjeta/i })).toBeNull();
    expect(screen.getByText("0/2")).toBeInTheDocument();
    expect(screen.queryByTestId("errores-botones")).toBeNull();
  });

  it("añade hasta 2 botones, sin ofrecer los que ya están", () => {
    render(<Harness />);
    fireEvent.click(anadir().getByRole("button", { name: /llamar/i }));
    expect(ultimo.botones).toEqual(["llamar"]);
    // Un tipo ya usado no se vuelve a ofrecer.
    expect(anadir().queryByRole("button", { name: /llamar/i })).toBeNull();

    fireEvent.click(anadir().getByRole("button", { name: /ver menú/i }));
    expect(ultimo.botones).toEqual(["llamar", "ver_menu"]);
    expect(screen.getByText("2/2")).toBeInTheDocument();
    // Lleno: ya no se puede añadir ninguno más.
    expect(screen.queryByRole("group", { name: "Añadir botón" })).toBeNull();
    expect(screen.getByText(/Ya tiene los 2 botones/)).toBeInTheDocument();
  });

  it("al añadir, el foco va al botón nuevo (no se pierde en <body>)", async () => {
    render(<Harness />);
    fireEvent.click(anadir().getByRole("button", { name: /llamar/i }));
    await waitFor(() => expect(screen.getByText("Llamar").closest("[data-foco]")).toHaveFocus());
  });

  it("cambia el orden con subir y bajar, y el foco sigue en el control", async () => {
    render(<Harness inicial={["llamar", "ver_menu"]} />);
    expect(filas()[0]).toMatch(/Llamar/);
    expect(screen.getByRole("button", { name: "Subir «Llamar»" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Bajar «Ver menú»" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Subir «Ver menú»" }));
    expect(ultimo.botones).toEqual(["ver_menu", "llamar"]);
    expect(filas()[0]).toMatch(/Ver menú/);
    // Arriba del todo «Subir» se deshabilita: el foco pasa a «Bajar» del mismo.
    await waitFor(() => expect(screen.getByRole("button", { name: "Bajar «Ver menú»" })).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Bajar «Ver menú»" }));
    expect(ultimo.botones).toEqual(["llamar", "ver_menu"]);
  });

  it("quitar un botón lo vuelve a ofrecer", async () => {
    render(<Harness inicial={["llamar"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Quitar «Llamar»" }));
    expect(ultimo.botones).toEqual([]);
    expect(anadir().getByRole("button", { name: /llamar/i })).toBeEnabled();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Botones" })).toHaveFocus());
  });

  it("«Échale un vistazo» solo se ofrece con un plato enlazado", async () => {
    render(<Harness />);
    const verPlato = anadir().getByRole("button", { name: /échale un vistazo/i });
    expect(verPlato).toBeDisabled();
    expect(screen.getByText(/se puede añadir cuando enlaces un plato/)).toBeInTheDocument();
    expect(screen.getByText(TEXTO_AYUDA_PLATO)).toBeInTheDocument();

    // El buscador reutiliza SelectorPlato y solo lista platos «en la carta».
    fireEvent.click(screen.getByRole("button", { name: "Enlazar un plato" }));
    const opciones = await screen.findAllByRole("option");
    expect(opciones.map((o) => o.textContent)).toEqual([expect.stringContaining("Pulpo a feira")]);
    fireEvent.click(opciones[0]);

    expect(ultimo.platoId).toBe("p-pulpo");
    expect(within(screen.getByTestId("plato-enlazado")).getByText("Pulpo a feira")).toBeInTheDocument();
    const habilitado = anadir().getByRole("button", { name: /échale un vistazo/i });
    expect(habilitado).toBeEnabled();
    fireEvent.click(habilitado);
    expect(ultimo.botones).toEqual(["ver_plato"]);
    expect(screen.getByText("Lleva a «Pulpo a feira» en la carta.")).toBeInTheDocument();
  });

  it("sin plato enlazado no deja guardar «Échale un vistazo» y lo explica", () => {
    render(<Harness inicial={["ver_plato"]} platoInicial="p-pulpo" />);
    fireEvent.click(screen.getByRole("button", { name: "Quitar el enlace a «Pulpo a feira»" }));
    expect(ultimo.platoId).toBeNull();
    expect(within(screen.getByTestId("errores-botones")).getByText(
      "«Échale un vistazo» necesita un plato de la carta enlazado.",
    )).toBeInTheDocument();
  });

  it("avisa de que el plato ya no está en la carta", () => {
    render(<Harness inicial={["ver_plato"]} platoInicial="p-off" platoRetirado />);
    expect(screen.getByText("El plato ya no está en la carta")).toBeInTheDocument();
    expect(within(screen.getByTestId("errores-botones")).getByText(/enlaza otro o quita «Échale un vistazo»/)).toBeInTheDocument();
  });

  it("«Ver menú» abre el editor del menú y pide al menos un plato", () => {
    render(<Harness />);
    expect(screen.queryByTestId("editor-menu-novedad")).toBeNull();
    fireEvent.click(anadir().getByRole("button", { name: /ver menú/i }));
    expect(screen.getByTestId("editor-menu-novedad")).toBeInTheDocument();
    expect(screen.getByText("«Ver menú» necesita al menos un plato en primero, segundo o postre.")).toBeInTheDocument();

    // Un plato a mano basta.
    fireEvent.click(within(screen.getByTestId("seccion-menu-primero")).getByRole("button", { name: /a mano/i }));
    fireEvent.change(screen.getByLabelText("Nombre del plato 1"), { target: { value: "Caldo gallego" } });
    expect(ultimo.menu.secciones.primero[0].nombre).toBe("Caldo gallego");
    expect(screen.queryByTestId("errores-botones")).toBeNull();
  });

  it("los controles miden al menos 44 px (h-11)", () => {
    render(<Harness inicial={["llamar"]} />);
    for (const nombre of ["Subir «Llamar»", "Bajar «Llamar»", "Quitar «Llamar»"]) {
      expect(screen.getByRole("button", { name: nombre }).className).toMatch(/\bh-11\b/);
    }
    for (const boton of anadir().getAllByRole("button")) expect(boton.className).toMatch(/\bh-11\b/);
  });
});
