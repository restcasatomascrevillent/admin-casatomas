// Regresión: al añadir un plato al menú del día la línea salía cortada (nombre
// a 0px) y con los botones montados sobre la sección vecina. La causa era un
// `lg:grid-cols-3` (breakpoint de VIEWPORT) dentro de una columna que desde
// `xl` comparte fila con la vista previa: a 1280px cada sección medía ~190px.
//
// Segunda vuelta (2026-10-01): el arreglo intermedio, un `flex-wrap` con
// `flex-basis: calc((62rem - 100%) * 999)`, depende de que el ancho del contenedor
// esté resuelto antes de maquetar las secciones; si algo lo mide por contenido,
// las tres pueden quedar en fila y más anchas que la pantalla. Ahora decide una
// container query sobre un envoltorio con `container-type: inline-size`, cuyo
// ancho no depende de su contenido.
//
// jsdom no maqueta, así que aquí no se miden anchos (eso se comprobó en
// Chrome y WebKit de 320 a 2000px). Lo que se fija es el contrato: las
// secciones se reparten según el ancho del CONTENEDOR, nunca del viewport, y
// solo en 1 o 3 columnas.

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
  it("reparte las secciones con una container query, sin breakpoints de viewport", () => {
    render(<Harness inicial={vacias()} />);

    const secciones = (["primero", "segundo", "postre"] as const).map((s) =>
      screen.getByTestId(`seccion-menu-${s}`),
    );
    const rejilla = secciones[0].parentElement!;
    const contenedor = screen.getByTestId("contenedor-secciones-menu");

    // El envoltorio es el query container y es el padre directo de la rejilla
    // (una container query nunca puede dar estilo al propio contenedor).
    expect(rejilla.parentElement).toBe(contenedor);
    expect(contenedor.className.split(/\s+/)).toContain("[container-type:inline-size]");

    // Una columna por defecto y tres solo con el contenedor a ≥62rem: nunca 2 + 1.
    const clases = rejilla.className.split(/\s+/);
    expect(clases).toContain("grid");
    expect(clases).toContain("grid-cols-1");
    expect(clases).toContain("[@container(min-width:62rem)]:grid-cols-3");
    expect(rejilla.className).not.toMatch(/grid-cols-2/);
    expect(rejilla.className).not.toMatch(/\b(xs|sm|md|lg|xl|2xl):grid-cols-/);

    for (const seccion of secciones) {
      expect(seccion.parentElement).toBe(rejilla);
      expect(seccion.className).toMatch(/\bmin-w-0\b/);
      // Nada del truco anterior, que dependía del ancho resuelto del contenedor.
      expect(seccion.className).not.toMatch(/basis-|\bgrow\b/);
    }
  });

  it("al añadir un plato «A mano» aparece su línea con el campo de nombre", () => {
    render(<Harness inicial={{ ...vacias(), primero: [itemLibre("Caldo gallego")] }} />);

    const primero = screen.getByTestId("seccion-menu-primero");
    fireEvent.click(within(primero).getByRole("button", { name: /a mano/i }));

    const nombres = within(primero).getAllByPlaceholderText("Nombre del plato");
    expect(nombres).toHaveLength(2);
    expect(nombres[1]).toHaveValue("");
    // Su hueco de foto es un botón que se ve como tal (icono + «Foto»), no el
    // hueco gris de «sin foto» de los platos de la carta.
    const subir = within(primero).getByRole("button", { name: "Subir foto de este plato" });
    expect(subir).toHaveTextContent("Foto");
    expect(subir.className).toMatch(/\bborder-primary/);
    // La línea nueva va dentro de la lista de su sección, no en otra.
    expect(within(screen.getByTestId("seccion-menu-segundo")).queryByPlaceholderText("Nombre del plato")).toBeNull();
  });
});
