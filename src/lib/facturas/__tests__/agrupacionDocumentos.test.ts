import {
  agruparDocumentos,
  claveEstadoMes,
  claveMes,
  etiquetaMes,
  guardarPlegado,
  importeQueSuma,
  leerPlegado,
  MESES_ABIERTOS_BUSCANDO,
  mesAbierto,
  mesesRecientes,
  sumaEnTotal,
} from "../agrupacionDocumentos";

const doc = (id: number, extra: Partial<Factura>): Factura => ({
  id,
  tipo: "factura",
  numero_documento: `D-${id}`,
  proveedor: "Makro",
  cif: null,
  fecha: "2026-10-03",
  subtotal: null,
  iva: null,
  total: 100,
  total_origen: "leido",
  observaciones: null,
  productos: [],
  drive_url: null,
  archivo_path: null,
  alertas: [],
  procesado_en: null,
  created_at: null,
  verificada: true,
  facturado_en_id: null,
  ...extra,
});

describe("fechas y etiquetas", () => {
  it("saca el mes de la fecha y lo llama en español", () => {
    expect(claveMes("2026-10-03")).toBe("2026-10");
    expect(claveMes("2026-10-03T22:00:00+00:00")).toBe("2026-10");
    expect(claveMes("")).toBe("sin-fecha");
    expect(claveMes(null)).toBe("sin-fecha");
    expect(claveMes("2026-13-01")).toBe("sin-fecha");
    expect(etiquetaMes("2026-10")).toBe("Octubre 2026");
    expect(etiquetaMes("2026-01")).toBe("Enero 2026");
    expect(etiquetaMes("sin-fecha")).toBe("Sin fecha");
  });

  it("mes actual y anterior, también al cruzar de año", () => {
    expect(mesesRecientes(new Date(2026, 9, 10))).toEqual(["2026-10", "2026-09"]);
    expect(mesesRecientes(new Date(2027, 0, 5))).toEqual(["2027-01", "2026-12"]);
  });
});

