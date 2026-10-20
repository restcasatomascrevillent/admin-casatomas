import { describe, expect, it } from "vitest";
import {
  difiereDeLaCarta,
  emparejarTraduccion,
  itemDesdePlato,
  itemLibre,
  menuEnIdioma,
  menuTieneContenido,
  parseMenuDia,
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
