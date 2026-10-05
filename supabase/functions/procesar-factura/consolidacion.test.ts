import { describe, expect, it } from "vitest";
import {
  consolidar,
  mismaFila,
  prepararDocumentoConsolidado,
  similitudNombre,
  solapeFranjas,
} from "./consolidacion.ts";
import { esCifCliente, normalizarDatos } from "./extraccion.ts";
import type { LineaPagina, PaginaCerrada, ResultadoPagina } from "./pagina.ts";
import { LUGA_FILAS, LUGA_FILAS_P1, LUGA_SUMA, type FilaLuga } from "./fixtures/luga-ml101511.ts";

// ─── Constructores de piezas simuladas ──────────────────────────────────────

function linea(f: Partial<LineaPagina> & { nombre: string }): LineaPagina {
  return {
    cantidad: 1,
    unidad: "ud",
    peso_kg: null,
    base_precio: "por_unidad",
    precio_unitario: null,
    total: null,
    bonificada: false,
    importe_literal: null,
    albaran_ref: null,
    es_fila_arrastre: false,
    partida: "no",
    ...f,
  };
}

const deLuga = (f: FilaLuga, conAlbaran = true): LineaPagina =>
  linea({
    nombre: f.nombre,
    cantidad: f.cantidad,
    peso_kg: f.peso_kg,
    precio_unitario: f.precio_unitario,
    total: f.total,
    importe_literal: f.total.toFixed(2),
    albaran_ref: conAlbaran ? f.albaran_ref : null,
  });

function resultado(lineas: LineaPagina[], extra: Partial<ResultadoPagina> = {}): ResultadoPagina {
  return {
    pie: {
      total_literal: null, subtotal_literal: null, iva_literal: null, subtotal: null, iva: null, total: null,
      tabla_totales_vacia: false,
    },
    pagina_visible: { literal: null, numero_impreso: null, total_impreso: null },
    cabecera_visible: {
      titulo_literal: null, tipo: null, proveedor: null, cif: null, numero_documento: null,
      numero_etiqueta_literal: null, fecha: null, fecha_literal: null,
    },
    sin_importes: false,
    formato_numerico: { formato: "en", ejemplo_literal: "1,547.26" },
    columnas: [],
    arrastre_entrada: { presente: false, literal: null, importe: null },
    primera_fila: { texto_literal: lineas[0]?.nombre ?? null, partida_desde_pagina_anterior: false },
    filas_tabla: lineas.length,
    lineas,
    ultima_fila: { texto_literal: lineas[lineas.length - 1]?.nombre ?? null, continua_en_pagina_siguiente: false },
    arrastre_salida: { presente: false, literal: null, importe: null },
    albaran_abierto_al_final: { ref: null, fecha_literal: null },
    continua_en_otra_pagina: false,
    observaciones: null,
    resumen: null,
    ...extra,
  };
}

function pieza(
  numero: number,
  r: ResultadoPagina | null,
  o: Partial<PaginaCerrada> = {},
): PaginaCerrada {
  return {
    pagina_id: 100 + numero,
    numero,
    pieza: "pagina",
    pagina_doc: numero,
    franja: null,
    estado: r ? "completada" : "fallida",
    resultado: r,
    recuento: r ? { filas_tabla: r.lineas.filter((l) => !l.es_fila_arrastre).length } : null,
    verificacion_pie: null,
    relecturas: 0,
    ...o,
  };
}

const cabeceraLugaP2 = {
  titulo_literal: "FACTURA",
  tipo: "factura" as const,
  proveedor: "LUGA SABORES S.L.",
  cif: "B-54529045",
  numero_documento: "ML/101511",
  numero_etiqueta_literal: "N. Factura:",
  fecha: "2025-12-31",
  fecha_literal: "31/12/25",
};

