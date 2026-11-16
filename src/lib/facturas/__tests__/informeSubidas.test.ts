import { describe, expect, it } from "vitest";
import {
  cantidad,
  euros0,
  fechaEs,
  normalizarBarato,
  normalizarSubidas,
  notasBarato,
  notasSubida,
  pct,
  resumenBarato,
  resumenSubidas,
  siguienteLimite,
  unirOpciones,
} from "../informeSubidas";

const doc = (id: number) => ({
  id,
  fecha: "2026-11-03",
  proveedor: "Casimiro Pérez, S.L.",
  proveedor_id: 7,
  numero: "F-1",
  tipo: "factura",
  local: "casa_tomas",
  total: 120.5,
  drive_url: null,
  archivo_path: "a/b.pdf",
});

const SUBIDAS = {
  hoy: "2026-11-16",
  meses: 12,
  totales: {
    impacto_fiable: 2522,
    n_fiable: 2,
    por_confianza: { alta: { n: 1, impacto: 1530 }, media: { n: 1, impacto: 992 }, baja: { n: 1, impacto: 52920 } },
    bajadas_fiable: { n: 3, importe: -640.4 },
    sin_referencia: 12,
    comparados: 40,
  },
  total_filas: 3,
  filas: [
    {
      id: "10:7:ud",
      producto_id: 10,
      producto: "Ostra",
      nombre_normalizado: "ostra",
      familia_id: 2,
      familia: "Pescado y marisco",
      proveedor_id: 7,
      proveedor: "Casimiro Pérez, S.L.",
      unidad: "ud",
      precio: 2.8,
      fecha: "2026-11-03",
      precio_ref: 2.05,
      fecha_ref: "2025-10-20",
      variacion_pct: 36.6,
      hace_3: { precio: 2.8, fecha: "2026-08-01", variacion_pct: 0 },
      hace_6: null,
      hace_12: { precio: 2.05, fecha: "2025-10-20", variacion_pct: 36.6 },
      compras_12m: 49,
      cantidad_12m: 2040,
      gasto_12m: 5100,
      impacto_anual: 1530,
      confianza: "alta",
      motivo: "Mismo proveedor y misma unidad; 49 compras en 12 meses",
      doc: doc(1),
      doc_ref: doc(2),
    },
    {
      id: "11:8:docena",
      producto_id: 11,
      producto: "Huevos M",
      proveedor_id: 8,
      proveedor: "Aviques",
      unidad: "docena",
      precio: "2.3",
      precio_ref: "1.9",
      variacion_pct: 21.1,
      cantidad_12m: 2480,
      impacto_anual: 992,
      confianza: "media",
      motivo: "Pocas compras",
      doc: null,
      doc_ref: null,
    },
    { id: "12:9:ud", producto_id: 12, producto: "Pan de cristal", unidad: "ud", precio: 29.4, precio_ref: 1.4, variacion_pct: 2000, impacto_anual: 52920, confianza: "rara", motivo: "Diferencia de más del 60 %" },
    { id: "roto", producto: null, precio: 1, precio_ref: 1 },
    { id: "sin-precio", producto: "X", precio: null, precio_ref: 1 },
  ],
  proveedores: [
    { id: 7, nombre: "Casimiro", n: 1 },
    { id: null, nombre: "roto" },
  ],
  familias: [{ id: 2, nombre: "Pescado y marisco", n: 1 }],
  excluidos: { n_genericos: 1, gasto_genericos: 33791, genericos: [{ producto_id: 99, producto: "Macruros", motivo: "Cajón de la lonja", gasto_12m: 33791, proveedores: 30 }] },
};

describe("normalizarSubidas", () => {
  const i = normalizarSubidas(SUBIDAS);

  it("lee los totales: lo fiable es alta + media, y lo de revisar va aparte", () => {
    expect(i.fiable).toEqual({ n: 2, importe: 2522 });
    expect(i.porConfianza.baja).toEqual({ n: 1, importe: 52920 });
    expect(i.bajadas).toEqual({ n: 3, importe: -640.4 });
    expect(i.sinReferencia).toBe(12);
    expect(i.meses).toBe(12);
    expect(i.totalFilas).toBe(3);
  });

  it("descarta las filas sin producto o sin precio y acepta números como texto", () => {
    expect(i.filas.map((f) => f.producto)).toEqual(["Ostra", "Huevos M", "Pan de cristal"]);
    expect(i.filas[1].precio).toBe(2.3);
    expect(i.filas[1].hace3).toBeNull();
  });

  it("una confianza que no conoce es «baja»: nunca suma por error", () => {
    expect(i.filas[2].confianza).toBe("baja");
  });

  it("los documentos llegan como los pide el visor", () => {
    expect(i.filas[0].doc).toMatchObject({ id: 1, proveedorId: 7, archivoPath: "a/b.pdf", tipo: "factura", local: "casa_tomas" });
    expect(i.filas[1].doc).toBeNull();
  });

  it("opciones de filtro y excluidos", () => {
    expect(i.proveedores).toEqual([{ id: 7, nombre: "Casimiro", n: 1 }]);
    expect(i.excluidos.genericos[0]).toMatchObject({ producto: "Macruros", gasto12m: 33791 });
  });

  it("aguanta null, texto o un JSON de otra forma", () => {
    for (const v of [null, "x", [], { filas: "no" }]) {
      const r = normalizarSubidas(v);
      expect(r.filas).toEqual([]);
      expect(r.fiable).toEqual({ n: 0, importe: 0 });
      expect(r.meses).toBe(12);
    }
  });

  it("el resumen dice qué suma y qué no", () => {
    expect(resumenSubidas(i)).toBe("1 fiables (+1.530 €) y 1 probables (+992 €) · 1 por revisar que no se suman · 3 bajadas restan 640 €");
  });

  it("las notas de «Comparar facturas»: primero la de antes, luego la última", () => {
    expect(notasSubida(i.filas[0])).toEqual([
      { etiqueta: "Factura del 20/10/2025", linea: "Ostra: 2,05 €/ud" },
      { etiqueta: "Última factura", linea: "Ostra: 2,80 €/ud" },
    ]);
  });
});

