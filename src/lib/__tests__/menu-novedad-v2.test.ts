/**
 * Menú versión 2 de las novedades (src/lib/menu-novedad.ts), historia 4093221d
 * «Maridajes y catas». Contrato: plan del CTO, sección 2 (E1–E10, L1–L6) y
 * ADR-6 a ADR-11. Los fixtures canónicos de `fixtures/` son los mismos que lee
 * la web: el panel tiene que escribirlos exactamente.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { itemDesdePlato, itemLibre } from "@/lib/menu-dia";
import {
  AVISO_GUARDAR_COMO_CATA,
  AVISO_GUARDAR_COMO_MENU,
  AVISO_BEBIDAS_CON_MARIDAJE,
  AVISO_MARIDAJE_APAGADO,
  ETIQUETA_LINEA_LIBRE,
  avisosMenuNovedad,
  bebidaElegibleParaMenu,
  bebidaEsVino,
  conSulfitos,
  conservarTraduccionesLinea,
  limpiarMenuNovedad,
  lineaDesdeBebida,
  lineaDesdeVino,
  lineaLibre,
  lineasBebidaMenu,
  menuNovedadVacio,
  menuPintable,
  parseLineaBebida,
  parseMenuNovedad,
  serializarMenuNovedad,
  sulfitosDeVino,
  sulfitosEditables,
  textoSulfitosCarta,
  coincidenciaBusqueda,
  traducirMenuNovedad,
  validarBotonesNovedad,
  type InvocarTraductorMenu,
  type ItemMenuNovedad,
  type LineaBebidaNovedad,
  type MenuNovedad,
} from "@/lib/menu-novedad";

const fixture = (nombre: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(process.cwd(), "src/lib/__tests__/fixtures", `${nombre}.json`), "utf8"));
const FIXTURE_MARIDAJE = fixture("menu-novedad-v2-maridaje");
const FIXTURE_CATA = fixture("menu-novedad-v2-cata");

/** Igualdad estricta, también en el orden de las claves. */
const mismoJson = (a: unknown, b: unknown) => expect(JSON.stringify(a)).toBe(JSON.stringify(b));

const plato = (id: string, nombre: string, extra: Partial<ItemMenuNovedad> = {}): ItemMenuNovedad => ({
  ...itemLibre(nombre),
  id,
  ...extra,
});

const linea = (id: string, extra: Partial<LineaBebidaNovedad> = {}): LineaBebidaNovedad => ({
  id,
  origen: "libre",
  refId: null,
  nombre: "Cava",
  descripcion: null,
  sulfitos: true,
  ...extra,
});

/** El modelo que, guardado, da exactamente el fixture del maridaje. */
const modeloMaridaje = (): MenuNovedad => ({
  ...menuNovedadVacio(),
  incluye_bebidas: false,
  maridaje: true,
  secciones: {
    primero: [
      plato("p1", "Gamba roja de Santa Pola", {
        descripcion: "A la plancha",
        traducciones: {
          en: { nombre: "Santa Pola red prawn", descripcion: "Grilled" },
          fr: { nombre: "Crevette rouge de Santa Pola", descripcion: "À la plancha" },
        },
      }),
    ],
    segundo: [plato("s1", "Arroz a banda")],
    postre: [plato("d1", "Turrón de Jijona")],
    bebidas: [],
  },
  maridajes: {
    p1: linea("m1", {
      nombre: "Cava brut nature",
      descripcion: "Bien frío",
      traducciones: {
        en: { nombre: "Brut nature cava", descripcion: "Well chilled" },
        fr: { nombre: "Cava brut nature", descripcion: "Bien frais" },
      },
    }),
    d1: linea("m2", { origen: "vino", refId: "vino-fondillon", nombre: "Fondillón" }),
  },
});

/** «Comida + bebidas» con agua: lo que tendría un menú que pasó por Menú. */
const conBebidasGenerales = (menu: MenuNovedad): MenuNovedad => ({
  ...menu,
  incluye_bebidas: true,
  secciones: { ...menu.secciones, bebidas: [plato("b1", "Agua mineral")] },
});

/** El modelo que, guardado, da exactamente el fixture de la cata. */
const modeloCata = (): MenuNovedad => ({
  ...menuNovedadVacio(),
  tipo: "cata",
  cata: [
    linea("c1", {
      origen: "bebida",
      refId: "bebida-whisky-12",
      nombre: "Whisky de malta 12 años",
      sulfitos: false,
      traducciones: { en: { nombre: "12-year-old malt whisky", descripcion: null } },
    }),
    linea("c2", { origen: "vino", refId: "vino-fondillon", nombre: "Fondillón", descripcion: "Alicante, dulce" }),
    linea("c3", { nombre: "Ginebra de Mahón", sulfitos: false }),
  ],
});

describe("serializarMenuNovedad v2 — fixtures canónicos", () => {
  it("un menú con maridaje da exactamente el fixture (E1–E3)", () => {
    mismoJson(serializarMenuNovedad(modeloMaridaje()), FIXTURE_MARIDAJE);
  });

  it("una cata da exactamente el fixture (E2)", () => {
    mismoJson(serializarMenuNovedad(modeloCata()), FIXTURE_CATA);
  });

  it("ida y vuelta: leer el fixture y guardarlo da el mismo JSON (L6)", () => {
    mismoJson(serializarMenuNovedad(parseMenuNovedad(FIXTURE_MARIDAJE)!), FIXTURE_MARIDAJE);
    mismoJson(serializarMenuNovedad(parseMenuNovedad(JSON.stringify(FIXTURE_CATA))!), FIXTURE_CATA);
  });
});