/** Luga en dos páginas tal como las leería un modelo perfecto. */
function lugaPorPaginas(): PaginaCerrada[] {
  const p1 = LUGA_FILAS.slice(0, LUGA_FILAS_P1).map((f) => deLuga(f));
  // Las 8 primeras de la p2 cuelgan de V/ 781.316 sin repetir su cabecera.
  const p2 = LUGA_FILAS.slice(LUGA_FILAS_P1).map((f, i) => deLuga(f, i >= 8));
  return [
    pieza(1, resultado(p1, {
      cabecera_visible: { ...resultado([]).cabecera_visible, numero_documento: "V/774.077", numero_etiqueta_literal: "Albaranes:" },
      pie: { ...resultado([]).pie, tabla_totales_vacia: true },
      albaran_abierto_al_final: { ref: "V/ 781.316", fecha_literal: "24/12/25" },
      continua_en_otra_pagina: true,
      pagina_visible: { literal: "Pág. 1/2", numero_impreso: 1, total_impreso: 2 },
    })),
    pieza(2, resultado(p2, {
      cabecera_visible: cabeceraLugaP2,
      pagina_visible: { literal: "Pág. 2/2", numero_impreso: 2, total_impreso: 2 },
    })),
  ];
}

/** Luga cortada en franjas con solape: cada franja repite las `solape` últimas
 *  filas de la anterior. `mutar` permite leer distinto una fila repetida. */
function lugaPorFranjas(
  cortes: number[],
  solape: number,
  mutar?: (franja: number, fila: LineaPagina, indiceGlobal: number) => LineaPagina | null,
): PaginaCerrada[] {
  const piezas: PaginaCerrada[] = [];
  let ini = 0;
  cortes.forEach((fin, k) => {
    const desde = k === 0 ? 0 : Math.max(0, ini - solape);
    const filas: LineaPagina[] = [];
    for (let g = desde; g < fin; g++) {
      // En la p2, las 8 primeras filas no traen albarán impreso, salvo que la
      // franja vea la cabecera del albarán (aquí: nunca, como en la captura).
      const conAlb = !(g >= LUGA_FILAS_P1 && g < LUGA_FILAS_P1 + 8);
      let l: LineaPagina | null = deLuga(LUGA_FILAS[g], conAlb);
      if (mutar) l = mutar(k + 1, l, g);
      if (l) filas.push(l);
    }
    const contiene = (a: number, b: number) => desde <= a && b < fin;
    piezas.push(pieza(k + 1, resultado(filas, {
      cabecera_visible: contiene(LUGA_FILAS_P1, LUGA_FILAS_P1)
        ? cabeceraLugaP2
        : resultado([]).cabecera_visible,
      pie: contiene(LUGA_FILAS_P1 - 1, LUGA_FILAS_P1 - 1)
        ? { ...resultado([]).pie, tabla_totales_vacia: true }
        : resultado([]).pie,
    }), { pieza: "franja", pagina_doc: 1, franja: k + 1 }));
    ini = fin;
  });
  return piezas;
}

