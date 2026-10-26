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
import { render, screen } from "@testing-library/react";
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
