import { describe, expect, it } from "vitest";
import {
  alertasDelPeriodo,
  alertasDePrecio,
  alertasPorClave,
  marcasDeExploracion,
  normalizarAlertas,
  ordenarAlertas,
  rutaAlerta,
  superaUmbral,
  umbralSubida,
} from "@/lib/facturas/alertas";
import { avisoCaducado, rutaDeAviso, SECCIONES_AVISOS, TIPO_ICON, TIPOS_POR_FILTRO } from "@/lib/avisos";

const crudo = [
  {
    id: "a1",
    tipo: "facturas_precio_sube",
    prioridad: "alta",
    titulo: "Sube Merluza: +30,0 %",
    mensaje: "PRUEBA MERLUZA (Mayorista): 13,00 €/kg…",
    leida: false,
    datos: {
      enlace: "?tab=compras&modo=documentos&doc=7",
      factura_id: 7,
      mes: "2026-10",
      desde: "2026-10-03",
      hasta: "2026-10-03",
      local: "casa_tomas",
      proveedor_id: 5,
      proveedor: "Mayorista",
      familia_id: 2,
      producto: "PRUEBA MERLUZA",
      nombre_normalizado: "prueba merluza",
      unidad: "caja",
      medida: "kg",
      precio: 13,
      precio_ref: 10,
      precio_ud: 65,
      precio_ref_ud: 50,
      variacion_pct: 30,
      umbral_pct: 12,
    },
  },
  {
    id: "a2",
    tipo: "facturas_familia_gasto",
    prioridad: "normal",
    titulo: "Congelados: +32 % en septiembre",
    mensaje: "…",
    leida: true,
    datos: { mes: "2026-09", desde: "2026-09-01", hasta: "2026-09-30", local: "casa_tomas", familia_id: 8, familia: "Congelados", enlace: "?tab=compras&modo=documentos&mes=2026-09" },
  },
  {
    id: "a3",
    tipo: "facturas_albaran_sin_factura",
    prioridad: "normal",
    titulo: "Bodega: 2 albaranes sin factura",
    mensaje: "…",
    datos: { mes: "2025-12", desde: "2025-12-23", hasta: "2025-12-30", local: null, proveedor_id: 9, enlace: "?tab=compras&modo=proveedores&prov=9" },
  },
  {
    id: "a4",
    tipo: "facturas_importe_inusual",
    prioridad: "normal",
    titulo: "Bodega Touza: factura de 500 €",
    mensaje: "…",
    datos: { mes: "2026-10", desde: "2026-10-15", hasta: "2026-10-15", local: "touza", proveedor_id: 11, enlace: "?tab=compras&modo=documentos&doc=9" },
  },
  { id: "a5", tipo: "facturas_revision", prioridad: "normal", titulo: "13 documentos con avisos sin revisar", mensaje: "…", datos: {} },
  // Descartadas: tipo desconocido, sin id o sin título.
  { id: "x1", tipo: "subida_precio", titulo: "otro" },
  { tipo: "facturas_revision", titulo: "sin id" },
  { id: "x3", tipo: "facturas_revision" },
];

