import { describe, expect, it } from "vitest";
import {
  difiereDeLaCarta,
  emparejarTraduccion,
  itemDesdePlato,
  itemLibre,
  MAX_NOMBRE_PLATO,
  rotuloEnElEditor,
  menuEnIdioma,
  menuTieneContenido,
  parseMenuDia,
  rotuloEnLaWeb,
  serializarMenuDia,
  textoDeSeccion,
  type ItemMenu,
  type PlatoParaMenu,
} from "@/lib/menu-dia";

const platoCarta: PlatoParaMenu = {
  id: "plato-1",
  nombre: "Pulpo a feira",
  descripcion: "Con cachelos y pimentón de la Vera",
  imagen_url: "https://ejemplo.test/pulpo.jpg",
  imagen_posicion_y: 40,
  alergenos_oficiales: ["moluscos", "Sulfitos"],
  alergenos_inferidos: ["gluten"],
  alergenos_notas: "Se fríe en aceite compartido",
};

describe("parseMenuDia — formato heredado (v1)", () => {
  it("parte por salto de línea, que es justo lo que la web no hacía", () => {
    const menu = parseMenuDia({
      primero: "Ensalada templada\nSopa de marisco",
      segundo: "Carrillera",
      postre: "Flan",
    });

    expect(menu.version).toBe(1);
    expect(menu.secciones.primero.map((i) => i.nombre)).toEqual([
      "Ensalada templada",
      "Sopa de marisco",
    ]);
    expect(menu.secciones.segundo).toHaveLength(1);
    expect(menu.secciones.postre[0].nombre).toBe("Flan");
  });

  it("los items heredados quedan como texto libre sin alérgenos", () => {
    const menu = parseMenuDia({ primero: "Sopa", segundo: "", postre: "" });
    expect(menu.secciones.primero[0]).toMatchObject({
      origen: "libre",
      platoId: null,
      alergenos: [],
      imagenUrl: null,
    });
  });

  it("acepta también los plurales y los arrays antiguos", () => {
    const menu = parseMenuDia({ primeros: ["Sopa", "  "], segundos: "Merluza", postres: "Flan" });
    expect(menu.secciones.primero.map((i) => i.nombre)).toEqual(["Sopa"]);
    expect(menu.secciones.segundo[0].nombre).toBe("Merluza");
  });

  it("no revienta con basura", () => {
    for (const basura of [null, undefined, 42, "no soy json", "[]", {}]) {
      const menu = parseMenuDia(basura);
      expect(menuTieneContenido(menu.secciones)).toBe(false);
    }
  });

  it("lee el jsonb aunque llegue como texto", () => {
    const menu = parseMenuDia(JSON.stringify({ primero: "Sopa", segundo: "", postre: "" }));
    expect(menu.secciones.primero[0].nombre).toBe("Sopa");
  });
});

describe("parseMenuDia — formato estructurado (v2)", () => {
  it("da la vuelta completa: serializar y volver a leer conserva los datos", () => {
    const secciones = {
      primero: [itemDesdePlato(platoCarta)],
      segundo: [itemLibre("Guiso de la abuela", ["Gluten", "lacteos"])],
      postre: [],
    };

    const leido = parseMenuDia(serializarMenuDia(secciones));

    expect(leido.version).toBe(2);
    expect(leido.secciones.primero[0]).toEqual(secciones.primero[0]);
    expect(leido.secciones.segundo[0]).toEqual(secciones.segundo[0]);
    expect(leido.secciones.postre).toEqual([]);
  });

  it("deduce el origen cuando falta, mirando el platoId", () => {
    const menu = parseMenuDia({
      secciones: {
        primero: [{ id: "a", nombre: "Con id de plato", platoId: "plato-9" }],
        segundo: [{ id: "b", nombre: "Sin id de plato" }],
        postre: [],
      },
    });

    expect(menu.secciones.primero[0].origen).toBe("carta");
    expect(menu.secciones.segundo[0].origen).toBe("libre");
    expect(menu.secciones.segundo[0].platoId).toBeNull();
  });

  it("descarta items sin nombre en vez de pintar líneas vacías", () => {
    const menu = parseMenuDia({
      secciones: { primero: [{ id: "a", nombre: "  " }, { id: "b", nombre: "Sopa" }], segundo: [], postre: [] },
    });
    expect(menu.secciones.primero.map((i) => i.nombre)).toEqual(["Sopa"]);
  });

  it("si `secciones` viene vacío del todo, cae al formato heredado", () => {
    const menu = parseMenuDia({
      secciones: { primero: [], segundo: [], postre: [] },
      primero: "Sopa",
      segundo: "",
      postre: "",
    });
    expect(menu.version).toBe(1);
    expect(menu.secciones.primero[0].nombre).toBe("Sopa");
  });
});

