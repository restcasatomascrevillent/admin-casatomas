import { describe, expect, it } from "vitest";
import {
  type FilaResumenMes,
  costeServicioMes,
  costesFaltantes,
  cuentaFaltantes,
  informeCsv,
  informeMes,
  mesAnterior,
  mesDe,
  nombreArchivoInforme,
  normalizarResumenMes,
  textoDiferenciaPct,
  textoMes,
  textoMesCorto,
  ultimosMeses,
} from "@/lib/informeServicios";
import type { ServicioContratado } from "@/lib/servicios";

const servicio = (p: Partial<ServicioContratado> & Pick<ServicioContratado, "proveedor" | "nombre">): ServicioContratado => ({
  plan: "Free", precio_mensual: 0, moneda: "USD", ciclo: "gratuito", renovacion: null, cuenta: null, panel_url: null, limites: {},
  notas: null, actualizado_en: "2026-11-03T10:00:00Z", categoria: "otros", orden: 100, activo: true, por_confirmar: false,
  precio_anual: null, fuente_precio: null, ...p,
});
const fila = (p: Partial<FilaResumenMes> & Pick<FilaResumenMes, "proveedor">): FilaResumenMes => ({
  manual_importe: null, manual_moneda: null, manual_nota: null, coste_variable: null, ultima_lectura: null, lecturas: 0, ...p,
});
const uso = (importe: number, moneda = "USD") => ({ importe, moneda, periodo: "mes en curso", origen: "api" as const });

const VERCEL = servicio({ proveedor: "vercel", nombre: "Vercel" });
const HOSTING = servicio({ proveedor: "hostinger", nombre: "Hostinger", ciclo: "anual", precio_anual: 120, moneda: "EUR", precio_mensual: null });
const LOADING = servicio({ proveedor: "loading", nombre: "Loading (dominio, correo y web antigua)", ciclo: "anual", precio_mensual: null, moneda: "EUR" });
const OPENAI = servicio({ proveedor: "openai", nombre: "OpenAI", ciclo: "por_uso", precio_mensual: null });
const GOOGLE = servicio({ proveedor: "google", nombre: "Google Maps Platform (reseñas)", ciclo: "por_uso", precio_mensual: null });
const QUITADO = servicio({ proveedor: "perplexity", nombre: "Perplexity", ciclo: "por_uso", precio_mensual: null, activo: false });
const TODOS = [VERCEL, HOSTING, LOADING, OPENAI, GOOGLE, QUITADO];

describe("meses", () => {
  it("mesDe, mesAnterior (también cruzando el año), ultimosMeses y textos", () => {
    expect(mesDe(new Date("2026-11-10T23:30:00Z"))).toBe("2026-11-01");
    expect(mesAnterior("2026-01-01")).toBe("2025-12-01");
    expect(mesAnterior("2026-11-01", 3)).toBe("2026-08-01");
    expect(mesAnterior("2026-12-01", -1)).toBe("2027-01-01");
    expect(ultimosMeses(new Date("2026-02-15T00:00:00Z"), 3)).toEqual(["2026-02-01", "2026-01-01", "2025-12-01"]);
    expect(textoMes("2026-10-01")).toBe("octubre de 2026");
    expect(textoMesCorto("2026-10-01")).toBe("Octubre 2026");
    expect(nombreArchivoInforme("2026-10-01")).toBe("informe-servicios-2026-10");
  });
});

describe("normalizarResumenMes", () => {
  it("convierte numeric en texto, descarta filas raras y valida el coste de uso", () => {
    expect(normalizarResumenMes([
      { proveedor: "a", manual_importe: "12.50", manual_moneda: "EUR", lecturas: "3", coste_variable: { importe: 1, moneda: "USD" } },
      { proveedor: "b", coste_variable: { importe: "x" } },
      { nada: 1 },
      null,
    ])).toEqual([
      { proveedor: "a", manual_importe: 12.5, manual_moneda: "EUR", manual_nota: null, coste_variable: { importe: 1, moneda: "USD" }, ultima_lectura: null, lecturas: 3 },
      { proveedor: "b", manual_importe: null, manual_moneda: null, manual_nota: null, coste_variable: null, ultima_lectura: null, lecturas: 0 },
    ]);
    expect(normalizarResumenMes(null)).toEqual([]);
  });
});