describe("parseMenuNovedad v2 (L1, L2, L6)", () => {
  it("restaura tipo, maridajes por plato, sulfitos y traducciones", () => {
    const menu = parseMenuNovedad(FIXTURE_MARIDAJE)!;
    expect(menu.tipo).toBe("menu");
    expect(menu.maridaje).toBe(true);
    expect(Object.keys(menu.maridajes).sort()).toEqual(["d1", "p1"]);
    expect(menu.maridajes.p1).toMatchObject({ id: "m1", origen: "libre", sulfitos: true });
    expect(menu.maridajes.p1.traducciones?.en).toEqual({ nombre: "Brut nature cava", descripcion: "Well chilled" });
    expect(menu.maridajes.d1).toMatchObject({ origen: "vino", refId: "vino-fondillon", sulfitos: true });
    expect(menu.secciones.primero[0]).not.toHaveProperty("maridaje");
    expect(menu.cata).toEqual([]);
  });

  it("restaura la cata en orden", () => {
    const menu = parseMenuNovedad(FIXTURE_CATA)!;
    expect(menu.tipo).toBe("cata");
    expect(menu.maridaje).toBe(false);
    expect(menu.cata.map((l) => l.id)).toEqual(["c1", "c2", "c3"]);
    expect(menu.cata.map((l) => l.sulfitos)).toEqual([false, true, false]);
  });

  it("una v1, sin versión o con un tipo desconocido es un Menú sin maridaje", () => {
    const v1 = { version: 1, incluye_bebidas: false, secciones: { primero: [{ id: "a", nombre: "Sopa" }] } };
    for (const crudo of [v1, { ...v1, version: undefined }, { ...v1, tipo: "degustacion" }]) {
      const menu = parseMenuNovedad(crudo)!;
      expect(menu).toMatchObject({ tipo: "menu", maridaje: false, maridajes: {}, cata: [] });
      expect(menu.secciones.primero).toHaveLength(1);
    }
  });

  it("sin `maridaje: true` se ignoran las bebidas de los platos; sin tipo Cata, la lista de la cata", () => {
    const sinBandera = { ...FIXTURE_MARIDAJE, maridaje: "true" };
    expect(parseMenuNovedad(sinBandera)).toMatchObject({ maridaje: false, maridajes: {} });
    const cataComoMenu = { ...FIXTURE_CATA, tipo: "menu" };
    expect(parseMenuNovedad(cataComoMenu)!.cata).toEqual([]);
  });

  it("una versión mayor se lee igual, en lo que se pueda", () => {
    expect(parseMenuNovedad({ ...FIXTURE_CATA, version: 3 })!.cata).toHaveLength(3);
  });

  it("líneas: sin nombre se descartan, sulfitos solo si es true y el origen desconocido es libre", () => {
    const crudo = {
      ...FIXTURE_CATA,
      secciones: {
        cata: [
          { id: "x1", nombre: "  " },
          "Ginebra",
          null,
          { id: "x2", nombre: "Vermut", sulfitos: "true", origen: "coctel", refId: "r-1" },
        ],
      },
    };
    const menu = parseMenuNovedad(crudo)!;
    expect(menu.cata).toEqual([
      { id: "x2", origen: "libre", refId: null, nombre: "Vermut", descripcion: null, sulfitos: false },
    ]);
    expect(menu.secciones.primero).toEqual([]);
  });
});

describe("serializarMenuNovedad — la v1 no cambia (E1, ADR-6)", () => {
  const menuV1 = (): MenuNovedad => ({
    ...menuNovedadVacio(),
    secciones: { ...menuNovedadVacio().secciones, primero: [plato("p1", "Sopa")] },
  });

  it("sin maridaje ni cata escribe solo las claves de siempre", () => {
    const json = serializarMenuNovedad(menuV1()) as Record<string, unknown>;
    expect(Object.keys(json)).toEqual(["version", "incluye_bebidas", "secciones"]);
    expect(json.version).toBe(1);
    expect(Object.keys(json.secciones as object)).toEqual(["primero", "segundo", "postre", "bebidas"]);
    expect(JSON.stringify(json)).not.toMatch(/maridaje|"tipo"|"cata"/);
  });

  it("al pasar de Maridaje a Menú no guarda las bebidas de los platos (E10)", () => {
    const menu = { ...menuV1(), maridajes: { p1: linea("m1") } };
    expect(JSON.stringify(serializarMenuNovedad(menu))).not.toMatch(/maridaje/);
  });

  it("con el maridaje encendido pero sin ninguna bebida con nombre se guarda la v1 (E4)", () => {
    const menu = { ...menuV1(), maridaje: true, maridajes: { p1: linea("m1", { nombre: "   " }) } };
    expect((serializarMenuNovedad(menu) as Record<string, unknown>).version).toBe(1);
    expect(limpiarMenuNovedad(menu).maridaje).toBe(false);
  });

  it("un Menú con lista de cata en memoria no guarda la cata (E10)", () => {
    const menu = { ...menuV1(), cata: [linea("c1")] };
    expect(JSON.stringify(serializarMenuNovedad(menu))).not.toMatch(/cata/);
  });
});