describe("serializarMenuDia", () => {
  it("escribe SIEMPRE el espejo heredado, para no romper a quien solo lo conoce", () => {
    const json = serializarMenuDia({
      primero: [itemLibre("Sopa"), itemLibre("Ensalada")],
      segundo: [itemLibre("Merluza")],
      postre: [],
    });

    expect(json.v).toBe(2);
    expect(json.primero).toBe("Sopa\nEnsalada");
    expect(json.segundo).toBe("Merluza");
    expect(json.postre).toBe("");
  });
});

describe("itemDesdePlato — se COPIA, no se enlaza", () => {
  it("trae alérgenos, foto y descripción sin teclear nada", () => {
    const item = itemDesdePlato(platoCarta);

    expect(item.origen).toBe("carta");
    expect(item.platoId).toBe("plato-1");
    expect(item.nombre).toBe("Pulpo a feira");
    expect(item.imagenUrl).toBe("https://ejemplo.test/pulpo.jpg");
    expect(item.imagenPosicionY).toBe(40);
    expect(item.alergenosNotas).toBe("Se fríe en aceite compartido");
  });

  it("normaliza los alérgenos al canónico y no mezcla declarados con inferidos", () => {
    const item = itemDesdePlato(platoCarta);
    expect(item.alergenos).toEqual(["moluscos", "sulfitos"]);
    expect(item.alergenosInferidos).toEqual(["gluten"]);
  });

  it("la copia sobrevive a que el plato cambie después", () => {
    const item = itemDesdePlato(platoCarta);
    const platoEditadoDespues = { ...platoCarta, nombre: "Pulpo (nuevo nombre)", imagen_url: null };

    // El item guardado no se entera: es el comportamiento que se busca.
    expect(item.nombre).toBe("Pulpo a feira");
    expect(item.imagenUrl).toBe("https://ejemplo.test/pulpo.jpg");
    // Pero el panel sí puede detectarlo y ofrecer actualizar.
    expect(difiereDeLaCarta(item, platoEditadoDespues)).toBe(true);
    expect(difiereDeLaCarta(item, platoCarta)).toBe(false);
  });

  it("un plato borrado de la carta no cuenta como 'difiere'", () => {
    expect(difiereDeLaCarta(itemDesdePlato(platoCarta), undefined)).toBe(false);
  });

  it("un item libre nunca difiere de la carta", () => {
    expect(difiereDeLaCarta(itemLibre("Guiso"), platoCarta)).toBe(false);
  });
});

describe("itemLibre — alérgenos como cualquier plato", () => {
  it("admite alérgenos y los normaliza", () => {
    const item = itemLibre("Guiso de la abuela", ["Huevo", "frutos_cascara"]);
    expect(item.origen).toBe("libre");
    expect(item.alergenos).toEqual(["huevos", "frutos de cáscara"]);
  });

  it("sin alérgenos se queda con la lista vacía, no con null", () => {
    expect(itemLibre("Sopa").alergenos).toEqual([]);
  });
});

describe("emparejarTraduccion", () => {
  const libres = [itemLibre("Sopa de marisco"), itemLibre("Guiso")];

  it("empareja por posición cuando cuadra el número de líneas", () => {
    const variantes = emparejarTraduccion(libres, "Seafood soup\nStew");
    expect(variantes.get(libres[0].id)?.nombre).toBe("Seafood soup");
    expect(variantes.get(libres[1].id)?.nombre).toBe("Stew");
  });

  it("descarta la sección entera si el traductor devuelve otro número de líneas", () => {
    // Desplazar los nombres le pondría a un plato el nombre de otro: peor que
    // quedarse en español.
    expect(emparejarTraduccion(libres, "Seafood soup").size).toBe(0);
    expect(emparejarTraduccion(libres, "A\nB\nC").size).toBe(0);
  });

  it("sin items que traducir no hace nada", () => {
    expect(emparejarTraduccion([], "loquesea").size).toBe(0);
  });
});

