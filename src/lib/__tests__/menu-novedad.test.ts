/**
 * Botones de las tarjetas de novedades (src/lib/menu-novedad.ts), historia
 * 4073221d. Contrato: plan del CTO, sección 2, y la migración
 * 20261028170000_novedades_botones_menu.sql.
 *
 * Lo que protege:
 *  - la lectura tolerante de `botones` y `menu` (una novedad de antes, o una
 *    BBDD sin la migración, es «Sin botones»);
 *  - la validación que impide guardar (criterio 5);
 *  - la regla 2.4 del payload: sin botones no viajan las claves nuevas;
 *  - la traducción del menú: la carta se copia, lo escrito a mano pasa por
 *    traducir-contenido tipo "menu" y, si falla, se guarda en castellano.
 */
import { describe, expect, it, vi } from "vitest";
import { itemDesdePlato, itemLibre } from "@/lib/menu-dia";
import {
  botonesVisiblesEnWeb,
  camposBotonesPayload,
  conservarTraduccionesVigentes,
  esErrorSinColumnasBotones,
  estadoPlatoEnlazado,
  menuNovedadVacio,
  menuTieneComida,
  parseBotonesNovedad,
  parseMenuNovedad,
  platoEnCarta,
  platoRetiradoDeLaCarta,
  serializarMenuNovedad,
  traduccionesDesdeCarta,
  traducirMenuNovedad,
  validarBotonesNovedad,
  type EstadoPlatoEnlazado,
  type InvocarTraductorMenu,
  type ItemMenuNovedad,
  type MenuNovedad,
} from "@/lib/menu-novedad";

/** El ejemplo del contrato: un menú de Navidad con un plato de la carta, uno a mano y bebidas. */
const MENU_EJEMPLO = {
  version: 1,
  incluye_bebidas: true,
  secciones: {
    primero: [
      {
        id: "l-1",
        origen: "carta",
        platoId: "p-pulpo",
        nombre: "Pulpo a feira",
        descripcion: "Con cachelos",
        imagenUrl: "https://ejemplo.test/pulpo.jpg",
        imagenPosicionY: 40,
        alergenos: ["moluscos"],
        alergenosInferidos: [],
        alergenosNotas: null,
        traducciones: {
          en: { nombre: "Galician-style octopus", descripcion: "With potatoes" },
          fr: { nombre: "Poulpe à la galicienne", descripcion: null },
        },
      },
    ],
    segundo: [
      {
        id: "l-2",
        origen: "libre",
        platoId: null,
        nombre: "Cordero asado",
        descripcion: null,
        imagenUrl: null,
        imagenPosicionY: null,
        alergenos: [],
        alergenosInferidos: [],
        alergenosNotas: null,
      },
    ],
    postre: [],
    bebidas: [
      {
        id: "l-3",
        origen: "libre",
        platoId: null,
        nombre: "Vino de la casa",
        descripcion: null,
        imagenUrl: null,
        imagenPosicionY: null,
        alergenos: ["sulfitos"],
        alergenosInferidos: [],
        alergenosNotas: null,
        traducciones: { en: { nombre: "House wine", descripcion: null } },
      },
    ],
  },
};

const conComida = (menu: Partial<MenuNovedad["secciones"]> = {}, incluye_bebidas = false): MenuNovedad => ({
  ...menuNovedadVacio(),
  incluye_bebidas,
  secciones: { ...menuNovedadVacio().secciones, ...menu },
});

const platosCarta = new Map([
  ["p-pulpo", { activado: true, restaurante: true, nombre_en: "Octopus", nombre_fr: "Poulpe", descripcion_en: "With potatoes", descripcion_fr: null }],
  ["p-off", { activado: false, restaurante: true }],
  ["p-tienda", { activado: true, restaurante: false }],
  ["p-sin-trad", { activado: true, restaurante: true, nombre_en: null, nombre_fr: "" }],
]);

