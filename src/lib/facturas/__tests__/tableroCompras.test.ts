// Facturas › Análisis: lógica pura del tablero de compras (periodo, periodo
// anterior equivalente, lectura del JSON de la RPC, textos, enlaces a Compras
// y sugerencias del copiloto).
import { describe, expect, it } from "vitest";
import {
  enlaceMesCompras,
  enlaceProveedorCompras,
  ENLACE_PRODUCTOS_COMPRAS,
  ErrorTablero,
  fechasPeriodo,
  finDeMes,
  leerEnlaceCompras,
  localRpc,
  marcaEje,
  topeEje,
  nombreCorto,
  normalizarTablero,
  periodoAnteriorEquivalente,
  periodosAnalisis,
  resumenGastoMes,
  resumenProveedores,
  sugerenciasDeTablero,
  textoPct,
  textoRangoMeses,
  textoTramos,
  textoVariacion,
} from "../tableroCompras";

const HOY = new Date(2026, 10, 5, 12); // 5 nov 2026

// Un trozo real de lo que devuelve tablero_compras('2026-01-01','2026-12-31') en la demo.
const RPC = {
  periodo: { desde: "2026-01-01", hasta: "2026-12-31", hasta_efectivo: "2026-11-05", local: null, anterior: { desde: "2025-01-01", hasta: "2025-11-05" } },
  sin_datos: false,
  indicadores: {
    gasto: 1362491.57, gasto_anterior: -323.94, documentos_anterior: 1, variacion_pct: null, documentos: 1884, facturas: 1844,
    albaranes_sin_factura: 40, albaranes_sin_factura_importe: 14915.34, sin_total: 3, abonos: -14376.94, abonos_n: 43,
    regalado: 28204.41, regalado_valia: 107581.24, regalado_lineas: 861, regalado_estimadas: 69, regalado_estimado_importe: 6231.06, proveedores: 245,
  },
  meses: [
    { mes: "2026-06", casa_tomas: 140517.85, touza: 2882.85, total: 143400.7, documentos: 194 },
    { mes: "2026-07", casa_tomas: 160999.23, touza: 4408.77, total: 165408, documentos: 237 },
    { mes: "2026-08", casa_tomas: "163577.65", touza: 4585.42, total: 168163.07, documentos: 204 },
  ],
  proveedores: [
    { id: 298, nombre: "EMBAJADORES MADRID", gasto: 103750.6, pct: 7.6, documentos: 11 },
    { id: 377, nombre: "DISTRIBUCIONES DE BEBIDAS CATRAL, S.L.", gasto: 59455.96, pct: 4.4, documentos: 23 },
  ],
  subidas: {
    tramo_inicio: { desde: "2026-01-12", hasta: "2026-04-11" },
    tramo_fin: { desde: "2026-07-09", hasta: "2026-10-06" },
    comparados: 216,
    productos: [
      { producto: "PAN DE CRISTAL", nombre_normalizado: "pan de cristal", unidad: "ud", proveedor_id: 276, proveedor: "Panaderia Garcia, S.L.",
        precio_inicio: 1.4, precio_fin: 2.0512, variacion_pct: 46.5, compras_inicio: 3, compras_fin: 3, importe: 2851.8 },
    ],
  },
  familias: { importe_total: 1200548.07, lineas: 12321, sin_clasificar: { lineas: 10396, importe: 1019048.6 }, familias: [{ id: 2, familia: "Pescado y marisco", importe: 81614.84, lineas: 459 }] },
  fijos: { ventana: { desde: "2026-01-01", hasta: "2026-11-05", meses_con_datos: 9 }, total_medio_mes: 15010.99,
    proveedores: [{ id: 398, nombre: "ACCIONA GREEN ENERGY DEVELOPMENTS, S.L.U.", medio_mes: 3611.03, meses: 9, meses_con_datos: 9, documentos: 11 }] },
  abonos: [{ id: 377, nombre: "DISTRIBUCIONES DE BEBIDAS CATRAL, S.L.", importe: -5716.71, documentos: 5 }],
  locales: { casa_tomas: { gasto: 1333190.24, documentos: 1857 }, touza: { gasto: 29301.33, documentos: 27 }, meses: [{ mes: "2026-07", casa_tomas: 160999.23, touza: 4408.77 }] },
};

