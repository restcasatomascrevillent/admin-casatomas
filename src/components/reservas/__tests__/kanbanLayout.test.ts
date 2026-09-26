import { describe, it, expect } from "vitest";
import * as kanbanLayout from "../kanbanLayout";
import {
  ANCHO_COLUMNA_PLEGADA,
  ANCHO_MAX_COLUMNA,
  ANCHO_MIN_BOTON_CON_TEXTO,
  ANCHO_MIN_COLUMNA,
  GAP_KANBAN,
  accionesSoloIcono,
  anchoParaQueQuepanTodas,
  calcularDisposicion,
  columnasQueCaben,
  type DisposicionKanban,
  type ItemColumna,
} from "../kanbanLayout";

const cols = (n: number, plegadas: readonly string[] = []): ItemColumna[] =>
  Array.from({ length: n }, (_, i) => ({ id: `c${i}`, plegada: plegadas.includes(`c${i}`) }));

const anchoDe = (d: DisposicionKanban, items: readonly ItemColumna[], id: string) =>
  items.find((i) => i.id === id)!.plegada ? ANCHO_COLUMNA_PLEGADA : d.anchoColumna;

/**
 * Anchos ÚTILES (el `clientWidth` del contenedor con scroll) de las cuatro
 * ventanas que revisa el dueño. De la ventana se descuentan el sidebar (256),
 * el padding de `main` (`sm:p-6`, 48) y el marco del grupo de negocio
 * (`border` + `p-2`, 18).
 */
const UTILES_POR_VENTANA = {
  1456: 1134,
  1280: 958,
  1024: 702,
  768: 446,
} as const;

/** Las 5 columnas de Casa Tomás: Sin asignar + Comedor + Reservado + Salón + Terraza. */
const CASA_TOMAS = 5;

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

