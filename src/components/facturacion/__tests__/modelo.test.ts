import { describe, expect, it } from "vitest";
import { nuevaFactura, nuevaLinea, totalesFactura, mensualFactura, erroresFactura, facturaSchema } from "../modelo";

describe("facturación comercial", () => {
  it("calcula descuentos, varios tipos de IVA y retención por separado", () => {
    const f = nuevaFactura();
    f.lineas = [
      {...nuevaLinea("Instalación"),cantidad:2,precio:100,descuento:10,iva:21},
      {...nuevaLinea("Soporte"),precio:50,iva:10},
      {...nuevaLinea("Módulo"),precio:20,iva:0},
    ];
    f.retencion = 15;
    const t = totalesFactura(f);
    expect(t.base).toBe(250);
    expect(t.iva).toBe(42.8);
    expect(t.retencion).toBe(37.5);
    expect(t.total).toBe(255.3);
    expect(t.grupos).toEqual([
      {tipo:0,base:20,importe:0},{tipo:10,base:50,importe:5},{tipo:21,base:180,importe:37.8},
    ]);
  });
  it("excluye pagos puntuales y normaliza licencias anuales para el margen mensual", () => {
    const f = nuevaFactura();
    f.lineas = [
      {...nuevaLinea("Instalación"),precio:1000,periodicidad:"Puntual"},
      {...nuevaLinea("Licencia"),precio:1200,periodicidad:"Anual"},
      {...nuevaLinea("Soporte"),cantidad:2,precio:50,descuento:10,periodicidad:"Mensual"},
    ];
    expect(mensualFactura(f)).toBe(190);
    expect(totalesFactura(f).base).toBe(2290);
  });
  it("redondea importes por línea sin acumular decimales binarios", () => {
    const f = nuevaFactura();
    f.lineas = [{...nuevaLinea(),cantidad:3,precio:0.1},{...nuevaLinea(),precio:1.005,iva:0}];
    expect(totalesFactura(f).base).toBe(1.31);
    expect(totalesFactura(f).total).toBe(1.37);
  });
  it("acepta servicios incluidos y descuento del 100%", () => {
    const f = nuevaFactura();
    f.lineas = [{...nuevaLinea("Soporte"),precio:0},{...nuevaLinea(),precio:30,descuento:100}];
    expect(totalesFactura(f).total).toBe(0);
  });
  it("permite guardar un borrador incompleto, pero bloquea su factura", () => {
    const f = nuevaFactura();
    expect(facturaSchema.safeParse(f).success).toBe(true);
    expect(erroresFactura(f)).toContain("Indica el número de factura.");
    expect(erroresFactura(f)).toHaveLength(3);
  });
  it("rechaza cantidades inválidas, impuestos fuera de rango y fechas imposibles", () => {
    const f = nuevaFactura();
    f.numero = "FO-2026-001";
    f.emisor = {nombre:"Emisor",nif:"TEST",direccion:"Dirección",email:""};
    f.cliente = {...f.emisor,nombre:"Cliente"};
    f.fecha = "2026-02-30";
    expect(erroresFactura(f)).toContain("Indica fechas válidas.");
    f.fecha = "2026-10-03"; f.vencimiento = "2026-10-01";
    expect(erroresFactura(f)).toContain("El vencimiento no puede ser anterior a la fecha de factura.");
    f.lineas[0].cantidad = 0;
    expect(facturaSchema.safeParse(f).success).toBe(false);
    f.lineas[0].cantidad = 1; f.lineas[0].iva = 101;
    expect(facturaSchema.safeParse(f).success).toBe(false);
    f.lineas[0].iva = 21; f.lineas[0].precio = Infinity;
    expect(facturaSchema.safeParse(f).success).toBe(false);
  });
});
