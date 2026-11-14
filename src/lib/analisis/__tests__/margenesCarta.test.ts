import { describe, expect, it } from "vitest";
import {
  CONFIG_POR_DEFECTO,
  avisoCompraMasNueva,
  dominioLog,
  explicacion,
  fechaFactura,
  marcasLog,
  normalizarCompras,
  normalizarFactura,
  normalizarMargenes,
  pctDeMultiplicador,
  pctDeMultiplicadorPeso,
  platosBorrador,
  problemas,
  precioFactura,
  puntosDispersion,
  razon,
  resumenFiable,
  textoFactura,
  textoMediana,
  textoMedianaIngrediente,
  textoPctCoste,
} from "../margenesCarta";

// Forma del jsonb de margenes_carta (datos reales de la demo, recortados).
const RPC = {
  hoy: "2026-11-07",
  config: { coste_max_plato_pct: 35, multiplicador_min_vino: 2.5, subida_coste_pct: 10, iva_pct: 10, dias_referencia: 90 },
  resumen: {
    platos: { total: 3, con_datos: 2, food_cost_medio: 43.2, food_cost_mediana: 43.2, en_rojo: 1, sube_coste: 1, sin_datos: 1, revisados: 0 },
    vinos: { total: 1, con_datos: 1, multiplicador_medio: 1.37, multiplicador_mediana: 1.37, en_rojo: 1, sube_coste: 0, sin_datos: 0, revisados: 0 },
  },
  platos: [
    {
      id: "p1", nombre: "Percebes", categoria: "MARISCOS", precio: 19, unidad: "100 g", gramos_venta: 100,
      venta: 17.2727, coste: 10.95, pct: 63.39, margen: 6.32, variacion_pct: null, principal: "Percebe", principal_coste: 10.95,
      origen: "estimado", revisado: false, motivo: null, banderas: ["coste_alto"],
      ingredientes: [{ id: 1, producto_id: 301, producto: "Percebe", cantidad: 100, unidad: "g", origen: "estimado", medida: "kg", eur: 109.5, coste: 10.95 }],
    },
    {
      id: "p2", nombre: "Mejillones al vapor", categoria: "MARISCOS", precio: 9.75, unidad: "Unidad", gramos_venta: null,
      venta: 8.8636, coste: 2.25, pct: 25.38, margen: 6.61, variacion_pct: 12.5, principal: "Mejillones",
      origen: "estimado", revisado: false, banderas: ["sube_coste", "otra_desconocida"],
      ingredientes: [{ id: 2, producto_id: 211, producto: "Mejillones", cantidad: 500, unidad: "g", medida: "kg", eur: 4.5, coste: 2.25 }],
    },
    { id: "p3", nombre: "Santiaguiño gallego", categoria: "MARISCOS", precio: 22, unidad: "100 g", motivo: "No hay compras de santiaguiño", banderas: ["sin_mapear"], ingredientes: [] },
    { nombre: "sin id: se descarta" },
  ],
  vinos: [
    {
      id: "v1", nombre: "Laurent‑Perrier Millésimé", categoria: "CHAMPAGNE", precio: 110, venta: 100, producto_id: 1785,
      producto: "Laurent-Perrier Millésimé 75 cl", litros: 0.75, coste: 80.4, multiplicador: 1.37, pct: 80.4, margen: 19.6,
      banderas: ["multiplicador_bajo"],
    },
  ],
};

describe("normalizarMargenes", () => {
  it("lee el jsonb y descarta lo que no sirve", () => {
    const d = normalizarMargenes(RPC);
    expect(d.platos).toHaveLength(3);
    expect(d.platos[1].banderas).toEqual(["sube_coste"]);
    expect(d.platos[0].ingredientes[0]).toMatchObject({ productoId: 301, cantidad: 100, unidad: "g", eur: 109.5 });
    expect(d.vinos[0]).toMatchObject({ tipo: "vino", multiplicador: 1.37, productoId: 1785 });
    expect(d.resumen.platos.foodCostMediana).toBe(43.2);
  });

  it("aguanta una respuesta vacía con los umbrales por defecto", () => {
    const d = normalizarMargenes(null);
    expect(d.platos).toEqual([]);
    expect(d.config).toEqual(CONFIG_POR_DEFECTO);
  });
});