describe("limpiarMenuNovedad v2", () => {
  it("descarta los maridajes de platos que ya no están, de platos sin nombre y las líneas sin nombre (E4)", () => {
    const menu = modeloMaridaje();
    menu.secciones.segundo = [plato("s1", "  ")];
    menu.maridajes = {
      ...menu.maridajes,
      s1: linea("m3"),
      borrado: linea("m4"),
      d1: { ...menu.maridajes.d1, nombre: " " },
    };
    const limpio = limpiarMenuNovedad(menu);
    expect(Object.keys(limpio.maridajes)).toEqual(["p1"]);
    expect(limpio.maridaje).toBe(true);
  });

  it("una cata no guarda comida, bebidas ni maridaje, y su descripción vacía es null (E7)", () => {
    const menu: MenuNovedad = {
      ...modeloMaridaje(),
      tipo: "cata",
      cata: [linea("c1", { nombre: " Ginebra ", descripcion: "  " }), linea("c2", { nombre: "" })],
    };
    const limpio = limpiarMenuNovedad(menu);
    expect(limpio).toEqual({
      ...menuNovedadVacio(),
      tipo: "cata",
      cata: [linea("c1", { nombre: "Ginebra", descripcion: null })],
    });
  });

  it("una línea a mano nunca guarda refId", () => {
    const menu: MenuNovedad = { ...menuNovedadVacio(), tipo: "cata", cata: [linea("c1", { refId: "x" })] };
    expect(limpiarMenuNovedad(menu).cata[0].refId).toBeNull();
  });
});

describe("lineasBebidaMenu", () => {
  it("las de los platos en el orden del menú, o las de la cata", () => {
    expect(lineasBebidaMenu(modeloMaridaje()).map((l) => l.id)).toEqual(["m1", "m2"]);
    expect(lineasBebidaMenu(modeloCata()).map((l) => l.id)).toEqual(["c1", "c2", "c3"]);
    expect(lineasBebidaMenu({ ...modeloMaridaje(), maridaje: false })).toEqual([]);
  });
});

describe("menuPintable (L3)", () => {
  it("un Menú necesita algún plato; una Cata alguna bebida", () => {
    expect(menuPintable(menuNovedadVacio())).toBe(false);
    expect(menuPintable(modeloMaridaje())).toBe(true);
    expect(menuPintable(modeloCata())).toBe(true);
    expect(menuPintable({ ...modeloCata(), cata: [linea("c1", { nombre: " " })] })).toBe(false);
    // Una cata no se pinta por los platos que queden en memoria.
    expect(menuPintable({ ...modeloMaridaje(), tipo: "cata" })).toBe(false);
  });
});