// ============================================================================
// LA REGLA NUEVA (2026-09-26): TODAS VISIBLES, NINGUNA CORTADA
// ----------------------------------------------------------------------------
// El dueño rechazó el plegado automático: "cuando abro todos se pierden, tienen
// que estar todos aunque ocupen menos espacio de ancho por columna". Estos
// tests fijan la regla que lo sustituye.
// ============================================================================
describe("todas las columnas visibles a la vez", () => {
  it("el módulo ya NO expone un plegado automático", () => {
    // `columnasAPlegarParaQueQuepan` plegaba columnas por su cuenta para hacer
    // sitio. Si alguien la reintroduce, este test lo caza.
    expect(Object.keys(kanbanLayout)).not.toContain("columnasAPlegarParaQueQuepan");
  });

  it("nada se pliega si no lo pide el usuario: lo plegado es exactamente lo que entra plegado", () => {
    // Las 5 columnas de Casa Tomás con CUATRO vacías (el caso del dueño: solo
    // "Sin asignar" tenía reservas). Ninguna llega plegada, ninguna sale
    // plegada, aunque el ancho apriete.
    for (const util of Object.values(UTILES_POR_VENTANA)) {
      const items = cols(CASA_TOMAS);
      const d = calcularDisposicion(items, util);
      // El único ancho que devuelve el módulo es el de columna abierta: si
      // plegase algo, tendría que decirlo por el flag `plegada`, que es de
      // entrada y el módulo no puede cambiar.
      expect(d.anchoColumna).not.toBe(ANCHO_COLUMNA_PLEGADA);
      expect(items.every((i) => !i.plegada)).toBe(true);
      // Y en alguna parada se ve cada una de las 5: ninguna desaparece.
      expect(new Set(d.visiblesPorParada.flat()).size).toBe(CASA_TOMAS);
    }
  });

  it("a 1456px (el ancho del dueño) las 5 columnas de Casa Tomás caben a la vez y sin scroll", () => {
    const items = cols(CASA_TOMAS);
    const util = UTILES_POR_VENTANA[1456];
    const d = calcularDisposicion(items, util);
    expect(d.modo).toBe("ajustado");
    expect(d.paradas).toEqual([0]);
    expect(d.visiblesPorParada[0]).toEqual(items.map((i) => i.id));
    expect(d.anchoColumna).toBeGreaterThanOrEqual(ANCHO_MIN_COLUMNA);
    expect(maquetar(d, items).scrollWidth).toBeLessThanOrEqual(util);
  });

  it("a 1280px también caben las 5 a la vez (con 224px de mínimo no cabían)", () => {
    const items = cols(CASA_TOMAS);
    const util = UTILES_POR_VENTANA[1280];
    const d = calcularDisposicion(items, util);
    expect(d.modo).toBe("ajustado");
    expect(d.visiblesPorParada[0]).toEqual(items.map((i) => i.id));
    expect(maquetar(d, items).scrollWidth).toBeLessThanOrEqual(util);
  });

  it("a 1024px TAMBIÉN caben las 5 a la vez (con 160 de mínimo no cabían)", () => {
    const items = cols(CASA_TOMAS);
    const util = UTILES_POR_VENTANA[1024];
    const d = calcularDisposicion(items, util);
    expect(d.modo).toBe("ajustado");
    expect(d.visiblesPorParada[0]).toEqual(items.map((i) => i.id));
    expect(maquetar(d, items).scrollWidth).toBeLessThanOrEqual(util);
    // Y ahí la botonera de las tarjetas se queda en iconos, que es lo que hace
    // posible estrechar tanto sin recortar nada.
    expect(accionesSoloIcono(d.anchoColumna)).toBe(true);
  });

  it("el mínimo por columna es bajo a propósito: 5 columnas caben en menos de 700px útiles", () => {
    // Traducción del encargo: antes que esconder una columna, estrecharlas.
    expect(anchoParaQueQuepanTodas(cols(CASA_TOMAS))).toBeLessThanOrEqual(700);
    expect(anchoParaQueQuepanTodas(cols(CASA_TOMAS))).toBeLessThanOrEqual(UTILES_POR_VENTANA[1024]);
  });

  it("el mínimo no baja del suelo medido en el que la insignia de estado se recorta (96px)", () => {
    // Medido en navegador: por debajo de 96px de columna, «Confirmada» se sale
    // de la tarjeta. El mínimo se queda por encima, con margen.
    expect(ANCHO_MIN_COLUMNA).toBeGreaterThanOrEqual(96);
  });

  it("si caben al mínimo, SIEMPRE se muestran todas (nunca se desplaza pudiendo no hacerlo)", () => {
    const casos = [cols(3), cols(4), cols(CASA_TOMAS), cols(6), cols(8), cols(6, ["c0"])];
    for (const items of casos) {
      const minimo = anchoParaQueQuepanTodas(items);
      for (const util of [minimo, minimo + 1, minimo + 40, minimo * 2]) {
        const d = calcularDisposicion(items, util);
        expect({ n: items.length, util, modo: d.modo }).toEqual({ n: items.length, util, modo: "ajustado" });
        expect(d.visiblesPorParada[0]).toEqual(items.map((i) => i.id));
        expect(maquetar(d, items).scrollWidth).toBeLessThanOrEqual(util);
      }
    }
  });

  it("justo por debajo del mínimo se desplaza (no se corta) y todas siguen alcanzables", () => {
    const items = cols(CASA_TOMAS);
    const util = anchoParaQueQuepanTodas(items) - 1;
    const d = calcularDisposicion(items, util);
    expect(d.modo).toBe("desplazable");
    // Ninguna se esconde: cada una se ve entera en alguna parada.
    expect([...new Set(d.visiblesPorParada.flat())].sort()).toEqual(items.map((i) => i.id).sort());
    d.paradas.forEach((_, i) => expect(partidasEn(d, items, i, util)).toEqual([]));
  });

  it("plegar es manual: una columna plegada ocupa el carril y las demás se reparten el resto", () => {
    const items = cols(CASA_TOMAS, ["c2"]);
    const util = UTILES_POR_VENTANA[1456];
    const d = calcularDisposicion(items, util);
    expect(anchoDe(d, items, "c2")).toBe(ANCHO_COLUMNA_PLEGADA);
    expect(d.modo).toBe("ajustado");
    expect(d.visiblesPorParada[0]).toEqual(items.map((i) => i.id));
  });
});