describe("parseBotonesNovedad", () => {
  it("sin columna, NULL o basura es «Sin botones»", () => {
    expect(parseBotonesNovedad(undefined)).toEqual([]);
    expect(parseBotonesNovedad(null)).toEqual([]);
    expect(parseBotonesNovedad("llamar")).toEqual([]);
    expect(parseBotonesNovedad({ 0: "llamar" })).toEqual([]);
  });

  it("conserva el orden de la pantalla", () => {
    expect(parseBotonesNovedad(["ver_menu", "llamar"])).toEqual(["ver_menu", "llamar"]);
    expect(parseBotonesNovedad(["ver_plato"])).toEqual(["ver_plato"]);
  });

  it("ignora tipos desconocidos y repetidos y se queda con los dos primeros válidos", () => {
    expect(parseBotonesNovedad(["reservar", "llamar", "llamar", 3, "ver_plato", "ver_menu"])).toEqual([
      "llamar",
      "ver_plato",
    ]);
  });
});

describe("parseMenuNovedad / serializarMenuNovedad", () => {
  it("lee el ejemplo del contrato con sus traducciones", () => {
    const menu = parseMenuNovedad(MENU_EJEMPLO)!;
    expect(menu.incluye_bebidas).toBe(true);
    expect(menu.secciones.primero[0]).toMatchObject({
      id: "l-1",
      origen: "carta",
      platoId: "p-pulpo",
      traducciones: {
        en: { nombre: "Galician-style octopus", descripcion: "With potatoes" },
        fr: { nombre: "Poulpe à la galicienne", descripcion: null },
      },
    });
    expect(menu.secciones.segundo[0].traducciones).toBeUndefined();
    expect(menu.secciones.bebidas[0].traducciones).toEqual({ en: { nombre: "House wine", descripcion: null } });
  });

  it("ida y vuelta: serializar lo leído da el mismo JSON", () => {
    expect(serializarMenuNovedad(parseMenuNovedad(MENU_EJEMPLO)!)).toEqual(MENU_EJEMPLO);
  });

  it("sin menú, NULL o algo que no es un menú devuelve null", () => {
    expect(parseMenuNovedad(undefined)).toBeNull();
    expect(parseMenuNovedad(null)).toBeNull();
    expect(parseMenuNovedad([])).toBeNull();
    expect(parseMenuNovedad({ incluye_bebidas: true })).toBeNull();
    expect(parseMenuNovedad("no es json")).toBeNull();
  });

  it("tolera secciones ausentes y traducciones vacías", () => {
    const menu = parseMenuNovedad({ secciones: { primero: [{ nombre: "Sopa", traducciones: { en: { nombre: "  " } } }] } })!;
    expect(menu.incluye_bebidas).toBe(false);
    expect(menu.secciones.segundo).toEqual([]);
    expect(menu.secciones.bebidas).toEqual([]);
    expect(menu.secciones.primero[0].nombre).toBe("Sopa");
    expect(menu.secciones.primero[0].traducciones).toBeUndefined();
  });

  it("al guardar: cuatro secciones siempre, sin líneas vacías y sin bebidas con «Solo comida»", () => {
    const menu = conComida(
      { primero: [itemLibre("Sopa"), itemLibre("")], bebidas: [itemLibre("Agua")] },
      false,
    );
    const json = serializarMenuNovedad(menu) as { incluye_bebidas: boolean; secciones: Record<string, unknown[]> };
    expect(json.incluye_bebidas).toBe(false);
    expect(Object.keys(json.secciones)).toEqual(["primero", "segundo", "postre", "bebidas"]);
    expect(json.secciones.primero).toHaveLength(1);
    expect(json.secciones.bebidas).toEqual([]);
  });

  it("no guarda propiedades que no son del contrato", () => {
    const item = { ...itemLibre("Sopa"), sobrante: "x" } as ItemMenuNovedad;
    const json = serializarMenuNovedad(conComida({ primero: [item] })) as { secciones: { primero: Record<string, unknown>[] } };
    expect(json.secciones.primero[0]).not.toHaveProperty("sobrante");
    expect(json.secciones.primero[0]).not.toHaveProperty("traducciones");
  });
});