describe("sulfitos y líneas de bebida (E5, E6, ADR-9)", () => {
  it("un vino toma los sulfitos de alergenos_oficiales con el vocabulario canónico", () => {
    expect(sulfitosDeVino(["sulfitos"])).toBe(true);
    expect(sulfitosDeVino('["Sulfitos", "Gluten"]')).toBe(true);
    expect(sulfitosDeVino(["gluten"])).toBe(false);
    expect(sulfitosDeVino([])).toBe(false);
    expect(sulfitosDeVino(null)).toBe(false);
    expect(sulfitosDeVino("")).toBe(false);
  });

  it("lineaDesdeVino copia nombre y nombres en/fr, y los sulfitos son fijos", () => {
    const conSulf = lineaDesdeVino({
      id: "vino-fondillon",
      nombre: " Fondillón ",
      nombre_en: "Fondillon",
      nombre_fr: null,
      alergenos_oficiales: ["sulfitos"],
    });
    expect(conSulf).toMatchObject({
      origen: "vino",
      refId: "vino-fondillon",
      nombre: "Fondillón",
      descripcion: null,
      sulfitos: true,
      traducciones: { en: { nombre: "Fondillon", descripcion: null } },
    });
    expect(conSulf.traducciones?.fr).toBeUndefined();
    expect(sulfitosEditables(conSulf)).toBe(false);
    expect(conSulfitos(conSulf, false).sulfitos).toBe(true);
    expect(textoSulfitosCarta(conSulf)).toBe("Según la carta: contiene sulfitos");

    const sinSulf = lineaDesdeVino({ id: "v2", nombre: "Blanco", alergenos_oficiales: null });
    expect(sinSulf.sulfitos).toBe(false);
    expect(sinSulf).not.toHaveProperty("traducciones");
    expect(textoSulfitosCarta(sinSulf)).toBe("La carta no declara sulfitos");
  });

  it("una bebida de la carta que no es vino empieza desmarcada y se puede cambiar", () => {
    const whisky = lineaDesdeBebida({ id: "b-1", nombre: "Whisky", nombre_en: "Whisky", nombre_fr: "Whisky" });
    expect(whisky).toMatchObject({ origen: "bebida", refId: "b-1", sulfitos: false, descripcion: null });
    expect(sulfitosEditables(whisky)).toBe(true);
    expect(conSulfitos(whisky, true).sulfitos).toBe(true);
  });

  // Decisión del dueño en QA DEMO (defecto 40a3221d, cambia la ADR-9): una bebida
  // de la carta que es vino sale con la casilla marcada y se puede desmarcar.
  describe("bebidaEsVino y la casilla inicial de una bebida de la carta", () => {
    const linea = (nombre: string, categoria: string | null) =>
      lineaDesdeBebida({ id: `b-${nombre}`, nombre, categoria });

    it("Copa Verdejo, Copa Cava y los tintos de verano salen marcados (las 11 Copas de la demo)", () => {
      for (const nombre of [
        "Copa Verdejo",
        "Copa Cava Edone",
        "Copa Cava Juvé & Camps",
        "Copa Champagne Laurent-Perrier",
        "Copa Ribera del Duero Aster Crianza",
        "Copa Rosado Marqués de Riscal XR",
        "Copa Vino Dulce Oremus Tokaji",
      ]) {
        expect(linea(nombre, "Copas"), nombre).toMatchObject({ origen: "bebida", sulfitos: true });
      }
      expect(linea("Tinto de verano con limón", "Tintos de verano").sulfitos).toBe(true);
      expect(linea("Tinto de verano casero", "Tinto de verano").sulfitos).toBe(true);
      // El nombre también cuenta aunque la categoría no lo diga.
      expect(linea("Tinto de verano", "Refrescos").sulfitos).toBe(true);
      expect(linea("Sangría de la casa", "Combinados").sulfitos).toBe(true);
      expect(linea("Vermut de grifo", "Aperitivos").sulfitos).toBe(true);
      expect(linea("Espumoso brut", null).sulfitos).toBe(true);
    });

    it("cerveza, refresco, agua, café, licores y destilados salen desmarcados", () => {
      const noVino: [string, string | null][] = [
        ["Mahou Cinco Estrellas", "Cervezas"],
        ["Ladrón de Manzanas", "Cervezas"],
        ["Coca-Cola", "Refrescos y aguas"],
        ["Fanta Naranja", "Refrescos"],
        ["Agua mineral 1 l", "Aguas"],
        ["Tónica Schweppes", "Tónicas"],
        ["Café solo", "Cafés"],
        ["Johnnie Walker Black Label", "Whiskies"],
        ["Whisky de malta 12 años", "Licores"],
        ["Gin Mare", "Ginebras"],
        ["Tequila José Cuervo", "Tequilas"],
        ["Ron blanco Bacardí", "Rones"],
        ["Licor de hierbas", "Licores"],
        ["Sin categoría", null],
      ];
      for (const [nombre, categoria] of noVino) {
        expect(linea(nombre, categoria).sulfitos, nombre).toBe(false);
        expect(bebidaEsVino(categoria, nombre), nombre).toBe(false);
      }
      // Palabra entera: «cava» no es «Cavalier»; «blanco» fuera de copas no es vino.
      expect(bebidaEsVino("Cervezas", "Cavalier")).toBe(false);
      expect(bebidaEsVino("Tequilas", "Tequila blanco")).toBe(false);
    });

    it("sin tildes ni mayúsculas", () => {
      expect(bebidaEsVino("COPAS", "COPA VERDEJO")).toBe(true);
      expect(bebidaEsVino("copas", "copa verdejo")).toBe(true);
      expect(bebidaEsVino("TINTOS DE VERANO", "tinto de verano")).toBe(true);
      expect(bebidaEsVino("Burbujas", "CHAMPÁN rosé")).toBe(true);
      expect(bebidaEsVino("Burbujas", "champan rose")).toBe(true);
      expect(bebidaEsVino("Aperitivos", "VERMÚ rojo")).toBe(true);
      expect(bebidaEsVino("Aperitivos", "Sangria")).toBe(true);
      // tinto, blanco o rosado solo si la categoría es de copas.
      expect(bebidaEsVino("Vinos por copa", "Tinto de la casa")).toBe(true);
      expect(bebidaEsVino("Por copas", "Blanco de la casa")).toBe(true);
      expect(bebidaEsVino("Por COPAS", "ROSADO")).toBe(true);
    });

    it("la casilla se puede desmarcar", () => {
      const verdejo = linea("Copa Verdejo", "Copas");
      expect(sulfitosEditables(verdejo)).toBe(true);
      const desmarcada = conSulfitos(verdejo, false);
      expect(desmarcada.sulfitos).toBe(false);
      expect(conSulfitos(desmarcada, true).sulfitos).toBe(true);
    });

    it("una línea ya guardada no cambia al reabrirla", () => {
      // Guardada desmarcada (antes del cambio o porque se desmarcó): se queda desmarcada.
      const guardada = { id: "g1", origen: "bebida", refId: "b-verdejo", nombre: "Copa Verdejo", sulfitos: false };
      expect(parseLineaBebida(guardada)).toMatchObject({ origen: "bebida", nombre: "Copa Verdejo", sulfitos: false });
      // Y una que no es vino guardada marcada a mano sigue marcada.
      const marcada = { id: "g2", origen: "bebida", refId: "b-cerveza", nombre: "Mahou", sulfitos: true };
      expect(parseLineaBebida(marcada)?.sulfitos).toBe(true);
    });

    it("los vinos de la carta y las escritas a mano no cambian", () => {
      expect(lineaDesdeVino({ id: "v", nombre: "Copa Verdejo", alergenos_oficiales: null }).sulfitos).toBe(false);
      expect(lineaLibre("otra", "Copa Verdejo").sulfitos).toBe(false);
      expect(lineaLibre("vino", "Agua").sulfitos).toBe(true);
    });
  });

  it("a mano: «Vino, cava o champagne» marca los sulfitos y «Otra bebida» no; la casilla se puede cambiar", () => {
    expect(ETIQUETA_LINEA_LIBRE).toEqual({ vino: "Vino, cava o champagne", otra: "Otra bebida" });
    const vino = lineaLibre("vino");
    const otra = lineaLibre("otra", " Tónica ");
    expect(vino).toMatchObject({ origen: "libre", refId: null, nombre: "", sulfitos: true });
    expect(otra).toMatchObject({ nombre: "Tónica", sulfitos: false });
    expect(conSulfitos(vino, false).sulfitos).toBe(false);
    expect(vino.id).not.toBe(otra.id);
  });

  it("el buscador solo trae lo que está en la carta y tiene nombre", () => {
    expect(bebidaElegibleParaMenu({ activado: true, restaurante: true, nombre: "Cava" })).toBe(true);
    expect(bebidaElegibleParaMenu({ activado: true, restaurante: true, nombre: " " })).toBe(false);
    expect(bebidaElegibleParaMenu({ activado: true, restaurante: true, nombre: null })).toBe(false);
    expect(bebidaElegibleParaMenu({ activado: false, restaurante: true, nombre: "Cava" })).toBe(false);
    expect(bebidaElegibleParaMenu({ activado: true, restaurante: false, nombre: "Cava" })).toBe(false);
  });
});

