// Respuesta de facturas_decision con los datos de la maqueta (para las pruebas).
export const RESPUESTA = {
  periodo: { desde: "2026-09-01", hasta: "2026-09-30", en_curso: false, meses_equivalentes: 1, meses_incompletos: [] },
  referencia: { meses: ["2026-05", "2026-06", "2026-07", "2026-08"], desde: "2026-05-01", hasta: "2026-08-31" },
  resumen: { gasto: 134154.74, documentos: 187, base: 115168, base_referencia: 132000 },
  familias: [
    { id: 1, familia: "Bebidas", importe: 38560, media_mes: 37412, referencia: 37412, variacion_pct: 3.1, aviso: false, alerta: null },
    { id: 8, familia: "Congelados", importe: 1842, media_mes: 1414, referencia: 1414, variacion_pct: 30.3, aviso: true, alerta: { id: "a-fam", titulo: "Congelados: +32 % en septiembre" } },
    { id: null, familia: "Sin clasificar", importe: 500, media_mes: null, referencia: null, variacion_pct: null, aviso: false, alerta: null },
    { familia: "" },
  ],
  cambios: {
    sube: [
      {
        id: "s1", tipo: "facturas_precio_sube", prioridad: "alta", titulo: "Sube Percebe: +29,0 %", mensaje: "largo", campana: true, impacto_mes: 62.42,
        datos: { producto: "PERCEBE GALLEGO G", proveedor: "Cetárea Angelmar", precio: 140, precio_ref: 108.5, variacion_pct: 29, medida: "kg", fecha: "2026-09-26", fecha_ref: "2026-09-12", factura_ref_id: 70, cantidad_90: 7, impacto_mes: 62.42, factura_id: 7, precio_contexto: 112, factura_verificada: false, local: "casa_tomas" },
        doc: { id: 7, fecha: "2026-09-26", proveedor: "Cetárea Angelmar", numero: "260489", tipo: "factura", local: "casa_tomas", total: 900, drive_url: "https://drive.google.com/file/d/abc/view", archivo_path: null },
      },
      {
        id: "s2", tipo: "facturas_precio_sube", prioridad: "normal", titulo: "Sube Melón piel de sapo: +52,0 %", mensaje: "largo", campana: false, impacto_mes: 2.09,
        datos: { producto: "MELON PIEL SAPO", proveedor: "Francisco José", precio: 0.95, precio_ref: 0.625, variacion_pct: 52, medida: "kg", fecha: "2026-10-02", fecha_ref: "2026-09-18", impacto_mes: 2.09, campana: false },
      },
    ],
    mejor: [
      {
        id: "m1", tipo: "facturas_precio_mejor", prioridad: "normal", titulo: "Berberecho: 18 % más barato en CASIMIRO", mensaje: "x",
        datos: { producto: "Berberecho", proveedor: "Cetárea Angelmar", proveedor_otro: "Casimiro Pérez", precio: 35.5, precio_otro: 29, ahorro: 117, medida: "kg", fecha: "2026-09-28", fecha_otro: "2026-09-20", cantidad_90: 18, factura_verificada: true },
        doc: { id: 8, total: 100 }, doc_otro: { id: 9, total: -20 },
      },
      {
        id: "m2", tipo: "facturas_precio_mejor", prioridad: "normal", titulo: "Pluma", mensaje: "x", datos: { producto: "Pluma", ahorro: 102 },
      },
    ],
    baja: [], proveedor: [], pactado: [], familia: [],
    otros: [{ id: "o1", tipo: "facturas_proveedor_nuevo", prioridad: "normal", titulo: "Proveedor nuevo: X", mensaje: "Primer documento el 10/10. Revisa sus datos.", datos: {} }],
  },
  top: [
    {
      clave: "c:1", producto: "Cruzcampo barril 50 l", producto_id: 1, unidad: "barril", importe_90: 16930.34, proveedor_id: 3, proveedor: "Catral",
      nombre_normalizado: "barril cruzcampo", linea: "BARRIL CRUZCAMPO",
      meses: [{ mes: "2026-08", precio: 203.98 }, { mes: "2026-09", precio: 203.98 }],
      alertas: [], pactado: { id: 4, precio: 203.98, unidad: "barril" },
    },
    { clave: "", producto: "x" },
  ],
  revisar_unidades: [{ clave: "c:115", producto: "Jamón 5J", importe_90: 13854, unidades: [{ unidad: "pieza", precio: 519.17, importe_90: 7525 }, { unidad: "kg", precio: 45, importe_90: 6329 }] }],
  top_desde: "2026-04-01",
  umbrales: { familia_pct: 25, campana_impacto_min_eur: 10, silencio_dias: 90 },
};