describe("costeServicioMes", () => {
  it("lo metido a mano manda; si no, cuota + uso; gratis no pide nada", () => {
    expect(costeServicioMes(VERCEL, null, 0.9)).toMatchObject({ origen: "gratis", totalEur: 0, falta: null });
    expect(costeServicioMes(HOSTING, null, 0.9)).toMatchObject({ origen: "estimado", fijoEur: 10, totalEur: 10 });
    expect(costeServicioMes(HOSTING, fila({ proveedor: "hostinger", manual_importe: 95.88, manual_moneda: "EUR" }), 0.9))
      .toMatchObject({ origen: "manual", manualEur: 95.88, totalEur: 95.88 });
    expect(costeServicioMes(OPENAI, fila({ proveedor: "openai", coste_variable: uso(10) }), 0.9)).toMatchObject({ origen: "estimado", usoEur: 9, totalEur: 9 });
    // Un dólar que pasa a euros con el tipo de cambio, también lo metido a mano.
    expect(costeServicioMes(GOOGLE, fila({ proveedor: "google", manual_importe: 20, manual_moneda: "USD" }), 0.9)).toMatchObject({ origen: "manual", totalEur: 18 });
  });
  it("falta: sin precio, o de pago por uso sin coste ese mes", () => {
    expect(costeServicioMes(LOADING, null, 0.9)).toMatchObject({ origen: "falta", falta: "sin_precio", totalEur: 0 });
    expect(costeServicioMes(GOOGLE, fila({ proveedor: "google", lecturas: 5 }), 0.9)).toMatchObject({ origen: "falta", falta: "sin_coste_uso" });
    expect(costeServicioMes(LOADING, fila({ proveedor: "loading", manual_importe: 3 }), 0.9)).toMatchObject({ origen: "manual", falta: null, totalEur: 3 });
  });
  it("moneda desconocida: lo dice y no la suma", () => {
    const gbp = servicio({ proveedor: "x", nombre: "X", ciclo: "mensual", precio_mensual: 10, moneda: "GBP" });
    expect(costeServicioMes(gbp, null, 0.9)).toMatchObject({ monedaDesconocida: true, totalEur: 0 });
  });
});

describe("costesFaltantes", () => {
  const meses = ["2026-11-01", "2026-10-01", "2026-09-01"];
  it("sin precio una vez; por uso, los meses sin coste desde el primero con datos; lo quitado no", () => {
    const resumenes = new Map<string, FilaResumenMes[]>([
      ["2026-11-01", [fila({ proveedor: "openai", lecturas: 10, coste_variable: uso(1) }), fila({ proveedor: "google", lecturas: 0 })]],
      ["2026-10-01", [fila({ proveedor: "openai", lecturas: 4, coste_variable: uso(2) }), fila({ proveedor: "google", manual_importe: null })]],
      // Septiembre sin ningún dato: antes de que se midiera nada, no se revisa.
      ["2026-09-01", []],
    ]);
    const lista = costesFaltantes({ servicios: TODOS, resumenes, meses, eurPorUsd: 0.9 });
    expect(lista).toEqual([
      { proveedor: "google", nombre: "Google Maps Platform", motivo: "sin_coste_uso", meses: ["2026-11-01", "2026-10-01"], soloMesEnCurso: false },
      { proveedor: "loading", nombre: "Loading", motivo: "sin_precio", meses: [], soloMesEnCurso: false },
    ]);
    expect(cuentaFaltantes(lista)).toBe(2);
  });
  it("lo metido a mano completa el mes; si solo falta el mes en curso, se avisa sin contar", () => {
    const resumenes = new Map<string, FilaResumenMes[]>([
      ["2026-11-01", [fila({ proveedor: "openai", lecturas: 3, coste_variable: uso(1) })]],
      ["2026-10-01", [fila({ proveedor: "openai", lecturas: 3, coste_variable: uso(1) }), fila({ proveedor: "google", manual_importe: 4 })]],
      ["2026-09-01", []],
    ]);
    const lista = costesFaltantes({ servicios: [OPENAI, GOOGLE], resumenes, meses, eurPorUsd: 0.9 });
    expect(lista).toEqual([{ proveedor: "google", nombre: "Google Maps Platform", motivo: "sin_coste_uso", meses: ["2026-11-01"], soloMesEnCurso: true }]);
    expect(cuentaFaltantes(lista)).toBe(0);
  });
  it("sin los resúmenes (falta la migración), solo los que no tienen precio", () => {
    expect(costesFaltantes({ servicios: TODOS, resumenes: new Map(), meses, eurPorUsd: 0.9 }).map((f) => f.proveedor)).toEqual(["loading"]);
  });
});