describe("normalizarBarato", () => {
  const i = normalizarBarato({
    totales: {
      ahorro_fiable: 2502,
      n_fiable: 1,
      por_confianza: { alta: { n: 0, ahorro: 0 }, media: { n: 1, ahorro: 2502 }, baja: { n: 2, ahorro: 6000 } },
      productos_varios_proveedores: 213,
    },
    total_filas: 3,
    filas: [
      {
        id: "1:2:kg",
        producto_id: 1,
        producto: "Quisquilla",
        unidad: "kg",
        proveedor_id: 2,
        proveedor: "Hermanos Narejos S.L.",
        precio: 72,
        fecha: "2026-11-10",
        compras_12m: 30,
        cantidad_12m: 250.2,
        gasto_12m: 17000,
        es_habitual: true,
        proveedor_barato_id: 3,
        proveedor_barato: "Once de Enero",
        precio_barato: 62,
        fecha_barato: "2026-07-01",
        compras_barato_12m: 5,
        diferencia_pct: 13.9,
        ahorro_anual: 2502,
        confianza: "media",
        motivo: "Pescado",
        doc: doc(5),
        doc_barato: doc(6),
      },
      { producto: "Sin precio barato", precio: 3 },
    ],
  });

  it("lee filas y totales", () => {
    expect(i.filas).toHaveLength(1);
    expect(i.filas[0]).toMatchObject({ esHabitual: true, proveedorBarato: "Once de Enero", ahorroAnual: 2502, confianza: "media" });
    expect(i.fiable).toEqual({ n: 1, importe: 2502 });
    expect(i.productosVariosProveedores).toBe(213);
    expect(resumenBarato(i)).toBe("0 fiables (0 €) y 1 probables (2.502 €) · 2 por revisar que no se suman");
  });

  it("las notas: la tuya y la del más barato, con el proveedor sin «S.L.»", () => {
    expect(notasBarato(i.filas[0])).toEqual([
      { etiqueta: "Factura de Hermanos Narejos", linea: "Quisquilla: 72,00 €/kg" },
      { etiqueta: "Factura de Once de Enero (más barato)", linea: "Quisquilla: 62,00 €/kg" },
    ]);
  });
});

describe("textos", () => {
  it("euros con punto de millar también en cuatro cifras", () => {
    expect(euros0(1530)).toBe("1.530");
    expect(euros0(23547.06)).toBe("23.547");
    expect(euros0(992)).toBe("992");
  });
  it("porcentajes con signo", () => {
    expect(pct(36.6)).toBe("+36,6 %");
    expect(pct(-13.9)).toBe("−13,9 %");
  });
  it("cantidades", () => {
    expect(cantidad(2040, "ud")).toBe("2.040 ud");
    expect(cantidad(9.75, "kg")).toBe("9,8 kg");
  });
  it("fechas", () => {
    expect(fechaEs("2026-11-03")).toBe("03/11/2026");
    expect(fechaEs(null)).toBe("—");
  });
  it("une las opciones de los dos bloques sin repetir y en orden", () => {
    expect(
      unirOpciones(
        [{ id: 2, nombre: "Narejos", n: 1 }],
        [
          { id: 1, nombre: "Ángel", n: 2 },
          { id: 2, nombre: "Narejos", n: 3 },
        ],
      ),
    ).toEqual([
      { id: 1, nombre: "Ángel", n: 2 },
      { id: 2, nombre: "Narejos", n: 4 },
    ]);
  });
  it("«Ver más» pide 100 más, hasta el tope de la RPC", () => {
    expect(siguienteLimite(100)).toBe(200);
    expect(siguienteLimite(950)).toBe(1000);
  });
});
