/**
 * MobilePreview («Así se ve en el móvil», Gestor Web → Novedades): el
 * encuadre vertical de la foto (`imagen_posicion_y`) que se eligió con
 * «Posicionar imagen» tiene que verse tal cual en esta vista previa.
 *
 * Bug que protege: `0` (encuadre arriba del todo) se trataba como «sin
 * valor» por ser falso en JavaScript (`y || 50`), y la foto se quedaba
 * centrada aunque se hubiera guardado arriba del todo. Mismo bug ya
 * corregido en casa-tomas-story (NovedadesSection, ProductoCard) y en el
 * resto de miniaturas de este panel (lista de novedades, ListaPlatos,
 * ListaVinos): aquí usaba `||` en vez de `??`.
 */
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MobilePreview, type NovedadPreview } from "../MobilePreview";

const base: NovedadPreview = {
  id: "x",
  titulo: "",
  descripcion: "",
};

const fotoDe = (titulo: string) => screen.getByAltText(titulo) as HTMLImageElement;

describe("MobilePreview — encuadre de la foto", () => {
  it("respeta el encuadre 0 (arriba del todo) en vez de centrar la foto", () => {
    render(
      <MobilePreview
        novedades={[{ ...base, id: "arriba", titulo: "Arriba", imagen_url: "https://example.com/arriba.jpg", imagen_posicion_y: 0 }]}
      />,
    );
    expect(fotoDe("Arriba").style.objectPosition).toBe("center 0%");
  });

  it("aplica un encuadre intermedio", () => {
    render(
      <MobilePreview
        novedades={[{ ...base, id: "medio", titulo: "Medio", imagen_url: "https://example.com/medio.jpg", imagen_posicion_y: 36 }]}
      />,
    );
    expect(fotoDe("Medio").style.objectPosition).toBe("center 36%");
  });

  it("sin encuadre guardado (null) centra la foto por defecto", () => {
    render(
      <MobilePreview
        novedades={[{ ...base, id: "sin-valor", titulo: "Sin valor", imagen_url: "https://example.com/sin-valor.jpg", imagen_posicion_y: null }]}
      />,
    );
    expect(fotoDe("Sin valor").style.objectPosition).toBe("center 50%");
  });
});

/**
 * Botones al pie de la tarjeta (historia 4073221d, criterio 1): la vista previa
 * los pinta en el orden guardado y con el texto del idioma elegido, y oculta
 * los que la web ocultaría. Sin botones, la tarjeta es la de siempre.
 */
describe("MobilePreview — botones de la tarjeta", () => {
  const botonesDe = () =>
    within(screen.getByRole("list", { name: "Botones de la tarjeta" }))
      .getAllByRole("listitem")
      .map((li) => li.textContent);

  it("una novedad sin botones no pinta nada al pie (como hasta ahora)", () => {
    render(<MobilePreview novedades={[{ ...base, titulo: "De siempre" }]} />);
    expect(screen.queryByRole("list", { name: "Botones de la tarjeta" })).toBeNull();
    expect(screen.queryByText(/No saldrá en la web/)).toBeNull();
  });

  it("pinta los botones en el orden guardado", () => {
    render(
      <MobilePreview
        novedades={[{ ...base, titulo: "Navidad", botones: ["ver_menu", "llamar"], menuConPlatos: true }]}
      />,
    );
    expect(botonesDe()).toEqual(["Ver menú", "Llamar"]);
    // Los mismos textos que la web (web-casatomas 6c9d0f0).
    fireEvent.click(screen.getByRole("radio", { name: "Inglés" }));
    expect(botonesDe()).toEqual(["View menu", "Call"]);
    fireEvent.click(screen.getByRole("radio", { name: "Francés" }));
    expect(botonesDe()).toEqual(["Voir le menu", "Appeler"]);
  });

  it("traduce las etiquetas con el idioma de la vista previa", () => {
    render(
      <MobilePreview
        novedades={[{ ...base, titulo: "Plato nuevo", botones: ["llamar", "ver_plato"], platoEnCarta: true }]}
      />,
    );
    expect(botonesDe()).toEqual(["Llamar", "Échale un vistazo"]);
    fireEvent.click(screen.getByRole("radio", { name: "Inglés" }));
    expect(botonesDe()).toEqual(["Call", "Take a look"]);
    fireEvent.click(screen.getByRole("radio", { name: "Francés" }));
    expect(botonesDe()).toEqual(["Appeler", "Jetez un œil"]);
  });

  it("oculta «Échale un vistazo» si el plato no está en la carta y «Ver menú» si no tiene platos", () => {
    render(
      <MobilePreview
        novedades={[
          { ...base, id: "a", titulo: "Sin plato", botones: ["llamar", "ver_plato"], platoEnCarta: false },
          { ...base, id: "b", titulo: "Sin menú", botones: ["ver_menu"], menuConPlatos: false },
        ]}
      />,
    );
    expect(screen.getAllByRole("list", { name: "Botones de la tarjeta" })).toHaveLength(1);
    expect(botonesDe()).toEqual(["Llamar"]);
  });

  it("en la tarjeta que se edita avisa de los botones que la web no enseñará", () => {
    render(
      <MobilePreview
        idResaltado="borrador"
        novedades={[{ ...base, id: "borrador", titulo: "Borrador", botones: ["ver_menu", "ver_plato"] }]}
      />,
    );
    expect(screen.getByText("No saldrá en la web: «Ver menú» y «Échale un vistazo»")).toBeInTheDocument();
  });
});