describe("plato en la carta", () => {
  it("«en la carta» es activado Y restaurante", () => {
    expect(platoEnCarta({ activado: true, restaurante: true })).toBe(true);
    expect(platoEnCarta({ activado: false, restaurante: true })).toBe(false);
    expect(platoEnCarta({ activado: true, restaurante: false })).toBe(false);
    expect(platoEnCarta({ activado: true, restaurante: null })).toBe(false);
    expect(platoEnCarta(undefined)).toBe(false);
  });

  it("estado del plato enlazado", () => {
    expect(estadoPlatoEnlazado(null, platosCarta, true)).toBe("sin_plato");
    expect(estadoPlatoEnlazado("p-pulpo", platosCarta, false)).toBe("desconocido");
    expect(estadoPlatoEnlazado("p-pulpo", platosCarta, true)).toBe("en_carta");
    expect(estadoPlatoEnlazado("p-off", platosCarta, true)).toBe("fuera_de_carta");
    expect(estadoPlatoEnlazado("p-borrado", platosCarta, true)).toBe("fuera_de_carta");
  });

  it("aviso «El plato ya no está en la carta» solo con «Échale un vistazo»", () => {
    expect(platoRetiradoDeLaCarta(["ver_plato"], "p-tienda", platosCarta, true)).toBe(true);
    // Borrado: la FK dejó plato_id a NULL.
    expect(platoRetiradoDeLaCarta(["llamar", "ver_plato"], null, platosCarta, true)).toBe(true);
    expect(platoRetiradoDeLaCarta(["ver_plato"], "p-pulpo", platosCarta, true)).toBe(false);
    expect(platoRetiradoDeLaCarta(["llamar"], null, platosCarta, true)).toBe(false);
    // Sin la carta cargada no se acusa a nadie.
    expect(platoRetiradoDeLaCarta(["ver_plato"], "p-off", platosCarta, false)).toBe(false);
  });
});

describe("botonesVisiblesEnWeb", () => {
  it("oculta «Échale un vistazo» sin plato en la carta y «Ver menú» sin platos", () => {
    const todos = ["ver_menu", "ver_plato"] as const;
    expect(botonesVisiblesEnWeb(todos, { platoEnCarta: true, menuConPlatos: true })).toEqual(["ver_menu", "ver_plato"]);
    expect(botonesVisiblesEnWeb(todos, { platoEnCarta: false, menuConPlatos: true })).toEqual(["ver_menu"]);
    expect(botonesVisiblesEnWeb(todos, { platoEnCarta: true, menuConPlatos: false })).toEqual(["ver_plato"]);
    expect(botonesVisiblesEnWeb(["llamar"], { platoEnCarta: false, menuConPlatos: false })).toEqual(["llamar"]);
  });
});

