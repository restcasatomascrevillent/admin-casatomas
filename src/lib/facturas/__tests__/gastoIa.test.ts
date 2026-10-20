import { describe, expect, it } from "vitest";
import {
  type FilaGastoIa,
  fmtEurIa,
  fmtFechaCorta,
  normalizarFilas,
  normalizarGastoReal,
  resumirGastoIa,
  resumirGastoReal,
  textoTipoCambioReal,
  textoReparto,
  USD_EUR,
  usdAEur,
} from "../gastoIa";

const fila = (over: Partial<FilaGastoIa>): FilaGastoIa => ({
  funcion: "chat-facturas", coste_usd: 0, filas: 1, llamadas: 1, unidades: 1,
  filas_sin_tarifa: 0, documentos_ocr: 0, ultima: null, ...over,
});

describe("gasto de IA en euros", () => {
  it("usa el tipo de cambio de Costes", () => {
    expect(USD_EUR).toBe(0.92);
    expect(usdAEur(1)).toBeCloseTo(0.92);
    expect(usdAEur(null)).toBeNull();
  });

  it("formatea céntimos y milésimas sin parecer gratis", () => {
    expect(fmtEurIa(0.2264 * 0.92)).toBe("0,21 €");
    expect(fmtEurIa(0.00111)).toBe("0,001 €");
    expect(fmtEurIa(0.00004)).toBe("0,0000 €");
    expect(fmtEurIa(12.5)).toBe("12,50 €");
    expect(fmtEurIa(0)).toBe("0 €");
    expect(fmtEurIa(null)).toBe("sin datos");
  });

  it("chatbot: total, preguntas y coste por pregunta (caso real del 08/10)", () => {
    const r = resumirGastoIa([
      fila({ funcion: "chat-facturas", coste_usd: 0.2264, filas: 189, llamadas: 372, unidades: 187 }),
    ], "chat");
    expect(r.eur).toBeCloseTo(0.2264 * 0.92);
    expect(r.unidades).toBe(187);
    expect(r.unidadTexto).toBe("preguntas");
    expect(fmtEurIa(r.porUnidadEur)).toBe("0,001 €");
    expect(r.desglose.find((l) => l.clave === "ocr")?.eur).toBeNull();
  });

  it("OCR sin filas: sin datos todavía (nunca 0 €)", () => {
    const r = resumirGastoIa([fila({ funcion: "chat-facturas", coste_usd: 0.1 })], "ocr");
    expect(r.eur).toBeNull();
    expect(r.porUnidadEur).toBeNull();
    expect(resumirGastoIa([], "chat").eur).toBeNull();
    expect(resumirGastoIa([], "chat").totalFacturasEur).toBeNull();
  });

  it("OCR: procesar-factura + ocr-trabajo + clasificación, por documento distinto", () => {
    const r = resumirGastoIa([
      fila({ funcion: "ocr-trabajo", coste_usd: 0.03, unidades: 2, documentos_ocr: 3 }),
      fila({ funcion: "procesar-factura", coste_usd: 0.01, unidades: 2, documentos_ocr: 3 }),
      fila({ funcion: "clasificar-productos", coste_usd: 0.005, unidades: 4 }),
      fila({ funcion: "chat-facturas", coste_usd: 1, unidades: 10 }),
    ], "ocr");
    expect(r.eur).toBeCloseTo(0.045 * 0.92);
    expect(r.unidades).toBe(3);
    expect(r.unidadTexto).toBe("documentos");
    expect(r.porUnidadEur).toBeCloseTo((0.045 * 0.92) / 3);
    expect(r.desglose.map((l) => l.clave)).toEqual(["chat", "ocr", "clasificacion"]);
    expect(r.desglose[1].eur).toBeCloseTo(0.04 * 0.92);
    expect(r.totalFacturasEur).toBeCloseTo(1.045 * 0.92);
  });

  it("normaliza numeric como texto y descarta basura", () => {
    const f = normalizarFilas([{ funcion: "ocr-trabajo", coste_usd: "0.5", filas: "2", llamadas: 2, unidades: 1, filas_sin_tarifa: 0, documentos_ocr: "1", ultima: null }, null, 3]);
    expect(f).toHaveLength(1);
    expect(f[0].coste_usd).toBe(0.5);
    expect(f[0].documentos_ocr).toBe(1);
    expect(normalizarFilas(null)).toEqual([]);
  });
});