describe("validarBotonesNovedad v2 (C7)", () => {
  const validar = (menu: MenuNovedad) =>
    validarBotonesNovedad({ botones: ["ver_menu"], menu, estadoPlato: "sin_plato" }).map((e) => e.codigo);

  it("los fixtures se pueden guardar", () => {
    expect(validar(modeloMaridaje())).toEqual([]);
    expect(validar(modeloCata())).toEqual([]);
  });

  it("un Maridaje sin ninguna bebida en ningún plato", () => {
    const errores = validarBotonesNovedad({
      botones: ["ver_menu"],
      menu: { ...modeloMaridaje(), maridajes: { p1: linea("m1", { nombre: " " }), borrado: linea("m9") } },
      estadoPlato: "sin_plato",
    });
    expect(errores).toEqual([
      {
        codigo: "maridaje_vacio",
        mensaje: "Un maridaje necesita la bebida de al menos un plato, o elige «Menú».",
      },
    ]);
  });

  it("una cata sin bebidas, y no se le piden platos", () => {
    const errores = validarBotonesNovedad({
      botones: ["ver_menu"],
      menu: { ...menuNovedadVacio(), tipo: "cata", cata: [linea("c1", { nombre: "" })] },
      estadoPlato: "sin_plato",
    });
    expect(errores).toEqual([{ codigo: "cata_vacia", mensaje: "Una cata necesita al menos una bebida." }]);
  });

  it("una cata no mira «Comida + bebidas» ni el maridaje que quede en memoria", () => {
    expect(validar({ ...modeloCata(), incluye_bebidas: true, maridaje: true })).toEqual([]);
  });

  it("un Menú sin platos sigue dando menu_sin_platos aunque haya una cata en memoria", () => {
    expect(validar({ ...menuNovedadVacio(), cata: modeloCata().cata })).toEqual(["menu_sin_platos"]);
  });

  it("sin «Ver menú» no se juzga el menú", () => {
    const menu = { ...menuNovedadVacio(), tipo: "cata" as const };
    expect(validarBotonesNovedad({ botones: ["llamar"], menu, estadoPlato: "sin_plato" })).toEqual([]);
  });
});

describe("avisosMenuNovedad (E10)", () => {
  it("avisa de lo que hay en el editor y no se guardará", () => {
    expect(avisosMenuNovedad(modeloMaridaje())).toEqual([]);
    expect(avisosMenuNovedad({ ...modeloMaridaje(), tipo: "cata" })).toEqual([AVISO_GUARDAR_COMO_CATA]);
    expect(avisosMenuNovedad({ ...modeloMaridaje(), cata: modeloCata().cata })).toEqual([AVISO_GUARDAR_COMO_MENU]);
    expect(avisosMenuNovedad({ ...modeloMaridaje(), maridaje: false })).toEqual([AVISO_MARIDAJE_APAGADO]);
    expect(avisosMenuNovedad(conBebidasGenerales(modeloMaridaje()))).toEqual([AVISO_BEBIDAS_CON_MARIDAJE]);
    expect(avisosMenuNovedad(conBebidasGenerales({ ...modeloMaridaje(), maridaje: false }))).toEqual([
      AVISO_MARIDAJE_APAGADO,
    ]);
  });

  it("un Maridaje no guarda la sección Bebidas aunque esté en memoria; al volver a Menú sí (31/10/2026)", () => {
    const conAgua = conBebidasGenerales(modeloMaridaje());
    mismoJson(serializarMenuNovedad(conAgua), FIXTURE_MARIDAJE);
    const comoMenu = serializarMenuNovedad({ ...conAgua, maridaje: false }) as { incluye_bebidas: boolean; secciones: { bebidas: unknown[] } };
    expect(comoMenu.incluye_bebidas).toBe(true);
    expect(comoMenu.secciones.bebidas).toHaveLength(1);
    // Con Maridaje no se exige bebida en la sección Bebidas (no se ve).
    const vacia = { ...modeloMaridaje(), incluye_bebidas: true };
    expect(validarBotonesNovedad({ botones: ["ver_menu"], menu: vacia, estadoPlato: "sin_plato" })).toEqual([]);
    expect(avisosMenuNovedad(modeloCata())).toEqual([]);
  });
});

