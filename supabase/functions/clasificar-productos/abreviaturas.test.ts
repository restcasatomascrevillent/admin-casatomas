import { describe, expect, it, vi } from "vitest";
import {
  abreviaturasActivas,
  type AbreviaturaFila,
  abreviaturaPlausible,
  compactarAbreviaturas,
  expandirAbreviaturaInicial,
  extraerAbreviaturasNuevas,
} from "./abreviaturas.ts";
import {
  agruparPendientes,
  type Categoria,
  cargarExtras,
  clasificarPendientes,
  construirMensajes,
  type LineaPendiente,
  type ProductoCatalogo,
  validarAsignaciones,
} from "./clasificacion.ts";

const GAMBIN = 483;
const fila = (abreviatura: string, expansion: string, extra: Partial<AbreviaturaFila> = {}): AbreviaturaFila => ({
  proveedor_id: GAMBIN, abreviatura, expansion, origen: "aprendida", veces: 1, en_nombre: true, ...extra,
});
const categorias: Categoria[] = [
  { id: 1, nombre: "Bebidas", padre_id: null, descripcion: null, activa: true },
  { id: 2, nombre: "Vinos", padre_id: 1, descripcion: null, activa: true },
];
const linea = (id: number, nombre: string, norm: string): LineaPendiente => ({
  id, nombre, nombre_normalizado: norm, unidad: "ud", precio_unitario: 40, proveedor: "Vinos y Licores Gambín", proveedor_id: GAMBIN,
});

describe("abreviaturasActivas", () => {
  it("vale lo del nombre, lo manual y lo visto 2 veces; no el truncado visto una vez", () => {
    const a = abreviaturasActivas([
      fila("lp", "Laurent-Perrier"),
      fila("baro", "Barón", { en_nombre: false, veces: 1 }),
      fila("mur", "Murrieta", { en_nombre: false, veces: 2 }),
      fila("cm", "Cardenal Mendoza", { en_nombre: false, origen: "manual" }),
    ]);
    expect(a.get(GAMBIN)).toEqual([
      { abreviatura: "mur", expansion: "Murrieta" },
      { abreviatura: "cm", expansion: "Cardenal Mendoza" },
      { abreviatura: "lp", expansion: "Laurent-Perrier" },
    ].sort((x, y) => (x.abreviatura === "mur" ? -1 : y.abreviatura === "mur" ? 1 : x.abreviatura.localeCompare(y.abreviatura))));
    expect(a.get(GAMBIN)?.some((x) => x.abreviatura === "baro")).toBe(false);
  });

  it("una abreviatura con dos expansiones parecidas es ambigua y se descarta; si una gana por el doble, gana", () => {
    const ambigua = abreviaturasActivas([fila("lp", "Laurent-Perrier", { veces: 3 }), fila("lp", "La Perla", { veces: 2 })]);
    expect(ambigua.get(GAMBIN) ?? []).toEqual([]);
    const clara = abreviaturasActivas([fila("lp", "Laurent-Perrier", { veces: 9 }), fila("lp", "La Perla", { veces: 2 })]);
    expect(clara.get(GAMBIN)).toEqual([{ abreviatura: "lp", expansion: "Laurent-Perrier" }]);
  });

  it("separa por proveedor y limita a las 40 más vistas", () => {
    const muchas = Array.from({ length: 50 }, (_, i) => fila(`a${String(i).padStart(2, "0")}`, `Marca ${i}`, { veces: 50 - i }));
    const a = abreviaturasActivas([...muchas, fila("lp", "Otra marca", { proveedor_id: 7 })]);
    expect(a.get(GAMBIN)).toHaveLength(40);
    expect(a.get(GAMBIN)?.[0].abreviatura).toBe("a00");
    expect(a.get(7)).toEqual([{ abreviatura: "lp", expansion: "Otra marca" }]);
  });

  it("se compacta en una línea por proveedor", () => {
    const a = abreviaturasActivas([fila("lp", "Laurent-Perrier", { veces: 5 }), fila("sc", "Sierra Cantabria")]);
    expect(compactarAbreviaturas(a, new Map([[GAMBIN, "Gambín"]]))).toBe("Gambín: LP=Laurent-Perrier; SC=Sierra Cantabria");
    expect(compactarAbreviaturas(a, new Map())).toBe("");
  });
});

