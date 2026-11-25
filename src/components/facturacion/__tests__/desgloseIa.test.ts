import { describe, expect, it } from "vitest";
import type { FilaCostePorUso } from "@/lib/costesServicios";
import { CONCEPTO_OTROS, CONCEPTO_SIN_ASIGNAR, desgloseIa, importesDesglose, textoUsos } from "../desgloseIa";
import { lineaDeGasto, aplicarGastosServicios, prepararNuevaFactura } from "../catalogo";
import { facturaSchema, nuevaFactura, totalesRecibo } from "../modelo";

const fila = (funcion: string, costeUsd: number | null, usos = 1, servidorPropio = false): FilaCostePorUso => ({
  funcion, queHace: null, accion: null, unidad: "llamada", orden: 1, llamadas: usos, usos, usosConCoste: usos, costeUsd,
  filasSinTarifa: 0, modelosSinTarifa: [], medianaUsd: null, mediaUsd: null, servidorPropio,
});
const suma = (xs: { importe: number }[]) => Math.round(xs.reduce((t, x) => t + x.importe, 0) * 100) / 100;

describe("desglose de la IA en el recibo mensual", () => {
  it("agrupa por lo que se ha hecho, con los pedidos por el dueño primero y «Sin asignar» con lo que falta", () => {
    const r = desgloseIa(
      [fila("ocr-trabajo", 5, 100), fila("procesar-factura", 1, 900), fila("chat-facturas", 2, 30), fila("chat-web", 1, 10), fila("extraer-vino-foto", 0.5, 4),
        fila("traducir-contenido", 0.2, 50), fila("format-novedad", 0.1, 3), fila("instagram-ia", 3, 5), fila("newsletter-ia", 0.05, 1), fila("funcion-nueva", 0.05, 2),
        fila("recortar-foto", 0, 9, true)],
      20, 1,
    )!;
    expect(r.proporcional).toBe(false);
    expect(r.registradoEur).toBeCloseTo(12.9);
    expect(r.desglose.map((d) => d.concepto)).toEqual([
      "Subir y leer facturas", "Chat (Facturas y web)", "Leer etiquetas de vino", "Traducir la carta", "Generar novedades",
      "Instagram y redes sociales", CONCEPTO_OTROS, CONCEPTO_SIN_ASIGNAR,
    ]);
    expect(r.desglose[0]).toMatchObject({ usos: 1000 });
    expect(r.desglose.find((d) => d.concepto === CONCEPTO_OTROS)).toMatchObject({ usos: 3 }); // newsletter + función sin grupo
    const euros = importesDesglose(20, r.desglose);
    expect(suma(euros)).toBe(20);
    expect(euros[0].importe).toBe(6);
    expect(euros.at(-1)).toMatchObject({ concepto: CONCEPTO_SIN_ASIGNAR, importe: 7.1 });
  });

  it("si lo apuntado pasa de la línea, la reparte en proporción (sin «Sin asignar» negativo)", () => {
    const r = desgloseIa([fila("ocr-trabajo", 3), fila("chat-facturas", 1)], 2, 1)!;
    expect(r.proporcional).toBe(true);
    expect(importesDesglose(2, r.desglose)).toEqual([
      { concepto: "Subir y leer facturas", importe: 1.5, usos: 1 },
      { concepto: "Chat (Facturas y web)", importe: 0.5, usos: 1 },
    ]);
  });

  it("sin nada apuntado (o línea a 0 €) no hay desglose", () => {
    expect(desgloseIa([], 10, 0.9)).toBeNull();
    expect(desgloseIa([fila("ocr-trabajo", null), fila("recortar-foto", 1, 1, true)], 10, 0.9)).toBeNull();
    expect(desgloseIa([fila("ocr-trabajo", 1)], 0, 0.9)).toBeNull();
  });

  it("los céntimos cuadran siempre con el importe de la línea", () => {
    const partes = [{ concepto: "A", parte: 1 / 3 }, { concepto: "B", parte: 1 / 3 }, { concepto: "C", parte: 1 / 3 }];
    expect(importesDesglose(1, partes).map((x) => x.importe)).toEqual([0.34, 0.33, 0.33]);
    expect(suma(importesDesglose(123.45, partes))).toBe(123.45);
    expect(importesDesglose(5, undefined)).toEqual([]);
    expect(textoUsos(1858)).toBe("1.858 usos");
    expect(textoUsos(1)).toBe("1 uso");
  });

  it("en el recibo: va dentro de la línea de OpenAI, se guarda y no cambia el total; con descuento sigue cuadrando", () => {
    const { desglose } = desgloseIa([fila("ocr-trabajo", 6), fila("chat-facturas", 2)], 10, 1)!;
    const gasto = { proveedor: "openai", nombre: "OpenAI", categoria: "IA", importe: 10, origen: "estimado" as const, desglose };
    expect(lineaDeGasto(gasto).desglose).toEqual(desglose);
    const f = aplicarGastosServicios(prepararNuevaFactura(nuevaFactura(), [], "mensual"), [gasto]);
    expect(facturaSchema.safeParse(f).success).toBe(true);
    expect(facturaSchema.parse(f).lineas.find((l) => l.proveedor === "openai")?.desglose).toEqual(desglose); // no se pierde al guardar
    const sinDesglose = aplicarGastosServicios(prepararNuevaFactura(nuevaFactura(), [], "mensual"), [{ ...gasto, desglose: undefined }]);
    expect(totalesRecibo(f).total).toBe(totalesRecibo(sinDesglose).total);
    const conDescuento = { ...f, lineas: f.lineas.map((l) => (l.proveedor === "openai" ? { ...l, descuento: 15 } : l)) };
    const linea = totalesRecibo(conDescuento).lineas.find((l) => l.proveedor === "openai")!;
    expect(suma(importesDesglose(linea.baseAntesGlobal, linea.desglose))).toBe(8.5);
  });
});
