import { describe, it, expect } from "vitest";
import {
  ANCHO_COLUMNA_PLEGADA,
  ANCHO_MAX_COLUMNA,
  ANCHO_MIN_COLUMNA,
  GAP_KANBAN,
  calcularDisposicion,
  columnasAPlegarParaQueQuepan,
  columnasQueCaben,
  type DisposicionKanban,
  type ItemColumna,
} from "../kanbanLayout";

const cols = (n: number, plegadas: readonly string[] = []): ItemColumna[] =>
  Array.from({ length: n }, (_, i) => ({ id: `c${i}`, plegada: plegadas.includes(`c${i}`) }));

const anchoDe = (d: DisposicionKanban, items: readonly ItemColumna[], id: string) =>
  items.find((i) => i.id === id)!.plegada ? ANCHO_COLUMNA_PLEGADA : d.anchoColumna;

/**
 * Reconstruye la fila tal y como la pintaría el navegador: posición izquierda
 * y derecha de cada columna, más el ancho total con scroll (`scrollWidth`).
 * Es la única forma honesta de comprobar la promesa "ninguna columna partida":
 * hay que simular la geometría, no confiar en los números que devuelve el
 * módulo.
 */
function maquetar(d: DisposicionKanban, items: readonly ItemColumna[]) {
  let x = 0;
  const cajas = items.map((item) => {
    const ancho = anchoDe(d, items, item.id);
    const caja = { id: item.id, izq: x, der: x + ancho };
    x += ancho + d.margenes[item.id];
    return caja;
  });
  return { cajas, scrollWidth: x + d.espacioFinal };
}

/**
 * Columnas que en esa parada se ven a medias (el fallo que hay que evitar).
 * Medio píxel de tolerancia: los anchos son fraccionarios y una diferencia de
 * milésimas no es una columna cortada, es ruido de coma flotante.
 */
const TOLERANCIA = 0.5;
function partidasEn(d: DisposicionKanban, items: readonly ItemColumna[], parada: number, viewport: number) {
  const { cajas } = maquetar(d, items);
  const vis0 = d.paradas[parada];
  const vis1 = vis0 + viewport;
  return cajas
    .filter((c) => c.der > vis0 + TOLERANCIA && c.izq < vis1 - TOLERANCIA) // asoma algo
    .filter((c) => c.izq < vis0 - TOLERANCIA || c.der > vis1 + TOLERANCIA) // …pero no entera
    .map((c) => c.id);
}

describe("calcularDisposicion", () => {
  it("sin columnas no rompe", () => {
    const d = calcularDisposicion([], 1136);
    expect(d.paradas).toEqual([]);
    expect(d.modo).toBe("ajustado");
  });

  it("antes de medir el contenedor (ancho 0) no se desplaza ni da anchos absurdos", () => {
    const d = calcularDisposicion(cols(4), 0);
    expect(d.modo).toBe("ajustado");
    expect(d.anchoColumna).toBe(ANCHO_MIN_COLUMNA);
  });

  // 1440px de ventana ≈ 1136px útiles (menos sidebar 256 y padding 48).
  it("a 1440px las 4 columnas de Casa Tomás caben y se reparten el ancho", () => {
    const items = cols(4);
    const d = calcularDisposicion(items, 1136);
    expect(d.modo).toBe("ajustado");
    expect(d.anchoColumna).toBeGreaterThanOrEqual(ANCHO_MIN_COLUMNA);
    expect(maquetar(d, items).scrollWidth).toBeLessThanOrEqual(1136);
  });

  it("a 1280px (943 útiles) sigue sin caber por poco y se desplaza en vez de cortar", () => {
    const items = cols(4);
    const d = calcularDisposicion(items, 943);
    expect(d.modo).toBe("desplazable");
    expect(d.anchoColumna).toBeGreaterThanOrEqual(ANCHO_MIN_COLUMNA);
  });

  it("nunca estira una columna más allá del máximo legible", () => {
    const items = cols(2);
    const d = calcularDisposicion(items, 1600);
    expect(d.anchoColumna).toBe(ANCHO_MAX_COLUMNA);
    // El sobrante queda como hueco vacío a la derecha, no como columnas gigantes.
    expect(maquetar(d, items).scrollWidth).toBeLessThan(1600);
  });

  it("sin carriles plegados se avanza de columna en columna, no de página en página", () => {
    const items = cols(6);
    const d = calcularDisposicion(items, 720);
    expect(d.modo).toBe("desplazable");
    const paso = d.anchoColumna + GAP_KANBAN;
    expect(d.paradas).toEqual(d.paradas.map((_, i) => i * paso));
    // Todas las columnas llevan imán: cualquiera puede quedar alineada al borde.
    expect(d.idsConIman).toEqual(items.map((i) => i.id));
  });

  it("una columna plegada ocupa el ancho del carril, no el de una columna", () => {
    const items = cols(4, ["c0"]);
    const d = calcularDisposicion(items, 900);
    expect(anchoDe(d, items, "c0")).toBe(ANCHO_COLUMNA_PLEGADA);
  });

  it("plegar la columna vacía permite que el resto quepa sin desplazamiento", () => {
    // 800px útiles: 4 columnas enteras darían 188px (ilegible) y habría que
    // desplazarse; plegando la vacía, las 3 restantes salen a 233px y caben.
    const anchoJusto = 800;
    expect(calcularDisposicion(cols(4), anchoJusto).modo).toBe("desplazable");
    expect(calcularDisposicion(cols(4, ["c0"]), anchoJusto).modo).toBe("ajustado");
  });
});