describe("razon (en sencillo, 13/11/2026)", () => {
  const d = normalizarMargenes(RPC);
  it("plato: a cuánto lo vendes, lo que cuesta hacerlo y «de cada 100 € que cobras» (el % es de la venta sin IVA)", () => {
    expect(razon(d.platos[0], d.config)).toBe(
      "Percebes: Lo vendes a 19 € (17,27 € sin IVA). Hacerlo te cuesta 10,95 €. De cada 10 € que cobras, 6,34 € es lo que te cuesta en ingredientes (máximo 3,50 €).",
    );
  });
  it("el ejemplo del dueño: 24 € en carta, 8,10 € de coste → 37 € de cada 100", () => {
    const p = normalizarMargenes({ platos: [{ id: "x", nombre: "Arroz", precio: 24, venta: 21.8182, coste: 8.1, pct: 37.13, banderas: [], ingredientes: [] }] }).platos[0];
    expect(explicacion(p)).toBe("Lo vendes a 24 € (21,82 € sin IVA). Hacerlo te cuesta 8,10 €. De cada 10 € que cobras, 3,71 € es lo que te cuesta en ingredientes (máximo 3,50 €).");
  });
  it("sube el coste sin subir la carta: de factura a factura", () => {
    expect(razon(d.platos[1], d.config)).toContain("Te cuesta un 13 % más que hace 6 meses (de factura a factura) y el precio de la carta sigue igual.");
  });
  it("sin mapear: el motivo", () => {
    expect(razon(d.platos[2], d.config)).toBe("Santiaguiño gallego: No hay compras de santiaguiño.");
  });
  it("vino: lo que cuesta la botella, cuántas veces cobras lo que pagas y de cada 10 €", () => {
    expect(razon(d.vinos[0], d.config)).toBe(
      "Laurent‑Perrier Millésimé: La botella te cuesta 80,40 € y la vendes a 110 € (100,00 € sin IVA): cobras 1,37 veces lo que pagas (mínimo 2,5). " +
        "De cada 10 € que cobras, 8,04 € es lo que te cuesta la botella.",
    );
  });
  it("vino con la tienda por debajo y comprado en otro formato", () => {
    const v = normalizarMargenes({
      ...RPC,
      vinos: [{
        id: "v2", nombre: "Godeval (Magnum)", precio: 42, venta: 38.18, coste: 33.7, multiplicador: 1.13, litros: 1.5, litros_producto: 0.75,
        formato_distinto: true, en_tienda: true, precio_tienda: 29.4, venta_tienda: 24.3, multiplicador_tienda: 0.72,
        banderas: ["formato_distinto", "multiplicador_bajo", "tienda_bajo"],
      }],
    }).vinos[0];
    // Sin «pct» en los datos: el «de cada 100 €» sale del multiplicador (100 ÷ 1,13 = 88).
    expect(razon(v, { ...CONFIG_POR_DEFECTO })).toBe(
      "Godeval (Magnum): La botella te cuesta 33,70 € y la vendes a 42 € (38,18 € sin IVA): cobras 1,13 veces lo que pagas (mínimo 2,3). " +
        "De cada 10 € que cobras, 8,85 € es lo que te cuesta la botella. " +
        "En la tienda la vendes a 29,40 € (24,30 € sin IVA): cobras 0,72 veces lo que pagas (mínimo 1,5). " +
        "Coste calculado desde la botella de 75 cl (en la carta es de 1,5 l).",
    );
  });
});