describe("periodo", () => {
  it("Mes · Trimestre · Año <año> · Todo; por defecto el año", () => {
    expect(periodosAnalisis(HOY).map((p) => p.etiqueta)).toEqual(["Mes", "Trimestre", "Año 2026", "Todo"]);
  });

  it("fechas naturales (como Compras): mes, trimestre y año enteros; «Todo» sin fechas", () => {
    expect(fechasPeriodo("mes", HOY)).toEqual({ desde: "2026-11-01", hasta: "2026-11-30" });
    expect(fechasPeriodo("trimestre", HOY)).toEqual({ desde: "2026-10-01", hasta: "2026-12-31" });
    expect(fechasPeriodo("anio", HOY)).toEqual({ desde: "2026-01-01", hasta: "2026-12-31" });
    expect(fechasPeriodo("todo", HOY)).toEqual({ desde: null, hasta: null });
    expect(fechasPeriodo("mes", new Date(2028, 1, 10))).toEqual({ desde: "2028-02-01", hasta: "2028-02-29" });
    expect(finDeMes("2026-02")).toBe("2026-02-28");
  });

  it("local: «Todos» va a la RPC como null", () => {
    expect(localRpc("todos")).toBeNull();
    expect(localRpc("touza")).toBe("touza");
  });
});

describe("periodo anterior equivalente (misma regla que la RPC)", () => {
  it("año abierto: el año anterior hasta el mismo día", () => {
    expect(periodoAnteriorEquivalente("2026-01-01", "2026-12-31", "2026-11-05")).toEqual({ desde: "2025-01-01", hasta: "2025-11-05" });
  });
  it("mes cerrado: el mes anterior entero (30 sep → 1-31 ago)", () => {
    expect(periodoAnteriorEquivalente("2026-09-01", "2026-09-30", "2026-11-05")).toEqual({ desde: "2026-08-01", hasta: "2026-08-31" });
    expect(periodoAnteriorEquivalente("2026-03-01", "2026-03-31", "2026-11-05")).toEqual({ desde: "2026-02-01", hasta: "2026-02-28" });
  });
  it("mes abierto: el anterior hasta el mismo día; trimestre cerrado: el anterior", () => {
    expect(periodoAnteriorEquivalente("2026-11-01", "2026-11-30", "2026-11-05")).toEqual({ desde: "2026-10-01", hasta: "2026-10-05" });
    expect(periodoAnteriorEquivalente("2026-07-01", "2026-09-30", "2026-11-05")).toEqual({ desde: "2026-04-01", hasta: "2026-06-30" });
  });
  it("rango suelto: los mismos días justo antes", () => {
    expect(periodoAnteriorEquivalente("2031-02-10", "2031-02-19", "2026-11-05")).toEqual({ desde: "2031-01-31", hasta: "2031-02-09" });
  });
});

describe("lectura del JSON de la RPC", () => {
  it("convierte cifras (también las que llegan como texto) y conserva los bloques", () => {
    const t = normalizarTablero(RPC);
    expect(t.indicadores.gasto).toBe(1362491.57);
    expect(t.indicadores.variacionPct).toBeNull();
    expect(t.meses[2].casa_tomas).toBe(163577.65);
    expect(t.proveedores[0]).toEqual({ id: 298, nombre: "EMBAJADORES MADRID", gasto: 103750.6, pct: 7.6, documentos: 11 });
    expect(t.subidas.productos[0].variacion_pct).toBe(46.5);
    expect(t.familias.sinClasificar).toEqual({ lineas: 10396, importe: 1019048.6 });
    expect(t.fijos.ventana).toEqual({ desde: "2026-01-01", hasta: "2026-11-05", mesesConDatos: 9 });
    expect(t.locales.touza).toEqual({ gasto: 29301.33, documentos: 27 });
    expect(t.periodo.anterior).toEqual({ desde: "2025-01-01", hasta: "2025-11-05" });
  });

  it("bloques que faltan salen vacíos; {error} lanza", () => {
    const t = normalizarTablero({ sin_datos: true });
    expect(t.sinDatos).toBe(true);
    expect(t.meses).toEqual([]);
    expect(t.indicadores.gasto).toBe(0);
    expect(t.subidas.tramoInicio).toBeNull();
    expect(() => normalizarTablero({ error: "local debe ser…" })).toThrow(ErrorTablero);
    expect(normalizarTablero(null).proveedores).toEqual([]);
  });
});