// ============================================================================
// EL SEGUNDO FALLO DEL 2026-09-26: una columna de ~480px con el máximo en 320
// ============================================================================
describe("ninguna columna pasa de su ancho máximo declarado", () => {
  const anchos = [
    160, 200, 260, 320, 321, 330, 336, 340, 352, 375, 446, 480, 600, 664, 702, 720, 744, 800,
    864, 900, 943, 958, 976, 1024, 1134, 1136, 1280, 1600, 2400,
  ];
  const casos: { nombre: string; items: ItemColumna[] }[] = [
    { nombre: "1 columna", items: cols(1) },
    { nombre: "2 columnas", items: cols(2) },
    { nombre: "5 columnas (Casa Tomás)", items: cols(CASA_TOMAS) },
    { nombre: "8 columnas", items: cols(8) },
    { nombre: "5 columnas con una plegada", items: cols(CASA_TOMAS, ["c1"]) },
  ];

  for (const { nombre, items } of casos) {
    it(`${nombre}: a ningún ancho se estira una columna más allá del máximo`, () => {
      for (const ancho of anchos) {
        expect({ ancho, w: calcularDisposicion(items, ancho).anchoColumna }).toEqual({
          ancho,
          w: Math.min(calcularDisposicion(items, ancho).anchoColumna, ANCHO_MAX_COLUMNA),
        });
        expect(calcularDisposicion(items, ancho).anchoColumna).toBeLessThanOrEqual(ANCHO_MAX_COLUMNA);
      }
    });
  }

  it("con el ancho de sobra el exceso queda como hueco, no como columnas gigantes", () => {
    const items = cols(2);
    const d = calcularDisposicion(items, 1600);
    expect(d.anchoColumna).toBe(ANCHO_MAX_COLUMNA);
    expect(maquetar(d, items).scrollWidth).toBeLessThan(1600);
  });

  it("el PASO entre paradas siempre llena el viewport, tope o no tope", () => {
    // Esta es la invariante que protege el recorte al máximo: si el tope se
    // aplicase al PASO (y no solo al ANCHO), el paso quedaría más corto que el
    // viewport y volvería a asomar media columna. Se comprueba como propiedad
    // y no con un ancho concreto porque, con ANCHO_MIN_COLUMNA en 112, el tope
    // ya no llega a activarse por esta vía: se deja como red de seguridad por
    // si el mínimo vuelve a subir.
    for (const items of [cols(CASA_TOMAS), cols(8), cols(12)]) {
      for (let ancho = 200; ancho <= 1200; ancho += 7) {
        const d = calcularDisposicion(items, ancho);
        if (d.modo !== "desplazable" || d.paradas.length < 2) continue;
        const porVista = d.visiblesPorParada[0].length;
        const paso = d.paradas[1] - d.paradas[0];
        expect({ ancho, n: items.length, llena: porVista * paso >= ancho }).toEqual({
          ancho,
          n: items.length,
          llena: true,
        });
      }
    }
  });

  it("el hueco entre columnas nunca baja de la separación de diseño", () => {
    for (const items of [cols(CASA_TOMAS), cols(8)]) {
      for (let ancho = 200; ancho <= 1200; ancho += 11) {
        const d = calcularDisposicion(items, ancho);
        const huecos = items.slice(0, -1).map((i) => d.margenes[i.id]);
        expect({ ancho, min: Math.min(...huecos) >= GAP_KANBAN }).toEqual({ ancho, min: true });
      }
    }
  });
});