describe("validarBotonesNovedad — no deja guardar y explica por qué", () => {
  const menuVacio = menuNovedadVacio();
  const mensajes = (botones: string[], menu = menuVacio, estadoPlato: EstadoPlatoEnlazado = "sin_plato") =>
    validarBotonesNovedad({ botones, menu, estadoPlato }).map((e) => e.mensaje);

  it("sin botones, o con «Llamar», se puede guardar", () => {
    expect(mensajes([])).toEqual([]);
    expect(mensajes(["llamar"])).toEqual([]);
  });

  it("más de 2 botones", () => {
    expect(mensajes(["llamar", "ver_menu", "ver_plato"], conComida({ primero: [itemLibre("Sopa")] }), "en_carta")).toEqual([
      "Como mucho 2 botones por novedad: quita alguno.",
    ]);
  });

  it("un botón repetido o desconocido", () => {
    expect(mensajes(["llamar", "llamar"])).toEqual(["«Llamar» está repetido: cada botón solo puede salir una vez."]);
    expect(mensajes(["reservar"])).toEqual(["Hay un botón que no existe. Quítalo y elige uno de la lista."]);
  });

  it("«Ver menú» sin ningún plato (las líneas en blanco no cuentan)", () => {
    expect(mensajes(["ver_menu"], conComida({ primero: [itemLibre("  ")] }))).toEqual([
      "«Ver menú» necesita al menos un plato en primero, segundo o postre.",
    ]);
    expect(mensajes(["ver_menu"], conComida({ postre: [itemLibre("Flan")] }))).toEqual([]);
  });

  it("solo bebidas no basta para «Ver menú»", () => {
    expect(mensajes(["ver_menu"], conComida({ bebidas: [itemLibre("Agua")] }, true))).toEqual([
      "«Ver menú» necesita al menos un plato en primero, segundo o postre.",
    ]);
  });

  it("«Comida + bebidas» sin bebidas (ADR-3)", () => {
    expect(mensajes(["ver_menu"], conComida({ primero: [itemLibre("Sopa")], bebidas: [itemLibre(" ")] }, true))).toEqual([
      "Con «Comida + bebidas» añade al menos una bebida, o elige «Solo comida».",
    ]);
    expect(mensajes(["ver_menu"], conComida({ primero: [itemLibre("Sopa")], bebidas: [itemLibre("Agua")] }, true))).toEqual([]);
  });

  it("«Échale un vistazo» sin plato enlazado o con un plato fuera de la carta", () => {
    expect(mensajes(["ver_plato"], menuVacio, "sin_plato")).toEqual([
      "«Échale un vistazo» necesita un plato de la carta enlazado.",
    ]);
    expect(mensajes(["ver_plato"], menuVacio, "fuera_de_carta")).toEqual([
      "El plato ya no está en la carta: enlaza otro o quita «Échale un vistazo».",
    ]);
    expect(mensajes(["ver_plato"], menuVacio, "en_carta")).toEqual([]);
    // Sin la carta cargada no se juzga el plato (la FK protege lo demás).
    expect(mensajes(["ver_plato"], menuVacio, "desconocido")).toEqual([]);
  });

  it("un menú con platos no importa si no hay «Ver menú»", () => {
    expect(mensajes(["llamar"], conComida({}, true))).toEqual([]);
  });
});

describe("camposBotonesPayload — regla 2.4", () => {
  const menu = conComida({ primero: [itemLibre("Sopa")] });

  it("una novedad sin botones (ni antes ni ahora) no manda ninguna clave nueva", () => {
    const campos = camposBotonesPayload({ botonesAlAbrir: [], botones: [], platoId: "p-pulpo", menu });
    expect(campos).toEqual({});
    expect(Object.keys({ titulo: "x", ...campos })).toEqual(["titulo"]);
  });

  it("con botones manda las tres claves; sin «Ver menú» menu es null y sin «Échale un vistazo» plato_id es null", () => {
    expect(camposBotonesPayload({ botonesAlAbrir: [], botones: ["llamar"], platoId: "p-pulpo", menu })).toEqual({
      botones: ["llamar"],
      menu: null,
      plato_id: null,
    });
  });

  it("guarda el orden, el plato y el menú serializado", () => {
    const campos = camposBotonesPayload({ botonesAlAbrir: [], botones: ["ver_plato", "ver_menu"], platoId: "p-pulpo", menu });
    expect(campos.botones).toEqual(["ver_plato", "ver_menu"]);
    expect(campos.plato_id).toBe("p-pulpo");
    expect(campos.menu).toEqual(serializarMenuNovedad(menu));
  });

  it("si los tenía al abrirla y se quitan todos, se guarda [] y se limpian menu y plato_id", () => {
    expect(camposBotonesPayload({ botonesAlAbrir: ["ver_menu"], botones: [], platoId: "p-pulpo", menu })).toEqual({
      botones: [],
      menu: null,
      plato_id: null,
    });
  });
});

describe("esErrorSinColumnasBotones", () => {
  it("reconoce el error de PostgREST y el de Postgres", () => {
    expect(esErrorSinColumnasBotones("Could not find the 'botones' column of 'novedades' in the schema cache")).toBe(true);
    expect(esErrorSinColumnasBotones('column "menu" of relation "novedades" does not exist')).toBe(true);
    expect(esErrorSinColumnasBotones("new row violates row-level security policy")).toBe(false);
  });
});