describe("menuEnIdioma", () => {
  it("cambia nombre y descripción y deja intacto lo demás", () => {
    const item = itemDesdePlato(platoCarta);
    const secciones = { primero: [item], segundo: [], postre: [] };

    const traducido = menuEnIdioma(secciones, new Map([[item.id, { nombre: "Galician octopus", descripcion: "With potatoes" }]]));
    const resultado = traducido.primero[0];

    expect(resultado.nombre).toBe("Galician octopus");
    expect(resultado.descripcion).toBe("With potatoes");
    // La foto, los alérgenos y el id NO dependen del idioma.
    expect(resultado.imagenUrl).toBe(item.imagenUrl);
    expect(resultado.alergenos).toEqual(item.alergenos);
    expect(resultado.id).toBe(item.id);
  });

  it("un item sin variante se queda en español en vez de quedarse en blanco", () => {
    const item = itemLibre("Sopa");
    const traducido = menuEnIdioma({ primero: [item], segundo: [], postre: [] }, new Map());
    expect(traducido.primero[0].nombre).toBe("Sopa");
  });
});

describe("textoDeSeccion y menuTieneContenido", () => {
  it("une los nombres por salto de línea", () => {
    expect(textoDeSeccion([itemLibre("Sopa"), itemLibre("Ensalada")])).toBe("Sopa\nEnsalada");
  });

  it("detecta si hay algo que guardar", () => {
    const vacio: Record<string, ItemMenu[]> = { primero: [], segundo: [], postre: [] };
    expect(menuTieneContenido(vacio as never)).toBe(false);
    expect(menuTieneContenido({ ...vacio, postre: [itemLibre("Flan")] } as never)).toBe(true);
  });
});

describe("entrante del menú del día (01/11/2026)", () => {
  it("da la vuelta completa con el entrante delante del primero", () => {
    const secciones = {
      entrante: [itemLibre("Gilda"), itemDesdePlato(platoCarta)],
      primero: [itemLibre("Sopa")],
      segundo: [],
      postre: [],
    };
    const json = serializarMenuDia(secciones);

    // Espejo heredado también para el entrante: quien no lo conozca lo ignora.
    expect(json.entrante).toBe("Gilda\nPulpo a feira");
    expect((json.secciones as Record<string, unknown>).entrante).toEqual(secciones.entrante);

    const leido = parseMenuDia(json);
    expect(leido.version).toBe(2);
    expect(leido.secciones.entrante).toEqual(secciones.entrante);
    expect(leido.secciones.primero[0].nombre).toBe("Sopa");
  });

  it("un menú con solo entrante también es estructurado y tiene contenido", () => {
    const leido = parseMenuDia(serializarMenuDia({ entrante: [itemLibre("Gilda")], primero: [], segundo: [], postre: [] }));
    expect(leido.version).toBe(2);
    expect(menuTieneContenido(leido.secciones)).toBe(true);
  });

  it("los menús de antes se leen con el entrante vacío", () => {
    expect(parseMenuDia({ primero: "Sopa", segundo: "", postre: "" }).secciones.entrante).toEqual([]);
    const v2 = parseMenuDia({ v: 2, secciones: { primero: [{ id: "a", nombre: "Sopa" }], segundo: [], postre: [] } });
    expect(v2.secciones.entrante).toEqual([]);
  });

  it("el espejo heredado lee también el entrante", () => {
    const menu = parseMenuDia({ entrante: "Gilda\nBoquerones", primero: "Sopa", segundo: "", postre: "" });
    expect(menu.secciones.entrante.map((i) => i.nombre)).toEqual(["Gilda", "Boquerones"]);
  });

  it("se traduce como las demás secciones", () => {
    const gilda = itemLibre("Gilda");
    const traducido = menuEnIdioma(
      { entrante: [gilda], primero: [], segundo: [], postre: [] },
      new Map([[gilda.id, { nombre: "Gilda skewer", descripcion: null }]]),
    );
    expect(traducido.entrante[0].nombre).toBe("Gilda skewer");
  });
});