describe("textos", () => {
  it("rango de meses con documentos", () => {
    expect(textoRangoMeses([{ mes: "2026-01", documentos: 3 }, { mes: "2026-11", documentos: 1 }])).toBe("ene – nov 2026");
    expect(textoRangoMeses([{ mes: "2025-12", documentos: 3 }, { mes: "2026-11", documentos: 1 }])).toBe("dic 2025 – nov 2026");
    expect(textoRangoMeses([{ mes: "2026-07", documentos: 3 }])).toBe("julio 2026");
    expect(textoRangoMeses([{ mes: "2026-07", documentos: 0 }])).toBe("Sin documentos");
  });

  it("porcentajes con coma y signo menos tipográfico", () => {
    expect(textoPct(15.8)).toBe("+15,8 %");
    expect(textoPct(-3.21)).toBe("−3,2 %");
    expect(textoPct(7.6, false)).toBe("7,6 %");
  });

  it("variación solo si la RPC la da", () => {
    const t = normalizarTablero(RPC);
    expect(textoVariacion(t)).toBeNull();
    const conVar = normalizarTablero({ ...RPC, indicadores: { ...RPC.indicadores, variacion_pct: 15.8 } });
    expect(textoVariacion(conVar)).toEqual({ texto: "+15,8 % frente a 1 ene 2025 – 5 nov 2025", sube: true });
  });

  it("tramos de «lo que más ha subido»", () => {
    const t = normalizarTablero(RPC);
    expect(textoTramos(t.subidas.tramoInicio, t.subidas.tramoFin)).toBe("mismo proveedor, 12 ene – 11 abr vs 9 jul – 6 oct");
    expect(textoTramos(null, null)).toBe("mismo proveedor");
  });

  it("nombre corto del proveedor", () => {
    expect(nombreCorto("DISTRIBUCIONES DE BEBIDAS CATRAL, S.L.")).toBe("Distribuciones de Bebidas Catral");
    expect(nombreCorto("ACCIONA GREEN ENERGY DEVELOPMENTS, S.L.U.")).toBe("Acciona Green Energy Developments");
    expect(nombreCorto("Makro distribuidor mayorista S.A.")).toBe("Makro distribuidor mayorista");
    expect(nombreCorto("Luga Sabores S.L.")).toBe("Luga Sabores");
  });

  it("resúmenes para lectores de pantalla (con punto de miles)", () => {
    const t = normalizarTablero(RPC);
    expect(resumenGastoMes(t.meses)).toBe(
      "3 meses. El más alto, Agosto 2026 con 168.163 €; el más bajo, Junio 2026 con 143.401 €. Con IVA.",
    );
    expect(resumenProveedores(t.proveedores)).toBe("Los que más: Embajadores Madrid 103.751 € (7,6 %), Distribuciones de Bebidas Catral 59.456 € (4,4 %).");
    expect(resumenGastoMes([])).toBe("Sin gasto en el periodo.");
  });
});

describe("eje de «Gasto por mes»", () => {
  it("tope redondo y marcas en miles", () => {
    expect(topeEje(171526)).toBe(200000);
    expect(topeEje(4585)).toBe(5000);
    expect(topeEje(0)).toBe(1);
    expect(marcaEje(200000)).toBe("200 mil €");
    expect(marcaEje(2500000)).toBe("2.500 mil €");
    expect(marcaEje(500)).toBe("500 €");
  });
});

describe("enlaces a Compras", () => {
  it("mes, proveedor y Productos", () => {
    expect(enlaceMesCompras("2026-07")).toBe("?tab=compras&modo=documentos&mes=2026-07");
    expect(enlaceProveedorCompras(298)).toBe("?tab=compras&modo=proveedores&prov=298");
    expect(ENLACE_PRODUCTOS_COMPRAS).toBe("?tab=compras&modo=productos");
  });

  it("se leen de la URL; lo que no es válido se ignora", () => {
    expect(leerEnlaceCompras(new URLSearchParams(enlaceMesCompras("2026-07")))).toEqual({ mes: "2026-07" });
    expect(leerEnlaceCompras(new URLSearchParams(enlaceProveedorCompras(298)))).toEqual({ prov: 298 });
    expect(leerEnlaceCompras(new URLSearchParams("mes=2026-13&prov=abc"))).toEqual({});
    expect(leerEnlaceCompras(new URLSearchParams("prov=-4"))).toEqual({});
  });
});

describe("sugerencias del copiloto", () => {
  it("salen de los datos: el mes que más subió, el producto que más sube, el primer proveedor y un fijo", () => {
    expect(sugerenciasDeTablero(normalizarTablero(RPC), "anio")).toEqual([
      "¿Por qué subió el gasto en julio?",
      "Compara el precio de pan de cristal entre proveedores",
      "¿Qué le he comprado a Embajadores Madrid este año?",
      "¿Ha subido lo que pago a Acciona Green Energy Developments?",
    ]);
  });
  it("sin datos, unas genéricas", () => {
    expect(sugerenciasDeTablero(null, "mes")).toHaveLength(3);
  });
});