const suma = (ls: { total: number | null }[]) => Math.round(ls.reduce((a, l) => a + (l.total ?? 0), 0) * 100) / 100;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("consolidar · Luga ML/101511 por páginas", () => {
  it("fixture perfecto: 54 filas, suma 3.787,53, factura, albarán heredado, sin avisos espurios", () => {
    const c = consolidar(lugaPorPaginas());
    expect(c.documento.productos).toHaveLength(54);
    expect(suma(c.documento.productos)).toBe(LUGA_SUMA);
    expect(c.documento.tipo).toBe("factura");
    expect(c.documento.numero_documento).toBe("ML/101511");
    expect(c.documento.cif).toBe("B-54529045");
    expect(c.stats.duplicados_frontera).toBe(0);
    expect(c.stats.albaran_heredado).toEqual([{ pieza: 2, albaran_ref: "V/ 781.316", lineas: 8 }]);
    expect(c.documento.productos.filter((l) => l.albaran_ref === "V/ 781.316")).toHaveLength(10);
    expect(c.documento.productos.map((l) => l.orden)).toEqual([...Array(54).keys()]);
    expect(c.documento.productos[35].pagina).toBe(1);
    expect(c.documento.productos[36].pagina).toBe(2);
    expect(c.alertas).toEqual([]);
    expect(c.relecturas).toEqual([]);

    const listo = prepararDocumentoConsolidado(c);
    expect(listo.datos.total).toBe(LUGA_SUMA);
    expect(listo.totalOrigen).toBe("deducido");
    expect(listo.datos.productos).toHaveLength(54);
    expect(listo.alertasPrevias.map((a) => a.codigo)).toEqual(["total_deducido"]);
  });

  it("repetidos no contiguos (NATOP, ESPINAS…) se conservan todos", () => {
    const c = consolidar(lugaPorPaginas());
    const natop = c.documento.productos.filter((l) => /^NATOP/.test(l.nombre));
    expect(natop.length).toBe(LUGA_FILAS.filter((f) => /^NATOP/.test(f.nombre)).length);
    expect(natop.length).toBeGreaterThan(1);
  });

  it("contador p2 = 18 y extraídas 12 → recuento_filas_discordante alta + relectura de p2; ronda 1 ya no pide", () => {
    const piezas = lugaPorPaginas();
    piezas[1].resultado!.lineas = piezas[1].resultado!.lineas.slice(0, 12);
    piezas[1].recuento = { filas_tabla: 18 };
    const c = consolidar(piezas);
    const a = c.alertas.find((x) => x.codigo === "recuento_filas_discordante");
    expect(a?.severidad).toBe("alta");
    expect(c.relecturas.map((r) => r.pagina_id)).toEqual([102]);
    const listo = prepararDocumentoConsolidado(c);
    expect(listo.datos.total).toBeNull();
    expect(listo.alertasPrevias.map((x) => x.codigo)).toContain("total_no_deducible");

    const c2 = consolidar(piezas, 1);
    expect(c2.relecturas).toEqual([]);
  });

  it("orden de subida invertido con numeración impresa completa → reordena y avisa", () => {
    const [p1, p2] = lugaPorPaginas();
    const c = consolidar([{ ...p2, numero: 1 }, { ...p1, numero: 2 }]);
    expect(c.stats.reordenado).toBe(true);
    expect(c.alertas.map((a) => a.codigo)).toContain("orden_paginas_discordante");
    expect(c.documento.productos[0].nombre).toBe(LUGA_FILAS[0].nombre);
    expect(suma(c.documento.productos)).toBe(LUGA_SUMA);
  });

  it("página que falta («Pág 2 de 3» con 2 subidas) → pagina_faltante alta y total no deducible", () => {
    const piezas = lugaPorPaginas();
    piezas[1].resultado!.pagina_visible = { literal: "Pág. 2/3", numero_impreso: 2, total_impreso: 3 };
    const c = consolidar(piezas);
    expect(c.alertas.find((a) => a.codigo === "pagina_faltante")?.severidad).toBe("alta");
    expect(prepararDocumentoConsolidado(c).datos.total).toBeNull();
  });

  it("página fallida → se consolida sin ella con pagina_no_procesada alta", () => {
    const [p1, p2] = lugaPorPaginas();
    const c = consolidar([p1, { ...p2, estado: "fallida", resultado: null }]);
    expect(c.documento.productos).toHaveLength(36);
    expect(c.alertas.find((a) => a.codigo === "pagina_no_procesada")?.severidad).toBe("alta");
    // sin número de factura con etiqueta buena, pero hay uno de p1 (Albaranes:) → se guarda con él
    expect(prepararDocumentoConsolidado(c).datos.total).toBeNull();
  });

  it("cabeceras contradictorias → aviso con los valores", () => {
    const piezas = lugaPorPaginas();
    piezas[0].resultado!.cabecera_visible = { ...cabeceraLugaP2, cif: "B-99999999", titulo_literal: null };
    const c = consolidar(piezas);
    const a = c.alertas.find((x) => x.codigo === "cabecera_contradictoria");
    expect(a).toBeTruthy();
    expect(c.documento.cif).toBe("B-99999999");
  });

  it("pieza de OTRO documento (nº distinto con etiqueta de factura) → aviso alto y sin deducción", () => {
    const piezas = lugaPorPaginas();
    piezas[0].resultado!.cabecera_visible = { ...cabeceraLugaP2, numero_documento: "ML/999999" };
    const c = consolidar(piezas);
    expect(c.alertas.map((a) => a.codigo)).toContain("pagina_de_otro_documento");
    expect(prepararDocumentoConsolidado(c).datos.total).toBeNull();
  });
});