describe("postre o café configurable (01/11/2026)", () => {
  const conPostre = { primero: [itemLibre("Sopa")], segundo: [], postre: [itemLibre("Flan")] };

  it("un menú guardado antes de la opción no la tiene elegida (null)", () => {
    expect(parseMenuDia({ primero: "Sopa", segundo: "", postre: "Flan" }).postreCafe).toBeNull();
    expect(parseMenuDia(serializarMenuDia(conPostre)).postreCafe).toBeNull();
  });

  it("sin pasarla no se escribe la clave: la web sigue pintando «Postre»", () => {
    expect(serializarMenuDia(conPostre)).not.toHaveProperty("postreCafe");
  });

  it("se guarda y se vuelve a leer", () => {
    for (const opcion of ["postre", "postre_o_cafe", "postre_y_cafe"] as const) {
      const json = serializarMenuDia(conPostre, opcion);
      expect(json.postreCafe).toBe(opcion);
      expect(parseMenuDia(json).postreCafe).toBe(opcion);
    }
  });

  it("un valor desconocido se lee como no elegido", () => {
    expect(parseMenuDia({ ...serializarMenuDia(conPostre), postreCafe: "cafe_solo" }).postreCafe).toBeNull();
  });
});

describe("rotuloEnLaWeb — lo que pinta la web en castellano", () => {
  const vacio = { entrante: [], primero: [], segundo: [], postre: [] } as Record<string, ItemMenu[]>;
  const base = { ...vacio, primero: [itemLibre("Sopa")], segundo: [itemLibre("Merluza")], postre: [itemLibre("Flan")] };

  it("sin entrante, lo de siempre: Entrantes, Principales y Postre", () => {
    const secciones = base as never;
    expect(rotuloEnLaWeb("primero", secciones, null)).toBe("Entrantes");
    expect(rotuloEnLaWeb("segundo", secciones, null)).toBe("Principales");
    expect(rotuloEnLaWeb("postre", secciones, null)).toBe("Postre");
    expect(rotuloEnLaWeb("postre", { ...base, postre: [itemLibre("Flan"), itemLibre("Natillas")] } as never, "postre")).toBe(
      "Postres",
    );
  });

  it("con entrante: Entrantes, Primeros y Segundos", () => {
    const secciones = { ...base, entrante: [itemLibre("Gilda")] } as never;
    expect(rotuloEnLaWeb("entrante", secciones, null)).toBe("Entrantes");
    expect(rotuloEnLaWeb("primero", secciones, null)).toBe("Primeros");
    expect(rotuloEnLaWeb("segundo", secciones, null)).toBe("Segundos");
  });

  it("el postre según «¿Qué entra?»", () => {
    expect(rotuloEnLaWeb("postre", base as never, "postre_o_cafe")).toBe("Postre o café");
    expect(rotuloEnLaWeb("postre", base as never, "postre_y_cafe")).toBe("Postre y café");
  });
});

describe("MAX_NOMBRE_PLATO (QA-MDN-01)", () => {
  it("un plato escrito a mano no pasa del máximo", () => {
    expect(itemLibre("x".repeat(658)).nombre).toHaveLength(MAX_NOMBRE_PLATO);
    expect(itemLibre("  Codillo asado  ").nombre).toBe("Codillo asado");
  });
});

describe("rotuloEnElEditor (QA-MDN-04)", () => {
  const vacio = { entrante: [], primero: [], segundo: [], postre: [] };
  const conEntrante = { ...vacio, entrante: [itemLibre("Croquetas")] };

  it("sin entrante avisa de cómo titula la web el primero y el segundo", () => {
    expect(rotuloEnElEditor("primero", vacio, null)).toBe("Primero · en la web: Entrantes");
    expect(rotuloEnElEditor("segundo", vacio, null)).toBe("Segundo · en la web: Principales");
  });

  it("con entrante la web dice lo mismo en plural y no se añade nada", () => {
    expect(rotuloEnElEditor("primero", conEntrante, null)).toBe("Primero");
    expect(rotuloEnElEditor("segundo", conEntrante, null)).toBe("Segundo");
    expect(rotuloEnElEditor("entrante", conEntrante, null)).toBe("Entrante");
  });

  it("el postre lleva el rótulo elegido", () => {
    expect(rotuloEnElEditor("postre", vacio, "postre_y_cafe")).toBe("Postre y café");
    expect(rotuloEnElEditor("postre", vacio, null)).toBe("Postre");
  });
});