describe("garantía de que ninguna columna queda partida", () => {
  const anchos = [320, 375, 480, 600, 720, 744, 800, 900, 943, 976, 1024, 1136, 1280, 1600];
  const casos: { nombre: string; items: ItemColumna[] }[] = [
    { nombre: "4 columnas (Casa Tomás)", items: cols(4) },
    { nombre: "5 columnas", items: cols(5) },
    { nombre: "8 columnas", items: cols(8) },
    { nombre: "1 columna (Touza sola)", items: cols(1) },
    { nombre: "6 columnas con dos plegadas a mano", items: cols(6, ["c0", "c3"]) },
    { nombre: "3 columnas con la primera plegada", items: cols(3, ["c0"]) },
  ];

  for (const { nombre, items } of casos) {
    for (const ancho of anchos) {
      it(`${nombre} a ${ancho}px: ninguna parada deja una columna a medias`, () => {
        const d = calcularDisposicion(items, ancho);
        d.paradas.forEach((_, i) => {
          expect(partidasEn(d, items, i, ancho)).toEqual([]);
        });
      });

      it(`${nombre} a ${ancho}px: la última parada es justo el final del scroll`, () => {
        const d = calcularDisposicion(items, ancho);
        const { scrollWidth } = maquetar(d, items);
        const maxScroll = Math.max(0, scrollWidth - ancho);
        // Ni corta ni larga: si la última parada quedase MÁS ALLÁ del final, el
        // navegador se pararía antes y asomaría media columna por la izquierda;
        // si quedase MÁS ACÁ, el scroll podría pasarse y asomaría una rendija.
        expect(d.paradas[d.paradas.length - 1]).toBe(maxScroll);
      });
    }
  }

  it("todas las columnas se pueden llegar a ver enteras en alguna parada", () => {
    const items = cols(7);
    const d = calcularDisposicion(items, 700);
    const vistas = new Set(d.visiblesPorParada.flat());
    expect([...vistas].sort()).toEqual(items.map((i) => i.id).sort());
  });

  it("cuando todo cabe hay una sola parada en el cero", () => {
    const d = calcularDisposicion(cols(3), 1136);
    expect(d.paradas).toEqual([0]);
    expect(d.espacioFinal).toBe(0);
  });

  it("con carriles plegados las paradas son páginas del ancho del viewport", () => {
    const ancho = 640;
    const d = calcularDisposicion(cols(6, ["c0"]), ancho);
    expect(d.modo).toBe("desplazable");
    expect(d.paradas).toEqual(d.paradas.map((_, i) => i * ancho));
  });
});

describe("columnasQueCaben", () => {
  it("nunca devuelve menos de una", () => {
    expect(columnasQueCaben(0)).toBe(1);
    expect(columnasQueCaben(-50)).toBe(1);
    expect(columnasQueCaben(100)).toBe(1);
  });

  it("cuenta columnas enteras con su separación", () => {
    expect(columnasQueCaben(ANCHO_MIN_COLUMNA)).toBe(1);
    expect(columnasQueCaben(ANCHO_MIN_COLUMNA * 2 + GAP_KANBAN)).toBe(2);
    expect(columnasQueCaben(ANCHO_MIN_COLUMNA * 2 + GAP_KANBAN - 1)).toBe(1);
  });
});

describe("columnasAPlegarParaQueQuepan", () => {
  it("no pliega nada si ya caben todas", () => {
    expect(columnasAPlegarParaQueQuepan(cols(4), new Set(["c0"]), 1136).size).toBe(0);
  });

  it("pliega solo las vacías justas para evitar el desplazamiento", () => {
    const items = cols(4);
    const plegar = columnasAPlegarParaQueQuepan(items, new Set(["c0", "c1"]), 800);
    expect(plegar.size).toBe(1);
    const simulado = items.map((i) => ({ ...i, plegada: plegar.has(i.id) }));
    expect(calcularDisposicion(simulado, 800).modo).toBe("ajustado");
  });

  it("no pliega nada si ni plegándolas todas se consigue que quepan", () => {
    // 8 columnas en 400px no caben ni plegando las vacías: mejor desplazarse
    // que esconder columnas y seguir sin caber.
    expect(columnasAPlegarParaQueQuepan(cols(8), new Set(["c0", "c1", "c2"]), 400).size).toBe(0);
  });

  it("no toca columnas con reservas", () => {
    expect(columnasAPlegarParaQueQuepan(cols(4), new Set(), 800).size).toBe(0);
  });
});
