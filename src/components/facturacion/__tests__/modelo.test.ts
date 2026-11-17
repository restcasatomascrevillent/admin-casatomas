import { describe, expect, it } from "vitest";
import { nuevaFactura as nuevoRecibo, nuevaLinea, totalesFactura, totalesRecibo, sinDatosFiscales, tituloRecibo, textoMesRecibo, mensualFactura, erroresFactura, facturaSchema, type Factura } from "../modelo";

/** Documento antiguo, de cuando eran facturas con IVA: el cálculo de lo ya guardado no cambia. */
const nuevaFactura = (): Factura => ({ ...nuevoRecibo(), aplicarIva: true, ivaGlobal: 21 });

describe("facturación comercial", () => {
  it("conserva el cálculo de facturas antiguas con varios tipos de IVA", () => {
    const f = nuevaFactura();
    delete f.ivaGlobal;
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
    delete f.ivaGlobal;
    f.lineas = [{...nuevaLinea(),cantidad:3,precio:0.1,iva:21},{...nuevaLinea(),precio:1.005,iva:0}];
    expect(totalesFactura(f).base).toBe(1.31);
    expect(totalesFactura(f).total).toBe(1.37);
  });
  it("acepta servicios incluidos y descuento del 100%", () => {
    const f = nuevaFactura();
    f.lineas = [{...nuevaLinea("Soporte"),precio:0},{...nuevaLinea(),precio:30,descuento:100}];
    expect(totalesFactura(f).total).toBe(0);
  });
  it("permite guardar un borrador incompleto, pero no emitirlo: pide número, cliente y conceptos, nunca datos fiscales", () => {
    const f = nuevoRecibo();
    expect(facturaSchema.safeParse(f).success).toBe(true);
    expect(erroresFactura(f)).toEqual(["Indica el número de recibo.", "Indica el nombre del cliente.", "Todos los conceptos deben tener una descripción."]);
    f.numero = "R-2026-001"; f.cliente.nombre = "Casa Tomás"; f.lineas[0].concepto = "Instalación";
    // Sin NIF, sin dirección y sin vencimiento posterior: un recibo no los lleva.
    expect(f.cliente.nif).toBe(""); expect(f.emisor.direccion).toBe("");
    expect(erroresFactura(f)).toEqual([]);
    f.tipo = "mensual";
    expect(erroresFactura(f)).toEqual(["Indica el mes que se paga."]);
    f.mes = "2026-11";
    expect(erroresFactura(f)).toEqual([]);
  });
  it("rechaza cantidades inválidas, impuestos fuera de rango y fechas imposibles", () => {
    const f = nuevaFactura();
    f.numero = "FO-2026-001";
    f.emisor = {nombre:"Emisor",nif:"TEST",direccion:"Dirección",email:""};
    f.cliente = {...f.emisor,nombre:"Cliente"};
    f.fecha = "2026-02-30";
    expect(erroresFactura(f)).toContain("Indica una fecha válida.");
    // El vencimiento ya no se enseña ni se comprueba (un recibo no vence).
    f.fecha = "2026-10-03"; f.vencimiento = "2026-10-01";
    expect(erroresFactura(f).join(" ")).not.toMatch(/vencimiento/i);
    f.mes = "2026-13";
    expect(facturaSchema.safeParse(f).success).toBe(false);
    delete f.mes;
    f.lineas[0].cantidad = 0;
    expect(facturaSchema.safeParse(f).success).toBe(false);
    f.lineas[0].cantidad = 1; f.lineas[0].iva = 101;
    expect(facturaSchema.safeParse(f).success).toBe(false);
    f.lineas[0].iva = 21; f.lineas[0].precio = Infinity;
    expect(facturaSchema.safeParse(f).success).toBe(false);
  });
  it("aplica el descuento global después de los descuentos por línea y antes del IVA y retención", () => {
    const f = nuevaFactura();
    f.lineas = [
      {...nuevaLinea("Instalación"),cantidad:2,precio:100,descuento:10,iva:21},
      {...nuevaLinea("Soporte"),precio:50,iva:10},
      {...nuevaLinea("Módulo"),precio:20,iva:0},
    ];
    f.descuentoGlobal=10; f.retencion=15;
    const t = totalesFactura(f);
    expect(t.subtotal).toBe(250); expect(t.descuentoGlobal).toBe(25);
    expect(t.base).toBe(225); expect(t.iva).toBe(47.25);
    expect(t.retencion).toBe(33.75); expect(t.total).toBe(238.5);
    expect(t.lineas[0].baseAntesGlobal).toBe(180);
  });
  it("quita el IVA completo sin borrar los porcentajes y los recupera al activarlo", () => {
    const f=nuevaFactura();
    f.lineas=[{...nuevaLinea(),precio:100,iva:21},{...nuevaLinea(),precio:50,iva:10}];
    f.aplicarIva=false;
    expect(totalesFactura(f).grupos).toEqual([]);
    expect(totalesFactura(f).iva).toBe(0);
    expect(totalesFactura(f).total).toBe(150);
    expect(f.lineas.map(l=>l.iva)).toEqual([21,10]);
    f.aplicarIva=true;
    expect(totalesFactura(f).total).toBe(181.5);
  });
  it("un descuento global del 100% deja a cero base, impuestos y retención", () => {
    const f=nuevaFactura(); f.lineas=[{...nuevaLinea(),precio:125.99}];
    f.descuentoGlobal=100; f.retencion=15;
    expect(totalesFactura(f).total).toBe(0);
    expect(mensualFactura(f)).toBe(0);
  });
  it("aplica un único porcentaje al total neto e ignora el IVA antiguo de los módulos",()=>{
    const f=nuevaFactura();f.ivaGlobal=10;
    f.lineas=[{...nuevaLinea(),precio:100,iva:21},{...nuevaLinea(),precio:50,iva:0}];
    f.descuentoGlobal=10;
    expect(totalesFactura(f).grupos).toEqual([{tipo:10,base:135,importe:13.5}]);
    expect(totalesFactura(f).total).toBe(148.5);
    f.lineas=[{...nuevaLinea(),precio:0.03},{...nuevaLinea(),precio:0.03}];f.ivaGlobal=21;f.descuentoGlobal=0;
    expect(totalesFactura(f).iva).toBe(0.01);
  });

});

