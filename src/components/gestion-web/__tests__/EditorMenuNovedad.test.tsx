// Menú de una novedad («Ver menú», historia 4073221d, criterios 3 y 7):
// comida con el editor del menú del día, «Comida + bebidas» o «Solo comida» y
// bebidas escritas a mano. Las traducciones guardadas se conservan mientras el
// español de la línea no cambie.

import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EditorMenuNovedad } from "@/components/gestion-web/EditorMenuNovedad";
import { indexarPlatos, type PlatoDeCarta } from "@/hooks/usePlatosParaMenu";
import { itemLibre } from "@/lib/menu-dia";
import { menuNovedadVacio, type ItemMenuNovedad, type MenuNovedad } from "@/lib/menu-novedad";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const PULPO: PlatoDeCarta = {
  id: "p-pulpo",
  nombre: "Pulpo a feira",
  nombre_en: "Galician-style octopus",
  nombre_fr: "Poulpe à la galicienne",
  descripcion: null,
  descripcion_en: null,
  descripcion_fr: null,
  categoria: "Entrantes",
  imagen_url: null,
  imagen_posicion_y: null,
  alergenos_oficiales: ["moluscos"],
  alergenos_inferidos: [],
  alergenos_notas: null,
  activado: true,
  restaurante: true,
  orden: null,
};

let ultimo: MenuNovedad;

function Harness({ inicial = menuNovedadVacio() }: { inicial?: MenuNovedad }) {
  const [menu, setMenu] = useState(inicial);
  ultimo = menu;
  return (
    <EditorMenuNovedad
      menu={menu}
      onChange={setMenu}
      platos={[PULPO]}
      platosPorId={indexarPlatos([PULPO])}
      cargandoPlatos={false}
    />
  );
}

const traducido = (nombre: string): ItemMenuNovedad => ({
  ...itemLibre(nombre),
  traducciones: { en: { nombre: `${nombre} (en)`, descripcion: null }, fr: { nombre: `${nombre} (fr)`, descripcion: null } },
});

describe("EditorMenuNovedad", () => {
  it("tiene primero, segundo y postre y empieza en «Solo comida», sin Bebidas", () => {
    render(<Harness />);
    for (const seccion of ["primero", "segundo", "postre"]) {
      expect(screen.getByTestId(`seccion-menu-${seccion}`)).toBeInTheDocument();
    }
    expect(screen.getByRole("radio", { name: /solo comida/i })).toBeChecked();
    expect(screen.queryByTestId("seccion-menu-bebidas")).toBeNull();
  });

  it("«Comida + bebidas» añade la sección Bebidas, escrita a mano", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: /comida \+ bebidas/i }));
    expect(ultimo.incluye_bebidas).toBe(true);

    const bebidas = screen.getByTestId("seccion-menu-bebidas");
    expect(within(bebidas).getByText(/Sin bebidas todavía/)).toBeInTheDocument();

    fireEvent.click(within(bebidas).getByRole("button", { name: "Añadir bebida" }));
    const campo = within(bebidas).getByLabelText("Bebida 1");
    await waitFor(() => expect(campo).toHaveFocus());
    fireEvent.change(campo, { target: { value: "Vino de la casa" } });
    expect(ultimo.secciones.bebidas[0]).toMatchObject({ nombre: "Vino de la casa", origen: "libre", platoId: null });
  });

  it("volver a «Solo comida» oculta las bebidas sin perderlas (no se guardan)", () => {
    render(<Harness inicial={{ ...menuNovedadVacio(), incluye_bebidas: true, secciones: { ...menuNovedadVacio().secciones, bebidas: [itemLibre("Agua")] } }} />);
    fireEvent.click(screen.getByRole("radio", { name: /solo comida/i }));
    expect(ultimo.incluye_bebidas).toBe(false);
    expect(screen.queryByTestId("seccion-menu-bebidas")).toBeNull();
    expect(ultimo.secciones.bebidas).toHaveLength(1);
  });

  it("ordena y quita bebidas", () => {
    const inicial: MenuNovedad = {
      ...menuNovedadVacio(),
      incluye_bebidas: true,
      secciones: { ...menuNovedadVacio().secciones, bebidas: [itemLibre("Agua"), itemLibre("Vino")] },
    };
    render(<Harness inicial={inicial} />);
    fireEvent.click(screen.getByRole("button", { name: "Subir bebida 2" }));
    expect(ultimo.secciones.bebidas.map((b) => b.nombre)).toEqual(["Vino", "Agua"]);
    fireEvent.click(screen.getByRole("button", { name: "Quitar bebida 1" }));
    expect(ultimo.secciones.bebidas.map((b) => b.nombre)).toEqual(["Agua"]);
  });

  it("un plato de la carta se copia con sus datos", async () => {
    render(<Harness />);
    fireEvent.click(within(screen.getByTestId("seccion-menu-segundo")).getByRole("button", { name: /de la carta/i }));
    fireEvent.click(await screen.findByRole("option", { name: /pulpo a feira/i }));
    expect(ultimo.secciones.segundo[0]).toMatchObject({
      origen: "carta",
      platoId: "p-pulpo",
      nombre: "Pulpo a feira",
      alergenos: ["moluscos"],
    });
  });

  it("si cambia el nombre de una línea a mano, pierde su traducción; si no, la conserva", () => {
    const inicial: MenuNovedad = {
      ...menuNovedadVacio(),
      incluye_bebidas: true,
      secciones: {
        ...menuNovedadVacio().secciones,
        primero: [traducido("Caldo"), traducido("Empanada")],
        bebidas: [traducido("Agua")],
      },
    };
    render(<Harness inicial={inicial} />);

    fireEvent.change(screen.getByLabelText("Nombre del plato 1"), { target: { value: "Caldo gallego" } });
    expect(ultimo.secciones.primero[0].traducciones).toBeUndefined();
    expect(ultimo.secciones.primero[1].traducciones?.en?.nombre).toBe("Empanada (en)");

    fireEvent.change(screen.getByLabelText("Bebida 1"), { target: { value: "Agua mineral" } });
    expect(ultimo.secciones.bebidas[0].traducciones).toBeUndefined();
  });
});