describe("problemas y gráfica", () => {
  const d = normalizarMargenes(RPC);
  it("solo lo que falla, primero lo que más se pasa del umbral", () => {
    const lista = problemas(d.platos, d.config);
    expect(lista.map((p) => p.id)).toEqual(["p1", "p2"]);
  });
  it("puntos con precio y % (sin los que no tienen datos), en rojo por encima del umbral", () => {
    const puntos = puntosDispersion(d.platos, 35);
    expect(puntos).toHaveLength(2);
    expect(puntos.find((p) => p.id === "p1")?.rojo).toBe(true);
    expect(puntos.find((p) => p.id === "p2")?.rojo).toBe(false);
  });
  it("vinos sin IVA / sin IVA (20261125100000): 2,3× = 43,5 % de coste", () => {
    expect(pctDeMultiplicador(2.3)).toBeCloseTo(43.478, 2);
  });
});

describe("normalizarCompras", () => {
  it("convierte las filas en documentos para el visor", () => {
    const filas = normalizarCompras({
      filas: [
        { linea_id: 9, id: 33, fecha: "2026-10-03", proveedor: "MARISCOS X", tipo: "factura", local: "casa_tomas", total: 500, drive_url: null,
          archivo_path: "a/b.pdf", nombre_linea: "PERCEBE", cantidad: 2, unidad: "kg", importe_aportado: 220, medida: "kg", eur_base: 110, eur_ud: 110 },
        { linea_id: 10 },
      ],
    });
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ id: 33, aporta: 220, archivoPath: "a/b.pdf", eurBase: 110, tipo: "factura" });
  });
});

// ─── «Por peso» (20261115410000_margenes_por_peso) ────────────────────────
const RPC_PESO = {
  ...RPC,
  config: { ...RPC.config, multiplicador_min_peso: 2 },
  peso: [
    {
      id: "p1", nombre: "Percebes", categoria: "MARISCOS", precio: 19, unidad: "100 g", gramos_venta: 100,
      venta_kg_iva: 190, venta_kg: 172.73, producto_id: 301, producto: "Percebe", compra_kg: 110, medida: "kg", lineas: 8,
      ultimo_proveedor: "CETAREA ANGELMAR S.L.", ultima_fecha: "2026-10-03", multiplicador: 1.57, pct: 63.68, banderas: ["multiplicador_bajo"],
    },
    {
      id: "pb", nombre: "Bogavante de la ría", categoria: "MARISCOS", precio: 95, unidad: "kg", gramos_venta: 1000,
      venta_kg_iva: 95, venta_kg: 86.36, producto_id: 218, producto: "Bogavante", compra_kg: 25, multiplicador: 3.45, pct: 28.95, banderas: [],
    },
    { id: "p3", nombre: "Santiaguiño gallego", precio: 22, unidad: "100 g", gramos_venta: 100, venta_kg_iva: 220, venta_kg: 200,
      motivo: "No hay compras de santiaguiño", banderas: ["sin_mapear"] },
    { id: "pc", nombre: "Caviar", precio: 26, unidad: "10 g", gramos_venta: 10, venta_kg_iva: 2600, venta_kg: 2363.64, producto_id: 9,
      producto: "Caviar lata", motivo: "Las compras de «Caviar lata» no traen el peso (se compran por pieza o unidad)", banderas: ["sin_datos"] },
  ],
};