describe("gasto real de OpenAI", () => {
  const filas = [
    { proceso: "ocr", usd_real: "2", ultimo_dia_real: "2026-10-07", usd_estimado_hoy: "0.2" },
    { proceso: "chat", usd_real: 1, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0 },
    { proceso: "otros", usd_real: 0, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0 },
  ];
  const tipo = [{ eur_por_usd: "0.9", fecha: "2026-10-07", fuente: "bce" }];

  it("pasa a euros con el tipo del BCE y suma real + hoy", () => {
    const g = normalizarGastoReal(filas, tipo)!;
    const r = resumirGastoReal(g, "ocr");
    expect(r.procesoRealEur).toBeCloseTo(1.8);
    expect(r.procesoHoyEur).toBeCloseTo(0.18);
    expect(r.procesoEur).toBeCloseTo(1.98);
    expect(r.totalEur).toBeCloseTo(2.88); // (3 + 0,2) x 0,9
    expect(r.lineas.map((l) => l.clave)).toEqual(["ocr", "chat", "otros"]);
  });

  it("sin_asignar solo aparece si tiene importe", () => {
    const g = normalizarGastoReal([...filas, { proceso: "sin_asignar", usd_real: 1, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0 }], tipo)!;
    expect(resumirGastoReal(g, "chat").lineas.map((l) => l.clave)).toContain("sin_asignar");
  });

  it("reparto por clave: chatweb, vinos y sub-líneas de otros; sin_asignar no suma al total", () => {
    const f = (proceso: string, usd_real: number, hoy = 0) => ({ proceso, usd_real, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: hoy, reparto: "clave_tarifa" });
    const g = normalizarGastoReal(
      [f("ocr", 4), f("chat", 2), f("chatweb", 1), f("vinos", 1), f("otros", 2), f("otros:traducciones", 1.5), f("otros:novedades", 0.5), f("otros:resto", 0), f("sin_asignar", 10)],
      [{ eur_por_usd: 0.5, fecha: "2026-10-07", fuente: "bce" }],
    )!;
    expect(g.subs?.map((s) => s.proceso)).toEqual(["traducciones", "novedades", "resto"]);
    expect(g.filas.map((x) => x.proceso)).not.toContain("otros:traducciones");
    const r = resumirGastoReal(g, "chat");
    expect(r.lineas.map((l) => l.clave)).toEqual(["ocr", "chat", "chatweb", "vinos", "otros", "sin_asignar"]);
    expect(r.totalRealEur).toBeCloseTo(5); // (4+2+1+1+2) x 0,5; sin_asignar fuera
    expect(r.sinAsignarEur).toBeCloseTo(5);
    expect(r.lineas.find((l) => l.clave === "otros")!.sub.map((s) => [s.clave, s.etiqueta, s.totalEur])).toEqual([
      ["traducciones", "Traducciones", 0.75],
      ["novedades", "Novedades (formato)", 0.25],
    ]); // «resto» a 0 no se pinta
    expect(r.lineas.find((l) => l.clave === "chatweb")!.etiqueta).toBe("Chat de la web");
    expect(r.lineas.find((l) => l.clave === "vinos")!.etiqueta).toBe("Vinos desde foto");
    expect(r.repartoTexto).toBe("Real repartido por clave (tokens × tarifa)");
    expect(textoReparto("proyecto")).toContain("por proyecto");
    expect(textoReparto(null)).toBe("Real repartido por clave");
  });

  it("con la RPC antigua (sin chatweb/vinos/reparto) el modo real sigue igual", () => {
    const r = resumirGastoReal(normalizarGastoReal(filas, tipo)!, "chat");
    expect(r.lineas.every((l) => l.sub.length === 0)).toBe(true);
    expect(r.sinAsignarEur).toBe(0);
  });

  it("sin ultimo_dia_real, vacía o basura: null (manda el estimado)", () => {
    expect(normalizarGastoReal([], tipo)).toBeNull();
    expect(normalizarGastoReal(null, tipo)).toBeNull();
    expect(normalizarGastoReal(filas.map((f) => ({ ...f, ultimo_dia_real: null })), tipo)).toBeNull();
  });

  it("tipo ausente o absurdo: 0,92 por defecto", () => {
    expect(normalizarGastoReal(filas, null)!.tipo.fuente).toBe("por_defecto");
    expect(normalizarGastoReal(filas, [{ eur_por_usd: 50 }])!.tipo.eurPorUsd).toBe(USD_EUR);
  });

  it("textos de fecha y de tipo de cambio", () => {
    expect(fmtFechaCorta("2026-10-07")).toBe("7 oct");
    expect(fmtFechaCorta(null)).toBe("—");
    expect(textoTipoCambioReal({ eurPorUsd: 0.9231, fecha: "2026-10-07", fuente: "bce" })).toBe("1 USD = 0,923 EUR, BCE 7 oct");
    expect(textoTipoCambioReal({ eurPorUsd: 0.92, fecha: null, fuente: "por_defecto" })).toContain("por defecto");
  });
});