// ============================================================================
// BOTONERA DE LA TARJETA: TEXTO O SOLO ICONOS
// ----------------------------------------------------------------------------
// Encargo del dueño (2026-09-26): antes que esconder columnas, encoger el
// contenido. Por debajo de cierto ancho de COLUMNA el botón «Ha llegado» se
// queda en el icono del check (con aria-label y title), y eso es lo que
// permite que las 5 columnas quepan también a 1024px.
// ============================================================================
describe("accionesSoloIcono", () => {
  it("con columnas anchas la botonera lleva texto", () => {
    expect(accionesSoloIcono(ANCHO_MIN_BOTON_CON_TEXTO)).toBe(false);
    expect(accionesSoloIcono(ANCHO_MAX_COLUMNA)).toBe(false);
    expect(accionesSoloIcono(211)).toBe(false); // 1456px
    expect(accionesSoloIcono(175)).toBe(false); // 1280px
  });

  it("con columnas estrechas se queda en iconos", () => {
    expect(accionesSoloIcono(ANCHO_MIN_BOTON_CON_TEXTO - 1)).toBe(true);
    expect(accionesSoloIcono(124)).toBe(true); // 1024px
    expect(accionesSoloIcono(ANCHO_MIN_COLUMNA)).toBe(true);
  });

  it("sin ancho conocido (tarjeta arrastrándose, primer pintado) va con texto", () => {
    expect(accionesSoloIcono(undefined)).toBe(false);
    expect(accionesSoloIcono(null)).toBe(false);
    expect(accionesSoloIcono(Number.NaN)).toBe(false);
  });

  it("el umbral deja margen sobre el ancho medido en el que el texto se sale (146px)", () => {
    // Medido en navegador: con texto, la fila de acciones cabe hasta 146px de
    // columna y a 144 el botón se sale de la tarjeta.
    expect(ANCHO_MIN_BOTON_CON_TEXTO).toBeGreaterThan(146);
  });

  it("el mínimo de columna está por debajo del umbral: nunca hay columna con texto recortado", () => {
    // Si el mínimo quedase por encima del umbral, habría anchos válidos donde
    // la botonera lleva texto y no cabe. Esta es la relación que lo impide.
    expect(ANCHO_MIN_COLUMNA).toBeLessThan(ANCHO_MIN_BOTON_CON_TEXTO);
    expect(accionesSoloIcono(ANCHO_MIN_COLUMNA)).toBe(true);
  });

  it("la decisión va por columna, no por fila: dos negocios a la vez pueden diferir", () => {
    // Misma pantalla (1024px, 687 útiles): Casa Tomás reparte entre 5 columnas
    // y Touza entre 3, así que una fila va en iconos y la otra con texto.
    const casaTomas = calcularDisposicion(cols(CASA_TOMAS), UTILES_POR_VENTANA[1024]);
    const touza = calcularDisposicion(cols(3), UTILES_POR_VENTANA[1024]);
    expect(accionesSoloIcono(casaTomas.anchoColumna)).toBe(true);
    expect(accionesSoloIcono(touza.anchoColumna)).toBe(false);
  });
});

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

  it("a 1440px las 4 columnas de un negocio caben y se reparten el ancho", () => {
    const items = cols(4);
    const d = calcularDisposicion(items, 1136);
    expect(d.modo).toBe("ajustado");
    expect(d.anchoColumna).toBeGreaterThanOrEqual(ANCHO_MIN_COLUMNA);
    expect(maquetar(d, items).scrollWidth).toBeLessThanOrEqual(1136);
  });

  it("a 1280px (943 útiles) 4 columnas caben de sobra: antes se desplazaba por 50px", () => {
    const items = cols(4);
    const d = calcularDisposicion(items, 943);
    expect(d.modo).toBe("ajustado");
    expect(d.anchoColumna).toBeGreaterThanOrEqual(ANCHO_MIN_COLUMNA);
  });

  it("sin carriles plegados se avanza de columna en columna, no de página en página", () => {
    const items = cols(8);
    const d = calcularDisposicion(items, 600);
    expect(d.modo).toBe("desplazable");
    const paso = d.anchoColumna + d.margenes[items[0].id];
    expect(d.paradas).toEqual(d.paradas.map((_, i) => i * paso));
    // Todas las columnas llevan imán: cualquiera puede quedar alineada al borde.
    expect(d.idsConIman).toEqual(items.map((i) => i.id));
  });

  it("una columna plegada ocupa el ancho del carril, no el de una columna", () => {
    const items = cols(4, ["c0"]);
    const d = calcularDisposicion(items, 900);
    expect(anchoDe(d, items, "c0")).toBe(ANCHO_COLUMNA_PLEGADA);
  });

  it("plegar a mano una columna da más ancho a las demás", () => {
    const util = 700;
    const abiertas = calcularDisposicion(cols(4), util);
    const conCarril = calcularDisposicion(cols(4, ["c0"]), util);
    expect(conCarril.anchoColumna).toBeGreaterThan(abiertas.anchoColumna);
    expect(conCarril.modo).toBe("ajustado");
  });
});