describe("informeMes", () => {
  const hoy = new Date("2026-11-10T10:00:00Z");
  const octubre = [
    fila({ proveedor: "openai", lecturas: 30, coste_variable: uso(10) }),
    fila({ proveedor: "hostinger", manual_importe: 95.88, manual_moneda: "EUR", manual_nota: "Renovación anual" }),
  ];
  const septiembre = [fila({ proveedor: "openai", lecturas: 30, coste_variable: uso(5) })];

  it("gasto por servicio, total, comparación con el mes anterior y lo que falta", () => {
    const inf = informeMes({ mes: "2026-10-01", servicios: TODOS, resumen: octubre, resumenAnterior: septiembre, eurPorUsd: 0.9, hoy });
    expect(inf.filas.map((f) => [f.proveedor, f.totalEur, f.origen, f.anteriorEur])).toEqual([
      ["hostinger", 95.88, "manual", 10],
      ["openai", 9, "estimado", 4.5],
      ["google", 0, "falta", 0],
      ["loading", 0, "falta", 0],
      ["vercel", 0, "gratis", 0],
    ]);
    expect(inf).toMatchObject({ totalEur: 104.88, totalAnteriorEur: 14.5, diferenciaEur: 90.38, diferenciaPct: 623.3, manualEur: 95.88, estimadoEur: 9, enCurso: false, anterior: "2026-09-01" });
    expect(inf.faltan.map((f) => [f.proveedor, f.falta])).toEqual([["google", "sin_coste_uso"], ["loading", "sin_precio"]]);
  });

  it("sin datos del mes anterior no compara; el mes en curso se marca", () => {
    const inf = informeMes({ mes: "2026-11-01", servicios: [OPENAI], resumen: [fila({ proveedor: "openai", lecturas: 2, coste_variable: uso(1) })], resumenAnterior: [], eurPorUsd: 1, hoy });
    expect(inf).toMatchObject({ totalEur: 1, totalAnteriorEur: null, diferenciaEur: null, diferenciaPct: null, enCurso: true });
    expect(inf.filas[0].anteriorEur).toBeNull();
  });

  it("CSV con «;» y coma decimal, total, comparación y lo que falta", () => {
    const inf = informeMes({ mes: "2026-10-01", servicios: TODOS, resumen: octubre, resumenAnterior: septiembre, eurPorUsd: 0.9, hoy });
    const csv = informeCsv(inf).split("\r\n");
    expect(csv[0]).toBe("Informe de servicios · Octubre 2026");
    expect(csv[2]).toBe("Servicio;Cuota (€);Por uso (€);Metido a mano (€);Total (€);Septiembre 2026 (€);Diferencia (€);Origen;Nota");
    expect(csv[3]).toBe("Hostinger;10,00;;95,88;95,88;10,00;85,88;Metido a mano;Renovación anual");
    expect(csv).toContain("Loading;;;;0,00;0,00;0,00;Falta meterlo: falta el precio del plan;");
    expect(csv.find((l) => l.startsWith("Total;"))).toBe(`Total;;;;104,88;14,50;90,38;;${textoDiferenciaPct(623.3)} frente a septiembre de 2026`);
    expect(csv).toContain("Faltan por meter;Google Maps Platform, Loading");
  });
});
