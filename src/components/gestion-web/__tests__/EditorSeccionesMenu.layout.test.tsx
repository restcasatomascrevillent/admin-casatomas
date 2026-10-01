// Regresión: al añadir un plato al menú del día la línea salía cortada (nombre
// a 0px) y con los botones montados sobre la sección vecina. La causa era un
// `lg:grid-cols-3` (breakpoint de VIEWPORT) dentro de una columna que desde
// `xl` comparte fila con la vista previa: a 1280px cada sección medía ~190px.
//
// jsdom no maqueta, así que no se pueden medir anchos aquí (eso se comprobó en
// el navegador). Lo que sí se fija es el contrato: las secciones se reparten
// según el ancho del CONTENEDOR, no del viewport.

import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { EditorSeccionesMenu } from "@/components/gestion-web/EditorSeccionesMenu";
import { itemLibre, type ItemMenu, type SeccionMenu } from "@/lib/menu-dia";

type Secciones = Record<SeccionMenu, ItemMenu[]>;

function Harness({ inicial }: { inicial: Secciones }) {
  const [secciones, setSecciones] = useState(inicial);
  return (
    <EditorSeccionesMenu
      secciones={secciones}
      onChange={setSecciones}
      platos={[]}
      platosPorId={new Map()}
      cargandoPlatos={false}
    />
  );
}

const vacias = (): Secciones => ({ primero: [], segundo: [], postre: [] });

describe("EditorSeccionesMenu — maquetación de las secciones", () => {
  it("reparte las secciones por el ancho del contenedor, sin breakpoints de viewport", () => {
    render(<Harness inicial={vacias()} />);

    const secciones = (["primero", "segundo", "postre"] as const).map((s) =>
      screen.getByTestId(`seccion-menu-${s}`),
    );
    const contenedor = secciones[0].parentElement!;

    expect(contenedor.className).toMatch(/\bflex-wrap\b/);
    expect(contenedor.className).not.toMatch(/\b(sm|md|lg|xl|2xl):grid-cols-/);

    for (const seccion of secciones) {
      expect(seccion.className).toContain("basis-[calc((62rem_-_100%)_*_999)]");
      expect(seccion.className).toMatch(/\bgrow\b/);
      expect(seccion.className).toMatch(/\bmin-w-0\b/);
    }
  });

  it("al añadir un plato «A mano» aparece su línea con el campo de nombre", () => {
    render(<Harness inicial={{ ...vacias(), primero: [itemLibre("Caldo gallego")] }} />);

    const primero = screen.getByTestId("seccion-menu-primero");
    fireEvent.click(within(primero).getByRole("button", { name: /a mano/i }));

    const nombres = within(primero).getAllByPlaceholderText("Nombre del plato");
    expect(nombres).toHaveLength(2);
    expect(nombres[1]).toHaveValue("");
    // La línea nueva va dentro de la lista de su sección, no en otra.
    expect(within(screen.getByTestId("seccion-menu-segundo")).queryByPlaceholderText("Nombre del plato")).toBeNull();
  });
});