describe("alertas de Facturas", () => {
  const alertas = normalizarAlertas(crudo);

  it("normaliza la respuesta de facturas_alertas_activas y descarta lo que no entiende", () => {
    expect(alertas.map((a) => a.id)).toEqual(["a1", "a2", "a3", "a4", "a5"]);
    expect(alertas[0]).toMatchObject({ prioridad: "alta", leida: false, datos: { proveedorId: 5, precioRefUd: 50, medida: "kg", local: "casa_tomas" } });
    expect(alertas[2].datos.local).toBeNull();
    expect(normalizarAlertas(null)).toEqual([]);
    expect(normalizarAlertas({ no: "es una lista" })).toEqual([]);
  });

  it("ordena: importantes primero y, dentro, las no leídas", () => {
    expect(ordenarAlertas([alertas[1], alertas[2], alertas[0]]).map((a) => a.id)).toEqual(["a1", "a3", "a2"]);
  });

  it("reparte las alertas por los puntos de cada eje (la revisión no va a ninguno)", () => {
    const mes = alertasPorClave(alertas, "mes");
    expect([...mes.keys()].sort()).toEqual(["2026-09", "2026-10"]);
    expect(mes.get("2026-10")?.map((a) => a.id)).toEqual(["a1", "a4"]);
    const prov = alertasPorClave(alertas, "proveedor");
    expect([...prov.keys()].sort()).toEqual(["11", "5", "9"]);
    const fam = alertasPorClave(alertas, "familia");
    expect([...fam.keys()].sort()).toEqual(["2", "8"]);
    expect(alertasPorClave(alertas, "producto").get("prueba merluza")?.[0].id).toBe("a1");
  });

  it("filtra por periodo y local (las de los dos locales, siempre)", () => {
    const oct = alertasDelPeriodo(alertas, { desde: "2026-10-01", hasta: "2026-10-31" }, "casa_tomas");
    expect(oct.map((a) => a.id)).toEqual(["a1", "a5"]);
    const touza = alertasDelPeriodo(alertas, { desde: null, hasta: null }, "touza");
    expect(touza.map((a) => a.id)).toEqual(["a3", "a4", "a5"]);
  });

  it("precio de un producto: referencia en la unidad facturada y el mes de la subida", () => {
    const p = alertasDePrecio(alertas, "Prueba Merluza", "caja");
    expect(p.referencia).toBe(50);
    expect(p.etiquetaReferencia).toBe("Precio de referencia (Mayorista)");
    expect([...p.meses.keys()]).toEqual(["2026-10"]);
    expect(alertasDePrecio(alertas, "Prueba merluza", "kg").referencia).toBeNull();
    expect(alertasDePrecio(alertas, "otro", null).alertas).toEqual([]);
  });

  it("marcas del explorador: gasto por mes con filtro de proveedor; precio con su referencia", () => {
    const base = { periodo: { desde: null, hasta: null }, local: null } as const;
    const gasto = marcasDeExploracion(alertas, {
      ...base,
      medida: "gasto",
      agrupar: "mes",
      filtros: { proveedores: [{ id: 11 }], familias: [], productos: [], unidad: null },
    });
    expect([...gasto.porClave.keys()]).toEqual(["2026-10"]);
    expect(gasto.porClave.get("2026-10")?.map((a) => a.id)).toEqual(["a4"]);
    expect(gasto.referencia).toBeNull();
    const precio = marcasDeExploracion(alertas, {
      ...base,
      medida: "precio",
      agrupar: "mes",
      filtros: { proveedores: [], familias: [], productos: ["PRUEBA MERLUZA"], unidad: "caja" },
    });
    expect(precio.referencia?.valor).toBe(50);
    expect(precio.porClave.get("2026-10")?.[0].id).toBe("a1");
    // Litros o cantidades: sin marcas.
    expect(marcasDeExploracion(alertas, { ...base, medida: "litros", agrupar: "mes", filtros: { proveedores: [], familias: [], productos: [], unidad: null } }).porClave.size).toBe(0);
  });

  it("umbral: el de las alertas o el 10 % por defecto", () => {
    expect(umbralSubida(alertas)).toBe(12);
    expect(umbralSubida([])).toBeNull();
    expect(superaUmbral(12.5, 12)).toBe(true);
    expect(superaUmbral(12, 12)).toBe(false);
    expect(superaUmbral(11, null)).toBe(true);
    expect(superaUmbral(null, 10)).toBe(false);
  });

  it("la campana: enlace al panel, icono y etiqueta de los tipos nuevos, caducidad", () => {
    expect(rutaAlerta({ enlace: "?tab=compras&modo=documentos&doc=7" })).toBe("/facturas?tab=compras&modo=documentos&doc=7");
    expect(rutaAlerta({ enlace: "https://otra.web" })).toBeNull();
    expect(rutaDeAviso({ tipo: "facturas_precio_sube", referencia_tipo: "facturas_alerta", datos: { enlace: "?tab=compras&modo=proveedores&prov=9" } })).toBe(
      "/facturas?tab=compras&modo=proveedores&prov=9",
    );
    expect(rutaDeAviso({ tipo: "facturas_revision", referencia_tipo: "facturas_alerta", datos: null })).toBe("/facturas?tab=chat");
    for (const t of ["facturas_precio_sube", "facturas_precio_mejor", "facturas_familia_gasto", "facturas_albaran_sin_factura", "facturas_proveedor_nuevo", "facturas_importe_inusual", "facturas_revision"]) {
      expect(TIPO_ICON[t]).toBeTruthy();
      expect(TIPOS_POR_FILTRO.facturas).toContain(t);
      expect(SECCIONES_AVISOS.facturas.tipos.find((x) => x.tipo === t)?.etiqueta).toBeTruthy();
    }
    const ahora = Date.parse("2026-11-07T10:00:00Z");
    expect(avisoCaducado({ caduca_en: "2026-11-07T09:00:00Z" }, ahora)).toBe(true);
    expect(avisoCaducado({ caduca_en: "2026-11-08T09:00:00Z" }, ahora)).toBe(false);
    expect(avisoCaducado({ caduca_en: null }, ahora)).toBe(false);
  });
});