describe("consolidar · fronteras entre páginas", () => {
  const A = linea({ nombre: "ACEITE OLIVA 5L", cantidad: 2, precio_unitario: 30, total: 60 });
  const B = linea({ nombre: "SAL GORDA 1KG", cantidad: 3, precio_unitario: 1, total: 3 });
  const C = linea({ nombre: "HARINA 1KG", cantidad: 5, precio_unitario: 1.2, total: 6 });
  const D = linea({ nombre: "AZUCAR 1KG", cantidad: 1, precio_unitario: 1.5, total: 1.5 });
  const cab = { ...resultado([]).cabecera_visible, numero_documento: "F-1", numero_etiqueta_literal: "Factura nº" };

  it("fila partida (descripción arriba, números abajo) → una sola fila", () => {
    const p1 = resultado([A, linea({ nombre: "QUESO MANCHEGO", cantidad: 0, partida: "continua_en_siguiente" })], { cabecera_visible: cab });
    const p2 = resultado([linea({ nombre: "CURADO 3KG", cantidad: 1, precio_unitario: 45, total: 45, partida: "continua_de_anterior" }), B]);
    const c = consolidar([pieza(1, p1), pieza(2, p2)]);
    expect(c.documento.productos.map((l) => l.nombre)).toEqual(["ACEITE OLIVA 5L", "QUESO MANCHEGO CURADO 3KG", "SAL GORDA 1KG"]);
    expect(c.documento.productos[1].total).toBe(45);
    expect(c.stats.filas_partidas_unidas).toBe(1);
  });

  it("fila partida con números distintos en las dos mitades → no se une y avisa", () => {
    const p1 = resultado([A, linea({ nombre: "QUESO", cantidad: 1, total: 10, partida: "continua_en_siguiente" })], { cabecera_visible: cab });
    const p2 = resultado([linea({ nombre: "CURADO", cantidad: 1, total: 12 }), B]);
    const c = consolidar([pieza(1, p1), pieza(2, p2)]);
    expect(c.documento.productos).toHaveLength(4);
    expect(c.alertas.map((a) => a.codigo)).toContain("fila_partida_ambigua");
  });

  it("fotos que se solapan 2 filas → se quitan las repetidas con aviso", () => {
    const c = consolidar([pieza(1, resultado([A, B, C], { cabecera_visible: cab })), pieza(2, resultado([B, C, D]))]);
    expect(c.documento.productos.map((l) => l.nombre)).toEqual([A.nombre, B.nombre, C.nombre, D.nombre]);
    expect(c.alertas.map((a) => a.codigo)).toContain("duplicado_frontera_eliminado");
  });

  it("1 fila repetida en la frontera SIN ancla textual → se conservan las dos", () => {
    const p2 = resultado([C, D], { primera_fila: { texto_literal: null, partida_desde_pagina_anterior: false } });
    const c = consolidar([pieza(1, resultado([A, B, C], { cabecera_visible: cab, ultima_fila: { texto_literal: null, continua_en_pagina_siguiente: false } })), pieza(2, p2)]);
    expect(c.documento.productos).toHaveLength(5);
  });

  it("«Suma y sigue» / «Suma anterior» fuera de las líneas; arrastre coherente sin aviso", () => {
    const p1 = resultado([A, B, linea({ nombre: "Suma y sigue", cantidad: 0, total: 63, es_fila_arrastre: true })], {
      cabecera_visible: cab, arrastre_salida: { presente: true, literal: "Suma y sigue 63.00", importe: 63 },
    });
    const p2 = resultado([linea({ nombre: "Suma anterior", cantidad: 0, total: 63 }), C], {
      arrastre_entrada: { presente: true, literal: "Suma anterior 63.00", importe: 63 },
    });
    const c = consolidar([pieza(1, p1), pieza(2, p2, { recuento: { filas_tabla: 1 } })]);
    expect(c.documento.productos.map((l) => l.nombre)).toEqual([A.nombre, B.nombre, C.nombre]);
    expect(c.stats.filas_arrastre_quitadas).toBe(2);
    expect(c.alertas.map((a) => a.codigo)).not.toContain("arrastre_inconsistente");
  });

  it("página con 0 filas y contador 0 → válida; con contador > 0 → pide relectura", () => {
    const pie = { ...resultado([]).pie, total_literal: "10.50", total: 10.5 };
    const ok = consolidar([pieza(1, resultado([A], { cabecera_visible: cab })), pieza(2, resultado([], { pie }), { recuento: { filas_tabla: 0 } })]);
    expect(ok.alertas).toEqual([]);
    const mal = consolidar([pieza(1, resultado([A], { cabecera_visible: cab })), pieza(2, resultado([], { pie }), { recuento: { filas_tabla: 3 } })]);
    expect(mal.relecturas.map((r) => r.pagina_id)).toEqual([102]);
    expect(mal.alertas.map((a) => a.codigo)).toContain("recuento_filas_discordante");
  });

  it("sin número de documento en ninguna página → error claro al preparar", () => {
    const c = consolidar([pieza(1, resultado([A])), pieza(2, resultado([B]))]);
    expect(() => prepararDocumentoConsolidado(c)).toThrow(/número de factura/);
  });
});

