/**
 * Nombres propios de las secciones (tarea «Cambiar en el panel el nombre de
 * las secciones»). Contrato de la web v0.48: `menu.titulos` en la raíz,
 * opcional, sin subir de versión, `{ es, en?, fr? }` por sección.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { itemLibre } from "@/lib/menu-dia";
import {
  lineaLibre,
  MAX_TITULO_SECCION,
  menuNovedadVacio,
  moverItem,
  parseMenuNovedad,
  serializarMenuNovedad,
  titulosDemasiadoLargos,
  validarBotonesNovedad,
  type MenuNovedad,
} from "@/lib/menu-novedad";

const fixture = (nombre: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), "src/lib/__tests__/fixtures", `${nombre}.json`), "utf8"));

type Salida = { [clave: string]: unknown; titulos?: Record<string, { es: string; en?: string; fr?: string }> };
const json = (menu: MenuNovedad) => serializarMenuNovedad(menu) as unknown as Salida;

function menuConPlatos(extra: Partial<MenuNovedad> = {}): MenuNovedad {
  const menu = menuNovedadVacio();
  menu.secciones.primero = [itemLibre("Gamba roja"), itemLibre("Tellinas")];
  menu.secciones.segundo = [itemLibre("Arroz a banda")];
  return { ...menu, ...extra };
}

const V1_SIN_TITULOS = {
  version: 1,
  incluye_bebidas: false,
  secciones: {
    primero: [
      {
        id: "l-1",
        origen: "libre",
        platoId: null,
        nombre: "Caldo gallego",
        descripcion: null,
        imagenUrl: null,
        imagenPosicionY: null,
        alergenos: [],
        alergenosInferidos: [],
        alergenosNotas: null,
      },
    ],
    segundo: [],
    postre: [],
    bebidas: [],
  },
};

describe("titulos · guardar", () => {
  it("se recortan y se guardan en la raíz, sin subir de versión", () => {
    const salida = json(
      menuConPlatos({ titulos: { primero: { es: "  Entrantes ", en: " Starters ", fr: "" }, postre: { es: "Dulces" } } }),
    );
    expect(salida.version).toBe(1);
    expect(salida.titulos).toEqual({ primero: { es: "Entrantes", en: "Starters" }, postre: { es: "Dulces" } });
    expect(salida.secciones).not.toHaveProperty("titulos");
  });

  it("un nombre vacío o solo con espacios quita su clave; sin ninguno no hay `titulos`", () => {
    const salida = json(menuConPlatos({ titulos: { primero: { es: "   ", en: "Starters" }, segundo: { es: "Principales" } } }));
    expect(salida.titulos).toEqual({ segundo: { es: "Principales" } });
    expect(json(menuConPlatos({ titulos: { primero: { es: " " } } }))).not.toHaveProperty("titulos");
  });

  it("Bebidas solo con «Comida + bebidas»; con Maridaje no", () => {
    const titulos = { bebidas: { es: "Para beber" } };
    expect(json(menuConPlatos({ titulos })).titulos).toBeUndefined();
    const conBebidas = menuConPlatos({ titulos, incluye_bebidas: true });
    conBebidas.secciones.bebidas = [itemLibre("Agua")];
    expect(json(conBebidas).titulos).toEqual(titulos);
  });

  it("con Maridaje (v2) se guardan igual", () => {
    const menu = menuConPlatos({ maridaje: true, titulos: { segundo: { es: "Arroces" } } });
    menu.maridajes = { [menu.secciones.primero[0].id]: lineaLibre("vino", "Cava") };
    const salida = json(menu);
    expect(salida.version).toBe(2);
    expect(salida.titulos).toEqual({ segundo: { es: "Arroces" } });
  });

  it("con Cata no se guardan", () => {
    const menu = { ...menuNovedadVacio(), tipo: "cata" as const, cata: [lineaLibre("vino", "Fondillón")] };
    expect(json({ ...menu, titulos: { primero: { es: "Entrantes" } } })).not.toHaveProperty("titulos");
  });

  it("cambiar nombres no altera platos, orden ni maridajes", () => {
    const menu = menuConPlatos({ maridaje: true });
    menu.maridajes = { [menu.secciones.primero[1].id]: lineaLibre("vino", "Albariño") };
    const reordenado = moverItem(menu, "primero", 1, 0);
    const antes = json(reordenado);
    const despues = json({ ...reordenado, titulos: { primero: { es: "Del mar" } } });
    const { titulos, ...resto } = despues;
    expect(titulos).toEqual({ primero: { es: "Del mar" } });
    expect(resto).toEqual(antes);
  });
});

describe("titulos · leer", () => {
  it("se leen en v1 y en v2, con lectura tolerante", () => {
    const v1 = parseMenuNovedad({
      ...V1_SIN_TITULOS,
      titulos: {
        primero: { es: " Entrantes ", en: "Starters", fr: 3 },
        segundo: { en: "Mains" },
        postre: "Dulces",
        cata: { es: "No existe" },
      },
    })!;
    expect(v1.titulos).toEqual({ primero: { es: "Entrantes", en: "Starters" } });
    const v2 = parseMenuNovedad({ ...fixture("menu-novedad-v2-maridaje"), titulos: { postre: { es: "Dulces", fr: "Desserts maison" } } })!;
    expect(v2.titulos).toEqual({ postre: { es: "Dulces", fr: "Desserts maison" } });
  });

  it("un menú guardado antes se abre sin nombres propios y se vuelve a escribir igual, byte a byte", () => {
    for (const crudo of [V1_SIN_TITULOS, fixture("menu-novedad-v2-maridaje"), fixture("menu-novedad-v2-cata")]) {
      const menu = parseMenuNovedad(crudo)!;
      expect(menu.titulos).toEqual({});
      expect(menu.otrasClaves).toBeUndefined();
      expect(JSON.stringify(serializarMenuNovedad(menu))).toBe(JSON.stringify(crudo));
    }
  });

  it("conserva las claves de la raíz que no conoce", () => {
    const crudo = { ...V1_SIN_TITULOS, notas_web: { destacado: true }, ordenSecciones: ["postre"] };
    const salida = json(parseMenuNovedad(crudo)!);
    expect(salida.notas_web).toEqual({ destacado: true });
    expect(salida.ordenSecciones).toEqual(["postre"]);
    // Lo que el panel conoce no se puede pisar con una clave desconocida.
    expect(salida.version).toBe(1);
  });

  it("ida y vuelta con nombres", () => {
    const titulos = { primero: { es: "Entrantes", en: "Starters", fr: "Entrées" } };
    const vuelta = parseMenuNovedad(json(menuConPlatos({ titulos })))!;
    expect(vuelta.titulos).toEqual(titulos);
  });
});

describe("titulos · validación", () => {
  const conTitulo = (es: string, en = "") => menuConPlatos({ titulos: { primero: { es, en } } });
  const validar = (menu: MenuNovedad) =>
    validarBotonesNovedad({ botones: ["ver_menu"], menu, estadoPlato: "desconocido" }).map((e) => e.codigo);

  it(`${MAX_TITULO_SECCION} caracteres valen; ${MAX_TITULO_SECCION + 1} no (en cualquier idioma)`, () => {
    expect(validar(conTitulo("a".repeat(40)))).toEqual([]);
    expect(validar(conTitulo("a".repeat(41)))).toEqual(["titulo_largo"]);
    expect(validar(conTitulo("Entrantes", "b".repeat(41)))).toEqual(["titulo_largo"]);
    expect(titulosDemasiadoLargos(conTitulo("Entrantes", "b".repeat(41)))).toEqual([{ seccion: "primero", idioma: "en" }]);
  });

  it("los espacios de los extremos no cuentan y las tildes cuentan como una", () => {
    expect(validar(conTitulo(`  ${"á".repeat(40)}  `))).toEqual([]);
  });

  it("una sección que no se guarda (Bebidas sin «Comida + bebidas») no bloquea", () => {
    expect(validar(menuConPlatos({ titulos: { bebidas: { es: "x".repeat(60) } } }))).toEqual([]);
  });
});