describe("agruparDocumentos", () => {
  it("meses del más reciente al más antiguo y «Sin fecha» al final", () => {
    const g = agruparDocumentos([
      doc(1, { fecha: "2026-08-20" }),
      doc(2, { fecha: "" }),
      doc(3, { fecha: "2026-10-01" }),
      doc(4, { fecha: "2025-12-31" }),
      doc(5, { fecha: "2026-09-15" }),
    ]);
    expect(g.map((m) => m.clave)).toEqual(["2026-10", "2026-09", "2026-08", "2025-12", "sin-fecha"]);
    expect(g.at(-1)?.etiqueta).toBe("Sin fecha");
  });

  it("dentro del mes, del documento más reciente al más antiguo (sin subgrupos por proveedor)", () => {
    const g = agruparDocumentos([
      doc(1, { fecha: "2026-10-01", proveedor: "Makro" }),
      doc(2, { fecha: "2026-10-09", proveedor: "Pescados" }),
      doc(3, { fecha: "2026-10-09", proveedor: null }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].documentos.map((d) => d.id)).toEqual([3, 2, 1]);
  });

  it("total = facturas + albaranes sin factura; un albarán facturado se ve pero no suma", () => {
    const g = agruparDocumentos([
      doc(1, { tipo: "factura", total: 1000.5 }),
      doc(2, { tipo: "albaran", total: 300, facturado_en_id: 1 }), // ya dentro de la factura 1
      doc(3, { tipo: "albaran", total: 120.25, facturado_en_id: null }), // sin factura: suma
      doc(4, { tipo: "albaran", total: null }), // sin importe: cuenta como documento, no suma
    ]);
    expect(g[0].documentos).toHaveLength(4);
    expect(g[0].total).toBe(1120.75);
    expect(g[0].abonos).toBe(0);
  });

  it("los abonos restan del total del mes y se cuentan aparte", () => {
    const g = agruparDocumentos([doc(1, { total: 500 }), doc(2, { total: -120.4 }), doc(3, { total: -9.6 })]);
    expect(g[0].total).toBe(370);
    expect(g[0].abonos).toBe(-130);
  });

  it("no arrastra errores de coma flotante", () => {
    const g = agruparDocumentos([doc(1, { total: 0.1 }), doc(2, { total: 0.2 }), doc(3, { total: 10 })]);
    expect(g[0].total).toBe(10.3);
  });

  it("un albarán facturado en otro mes no suma en el suyo (ya está en la factura)", () => {
    const g = agruparDocumentos([
      doc(1, { tipo: "albaran", fecha: "2026-09-30", total: 80, facturado_en_id: 99 }),
      doc(2, { tipo: "albaran", fecha: "2026-10-02", total: 20 }),
    ]);
    expect(g.map((m) => [m.clave, m.total, m.documentos.length])).toEqual([
      ["2026-10", 20, 1],
      ["2026-09", 0, 1],
    ]);
  });

  it("lista vacía = sin grupos", () => {
    expect(agruparDocumentos([])).toEqual([]);
  });

  it("sumaEnTotal e importeQueSuma", () => {
    expect(sumaEnTotal({ tipo: "factura", facturado_en_id: null })).toBe(true);
    expect(sumaEnTotal({ tipo: "albaran", facturado_en_id: null })).toBe(true);
    expect(sumaEnTotal({ tipo: "albaran", facturado_en_id: 7 })).toBe(false);
    expect(sumaEnTotal({ tipo: "albaran" })).toBe(true);
    expect(importeQueSuma({ tipo: "albaran", facturado_en_id: 7, total: 50 })).toBe(0);
    expect(importeQueSuma({ tipo: "factura", facturado_en_id: null, total: null })).toBe(0);
    expect(importeQueSuma({ tipo: "factura", facturado_en_id: null, total: -12.5 })).toBe(-12.5);
  });
});

describe("qué grupos están abiertos", () => {
  const hoy = new Date(2026, 9, 10);

  it("por defecto (y con cualquier chip), solo el mes actual y el anterior", () => {
    expect(mesAbierto("2026-10", {}, hoy)).toBe(true);
    expect(mesAbierto("2026-09", {}, hoy)).toBe(true);
    expect(mesAbierto("2026-08", {}, hoy)).toBe(false);
    expect(mesAbierto("sin-fecha", {}, hoy)).toBe(false);
    expect(mesAbierto("2026-03", {}, hoy, null)).toBe(false);
  });

  it("con texto buscado se abren solo los 3 meses con resultados más recientes", () => {
    expect(MESES_ABIERTOS_BUSCANDO).toBe(3);
    expect(mesAbierto("2025-01", {}, hoy, 0)).toBe(true);
    expect(mesAbierto("2024-12", {}, hoy, 2)).toBe(true);
    expect(mesAbierto("2024-11", {}, hoy, 3)).toBe(false);
    // Aunque sea el mes de hoy: si no está entre los 3 primeros con resultados, plegado.
    expect(mesAbierto("2026-10", {}, hoy, 5)).toBe(false);
  });

  it("lo que decidió el usuario manda, con o sin búsqueda", () => {
    expect(mesAbierto("2026-03", { [claveEstadoMes("2026-03")]: false }, hoy, 0)).toBe(false);
    expect(mesAbierto("2026-03", { [claveEstadoMes("2026-03")]: true }, hoy, 7)).toBe(true);
    expect(mesAbierto("2026-10", { [claveEstadoMes("2026-10")]: false }, hoy)).toBe(false);
    expect(mesAbierto("2026-03", { [claveEstadoMes("2026-03")]: true }, hoy)).toBe(true);
  });

  it("si la lista tiene un solo mes, sale abierto (salvo que se pliegue a mano)", () => {
    expect(mesAbierto("2025-03", {}, hoy, null, 1)).toBe(true);
    expect(mesAbierto("2025-03", {}, hoy, 4, 1)).toBe(true);
    expect(mesAbierto("2025-03", { [claveEstadoMes("2025-03")]: false }, hoy, null, 1)).toBe(false);
    expect(mesAbierto("2025-03", {}, hoy, null, 2)).toBe(false);
  });
});

describe("estado recordado en localStorage", () => {
  beforeEach(() => window.localStorage.clear());

  it("guarda y vuelve a leer", () => {
    guardarPlegado({ "m:2026-03": true, "m:2026-10": false });
    expect(leerPlegado()).toEqual({ "m:2026-03": true, "m:2026-10": false });
  });

  it("ignora contenido roto o de otro tipo", () => {
    window.localStorage.setItem("compras.documentos.plegado", "{no es json");
    expect(leerPlegado()).toEqual({});
    window.localStorage.setItem("compras.documentos.plegado", JSON.stringify(["a"]));
    expect(leerPlegado()).toEqual({});
    window.localStorage.setItem("compras.documentos.plegado", JSON.stringify({ a: true, b: "sí", c: 1 }));
    expect(leerPlegado()).toEqual({ a: true });
  });

  it("si localStorage falla, no revienta", () => {
    const original = Storage.prototype.getItem;
    const guardar = Storage.prototype.setItem;
    Storage.prototype.getItem = () => {
      throw new Error("bloqueado");
    };
    Storage.prototype.setItem = () => {
      throw new Error("bloqueado");
    };
    try {
      expect(leerPlegado()).toEqual({});
      expect(() => guardarPlegado({ a: true })).not.toThrow();
    } finally {
      Storage.prototype.getItem = original;
      Storage.prototype.setItem = guardar;
    }
  });
});