describe("consolidar · Luga en FRANJAS con solape", () => {
  it("franjas perfectas con 3 filas de solape → 54 filas, suma 3.787,53, sin relecturas", () => {
    const c = consolidar(lugaPorFranjas([12, 24, 36, 46, 54], 3));
    expect(c.documento.productos).toHaveLength(54);
    expect(suma(c.documento.productos)).toBe(LUGA_SUMA);
    expect(c.stats.duplicados_solape_franjas).toBe(12);
    expect(c.documento.tipo).toBe("factura");
    expect(c.documento.numero_documento).toBe("ML/101511");
    expect(c.documento.productos.filter((l) => l.albaran_ref === "V/ 781.316")).toHaveLength(10);
    const listo = prepararDocumentoConsolidado(c);
    expect(listo.datos.total).toBe(LUGA_SUMA);
    expect(listo.totalOrigen).toBe("deducido");
  });

  it("kilos y bultos: las 54 se guardan cuadrando (19 por kilo con sus uds, 35 en ud) y sin avisos de cantidad", () => {
    const c = consolidar(lugaPorFranjas([12, 24, 36, 46, 54], 3));
    const listo = prepararDocumentoConsolidado(c);
    const ps = listo.datos.productos;
    expect(ps).toHaveLength(54);
    const tol = (q: number) => Math.max(0.05, Math.abs(q) * 0.005 + 0.01);
    expect(ps.filter((p) => Math.abs(p.cantidad * (p.precio_unitario as number) - (p.total as number)) > tol(p.cantidad)))
      .toEqual([]);
    expect(ps.filter((p) => p.unidad === "kg").map((p) => p.bultos)).toEqual(
      [1, 12, 1, 24, 1, 12, 1, 3, 1, 12, 1, 1, 1, 12, 3, 8, 1, 12, 1],
    );
    expect(ps.filter((p) => p.unidad === "ud" && p.bultos === null)).toHaveLength(35);
    expect(ps[2]).toMatchObject({ cantidad: 24, unidad: "kg", bultos: 12, precio_unitario: 4.14, total: 99.46 });
    expect(ps[17]).toMatchObject({ cantidad: 15, unidad: "kg", bultos: 3, total: 87 });
    expect(ps[44]).toMatchObject({ cantidad: 75.48, unidad: "kg", bultos: 8, total: 1547.26 });
    expect(ps[1]).toMatchObject({ cantidad: 2, unidad: "kg", bultos: 1, total: 8.4 });
    expect(ps[4]).toMatchObject({ cantidad: 3, unidad: "ud", bultos: null }); // LAMINAS: por unidad
    expect(listo.alertasPrevias.map((a) => a.codigo)).toEqual(["total_deducido"]);
  });

  it("dedup DIFUSA: la copia repetida trae un dígito distinto y otro nombre abreviado → se quita igual", () => {
    const c = consolidar(lugaPorFranjas([12, 24, 36, 46, 54], 3, (franja, l, g) => {
      // En la franja siguiente, la primera fila del solape se lee con un
      // céntimo distinto y el nombre recortado.
      if (franja === 2 && g === 9) return { ...l, total: (l.total ?? 0) + 0.01, nombre: l.nombre.slice(0, 18) };
      if (franja === 3 && g === 22) return { ...l, cantidad: l.cantidad + 1 };
      return l;
    }));
    expect(c.documento.productos).toHaveLength(54);
    expect(suma(c.documento.productos)).toBe(LUGA_SUMA);
  });

  it("hueco en el solape (una franja da por cortada una fila que la otra ve) → ni pierde ni duplica", () => {
    const c = consolidar(lugaPorFranjas([12, 24, 36, 46, 54], 3, (franja, l, g) => {
      if (franja === 1 && g === 11) return null; // la franja 1 no ve la última (cortada)
      if (franja === 4 && g === 34) return null; // la franja 4 se salta la 2ª del solape
      return l;
    }));
    expect(c.documento.productos).toHaveLength(54);
    expect(suma(c.documento.productos)).toBe(LUGA_SUMA);
  });

  it("filas repetidas consecutivas DENTRO de una franja no se tocan", () => {
    const x = linea({ nombre: "CAFE GRANO 1KG", cantidad: 2, precio_unitario: 15, total: 30 });
    const y = linea({ nombre: "LECHE 1L", cantidad: 6, precio_unitario: 1, total: 6 });
    const cab = { ...resultado([]).cabecera_visible, numero_documento: "T-9", numero_etiqueta_literal: "Factura" };
    const f1 = pieza(1, resultado([x, x, y], { cabecera_visible: cab }), { pieza: "franja", pagina_doc: 1, franja: 1 });
    const f2 = pieza(2, resultado([y, x]), { pieza: "franja", pagina_doc: 1, franja: 2 });
    const c = consolidar([f1, f2]);
    expect(c.documento.productos.map((l) => l.nombre)).toEqual([x.nombre, x.nombre, y.nombre, x.nombre]);
  });

  it("una entrega distinta del mismo producto justo tras el solape (total muy distinto) no se confunde", () => {
    const a = linea({ nombre: "NATOP 2L", cantidad: 12, precio_unitario: 4.14, total: 99.46, albaran_ref: "V/1" });
    const b = linea({ nombre: "NATOP 2L", cantidad: 6, precio_unitario: 4.14, total: 49.68, albaran_ref: "V/2" });
    const cab = { ...resultado([]).cabecera_visible, numero_documento: "T-9", numero_etiqueta_literal: "Factura" };
    const c = consolidar([
      pieza(1, resultado([a], { cabecera_visible: cab }), { pieza: "franja", pagina_doc: 1, franja: 1 }),
      pieza(2, resultado([b]), { pieza: "franja", pagina_doc: 1, franja: 2 }),
    ]);
    expect(c.documento.productos).toHaveLength(2);
  });
});

