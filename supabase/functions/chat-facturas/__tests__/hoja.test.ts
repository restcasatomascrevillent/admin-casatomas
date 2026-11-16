/**
 * Hojas de precios grandes (hoja.ts): columnas por cabecera y por contenido,
 * contenido sacado del nombre, CSV, IA solo con 20 filas y prefiltro contra lo
 * que se compra. Fixture sintético con la forma de una tarifa real
 * (IdArticulo | Precio | Articulo | Stock), sin datos de ningún proveedor.
 */
import { describe, expect, it, vi } from "vitest";
import {
  columnasConIA,
  confirmarParejas,
  contenidoDelNombre,
  MODELO_CONFIRMAR,
  detectarColumnas,
  filasDeCsv,
  lineasDeHoja,
  numeroDe,
  palabrasDe,
  prefiltrarLineas,
  type Filas,
  type NombreCompra,
} from "../hoja.ts";

const TARIFA: Filas = [
  ["IdArticulo", "Precio", "Articulo", "Stock"],
  ["20001", 3.45, "ACEITE MARCAPRUEBA OLIVA 0,4º 1L C15 PET", 4000],
  ["20002", 0.31, "AGUA FUENTEFALSA 1,5L C6", 9000],
  ["20003", 12.8, "GIN.INVENTADO PREMIUN 70CL 40º C6", 120],
  ["20004", 6.4, "R.TONICA EJEMPLO IGLU 20CL 24U C1", 300],
  ["20005", 1.99, "TORNILLO GALVANIZADO M6", 50],
  ["20006", 4.75, "ARROZ BOMBA CAMPOSUR 1KG C10", 800],
  ["20007", null, "SIN PRECIO", 1],
];

const COMPRAS: NombreCompra[] = [
  { n: "ACEITE MARCAPRUEBA OLIVA 0,4 1L", p: 1, c: "Aceite de oliva Marcaprueba 1 l" },
  { n: "AGUA FUENTEFALSA 1,5L", p: 2, c: "Agua Fuentefalsa 1,5 l" },
  { n: "GIN INVENTADO 70CL", p: 3, c: "Gin Inventado 70 cl" },
  { n: "ARROZ BOMBA CAMPOSUR 1 KG", p: 4, c: "Arroz bomba Camposur 1 kg" },
  { n: "TONICA EJEMPLO 20CL", p: 5, c: "Tónica Ejemplo 20 cl" },
  { n: "LIMON", p: 6, c: "Limón" },
  { n: "PATATA AGRIA SACO 25 KG", p: 7, c: "Patata agria" },
];

describe("detectarColumnas", () => {
  it("por cabecera: Articulo = producto, Precio = precio; ignora IdArticulo y Stock", () => {
    expect(detectarColumnas(TARIFA)).toMatchObject({ cabecera: 0, producto: 2, precio: 1, metodo: "cabecera" });
  });

  it("nombres variados: Descripción, P.Unit., Formato, Dto", () => {
    const filas: Filas = [
      ["Tarifa noviembre"],
      [],
      ["Cód.", "EAN", "Descripción", "Formato", "P.Unit.", "Dto %"],
      ["A1", "8410000000001", "Gamba roja", "caja 2 kg", "42,50", "5"],
    ];
    expect(detectarColumnas(filas)).toMatchObject({ cabecera: 2, producto: 2, precio: 4, formato: 3, descuento: 5 });
  });

  it("sin cabecera: texto más largo = nombre, numérica con decimales = precio (no stock ni código)", () => {
    expect(detectarColumnas(TARIFA.slice(1))).toMatchObject({ cabecera: -1, producto: 2, precio: 1, metodo: "contenido" });
  });

  it("sin nada reconocible: null (entonces pregunta a la IA)", () => {
    expect(detectarColumnas([["a", "b"], ["c", "d"]])).toBeNull();
  });
});