describe("conservarTraduccionesLinea", () => {
  const traducida = linea("m1", {
    origen: "vino",
    refId: "v-1",
    nombre: "Fondillón",
    descripcion: "Dulce",
    traducciones: { en: { nombre: "Fondillon", descripcion: "Sweet" } },
  });

  it("sin cambios en castellano las conserva", () => {
    expect(conservarTraduccionesLinea(traducida, { ...traducida, sulfitos: false })).toEqual({
      ...traducida,
      sulfitos: false,
    });
  });

  it("si cambia la descripción conserva los nombres y pierde las descripciones", () => {
    const nueva = conservarTraduccionesLinea(traducida, { ...traducida, descripcion: "Muy dulce" });
    expect(nueva.traducciones).toEqual({ en: { nombre: "Fondillon", descripcion: null } });
  });

  it("si cambia el nombre las pierde todas", () => {
    const nueva = conservarTraduccionesLinea(traducida, { ...traducida, nombre: "Moscatel" });
    expect(nueva).not.toHaveProperty("traducciones");
  });
});

describe("traducirMenuNovedad — bebidas a mano con un traductor que funde líneas (QA DEMO 31-10-2026)", () => {
  // Imita a traducir-contenido en la demo: si un hueco lleva varias líneas,
  // devuelve una sola (las funde); con una línea, la traduce bien.
  const traductorQueFunde = vi.fn<InvocarTraductorMenu>(async ({ datos }) => {
    const traducir = (prefijo: string, valor: string) => {
      const lineas = valor.split("\n").filter((l) => l.trim() !== "");
      if (lineas.length === 0) return "";
      return lineas.length > 1 ? `${prefijo} ${lineas.join(" y ")}` : `${prefijo} ${lineas[0]}`;
    };
    const idioma = (prefijo: string) => ({
      primero: traducir(prefijo, datos.primero),
      segundo: traducir(prefijo, datos.segundo),
      postre: traducir(prefijo, datos.postre),
    });
    return { data: { ok: true, translations: { menu_en: idioma("EN"), menu_fr: idioma("FR") } }, error: null };
  });

  const cataAMano = (cuantas: number): MenuNovedad => ({
    ...menuNovedadVacio(),
    tipo: "cata",
    cata: Array.from({ length: cuantas }, (_, i) =>
      linea(`c${i + 1}`, { nombre: `Bebida ${i + 1}`, descripcion: `Nota ${i + 1}` }),
    ),
  });

  it.each([1, 2, 4])("con %i bebidas a mano todas se traducen (nombre y descripción) y no hay aviso", async (cuantas) => {
    traductorQueFunde.mockClear();
    const { menu, sinTraducir } = await traducirMenuNovedad(cataAMano(cuantas), new Map(), traductorQueFunde);
    expect(sinTraducir).toBe(0);
    expect(traductorQueFunde).toHaveBeenCalledTimes(cuantas);
    // Nunca dos bebidas en el mismo hueco.
    for (const [{ datos }] of traductorQueFunde.mock.calls) {
      for (const hueco of [datos.primero, datos.segundo, datos.postre]) expect(hueco).not.toContain("\n");
    }
    menu.cata.forEach((l, i) => {
      expect(l.traducciones).toEqual({
        en: { nombre: `EN Bebida ${i + 1}`, descripcion: `EN Nota ${i + 1}` },
        fr: { nombre: `FR Bebida ${i + 1}`, descripcion: `FR Nota ${i + 1}` },
      });
    });
  });

  it("los maridajes a mano de varios platos también se traducen uno a uno", async () => {
    traductorQueFunde.mockClear();
    const menu: MenuNovedad = {
      ...menuNovedadVacio(),
      maridaje: true,
      secciones: {
        ...menuNovedadVacio().secciones,
        primero: [{ ...plato("p1", "Sopa"), traducciones: { en: { nombre: "Soup", descripcion: null }, fr: { nombre: "Soupe", descripcion: null } } }],
        segundo: [{ ...plato("p2", "Arroz"), traducciones: { en: { nombre: "Rice", descripcion: null }, fr: { nombre: "Riz", descripcion: null } } }],
      },
      maridajes: {
        p1: linea("m1", { nombre: "Ginebra con tónica" }),
        p2: linea("m2", { nombre: "Chupito de tequila", descripcion: "Reposado" }),
      },
    };
    const { menu: traducido, sinTraducir } = await traducirMenuNovedad(menu, new Map(), traductorQueFunde);
    expect(sinTraducir).toBe(0);
    expect(traducido.maridajes.p1.traducciones?.en).toEqual({ nombre: "EN Ginebra con tónica", descripcion: null });
    expect(traducido.maridajes.p2.traducciones?.fr).toEqual({ nombre: "FR Chupito de tequila", descripcion: "FR Reposado" });
  });

  it("las bebidas a mano de la sección Bebidas van una por llamada", async () => {
    traductorQueFunde.mockClear();
    const menu: MenuNovedad = {
      ...menuNovedadVacio(),
      incluye_bebidas: true,
      secciones: { ...menuNovedadVacio().secciones, bebidas: [plato("b1", "Agua"), plato("b2", "Caña")] },
    };
    const { menu: traducido, sinTraducir } = await traducirMenuNovedad(menu, new Map(), traductorQueFunde);
    expect(sinTraducir).toBe(0);
    expect(traducido.secciones.bebidas.map((b) => b.traducciones?.en?.nombre)).toEqual(["EN Agua", "EN Caña"]);
  });

  it("si falla el nombre se guarda la descripción traducida (y al revés), y se avisa", async () => {
    const soloSegundo = vi.fn<InvocarTraductorMenu>(async ({ datos }) => ({
      data: {
        ok: true,
        translations: {
          menu_en: { primero: "", segundo: datos.segundo ? `EN ${datos.segundo}` : "", postre: "" },
          menu_fr: { primero: "", segundo: datos.segundo ? `FR ${datos.segundo}` : "", postre: "" },
        },
      },
      error: null,
    }));
    const { menu, sinTraducir } = await traducirMenuNovedad(cataAMano(1), new Map(), soloSegundo);
    expect(sinTraducir).toBe(1);
    expect(menu.cata[0].traducciones).toEqual({
      en: { nombre: "Bebida 1", descripcion: "EN Nota 1" },
      fr: { nombre: "Bebida 1", descripcion: "FR Nota 1" },
    });

    const soloPrimero = vi.fn<InvocarTraductorMenu>(async ({ datos }) => ({
      data: {
        ok: true,
        translations: {
          menu_en: { primero: `EN ${datos.primero}`, segundo: "", postre: "" },
          menu_fr: { primero: `FR ${datos.primero}`, segundo: "", postre: "" },
        },
      },
      error: null,
    }));
    const otra = await traducirMenuNovedad(cataAMano(1), new Map(), soloPrimero);
    expect(otra.sinTraducir).toBe(1);
    expect(otra.menu.cata[0].traducciones).toEqual({
      en: { nombre: "EN Bebida 1", descripcion: null },
      fr: { nombre: "FR Bebida 1", descripcion: null },
    });
  });
});