describe("comparación difusa de filas", () => {
  it("similitudNombre tolera una letra mal leída", () => {
    expect(similitudNombre("MAIZENA EXPRESS OSCURA", "MAIZENA EXPRES OSCURA")).toBeGreaterThan(0.9);
    expect(similitudNombre("MAIZENA EXPRESS OSCURA", "PERDIZ ESCABECHE")).toBeLessThan(0.3);
  });
  it("mismaFila exige algún número igual y albaranes compatibles", () => {
    const a = linea({ nombre: "NATOP 2L", cantidad: 12, total: 99.46, albaran_ref: "V/ 774.077" });
    expect(mismaFila(a, { ...a, total: 99.48 })).toBe(true);
    expect(mismaFila(a, { ...a, albaran_ref: "V/ 775.630" })).toBe(false);
    expect(mismaFila(a, { ...a, cantidad: 3, total: 20 })).toBe(false);
  });
  it("solapeFranjas devuelve [] sin coincidencias", () => {
    const a = linea({ nombre: "A1", cantidad: 1, total: 1 });
    const b = linea({ nombre: "ZZZZ", cantidad: 9, total: 9 });
    expect(solapeFranjas([a], [b])).toEqual([]);
  });
});

describe("cliente ≠ proveedor (caso Salazones Garre F/25011959, factura 39)", () => {
  it("normalizarDatos descarta el CIF del cliente B54583356 en cualquier formato", () => {
    for (const cif of ["B54583356", "B-54583356", "b 54.583.356"]) {
      expect(esCifCliente(cif)).toBe(true);
      const d = normalizarDatos({ numero_documento: "F / 25011959", tipo: "factura", cif, proveedor: "SALAZONES GARRE", productos: [] });
      expect(d.cif).toBeNull();
    }
    expect(normalizarDatos({ numero_documento: "X", cif: "B-73028474", productos: [] }).cif).toBe("B-73028474");
  });
  it("normalizarDatos no acepta al restaurante como proveedor", () => {
    expect(normalizarDatos({ numero_documento: "X", proveedor: "MASIDE 2011, S.L.U", productos: [] }).proveedor).toBeNull();
    expect(normalizarDatos({ numero_documento: "X", proveedor: "Salazones Garre", productos: [] }).proveedor).toBe("Salazones Garre");
  });
  it("la consolidación salta el CIF del cliente y usa el del emisor de otra pieza", () => {
    const cabCliente = {
      ...resultado([]).cabecera_visible, cif: "B54583356", numero_documento: "F / 25011959", numero_etiqueta_literal: "Factura",
    };
    const cabProv = { ...resultado([]).cabecera_visible, cif: "B-73028474" };
    const l = linea({ nombre: "BACALAO", cantidad: 1, precio_unitario: 10, total: 10 });
    const c = consolidar([pieza(1, resultado([l], { cabecera_visible: cabCliente })), pieza(2, resultado([], { cabecera_visible: cabProv }), { recuento: { filas_tabla: 0 } })]);
    expect(c.documento.cif).toBe("B-73028474");
  });
});