describe("conservarTraduccionesVigentes", () => {
  const traducido: ItemMenuNovedad = {
    ...itemLibre("Cordero asado"),
    traducciones: { en: { nombre: "Roast lamb", descripcion: null }, fr: { nombre: "Agneau rôti", descripcion: null } },
  };

  it("si cambia el nombre en español, la línea pierde sus traducciones", () => {
    const [despues] = conservarTraduccionesVigentes([traducido], [{ ...traducido, nombre: "Cordero lechal" }]);
    expect(despues.traducciones).toBeUndefined();
    expect(despues.nombre).toBe("Cordero lechal");
  });

  it("si solo cambian los alérgenos o un espacio al final, las conserva", () => {
    const [a, b] = conservarTraduccionesVigentes(
      [traducido, { ...traducido, id: "otra" }],
      [{ ...traducido, alergenos: ["leche"] }, { ...traducido, id: "otra", nombre: "Cordero asado " }],
    );
    expect(a.traducciones).toEqual(traducido.traducciones);
    expect(b.traducciones).toEqual(traducido.traducciones);
  });
});

describe("traducirMenuNovedad", () => {
  const respuestaOk = (en: Record<string, string>, fr: Record<string, string>) => ({
    data: {
      ok: true,
      translations: {
        menu_en: { primero: "", segundo: "", postre: "", ...en },
        menu_fr: { primero: "", segundo: "", postre: "", ...fr },
      },
    },
    error: null,
  });

  it("un plato de la carta copia sus traducciones y no llama al traductor", async () => {
    const invocar = vi.fn<InvocarTraductorMenu>();
    const pulpo = itemDesdePlato({ id: "p-pulpo", nombre: "Pulpo a feira" });
    const { menu, sinTraducir } = await traducirMenuNovedad(conComida({ primero: [pulpo] }), platosCarta, invocar);
    expect(invocar).not.toHaveBeenCalled();
    expect(sinTraducir).toBe(0);
    expect(menu.secciones.primero[0].traducciones).toEqual({
      en: { nombre: "Octopus", descripcion: "With potatoes" },
      fr: { nombre: "Poulpe", descripcion: null },
    });
  });

  it("un plato de la carta sin traducción en la carta se queda en castellano (no se inventa otra versión)", async () => {
    const invocar = vi.fn<InvocarTraductorMenu>();
    const plato = itemDesdePlato({ id: "p-sin-trad", nombre: "Zorza" });
    const { menu, sinTraducir } = await traducirMenuNovedad(conComida({ segundo: [plato] }), platosCarta, invocar);
    expect(invocar).not.toHaveBeenCalled();
    expect(sinTraducir).toBe(0);
    expect(menu.secciones.segundo[0].traducciones).toBeUndefined();
  });

  it("lo escrito a mano pasa por traducir-contenido tipo «menu», y las bebidas en otra llamada", async () => {
    const invocar = vi.fn<InvocarTraductorMenu>(async ({ datos }) =>
      datos.primero === "Vino de la casa\nAgua"
        ? respuestaOk({ primero: "House wine\nWater" }, { primero: "Vin de la maison\nEau" })
        : respuestaOk({ segundo: "Roast lamb", postre: "Custard" }, { segundo: "Agneau rôti", postre: "Flan" }),
    );
    const menuInicial = conComida(
      {
        segundo: [itemLibre("Cordero asado")],
        postre: [itemLibre("Flan")],
        bebidas: [itemLibre("Vino de la casa"), itemLibre("Agua")],
      },
      true,
    );

    const { menu, sinTraducir } = await traducirMenuNovedad(menuInicial, platosCarta, invocar);

    expect(invocar).toHaveBeenCalledTimes(2);
    expect(invocar).toHaveBeenCalledWith({ tipo: "menu", datos: { primero: "", segundo: "Cordero asado", postre: "Flan" } });
    expect(invocar).toHaveBeenCalledWith({ tipo: "menu", datos: { primero: "Vino de la casa\nAgua", segundo: "", postre: "" } });
    expect(sinTraducir).toBe(0);
    expect(menu.secciones.segundo[0].traducciones).toEqual({
      en: { nombre: "Roast lamb", descripcion: null },
      fr: { nombre: "Agneau rôti", descripcion: null },
    });
    expect(menu.secciones.bebidas.map((b) => b.traducciones?.fr?.nombre)).toEqual(["Vin de la maison", "Eau"]);
  });

  it("un plato que ya no está en la carta y no tenía traducción también va al traductor", async () => {
    const invocar = vi.fn<InvocarTraductorMenu>(async () => respuestaOk({ primero: "Old dish" }, { primero: "Ancien plat" }));
    const retirado = itemDesdePlato({ id: "p-borrado", nombre: "Plato viejo" });
    const { menu } = await traducirMenuNovedad(conComida({ primero: [retirado] }), platosCarta, invocar);
    expect(invocar).toHaveBeenCalledWith({ tipo: "menu", datos: { primero: "Plato viejo", segundo: "", postre: "" } });
    expect(menu.secciones.primero[0].traducciones?.en?.nombre).toBe("Old dish");
  });

  it("lo ya traducido no se vuelve a mandar", async () => {
    const invocar = vi.fn<InvocarTraductorMenu>();
    const { menu } = await traducirMenuNovedad(parseMenuNovedad(MENU_EJEMPLO)!, new Map(), invocar);
    // Solo el cordero (a mano, sin traducción) y el vino (le falta el francés).
    expect(invocar).toHaveBeenCalledTimes(2);
    expect(menu.secciones.primero[0].traducciones?.en?.nombre).toBe("Galician-style octopus");
  });

  it("si el traductor falla, se guarda sin traducción y se cuenta para avisar", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    const invocar = vi.fn<InvocarTraductorMenu>(async () => ({ data: { ok: false, error: "OpenAI caído" }, error: null }));
    const pulpo = itemDesdePlato({ id: "p-pulpo", nombre: "Pulpo a feira" });
    const { menu, sinTraducir } = await traducirMenuNovedad(
      conComida({ primero: [pulpo, itemLibre("Caldo")] }),
      platosCarta,
      invocar,
    );
    expect(sinTraducir).toBe(1);
    expect(menu.secciones.primero[1].traducciones).toBeUndefined();
    // La carta sí llega traducida aunque falle el traductor.
    expect(menu.secciones.primero[0].traducciones?.fr?.nombre).toBe("Poulpe");
    consola.mockRestore();
  });

  it("si la llamada lanza o devuelve otro número de líneas, esa sección se queda en castellano", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    const lanza = vi.fn<InvocarTraductorMenu>(async () => {
      throw new Error("red");
    });
    expect((await traducirMenuNovedad(conComida({ primero: [itemLibre("Caldo")] }), platosCarta, lanza)).sinTraducir).toBe(1);

    const descuadra = vi.fn<InvocarTraductorMenu>(async () => respuestaOk({ primero: "Broth\nSoup" }, { primero: "Bouillon" }));
    const { menu, sinTraducir } = await traducirMenuNovedad(conComida({ primero: [itemLibre("Caldo")] }), platosCarta, descuadra);
    expect(sinTraducir).toBe(1);
    expect(menu.secciones.primero[0].traducciones).toEqual({ fr: { nombre: "Bouillon", descripcion: null } });
    consola.mockRestore();
  });

  it("descarta las líneas vacías y no traduce bebidas con «Solo comida»", async () => {
    const invocar = vi.fn<InvocarTraductorMenu>(async () => respuestaOk({ primero: "Soup" }, { primero: "Soupe" }));
    const { menu } = await traducirMenuNovedad(
      conComida({ primero: [itemLibre("Sopa"), itemLibre("  ")], bebidas: [itemLibre("Agua")] }, false),
      platosCarta,
      invocar,
    );
    expect(invocar).toHaveBeenCalledTimes(1);
    expect(menu.secciones.primero).toHaveLength(1);
    expect(menu.secciones.bebidas).toEqual([]);
    expect(menuTieneComida(menu)).toBe(true);
  });
});

describe("traduccionesDesdeCarta", () => {
  it("solo los idiomas que la carta tiene", () => {
    expect(traduccionesDesdeCarta({ nombre_en: "Octopus", nombre_fr: " " })).toEqual({
      en: { nombre: "Octopus", descripcion: null },
    });
    expect(traduccionesDesdeCarta({})).toBeUndefined();
  });
});
