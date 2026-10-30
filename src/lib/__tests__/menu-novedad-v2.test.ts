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
  AVISO_MARIDAJE_APAGADO,
  ETIQUETA_LINEA_LIBRE,
  avisosMenuNovedad,
  bebidaElegibleParaMenu,
  conSulfitos,
  conservarTraduccionesLinea,
  limpiarMenuNovedad,
  lineaDesdeBebida,
  lineaDesdeVino,
  lineaLibre,
  lineasBebidaMenu,
  menuNovedadVacio,
  menuPintable,
  parseMenuNovedad,
  serializarMenuNovedad,
  sulfitosDeVino,
  sulfitosEditables,
  textoSulfitosCarta,
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
  incluye_bebidas: true,
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
    bebidas: [plato("b1", "Agua mineral")],
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

  it("con el maridaje apagado no guarda las bebidas de los platos (E10)", () => {
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

  it("una bebida de la carta empieza desmarcada y se puede cambiar", () => {
    const whisky = lineaDesdeBebida({ id: "b-1", nombre: "Whisky", nombre_en: "Whisky", nombre_fr: "Whisky" });
    expect(whisky).toMatchObject({ origen: "bebida", refId: "b-1", sulfitos: false, descripcion: null });
    expect(sulfitosEditables(whisky)).toBe(true);
    expect(conSulfitos(whisky, true).sulfitos).toBe(true);
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

  it("«Con maridaje» sin ninguna bebida en ningún plato", () => {
    const errores = validarBotonesNovedad({
      botones: ["ver_menu"],
      menu: { ...modeloMaridaje(), maridajes: { p1: linea("m1", { nombre: " " }), borrado: linea("m9") } },
      estadoPlato: "sin_plato",
    });
    expect(errores).toEqual([
      {
        codigo: "maridaje_vacio",
        mensaje: "“Con maridaje” necesita al menos una bebida en algún plato, o apágalo.",
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

  it("los nombres a mano y las descripciones van en una tercera llamada tipo «menu»", async () => {
    const invocar = vi.fn<InvocarTraductorMenu>(async () =>
      respuesta(
        { primero: "Brut nature cava", segundo: "Well chilled\nSweet" },
        { primero: "Cava brut nature", segundo: "Bien frais\nDoux" },
      ),
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

    expect(invocar).toHaveBeenCalledTimes(1);
    expect(invocar).toHaveBeenCalledWith({
      tipo: "menu",
      datos: { primero: "Cava brut nature", segundo: "Bien frío\nDulce", postre: "" },
    });
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
    // s1, d1 y b1 están a mano sin traducir: van en las llamadas de siempre, no en la de las bebidas.
    for (const [{ datos }] of invocar.mock.calls) expect(datos.primero).not.toMatch(/Cava|Fondillón/);
    expect(menu.maridajes.d1).toEqual(modeloMaridaje().maridajes.d1);
    expect(sinTraducir).toBe(3);
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