describe("traducirMenuNovedad — bebidas del maridaje y de la cata (E8, C8)", () => {
  const respuesta = (en: Record<string, string>, fr: Record<string, string>) => ({
    data: {
      ok: true,
      translations: {
        menu_en: { primero: "", segundo: "", postre: "", ...en },
        menu_fr: { primero: "", segundo: "", postre: "", ...fr },
      },
    },
    error: null,
  });

  it("cada bebida va en su llamada tipo «menu»: el nombre a mano en «primero» y la descripción en «segundo»", async () => {
    const invocar = vi.fn<InvocarTraductorMenu>(async ({ datos }) =>
      datos.primero === "Cava brut nature"
        ? respuesta({ primero: "Brut nature cava", segundo: "Well chilled" }, { primero: "Cava brut nature", segundo: "Bien frais" })
        : respuesta({ segundo: "Sweet" }, { segundo: "Doux" }),
    );
    const menu = modeloCata();
    menu.cata = [
      linea("c1", { nombre: "Cava brut nature", descripcion: "Bien\nfrío" }),
      linea("c2", {
        origen: "vino",
        refId: "v-1",
        nombre: "Fondillón",
        descripcion: "Dulce",
        traducciones: { en: { nombre: "Fondillon", descripcion: null } },
      }),
      lineaDesdeBebida({ id: "b-1", nombre: "Agua", nombre_en: "Water", nombre_fr: "Eau" }),
    ];

    const { menu: traducido, sinTraducir } = await traducirMenuNovedad(menu, new Map(), invocar);

    expect(invocar).toHaveBeenCalledTimes(2);
    expect(invocar).toHaveBeenCalledWith({
      tipo: "menu",
      datos: { primero: "Cava brut nature", segundo: "Bien frío", postre: "" },
    });
    expect(invocar).toHaveBeenCalledWith({ tipo: "menu", datos: { primero: "", segundo: "Dulce", postre: "" } });
    expect(sinTraducir).toBe(0);
    expect(traducido.cata[0].traducciones).toEqual({
      en: { nombre: "Brut nature cava", descripcion: "Well chilled" },
      fr: { nombre: "Cava brut nature", descripcion: "Bien frais" },
    });
    // De la carta: el nombre es el de la carta (o el castellano si no lo tiene); solo se traduce la descripción.
    expect(traducido.cata[1].traducciones).toEqual({
      en: { nombre: "Fondillon", descripcion: "Sweet" },
      fr: { nombre: "Fondillón", descripcion: "Doux" },
    });
    expect(traducido.cata[2]).toEqual(menu.cata[2]);
  });

  it("los maridajes se traducen con los platos, cada uno en su llamada", async () => {
    const invocar = vi.fn<InvocarTraductorMenu>(async ({ datos }) =>
      datos.primero === "Cava"
        ? respuesta({ primero: "Cava EN" }, { primero: "Cava FR" })
        : respuesta({ primero: "Soup" }, { primero: "Soupe" }),
    );
    const menu: MenuNovedad = {
      ...menuNovedadVacio(),
      maridaje: true,
      secciones: { ...menuNovedadVacio().secciones, primero: [plato("p1", "Sopa")] },
      maridajes: { p1: linea("m1") },
    };
    const { menu: traducido, sinTraducir } = await traducirMenuNovedad(menu, new Map(), invocar);
    expect(invocar).toHaveBeenCalledTimes(2);
    expect(sinTraducir).toBe(0);
    expect(traducido.secciones.primero[0].traducciones?.en?.nombre).toBe("Soup");
    expect(traducido.maridajes.p1.traducciones).toEqual({
      en: { nombre: "Cava EN", descripcion: null },
      fr: { nombre: "Cava FR", descripcion: null },
    });
  });

  it("lo ya traducido y las bebidas de la carta sin descripción no llaman al traductor", async () => {
    const invocar = vi.fn<InvocarTraductorMenu>();
    const { menu, sinTraducir } = await traducirMenuNovedad(modeloMaridaje(), new Map(), invocar);
    // s1 y d1 están a mano sin traducir: van en las llamadas de siempre, no en la de las bebidas.
    for (const [{ datos }] of invocar.mock.calls) expect(datos.primero).not.toMatch(/Cava|Fondillón/);
    expect(menu.maridajes.d1).toEqual(modeloMaridaje().maridajes.d1);
    expect(sinTraducir).toBe(2);
  });

  it("si el traductor falla se guarda en castellano y se cuenta para avisar", async () => {
    const invocar = vi.fn<InvocarTraductorMenu>(async () => ({ data: { ok: false, error: "x" }, error: null }));
    const errorConsola = vi.spyOn(console, "error").mockImplementation(() => {});
    const menu: MenuNovedad = {
      ...menuNovedadVacio(),
      tipo: "cata",
      cata: [linea("c1", { descripcion: "Frío" }), lineaDesdeVino({ id: "v", nombre: "Tinto", nombre_en: "Red" })],
    };
    const { menu: traducido, sinTraducir } = await traducirMenuNovedad(menu, new Map(), invocar);
    errorConsola.mockRestore();
    expect(sinTraducir).toBe(1);
    expect(traducido.cata[0]).not.toHaveProperty("traducciones");
    expect(traducido.cata[1].traducciones).toEqual({ en: { nombre: "Red", descripcion: null } });
  });

  it("una cata no manda platos ni bebidas al traductor aunque queden en memoria", async () => {
    const invocar = vi.fn<InvocarTraductorMenu>(async () => respuesta({ primero: "Gin" }, { primero: "Gin" }));
    const menu: MenuNovedad = {
      ...modeloMaridaje(),
      tipo: "cata",
      cata: [linea("c1", { nombre: "Ginebra" })],
    };
    menu.secciones.segundo = [itemDesdePlato({ id: "x", nombre: "Arroz" })];
    const { menu: traducido } = await traducirMenuNovedad(menu, new Map(), invocar);
    expect(invocar).toHaveBeenCalledTimes(1);
    expect(traducido.secciones).toEqual(menuNovedadVacio().secciones);
    expect(traducido.maridajes).toEqual({});
  });
});