describe("Por peso", () => {
  const d = normalizarMargenes(RPC_PESO);
  it("lee la lista al peso y el umbral (por defecto ×2 si no viene)", () => {
    expect(d.peso).toHaveLength(4);
    expect(d.peso[0]).toMatchObject({ tipo: "peso", compraKg: 110, ventaKg: 172.73, ventaKgIva: 190, multiplicador: 1.57, ultimoProveedor: "CETAREA ANGELMAR S.L." });
    expect(d.config.multiplicadorMinPeso).toBe(2);
    expect(normalizarMargenes(RPC).config.multiplicadorMinPeso).toBe(2);
    expect(normalizarMargenes(RPC).peso).toEqual([]);
  });
  it("el porqué en €/kg, con el precio de carta", () => {
    expect(razon(d.peso[0], d.config)).toBe(
      "Percebes: Lo vendes a 190 € el kilo (172,73 € sin IVA) y el kilo te cuesta 110,00 €: cobras 1,57 veces lo que pagas (mínimo 2). " +
        "De cada 10 € que cobras, 6,37 € es lo que te cuesta comprarlo.",
    );
  });
  it("sin datos: el motivo (pieza sin peso, sin compras)", () => {
    expect(razon(d.peso[3], d.config)).toBe("Caviar: Las compras de «Caviar lata» no traen el peso (se compran por pieza o unidad).");
    expect(razon(d.peso[2], d.config)).toBe("Santiaguiño gallego: No hay compras de santiaguiño.");
  });
  it("problemas: solo los que bajan del multiplicador", () => {
    expect(problemas(d.peso, d.config).map((p) => p.id)).toEqual(["p1"]);
  });
  it("la gráfica usa el precio del kilo con IVA", () => {
    const puntos = puntosDispersion(d.peso, pctDeMultiplicadorPeso(2));
    expect(puntos.map((p) => [p.id, p.precio, p.rojo])).toEqual([["p1", 190, true], ["pb", 95, false]]);
  });
  it("las cifras de arriba: peso + vinos; los platos del borrador solo si están revisados", () => {
    const r = resumenFiable(d);
    expect(r.peso).toMatchObject({ total: 4, conDatos: 2, multiplicadorMediana: 2.51, enRojo: 1, sinDatos: 2 });
    expect(r.vinos).toMatchObject({ total: 1, conDatos: 1, multiplicadorMediana: 1.37, enRojo: 1 });
    // p1 y p3 tienen gramos de venta: el borrador es solo «Mejillones al vapor».
    expect(platosBorrador(d).map((p) => p.id)).toEqual(["p2"]);
    expect(r.borrador).toEqual({ total: 1, revisados: 0, enRojoRevisados: 0 });
  });
});

describe("eje X logarítmico", () => {
  it("las marcas llegan hasta el máximo real", () => {
    expect(marcasLog(2.5, 180)).toEqual([2, 5, 10, 20, 50, 100, 200]);
    expect(marcasLog(60, 2600)).toEqual([50, 100, 200, 500, 1000, 2000, 5000]);
    expect(dominioLog([2.5, 180])).toEqual([2, 200]);
    expect(marcasLog(0, 10)).toEqual([]);
  });
});

// ─── La última factura (20261128140000_margenes_ultima_factura) ───────────
const FACTURA = {
  linea_id: 77, id: 501, fecha: "2026-11-03", proveedor: "MAKRO", proveedor_id: 9, numero_documento: "F-123", tipo: "factura",
  local: "casa_tomas", total: 640.5, drive_url: null, archivo_path: "facturas/f-123.pdf", nombre_linea: "PERCEBE GALLEGO",
  cantidad: 2, unidad: "KG", unidad_compra: "kg", importe: 43, precio_unidad: 21.5, medida: "kg", eur_base: 21.5, iva_pct: 10, iva_origen: "linea",
};

