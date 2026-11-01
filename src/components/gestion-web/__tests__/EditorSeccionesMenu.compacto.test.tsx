// Menos scroll en el editor del menú del día (petición del dueño, 01/11/2026:
// «hay que hacer mucho scroll, soluciónalo»):
//   - Cada plato ocupa una fila: Alérgenos, Subir, Bajar y Quitar van en el
//     menú «⋮» del plato en vez de cuatro botones que en el móvil bajaban a una
//     segunda fila.
//   - Con `plegable`, una sección se queda en su cabecera con el resumen
//     («Segundo · 2 platos» y sus nombres) y se despliega al tocarla.
//   - Con el entrante son cuatro secciones: una columna o cuatro, nunca 3 + 1.

import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EditorSeccionesMenu } from "@/components/gestion-web/EditorSeccionesMenu";
import { SECCIONES_MENU_DIA, itemLibre, type ItemMenu, type SeccionesMenuDia } from "@/lib/menu-dia";

let ultimo: SeccionesMenuDia;

function Harness({ inicial, plegable = true }: { inicial: SeccionesMenuDia; plegable?: boolean }) {
  const [secciones, setSecciones] = useState(inicial);
  ultimo = secciones;
  return (
    <EditorSeccionesMenu
      orden={SECCIONES_MENU_DIA}
      secciones={secciones}
      onChange={setSecciones}
      platos={[]}
      platosPorId={new Map()}
      cargandoPlatos={false}
      plegable={plegable}
      titulos={{ postre: "Postre y café" }}
      abiertaAlInicio={(seccion, items) => seccion !== "entrante" && items.length === 0}
      detalleVacia={{ entrante: "Opcional" }}
      cabeceraDe={(seccion) => (seccion === "postre" ? <p>¿Qué entra?</p> : null)}
    />
  );
}

const vacias = (): SeccionesMenuDia => ({ entrante: [], primero: [], segundo: [], postre: [] });
const nombres = (items: ItemMenu[]) => items.map((i) => i.nombre);

describe("EditorSeccionesMenu — secciones plegables", () => {
  it("con platos empieza plegada y enseña cuántos y cuáles; al tocarla se despliega", () => {
    render(<Harness inicial={{ ...vacias(), segundo: [itemLibre("Merluza"), itemLibre("Carrillera")] }} />);

    const segundo = screen.getByTestId("seccion-menu-segundo");
    const cabecera = within(segundo).getByRole("button", { name: /Segundo/ });
    expect(cabecera).toHaveAttribute("aria-expanded", "false");
    expect(cabecera).toHaveTextContent("2 platos");
    expect(cabecera).toHaveTextContent("Merluza · Carrillera");
    // Plegada no hay líneas ni botones de añadir: solo la cabecera.
    expect(within(segundo).queryByPlaceholderText("Nombre del plato")).toBeNull();
    expect(within(segundo).queryByRole("button", { name: /a mano/i })).toBeNull();

    fireEvent.click(cabecera);
    expect(cabecera).toHaveAttribute("aria-expanded", "true");
    expect(within(segundo).getAllByPlaceholderText("Nombre del plato")).toHaveLength(2);
    expect(within(segundo).getByRole("button", { name: /a mano/i })).toBeInTheDocument();
  });

  it("vacía empieza abierta para rellenarla, sin el hueco de «Sin platos todavía»", () => {
    render(<Harness inicial={vacias()} />);
    const primero = screen.getByTestId("seccion-menu-primero");
    expect(within(primero).getByRole("button", { name: /Primero/ })).toHaveAttribute("aria-expanded", "true");
    expect(within(primero).getByRole("button", { name: /a mano/i })).toBeInTheDocument();
    expect(screen.queryByText("Sin platos todavía")).toBeNull();
  });

  it("el entrante va el primero, plegado y marcado como opcional", () => {
    render(<Harness inicial={vacias()} />);
    const secciones = screen.getAllByTestId(/^seccion-menu-/).map((s) => s.dataset.testid);
    expect(secciones).toEqual([
      "seccion-menu-entrante",
      "seccion-menu-primero",
      "seccion-menu-segundo",
      "seccion-menu-postre",
    ]);

    const entrante = screen.getByTestId("seccion-menu-entrante");
    const cabecera = within(entrante).getByRole("button", { name: /Entrante/ });
    expect(cabecera).toHaveAttribute("aria-expanded", "false");
    expect(cabecera).toHaveTextContent("Opcional");

    fireEvent.click(cabecera);
    fireEvent.click(within(entrante).getByRole("button", { name: /a mano/i }));
    fireEvent.change(within(entrante).getByPlaceholderText("Nombre del plato"), { target: { value: "Gilda" } });
    expect(nombres(ultimo.entrante)).toEqual(["Gilda"]);
    expect(ultimo.primero).toEqual([]);
  });

  it("usa el rótulo que se le pasa y pinta la cabecera de la sección desplegada", () => {
    render(<Harness inicial={vacias()} />);
    const postre = screen.getByTestId("seccion-menu-postre");
    expect(within(postre).getByRole("button", { name: /Postre y café/ })).toBeInTheDocument();
    expect(within(postre).getByText("¿Qué entra?")).toBeInTheDocument();
  });

  it("cuatro secciones: una columna o cuatro, nunca 3 + 1", () => {
    render(<Harness inicial={vacias()} />);
    const rejilla = screen.getByTestId("seccion-menu-entrante").parentElement!;
    const clases = rejilla.className.split(/\s+/);
    expect(clases).toContain("grid-cols-1");
    expect(clases).toContain("[@container(min-width:82rem)]:grid-cols-4");
    expect(rejilla.className).not.toMatch(/grid-cols-[23]\b/);
  });
});