describe("coincidenciaBusqueda — buscador de vinos y bebidas", () => {
  it("exacta < empieza por < palabra < contiene < categoría < todas las palabras; si no, null", () => {
    expect(coincidenciaBusqueda("Sol", "Cervezas", "sol")).toBe(0);
    expect(coincidenciaBusqueda("Soleá fino", null, "Sol")).toBe(1);
    expect(coincidenciaBusqueda("Marqués de Solar", null, "sol")).toBe(2);
    expect(coincidenciaBusqueda("Consolación", null, "sol")).toBe(3);
    expect(coincidenciaBusqueda("Monastrell", "TINTOS", "tintos")).toBe(4);
    expect(coincidenciaBusqueda("Lagavulin 16 años", "Whiskys", "whiskys lagavulin")).toBe(5);
    expect(coincidenciaBusqueda("Lagavulin 16 años", "Whiskys", "Lagavulin 8")).toBeNull();
    expect(coincidenciaBusqueda("Fondillón", null, "FONDILLON")).toBe(0);
    expect(coincidenciaBusqueda("Lo que sea", null, "  ")).toBe(0);
  });
});

describe("parseMenuNovedad — L1: v1 o sin versión ignora tipo, maridaje y cata (QA DEMO)", () => {
  const conTodo = (version?: number) => ({
    ...(version === undefined ? {} : { version }),
    tipo: "cata",
    maridaje: true,
    incluye_bebidas: true,
    secciones: {
      primero: [{ id: "p1", nombre: "Sopa", maridaje: { id: "m1", origen: "libre", nombre: "Cava" } }],
      segundo: [],
      postre: [],
      bebidas: [{ id: "b1", nombre: "Agua" }],
      cata: [{ id: "c1", origen: "libre", nombre: "Fondillón" }],
    },
  });

  it.each([undefined, 1])("versión %s: Menú sin maridaje ni cata, con sus platos y bebidas", (version) => {
    const menu = parseMenuNovedad(conTodo(version))!;
    expect(menu.tipo).toBe("menu");
    expect(menu.maridaje).toBe(false);
    expect(menu.maridajes).toEqual({});
    expect(menu.cata).toEqual([]);
    expect(menu.incluye_bebidas).toBe(true);
    expect(menu.secciones.primero.map((p) => p.nombre)).toEqual(["Sopa"]);
    expect(menu.secciones.bebidas.map((b) => b.nombre)).toEqual(["Agua"]);
  });

  it("un Menú v1 con maridaje: true y sin versión tampoco enciende el maridaje", () => {
    const { tipo: _tipo, ...sinTipo } = conTodo();
    const menu = parseMenuNovedad(sinTipo)!;
    expect(menu.maridaje).toBe(false);
    expect(menu.maridajes).toEqual({});
  });

  it.each([2, 3])("versión %i: se leen el tipo y la cata", (version) => {
    const menu = parseMenuNovedad(conTodo(version))!;
    expect(menu.tipo).toBe("cata");
    expect(menu.cata.map((l) => l.nombre)).toEqual(["Fondillón"]);
  });

  it("la v1 se sigue guardando igual", () => {
    const menu = parseMenuNovedad(conTodo(1))!;
    expect(serializarMenuNovedad(menu)).toMatchObject({ version: 1, incluye_bebidas: true });
    expect(serializarMenuNovedad(menu)).not.toHaveProperty("tipo");
    expect(serializarMenuNovedad(menu)).not.toHaveProperty("maridaje");
  });
});