describe("garantía de que ninguna columna queda partida", () => {
  const anchos = [
    320, 330, 375, 446, 480, 600, 702, 720, 744, 800, 900, 943, 958, 976, 1024, 1134, 1136, 1280, 1600,
  ];
  const casos: { nombre: string; items: ItemColumna[] }[] = [
    { nombre: "4 columnas", items: cols(4) },
    { nombre: "5 columnas (Casa Tomás)", items: cols(CASA_TOMAS) },
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

      it(`${nombre} a ${ancho}px: si el modo es "ajustado" no hay nada que desplazar`, () => {
        const d = calcularDisposicion(items, ancho);
        if (d.modo !== "ajustado") return;
        expect(d.paradas).toEqual([0]);
        expect(d.espacioFinal).toBe(0);
        expect(maquetar(d, items).scrollWidth).toBeLessThanOrEqual(ancho);
        expect(d.visiblesPorParada[0]).toEqual(items.map((i) => i.id));
      });
    }
  }

  it("todas las columnas se pueden llegar a ver enteras en alguna parada", () => {
    const items = cols(12);
    const d = calcularDisposicion(items, 700);
    const vistas = new Set(d.visiblesPorParada.flat());
    expect([...vistas].sort()).toEqual(items.map((i) => i.id).sort());
  });

  it("cuando todo cabe hay una sola parada en el cero", () => {
    const d = calcularDisposicion(cols(3), 1136);
    expect(d.paradas).toEqual([0]);
    expect(d.espacioFinal).toBe(0);
  });

  it("con carriles plegados a mano las paradas son páginas del ancho del viewport", () => {
    const ancho = 420;
    const d = calcularDisposicion(cols(8, ["c0"]), ancho);
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

describe("anchoParaQueQuepanTodas", () => {
  it("es el ancho exacto a partir del cual se muestran todas", () => {
    for (const n of [2, 3, 5, 8]) {
      const items = cols(n);
      const minimo = anchoParaQueQuepanTodas(items);
      expect(minimo).toBe(n * ANCHO_MIN_COLUMNA + (n - 1) * GAP_KANBAN);
      expect(calcularDisposicion(items, minimo).modo).toBe("ajustado");
      expect(calcularDisposicion(items, minimo - 1).modo).toBe("desplazable");
    }
  });

  it("con UNA sola columna no hay nada que desplazar: se estrecha y se queda", () => {
    // Touza puede tener una sola sala. Por debajo del mínimo la columna se
    // estrecha hasta el ancho de la pantalla, que es preferible a un scroll
    // que no llevaría a ninguna parte.
    const items = cols(1);
    expect(anchoParaQueQuepanTodas(items)).toBe(ANCHO_MIN_COLUMNA);
    const d = calcularDisposicion(items, ANCHO_MIN_COLUMNA - 1);
    expect(d.modo).toBe("ajustado");
    expect(maquetar(d, items).scrollWidth).toBeLessThanOrEqual(ANCHO_MIN_COLUMNA - 1);
  });

  it("los carriles plegados a mano cuentan por lo que miden", () => {
    expect(anchoParaQueQuepanTodas(cols(3, ["c0"]))).toBe(
      ANCHO_COLUMNA_PLEGADA + 2 * ANCHO_MIN_COLUMNA + 2 * GAP_KANBAN,
    );
  });

  it("sin columnas es cero", () => {
    expect(anchoParaQueQuepanTodas([])).toBe(0);
  });
});
