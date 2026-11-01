/**
 * `moverItem` (tarea «Ordenar la Cata arrastrando», criterio 5): mueve un
 * elemento dentro de su lista sin cruzar de sección, sin tocar el original y
 * sin cambiar la versión que se guarda.
 */
import { describe, expect, it } from "vitest";
import { itemLibre } from "@/lib/menu-dia";
import {
  lineaLibre,
  menuNovedadVacio,
  moverItem,
  serializarMenuNovedad,
  type MenuNovedad,
} from "@/lib/menu-novedad";

const linea = (nombre: string) => lineaLibre("vino", nombre);

function cata(...nombres: string[]): MenuNovedad {
  return { ...menuNovedadVacio(), tipo: "cata", cata: nombres.map(linea) };
}

const nombres = (menu: MenuNovedad) => menu.cata.map((l) => l.nombre);

describe("moverItem · cata", () => {
  const base = cata("A", "B", "C", "D");

  it("mueve al principio", () => {
    expect(nombres(moverItem(base, "cata", 2, 0))).toEqual(["C", "A", "B", "D"]);
  });

  it("mueve al final", () => {
    expect(nombres(moverItem(base, "cata", 0, 3))).toEqual(["B", "C", "D", "A"]);
  });

  it("mueve una posición hacia arriba y hacia abajo", () => {
    expect(nombres(moverItem(base, "cata", 1, 0))).toEqual(["B", "A", "C", "D"]);
    expect(nombres(moverItem(base, "cata", 1, 2))).toEqual(["A", "C", "B", "D"]);
  });

  it("fuera de rango, con índices no enteros o iguales devuelve el mismo menú", () => {
    for (const [desde, hasta] of [
      [-1, 0],
      [0, -1],
      [4, 0],
      [0, 4],
      [0.5, 1],
      [Number.NaN, 1],
      [2, 2],
    ]) {
      expect(moverItem(base, "cata", desde, hasta)).toBe(base);
    }
  });

  it("con un solo elemento o con la lista vacía no mueve nada", () => {
    const una = cata("Solo");
    expect(moverItem(una, "cata", 0, 0)).toBe(una);
    expect(moverItem(una, "cata", 0, 1)).toBe(una);
    const vacia = cata();
    expect(moverItem(vacia, "cata", 0, 0)).toBe(vacia);
  });

  it("no modifica el original y conserva ids y traducciones de cada bebida", () => {
    const original = cata("A", "B", "C");
    original.cata[0].traducciones = { en: { nombre: "A-en", descripcion: null } };
    const copia = structuredClone(original);
    const movido = moverItem(original, "cata", 0, 2);
    expect(original).toEqual(copia);
    expect(movido).not.toBe(original);
    expect(movido.cata[2]).toBe(original.cata[0]);
    expect(movido.cata[2].traducciones?.en?.nombre).toBe("A-en");
    expect(movido.cata.map((l) => l.id)).toEqual([original.cata[1].id, original.cata[2].id, original.cata[0].id]);
  });

  it("no cambia la versión ni el resto del jsonb, solo el orden", () => {
    const original = cata("A", "B", "C");
    const antes = serializarMenuNovedad(original) as { version: number; secciones: { cata: { nombre: string }[] } };
    const despues = serializarMenuNovedad(moverItem(original, "cata", 2, 0)) as typeof antes;
    expect(despues.version).toBe(antes.version);
    expect(despues.secciones.cata.map((l) => l.nombre)).toEqual(["C", "A", "B"]);
    expect({ ...despues, secciones: { ...despues.secciones, cata: [] } }).toEqual({
      ...antes,
      secciones: { ...antes.secciones, cata: [] },
    });
  });
});

describe("moverItem · secciones de platos", () => {
  const menuConPlatos = (): MenuNovedad => {
    const menu = menuNovedadVacio();
    menu.maridaje = true;
    menu.secciones.primero = ["P0", "P1", "P2"].map((nombre) => itemLibre(nombre));
    menu.secciones.segundo = [itemLibre("S0")];
    menu.cata = [linea("Cata")];
    menu.maridajes = { [menu.secciones.primero[0].id]: linea("Vino de P0") };
    return menu;
  };

  it("nunca pasa un plato a otra sección ni toca la cata", () => {
    const menu = menuConPlatos();
    const movido = moverItem(menu, "primero", 0, 2);
    expect(movido.secciones.primero.map((p) => p.nombre)).toEqual(["P1", "P2", "P0"]);
    expect(movido.secciones.segundo).toBe(menu.secciones.segundo);
    expect(movido.secciones.postre).toBe(menu.secciones.postre);
    expect(movido.cata).toBe(menu.cata);
    // Un índice de otra sección no sirve: «segundo» solo tiene un plato.
    expect(moverItem(menu, "segundo", 0, 2)).toBe(menu);
  });

  it("el maridaje acompaña a su plato (va por id)", () => {
    const menu = menuConPlatos();
    const p0 = menu.secciones.primero[0].id;
    const movido = moverItem(menu, "primero", 0, 2);
    expect(movido.maridajes).toBe(menu.maridajes);
    expect(movido.secciones.primero[2].id).toBe(p0);
    expect(movido.maridajes[movido.secciones.primero[2].id].nombre).toBe("Vino de P0");
    const json = serializarMenuNovedad(movido) as { secciones: { primero: { nombre: string; maridaje?: { nombre: string } }[] } };
    expect(json.secciones.primero.at(-1)).toMatchObject({ nombre: "P0", maridaje: { nombre: "Vino de P0" } });
  });
});

describe("moverItem · Bebidas del menú", () => {
  it("mueve líneas de Bebidas sin tocar los platos", () => {
    const menu = menuNovedadVacio();
    menu.secciones.bebidas = ["Agua", "Vino", "Café"].map((nombre) => itemLibre(nombre));
    menu.secciones.primero = [itemLibre("P0")];
    const movido = moverItem(menu, "bebidas", 2, 0);
    expect(movido.secciones.bebidas.map((b) => b.nombre)).toEqual(["Café", "Agua", "Vino"]);
    expect(movido.secciones.primero).toBe(menu.secciones.primero);
    expect(menu.secciones.bebidas.map((b) => b.nombre)).toEqual(["Agua", "Vino", "Café"]);
  });
});