describe("expandirAbreviaturaInicial (red de seguridad)", () => {
  const lista = [{ abreviatura: "lp", expansion: "Laurent-Perrier" }, { abreviatura: "jw", expansion: "Johnnie Walker" }];
  it("expande la primera palabra, con o sin punto", () => {
    expect(expandirAbreviaturaInicial("LP La Cuvée 75 cl", lista)).toBe("Laurent-Perrier La Cuvée 75 cl");
    expect(expandirAbreviaturaInicial("L.P. Brut", lista)).toBe("L.P. Brut");
    expect(expandirAbreviaturaInicial("JW. Black 70 cl", lista)).toBe("Johnnie Walker Black 70 cl");
  });
  it("no toca lo que no empieza por una abreviatura ni lo que ya lleva la marca", () => {
    expect(expandirAbreviaturaInicial("Laurent-Perrier La Cuvée 75 cl", lista)).toBe("Laurent-Perrier La Cuvée 75 cl");
    expect(expandirAbreviaturaInicial("Tanqueray 70 cl", lista)).toBe("Tanqueray 70 cl");
    expect(expandirAbreviaturaInicial("LP Laurent-Perrier Brut", lista)).toBe("Laurent-Perrier Brut");
    expect(expandirAbreviaturaInicial("LP La Cuvée", undefined)).toBe("LP La Cuvée");
  });
});

describe("el nombre sigue Marca + producto + formato", () => {
  const abreviaturas = abreviaturasActivas([fila("lp", "Laurent-Perrier")]);
  const catalogo: ProductoCatalogo[] = [{ id: 1, nombre: "Laurent-Perrier Brut 75 cl", categoria_id: 2 }];
  const textos = agruparPendientes([
    linea(1, "C/6B LP LA CUVEE 0,75L", "c/6b lp la cuvee 0,75l"),
    linea(2, "LAURENT PERRIER LA CUVEE MAGNUM", "laurent perrier la cuvee magnum"),
  ]);

  it("el prompt exige la marca completa y lleva las abreviaturas del proveedor", () => {
    const [sistema, usuario] = construirMensajes(textos, catalogo, categorias, {
      abreviaturas,
      fichas: [{ id: GAMBIN, nombre: "Vinos y Licores Gambín", notas_ia: "Distribuidor de vinos y espumosos. «LC.» es licor." }],
    });
    expect(sistema.content).toContain("MARCA + producto o variedad + formato");
    expect(sistema.content).toContain("NUNCA su abreviatura");
    expect(usuario.content).toContain("Vinos y Licores Gambín: LP=Laurent-Perrier");
    expect(usuario.content).toContain("Ficha de proveedores:");
    expect(usuario.content).toContain('"prov":"Vinos y Licores Gambín"');
  });

  it("sin abreviaturas ni fichas el prompt no añade secciones", () => {
    const usuario = construirMensajes(textos, catalogo, categorias)[1].content;
    expect(usuario).not.toContain("Abreviaturas de cada proveedor");
    expect(usuario).not.toContain("Ficha de proveedores");
  });

  it("si el modelo deja «LP La Cuvée 75 cl», sale «Laurent-Perrier La Cuvée 75 cl» y las dos líneas son el mismo producto", () => {
    const items = validarAsignaciones(
      {
        asignaciones: [
          { texto: "c/6b lp la cuvee 0,75l", producto_id: null, nombre_nuevo: "LP La Cuvée 75 cl", categoria_id: 2 },
          { texto: "laurent perrier la cuvee magnum", producto_id: null, nombre_nuevo: "Laurent-Perrier La Cuvée 75 cl", categoria_id: 2 },
        ],
      },
      textos, catalogo, categorias, abreviaturas,
    );
    expect(items).toEqual([
      { textos: ["c/6b lp la cuvee 0,75l", "laurent perrier la cuvee magnum"], producto_id: null, nombre: "Laurent-Perrier La Cuvée 75 cl", categoria_id: 2, unidad: "ud" },
    ]);
  });

  it("sin diccionario no se inventa nada: el nombre queda como lo dio el modelo", () => {
    const items = validarAsignaciones(
      { asignaciones: [{ texto: "c/6b lp la cuvee 0,75l", producto_id: null, nombre_nuevo: "LP La Cuvée 75 cl", categoria_id: 2 }] },
      textos, catalogo, categorias,
    );
    expect(items[0].nombre).toBe("LP La Cuvée 75 cl");
  });
});