describe("lectura de filas", () => {
  it("números en formato español y contenido del nombre (L, CL, KG, paquetes de 24U)", () => {
    expect(numeroDe("1.234,56 €")).toBe(1234.56);
    expect(numeroDe("3,59")).toBe(3.59);
    expect(numeroDe(3.593)).toBe(3.593);
    expect(contenidoDelNombre("AGUA 1,5L C6")).toEqual({ cantidad: 1.5, unidad: "l" });
    expect(contenidoDelNombre("GIN 70CL 40º")).toEqual({ cantidad: 0.7, unidad: "l" });
    expect(contenidoDelNombre("ARROZ 1KG C10")).toEqual({ cantidad: 1, unidad: "kg" });
    expect(contenidoDelNombre("TONICA 20CL 24U C1").cantidad).toBeCloseTo(4.8);
    expect(contenidoDelNombre("TORNILLO M6")).toEqual({ cantidad: null, unidad: null });
  });

  it("lineasDeHoja: una línea por fila con precio; aplica el descuento de línea", () => {
    const r = lineasDeHoja(TARIFA, detectarColumnas(TARIFA)!);
    expect(r.lineas).toHaveLength(6);
    expect(r.descartadas).toBe(1);
    expect(r.lineas[0]).toMatchObject({ producto: "ACEITE MARCAPRUEBA OLIVA 0,4º 1L C15 PET", precio: 3.45, unidad: "ud", contenido_cantidad: 1, contenido_unidad: "l" });
    const conDto = lineasDeHoja([["Producto", "Precio", "Dto"], ["Gamba", "40", "10"]], detectarColumnas([["Producto", "Precio", "Dto"]])!);
    expect(conDto.lineas[0].precio).toBe(36);
  });

  it("CSV con ; y comillas", () => {
    expect(filasDeCsv('Producto;Precio\n"Aceite; oliva";3,5\r\nAgua;0,3\n')).toEqual([["Producto", "Precio"], ["Aceite; oliva", "3,5"], ["Agua", "0,3"]]);
  });
});

describe("columnasConIA", () => {
  it("manda solo las 20 primeras filas", async () => {
    const filas: Filas = Array.from({ length: 500 }, (_, i) => [`x${i}`, `y${i}`]);
    const f = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ fila_cabecera: -1, producto: 0, precio: 1, unidad: null, formato: null, descuento: null }) } }],
      usage: {},
    }), { status: 200 })) as unknown as typeof fetch;
    const c = await columnasConIA(filas, { clave: "k", modelo: "m", parametros: {}, fetchImpl: f });
    expect(c).toMatchObject({ producto: 0, precio: 1, metodo: "ia" });
    const cuerpo = String(((f as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as { body: string }).body);
    expect(cuerpo).toMatch(/x19/);
    expect(cuerpo).not.toMatch(/x20\b/);
  });
});

describe("prefiltrarLineas", () => {
  it("se queda con lo que se compra y deja fuera el resto", () => {
    const lineas = lineasDeHoja(TARIFA, detectarColumnas(TARIFA)!).lineas;
    const c = prefiltrarLineas(lineas, COMPRAS);
    const porNombre = Object.fromEntries(c.map((x) => [lineas[x.i].producto, x]));
    expect(porNombre["ACEITE MARCAPRUEBA OLIVA 0,4º 1L C15 PET"]).toMatchObject({ producto_id: 1, confianza: "alta" });
    expect(porNombre["AGUA FUENTEFALSA 1,5L C6"]).toMatchObject({ producto_id: 2 });
    expect(porNombre["ARROZ BOMBA CAMPOSUR 1KG C10"]).toMatchObject({ producto_id: 4 });
    expect(porNombre["GIN.INVENTADO PREMIUN 70CL 40º C6"]).toMatchObject({ producto_id: 3 });
    expect(porNombre["TORNILLO GALVANIZADO M6"]).toBeUndefined();
  });

  it("una sola palabra genérica en común no basta", () => {
    const c = prefiltrarLineas([{ producto: "LICOR DE LIMON CASERO 70CL" }], COMPRAS);
    expect(c).toHaveLength(0);
  });

  it("2.000 filas en milisegundos (todo en memoria)", () => {
    const muchas = Array.from({ length: 2000 }, (_, i) => ({ producto: i % 2 ? `ARTICULO RARO ${i}` : "AGUA FUENTEFALSA 1,5L C6" }));
    const t = Date.now();
    const c = prefiltrarLineas(muchas, COMPRAS);
    expect(Date.now() - t).toBeLessThan(1500);
    expect(c).toHaveLength(1000);
  });

  it("palabras: sin acentos, sin formatos ni relleno, plural fuera", () => {
    expect(palabrasDe("Tónicas de LIMÓN 20CL C24 PET")).toEqual(["tonica", "limon"]);
  });
});