describe("última factura", () => {
  it("normaliza la factura usada como documento del visor (y descarta la que no tiene id)", () => {
    const f = normalizarFactura(FACTURA);
    expect(f).toMatchObject({ id: 501, proveedor: "MAKRO", numero: "F-123", tipo: "factura", archivoPath: "facturas/f-123.pdf", aporta: 43, lineaId: 77, unidadCompra: "kg", precioUnidad: 21.5, eurBase: 21.5 });
    expect(normalizarFactura({ proveedor: "X" })).toBeNull();
    expect(normalizarFactura(null)).toBeNull();
  });
  it("precio en la unidad de la factura, con el €/kg entre paréntesis si aporta", () => {
    expect(precioFactura({ unidadCompra: "kg", precioUnidad: 21.5, medida: "kg", eurBase: 21.5 })).toBe("21,50 €/kg");
    expect(precioFactura({ unidadCompra: "caja", precioUnidad: 29.52, medida: "kg", eurBase: 8.2 })).toBe("29,52 € la caja (8,20 €/kg)");
    expect(precioFactura({ unidadCompra: "botella", precioUnidad: 12, medida: "l", eurBase: 16 })).toBe("12,00 € la botella (16,00 €/l)");
    expect(precioFactura({ unidadCompra: "ud", precioUnidad: 3.2, medida: null, eurBase: null })).toBe("3,20 € la unidad");
  });
  it("«Makro, 03/11 · 21,50 €/kg»; de otro año, con el año", () => {
    const f = normalizarFactura(FACTURA)!;
    expect(textoFactura(f, "2026-11-13")).toBe("MAKRO, 03/11 · 21,50 €/kg");
    expect(fechaFactura("2025-12-30", "2026-11-13")).toBe("30/12/25");
    expect(fechaFactura(null)).toBe("sin fecha");
  });
  it("lee la factura, la mediana, la anterior y hace 6 meses de vinos, al peso, platos e ingredientes", () => {
    const d = normalizarMargenes({
      coste_desde: "ultima_factura",
      platos: [{ id: "p", nombre: "Plato", precio: 22, venta: 20, coste: 7, coste_mediana: 6, pct: 35, pct_mediana: 30, factura: FACTURA, banderas: [],
        ingredientes: [{ producto_id: 1, producto: "Percebe", cantidad: 100, unidad: "g", medida: "kg", eur: 21.5, eur_mediana: 20.1, eur_anterior: 19.8,
          fecha_anterior: "2026-10-12", proveedor_anterior: "MARISCOS B", fecha_6m: "2026-05-01", factura: FACTURA }] }],
      vinos: [{ id: "v", nombre: "Vino", coste: 12, coste_mediana: 10.5, multiplicador_mediana: 2.86, coste_anterior: 9, fecha_anterior: "2026-09-01", factura: FACTURA, banderas: [] }],
      peso: [{ id: "k", nombre: "Kilo", compra_kg: 21.5, compra_kg_mediana: 20.1, multiplicador_mediana: 2.1, ultima: "2026-11-05", factura: FACTURA, banderas: [] }],
    });
    expect(d.costeDesde).toBe("ultima_factura");
    expect(normalizarMargenes({}).costeDesde).toBe("mediana");
    expect(d.platos[0]).toMatchObject({ costeMediana: 6, pctMediana: 30, factura: { id: 501 } });
    expect(d.platos[0].ingredientes[0]).toMatchObject({ eurMediana: 20.1, eurAnterior: 19.8, proveedorAnterior: "MARISCOS B", fecha6m: "2026-05-01", factura: { proveedor: "MAKRO" } });
    expect(d.vinos[0]).toMatchObject({ costeMediana: 10.5, multiplicadorMediana: 2.86, costeAnterior: 9, factura: { id: 501 } });
    expect(d.peso[0]).toMatchObject({ compraKgMediana: 20.1, multiplicadorMediana: 2.1, ultima: "2026-11-05", factura: { id: 501 } });
    // La mediana, en pequeño y en la misma unidad que el coste.
    expect(textoMediana(d.peso[0])).toBe("Lo normal en 3 meses (mediana): 20,10 €/kg");
    expect(textoMediana(d.vinos[0])).toBe("Lo normal en 3 meses (mediana): 10,50 € la botella");
    expect(textoMediana(d.platos[0])).toBe("Lo normal en 3 meses (mediana): hacerlo costaría 6,00 € (30 % coste sobre venta)");
    expect(textoMediana(d.peso[0], { ...CONFIG_POR_DEFECTO, diasReferencia: 45 })).toBe("Lo normal en 45 días (mediana): 20,10 €/kg");
    expect(textoMedianaIngrediente(d.platos[0].ingredientes[0])).toBe("Lo normal en 3 meses (mediana): 20,10 €/kg");
    // Una compra más nueva que no trae el peso: se dice cuál se usa.
    expect(avisoCompraMasNueva(d.peso[0].factura, d.peso[0].ultima, "2026-11-13")).toBe("Hay una compra más nueva (05/11) que no trae el peso: se usa esta");
    expect(avisoCompraMasNueva(d.peso[0].factura, "2026-11-03")).toBeNull();
  });
  it("el % de coste dicho en corto: «37 % coste sobre venta»", () => {
    expect(textoPctCoste(37.2)).toBe("37 % coste sobre venta");
    expect(textoPctCoste(null)).toBe("coste sobre venta: —");
  });
});