describe("cargarExtras / clasificarPendientes con diccionario", () => {
  const datos: Record<string, unknown[]> = {
    abreviaturas_proveedor: [fila("lp", "Laurent-Perrier"), fila("zz", "Dudosa", { en_nombre: false, veces: 1 })],
    proveedores: [{ id: GAMBIN, nombre: "Vinos y Licores Gambín", notas_ia: null }],
  };
  function doble(tablas: Record<string, unknown[]>, error?: string) {
    const rpc = vi.fn(async () => ({ data: { productos_creados: 1 }, error: null }));
    const from = (tabla: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "is", "order", "limit", "in"]) c[m] = () => c;
      c.then = (ok: (v: unknown) => unknown) =>
        Promise.resolve(error && tabla === "abreviaturas_proveedor" ? { data: null, error: { message: error } } : { data: tablas[tabla] ?? [], error: null }).then(ok);
      return c;
    };
    return { supabase: { from, rpc }, rpc };
  }
  const textos = agruparPendientes([linea(1, "LP LA CUVEE", "lp la cuvee")]);

  it("carga solo lo fiable de los proveedores de la tanda", async () => {
    const e = await cargarExtras(doble(datos).supabase, textos);
    expect(e.abreviaturas?.get(GAMBIN)).toEqual([{ abreviatura: "lp", expansion: "Laurent-Perrier" }]);
    expect(e.fichas).toHaveLength(1);
  });

  it("si la tabla no existe todavía sigue sin abreviaturas (no rompe la clasificación)", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const e = await cargarExtras(doble(datos, "relation does not exist").supabase, textos);
    expect(e.abreviaturas).toBeUndefined();
    aviso.mockRestore();
  });

  it("de punta a punta: la IA contesta con la abreviatura y a la RPC llega la marca completa", async () => {
    const { supabase, rpc } = doble({
      ...datos,
      productos_factura: [{ id: 1, nombre: "LP LA CUVEE", nombre_normalizado: "lp la cuvee", unidad: "ud", precio_unitario: 40, facturas: { proveedor: "Vinos y Licores Gambín", proveedor_id: GAMBIN } }],
      productos_catalogo: [],
      categorias_producto: categorias,
    });
    const llamarModelo = vi.fn(async (mensajes: { role: string; content: string }[]) => {
      expect(mensajes[1].content).toContain("LP=Laurent-Perrier");
      return { asignaciones: [{ texto: "lp la cuvee", producto_id: null, nombre_nuevo: "LP La Cuvée 75 cl", categoria_id: 2 }] };
    });
    await clasificarPendientes({ supabase, llamarModelo });
    expect(rpc).toHaveBeenCalledWith("productos_aplicar_clasificacion_ia", {
      p_items: [{ textos: ["lp la cuvee"], producto_id: null, nombre: "Laurent-Perrier La Cuvée 75 cl", categoria_id: 2, unidad: "ud" }],
    });
  });
});