describe("confirmarParejas (paso 2: la IA mira producto y formato)", () => {
  const lineas = [
    { producto: "ANCHOAS CANTABRICO LATA 50GR" },
    { producto: "ANCHOAS CANTABRICO LATA 500GR" },
    { producto: "ANCHOAS EN SALAZON GRANEL" },
  ];
  const op = (id: number, c: string) => ({ producto_id: id, producto_catalogo: c, nombre_compra: c.toUpperCase(), cobertura: 1, similitud: 0.9, trigramas: 0.8 });
  const cands = lineas.map((_, i) => ({
    i, producto_id: 9, producto_catalogo: "Anchoas Cantábrico 50 g", cobertura: 1, similitud: 0.9, confianza: "alta" as const,
    opciones: [op(9, "Anchoas Cantábrico 50 g")],
  }));
  const respuesta = (parejas: unknown[]) => vi.fn(async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ parejas }) } }], usage: { prompt_tokens: 100, completion_tokens: 20 },
  }), { status: 200 })) as unknown as typeof fetch;

  it("mismo formato se compara; otro tamaño queda «formato_distinto» con el motivo; otro producto sale", async () => {
    const f = respuesta([
      { id: 0, opcion: 1, decision: "mismo_formato", motivo: "" },
      { id: 1, opcion: 1, decision: "formato_distinto", motivo: "lata 500 g vs 50 g" },
      { id: 2, opcion: null, decision: "otro_producto", motivo: "salazon a granel" },
    ]);
    const usos: unknown[] = [];
    const r = await confirmarParejas(lineas, cands, { clave: "k", fetchImpl: f, alUsar: (u) => usos.push(u) });
    expect(r.candidatas.map((c) => [c.i, c.confianza])).toEqual([[0, "alta"], [1, "formato_distinto"]]);
    expect(r.candidatas[1].nota).toBe("lata 500 g vs 50 g");
    expect(r.rechazos.map((x) => x.decision)).toEqual(["formato_distinto", "otro_producto"]);
    expect(usos).toHaveLength(1);
    const cuerpo = JSON.parse(String(((f as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as { body: string }).body));
    expect(cuerpo.model).toBe(MODELO_CONFIRMAR);
  });

  it("en lotes de 40 en paralelo; si un lote falla, sus líneas salen sin confirmar (nunca «alta»)", async () => {
    const muchas = Array.from({ length: 90 }, (_, i) => ({ producto: `X ${i}` }));
    const c90 = muchas.map((_, i) => ({ ...cands[0], i }));
    let n = 0;
    const f = vi.fn(async () => {
      n++;
      if (n === 2) return new Response("error", { status: 500 });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ parejas: muchas.map((_, i) => ({ id: i, opcion: 1, decision: "mismo_formato", motivo: "" })) }) } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await confirmarParejas(muchas, c90, { clave: "k", fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(3);
    expect(r.lotesFallidos).toBe(1);
    expect(r.candidatas.filter((c) => c.confianza === "alta")).toHaveLength(50);
    expect(r.candidatas.filter((c) => c.nota === "sin confirmar")).toHaveLength(40);
  });
});
