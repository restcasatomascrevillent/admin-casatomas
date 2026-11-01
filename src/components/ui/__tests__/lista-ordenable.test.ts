// Lista ordenable común (tarea «Ordenar la Cata arrastrando»): soltar fuera de
// la lista o en el mismo sitio no mueve nada, y los anuncios van en español.
import { describe, expect, it } from "vitest";
import { anunciosListaOrdenable, destinoArrastre } from "@/components/ui/lista-ordenable";

const ids = ["a", "b", "c"];
const nombre = (id: string) => ({ a: "Cava", b: "Fondillón", c: "Orujo" })[id] ?? id;
const nodo = (id: string) => ({ id }) as never;

describe("destinoArrastre", () => {
  it("devuelve origen y destino al soltar sobre otra bebida", () => {
    expect(destinoArrastre(ids, { active: nodo("a"), over: nodo("c") })).toEqual({ desde: 0, hasta: 2 });
    expect(destinoArrastre(ids, { active: nodo("c"), over: nodo("a") })).toEqual({ desde: 2, hasta: 0 });
  });

  it("soltar fuera de la lista, en su sitio o sobre algo ajeno no mueve nada", () => {
    expect(destinoArrastre(ids, { active: nodo("a"), over: null })).toBeNull();
    expect(destinoArrastre(ids, { active: nodo("b"), over: nodo("b") })).toBeNull();
    expect(destinoArrastre(ids, { active: nodo("a"), over: nodo("otra-lista") })).toBeNull();
  });
});

describe("anunciosListaOrdenable", () => {
  const anuncios = anunciosListaOrdenable(ids, nombre);
  it("habla en español y dice la posición", () => {
    expect(anuncios.onDragStart({ active: nodo("b") })).toBe("Has cogido «Fondillón». Está en la posición 2 de 3.");
    expect(anuncios.onDragOver({ active: nodo("b"), over: nodo("a") })).toBe("«Fondillón» pasaría a la posición 1 de 3.");
    expect(anuncios.onDragEnd({ active: nodo("b"), over: nodo("c") })).toBe(
      "Has soltado «Fondillón» en la posición 3 de 3.",
    );
    expect(anuncios.onDragEnd({ active: nodo("b"), over: null })).toMatch(/fuera de la lista\. Se queda en la posición 2/);
    expect(anuncios.onDragCancel({ active: nodo("b"), over: null })).toBe(
      "Cancelado. «Fondillón» vuelve a la posición 2 de 3.",
    );
  });
});