describe("abreviaturas nuevas: aviso para confirmarlas", () => {
  const textos = agruparPendientes([
    linea(1, "C/6B LP LA CUVEE 0,75L", "c/6b lp la cuvee 0,75l"),
    linea(2, "BOT. CHA. DOM PERIGNON", "bot. cha. dom perignon"),
    linea(3, "T. LAUR. HERMITAGE", "t. laur. hermitage"),
  ]);
  const resp = (a: unknown[]) => ({ asignaciones: a });

  it("plausible = iniciales de la marca o comienzo de su primera palabra", () => {
    expect(abreviaturaPlausible("lp", "Laurent-Perrier")).toBe(true);
    expect(abreviaturaPlausible("jw", "Johnnie Walker")).toBe(true);
    expect(abreviaturaPlausible("laur", "Tardieu-Laurent")).toBe(false);
    expect(abreviaturaPlausible("mur", "Murrieta")).toBe(true);
    expect(abreviaturaPlausible("lp", "La Perla")).toBe(false);
  });

  it("propone LP → Laurent-Perrier y descarta genéricos, tokens ausentes y expansiones que no encajan", () => {
    const r = extraerAbreviaturasNuevas(resp([
      { texto: "c/6b lp la cuvee 0,75l", abreviatura: { token: "LP", expansion: "Laurent-Perrier" } },
      { texto: "bot. cha. dom perignon", abreviatura: { token: "CHA.", expansion: "Champagne" } },
      { texto: "bot. cha. dom perignon", abreviatura: { token: "BOT", expansion: "Botella" } },
      { texto: "t. laur. hermitage", abreviatura: { token: "TL", expansion: "Tardieu-Laurent" } },
      { texto: "t. laur. hermitage", abreviatura: { token: "xy", expansion: "Xavier Yzaguirre" } },
      { texto: "inventado", abreviatura: { token: "LP", expansion: "Laurent-Perrier" } },
      { texto: "c/6b lp la cuvee 0,75l", abreviatura: null },
    ]), textos);
    expect(r).toEqual([{ proveedor_id: GAMBIN, abreviatura: "lp", propuesta: "Laurent-Perrier", texto: "c/6b lp la cuvee 0,75l" }]);
  });

  it("no repite la misma abreviatura ni propone las que el proveedor ya tiene", () => {
    const dos = resp([
      { texto: "c/6b lp la cuvee 0,75l", abreviatura: { token: "lp", expansion: "Laurent-Perrier" } },
      { texto: "t. laur. hermitage", abreviatura: { token: "laur", expansion: "Laurent" } },
      { texto: "t. laur. hermitage", abreviatura: { token: "laur", expansion: "Laurent Perrier" } },
    ]);
    expect(extraerAbreviaturasNuevas(dos, textos).map((x) => x.abreviatura)).toEqual(["lp", "laur"]);
    const conocidas = abreviaturasActivas([fila("lp", "Laurent-Perrier")]);
    expect(extraerAbreviaturasNuevas(dos, textos, conocidas).map((x) => x.abreviatura)).toEqual(["laur"]);
  });

  it("clasificarPendientes manda las propuestas a abreviaturas_proponer, y si falla no pierde la clasificación", async () => {
    const rpc = vi.fn(async (nombre: string) =>
      nombre === "abreviaturas_proponer" ? { data: { avisos_creados: 1 }, error: null } : { data: { productos_creados: 1 }, error: null });
    const from = (tabla: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "is", "order", "limit", "in"]) c[m] = () => c;
      const filas: Record<string, unknown[]> = {
        productos_factura: [{ id: 1, nombre: "LP LA CUVEE", nombre_normalizado: "lp la cuvee", unidad: "ud", precio_unitario: 40, facturas: { proveedor: "Gambín", proveedor_id: GAMBIN } }],
        categorias_producto: categorias,
      };
      c.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: filas[tabla] ?? [], error: null }).then(ok);
      return c;
    };
    const llamarModelo = vi.fn(async () => ({ asignaciones: [{ texto: "lp la cuvee", producto_id: null, nombre_nuevo: "Laurent-Perrier La Cuvée", categoria_id: 2, abreviatura: { token: "LP", expansion: "Laurent-Perrier" } }] }));
    const r = await clasificarPendientes({ supabase: { from, rpc }, llamarModelo });
    expect(rpc).toHaveBeenCalledWith("abreviaturas_proponer", { p_items: [{ proveedor_id: GAMBIN, abreviatura: "lp", propuesta: "Laurent-Perrier", texto: "lp la cuvee" }] });
    expect(r.avisos_abreviaturas).toBe(1);

    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    rpc.mockImplementation(async (nombre: string) => {
      if (nombre === "abreviaturas_proponer") throw new Error("boom");
      return { data: { productos_creados: 1 }, error: null };
    });
    const r2 = await clasificarPendientes({ supabase: { from, rpc }, llamarModelo });
    expect(r2.propuestas).toBe(1);
    expect(r2.avisos_abreviaturas).toBeUndefined();
    aviso.mockRestore();
  });

  it("el prompt explica cuándo devolver una abreviatura nueva y cuándo no", () => {
    const sistema = construirMensajes(textos, [], categorias)[0].content;
    expect(sistema).toContain("abreviatura: si la línea lleva");
    expect(sistema).toContain("Nunca para BOT, CHA, C/6B, CAJA, UD");
  });
});