describe("recibos sin datos fiscales (17/11/2026)", () => {
  it("un recibo nuevo nace sin IVA, sin retención y sin datos fiscales de nadie", () => {
    const f = nuevoRecibo();
    expect(f).toMatchObject({ aplicarIva: false, retencion: 0, tipo: "licencia" });
    expect(f.ivaGlobal).toBeUndefined();
    expect(f.emisor).toEqual({ nombre: "OficiosOsIA", nif: "", direccion: "", email: "" });
    expect(nuevaLinea().iva).toBe(0);
    expect(sinDatosFiscales(f)).toBe(f); // ya está limpio: mismo objeto
  });
  it("una factura antigua se trata como recibo: se le quitan NIF, dirección, email, IVA y retención", () => {
    const vieja = nuevaFactura();
    vieja.emisor = { nombre: "OficiosOsIA", nif: "B00000000", direccion: "Calle Mayor 1", email: "a@b.test" };
    vieja.cliente = { nombre: "Casa Tomás", nif: "B11111111", direccion: "Plaza 2", email: "c@d.test" };
    vieja.lineas = [{ ...nuevaLinea("Licencia"), concepto: "Licencia", precio: 100, iva: 21 }];
    vieja.retencion = 15;
    expect(totalesFactura(vieja).total).toBe(106); // 100 + 21 − 15, como estaba guardada
    const recibo = sinDatosFiscales(vieja);
    expect(recibo.emisor).toEqual({ nombre: "OficiosOsIA", nif: "", direccion: "", email: "" });
    expect(recibo.cliente).toEqual({ nombre: "Casa Tomás", nif: "", direccion: "", email: "" });
    expect(recibo).toMatchObject({ aplicarIva: false, retencion: 0 });
    const t = totalesRecibo(vieja);
    expect(t.total).toBe(100); expect(t.iva).toBe(0); expect(t.retencion).toBe(0); expect(t.grupos).toEqual([]);
    expect(vieja.cliente.nif).toBe("B11111111"); // no muta el original
  });
  it("da título al recibo según su tipo y su mes", () => {
    expect(tituloRecibo({})).toBe("Licencia global");
    expect(tituloRecibo({ tipo: "mensual", mes: "2026-11" })).toBe("Pago mensual · noviembre de 2026");
    expect(tituloRecibo({ tipo: "mensual" })).toBe("Pago mensual");
    expect(textoMesRecibo("2026-01")).toBe("enero de 2026");
    expect(textoMesRecibo("2026-00")).toBe("");
    expect(textoMesRecibo(undefined)).toBe("");
  });
});