describe("consolidar · defensas vistas en el banco real (05-oct-2026)", () => {
  const cab = { ...resultado([]).cabecera_visible, numero_documento: "ML/101511", numero_etiqueta_literal: "N. Factura:" };
  const fr = (n: number, ls: LineaPagina[], extra: Partial<ResultadoPagina> = {}) =>
    pieza(n, resultado(ls, extra), { pieza: "franja", pagina_doc: 1, franja: n });

  it("fila de arriba leída con otro nombre pero mismo importe (FR.COSTILLA → «FR.COM. BUENAPINTA») cuenta como repetida", () => {
    const [a, b, c, d, e] = LUGA_FILAS.slice(5, 10).map((f) => deLuga(f));
    const mal = { ...c, nombre: "FR.COM. BUENAPINTA- COCO BLA" };
    const out = consolidar([fr(1, [a, b, c, d], { cabecera_visible: cab }), fr(2, [mal, d, e])]);
    expect(out.documento.productos.map((l) => l.total)).toEqual([a.total, b.total, c.total, d.total, e.total]);
  });

  it("bucle del modelo (4+ filas idénticas repetidas en la misma franja) → se quitan con aviso", () => {
    const ls = LUGA_FILAS.slice(20, 26).map((f) => deLuga(f));
    const conBucle = [...ls, ...ls.slice(1, 6)];
    const out = consolidar([fr(1, conBucle, { cabecera_visible: cab }), fr(2, [deLuga(LUGA_FILAS[26])])]);
    expect(out.documento.productos).toHaveLength(7);
    expect(out.alertas.map((x) => x.codigo)).toContain("bloque_repetido_eliminado");
    expect(out.stats.filas_bucle_quitadas).toBe(5);
  });

  it("la fila fantasma «PRODUCTO NO LEGIBLE / CONTINÚA» de una franja no es una fila", () => {
    const ls = LUGA_FILAS.slice(0, 4).map((f) => deLuga(f));
    const fantasma = linea({ nombre: "PRODUCTO NO LEGIBLE / CONTINUA", cantidad: 1 });
    const out = consolidar([fr(1, [...ls.slice(0, 3), fantasma], { cabecera_visible: cab }), fr(2, [ls[2], ls[3]])]);
    expect(out.documento.productos.map((l) => l.nombre)).toEqual(ls.map((l) => l.nombre));
  });

  it("pie partido entre dos franjas: base en una, total en la siguiente → se fusiona sin aviso", () => {
    const l = linea({ nombre: "CAFETERA", cantidad: 1, precio_unitario: 1322.08, total: 1322.08 });
    const pieBase = { ...resultado([]).pie, subtotal: 1322.08, subtotal_literal: "1.322,08" };
    const pieTotal = { ...resultado([]).pie, total: 1599.72, total_literal: "1.599,72", iva: 277.64, iva_literal: "277,64" };
    const out = consolidar([
      fr(1, [l], { cabecera_visible: { ...cab, numero_documento: "VTAF/25-06865", numero_etiqueta_literal: "Factura nº" } }),
      fr(2, [], { pie: pieBase }),
      fr(3, [], { pie: pieTotal }),
      fr(4, []),
    ]);
    expect(out.documento.subtotal).toBe(1322.08);
    expect(out.documento.total).toBe(1599.72);
    expect(out.alertas.map((a) => a.codigo)).not.toContain("pie_fuera_de_ultima_pagina");
    expect(out.alertas.map((a) => a.codigo)).not.toContain("cabecera_contradictoria");
  });

  it("la fecha sale de la pieza de la cabecera (Luga: no la «Fecha Emisión» del pie de la p1)", () => {
    const p1 = fr(1, [deLuga(LUGA_FILAS[0])], { cabecera_visible: { ...resultado([]).cabecera_visible, fecha: "2026-01-02" } });
    const p2 = fr(2, [deLuga(LUGA_FILAS[1])], { cabecera_visible: { ...cab, fecha: "2025-12-31" } });
    expect(consolidar([p1, p2]).documento.fecha).toBe("2025-12-31");
  });

  it("la verdad de campo de Luga no tiene ningún bloque repetido de 4 filas (no hay falsos positivos)", () => {
    const out = consolidar([fr(1, LUGA_FILAS.map((f) => deLuga(f)), { cabecera_visible: cab })]);
    expect(out.stats.filas_bucle_quitadas).toBe(0);
    expect(out.documento.productos).toHaveLength(54);
  });
});