describe("EditorSeccionesMenu — una fila por plato, el resto en «⋮»", () => {
  const conTres = () => ({ ...vacias(), primero: [itemLibre("Sopa"), itemLibre("Ensalada"), itemLibre("Crema")] });

  it("cada plato tiene un solo botón de opciones, de 44px", () => {
    render(<Harness inicial={conTres()} plegable={false} />);
    const primero = screen.getByTestId("seccion-menu-primero");
    const opciones = within(primero).getAllByRole("button", { name: /^Opciones de / });
    expect(opciones).toHaveLength(3);
    for (const boton of opciones) expect(boton.className).toMatch(/\bh-11\b.*\bw-11\b|\bw-11\b.*\bh-11\b/);
    // Los botones sueltos de antes ya no están en la fila.
    expect(within(primero).queryByRole("button", { name: "Subir" })).toBeNull();
    expect(within(primero).queryByRole("button", { name: /^Alérgenos de/ })).toBeNull();
  });

  it("Subir, Bajar y Quitar desde el menú", async () => {
    render(<Harness inicial={conTres()} plegable={false} />);

    fireEvent.keyDown(screen.getByRole("button", { name: "Opciones de Ensalada" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Subir" }));
    expect(nombres(ultimo.primero)).toEqual(["Ensalada", "Sopa", "Crema"]);

    // Arriba del todo no se puede subir más.
    fireEvent.keyDown(screen.getByRole("button", { name: "Opciones de Ensalada" }), { key: "Enter" });
    expect(await screen.findByRole("menuitem", { name: "Subir" })).toHaveAttribute("data-disabled");
    fireEvent.click(screen.getByRole("menuitem", { name: "Bajar" }));
    expect(nombres(ultimo.primero)).toEqual(["Sopa", "Ensalada", "Crema"]);

    fireEvent.keyDown(screen.getByRole("button", { name: "Opciones de Crema" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Quitar del menú" }));
    expect(nombres(ultimo.primero)).toEqual(["Sopa", "Ensalada"]);
  });

  it("«Alérgenos…» abre los alérgenos de ese plato y se pueden marcar", async () => {
    render(<Harness inicial={{ ...vacias(), primero: [itemLibre("Sopa de picadillo")] }} plegable={false} />);

    fireEvent.keyDown(screen.getByRole("button", { name: "Opciones de Sopa de picadillo" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Alérgenos…" }));

    const dialogo = await screen.findByRole("dialog", { name: "Alérgenos de Sopa de picadillo" });
    fireEvent.click(within(dialogo).getByRole("button", { name: /huevo/i }));
    await waitFor(() => expect(ultimo.primero[0].alergenos.length).toBe(1));
    // El resumen de la fila lo dice sin abrir nada.
    expect(screen.getByTestId("seccion-menu-primero")).toHaveTextContent("· Huevos");
  });
});
