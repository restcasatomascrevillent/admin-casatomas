/**
 * Super Admin › Servicios › Costes: costes que faltan por meter e informe
 * mensual (petición del dueño, 10/11/2026: «controlar los costes faltantes por
 * meter y un generador de informes mensuales»). Sin React.
 *
 * De dónde sale el coste de un servicio en un mes:
 *   1. Lo metido a mano para ese mes (`servicios_costes_mes`: factura, cargo en
 *      la tarjeta…). Si existe, manda.
 *   2. Si no, la estimación: la cuota del plan (precio de HOY: no hay historial
 *      de precios) + lo gastado por uso según la última lectura de ese mes
 *      (`servicios_uso.coste_variable`).
 *
 * Falta meter el coste cuando no se puede saber:
 *   · «sin precio»: el servicio de pago no tiene precio apuntado (p. ej. un
 *     dominio anual sin importe). Se completa poniendo el precio en su ficha.
 *   · «sin coste de uso»: es de pago por uso y ese mes no hay lectura con su
 *     coste (Google Maps, o un mes sin lecturas). Se completa metiendo el
 *     importe de su factura de ese mes.
 * Lo gratuito no pide nada.
 */
import {
  type CosteVariable,
  type ServicioContratado,
  aEur,
  costeVariableDe,
  cuotaMensual,
  formatearEur,
  sinAclaracion,
} from "@/lib/servicios";

/** Una fila de `servicios_resumen_mes(p_mes)`. */
export interface FilaResumenMes {
  proveedor: string;
  manual_importe: number | null;
  manual_moneda: string | null;
  manual_nota: string | null;
  coste_variable: CosteVariable | null;
  ultima_lectura: string | null;
  lecturas: number;
}

/** Meses que se revisan para avisar de lo que falta: este y los dos anteriores. */
export const MESES_REVISADOS = 3;

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** «2026-11-01»: el mes (UTC) de una fecha. */
export function mesDe(fecha: Date): string {
  return `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** El mes `n` meses antes (n < 0: después) de «AAAA-MM-01». */
export function mesAnterior(mes: string, n = 1): string {
  const [a, m] = mes.split("-").map(Number);
  return mesDe(new Date(Date.UTC(a, m - 1 - n, 1)));
}

/** [este mes, el anterior, …] (`cuantos` meses). */
export function ultimosMeses(hoy: Date, cuantos: number): string[] {
  const actual = mesDe(hoy);
  return Array.from({ length: cuantos }, (_, i) => mesAnterior(actual, i));
}

/** «octubre de 2026». */
export function textoMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return `${MESES[m - 1] ?? "?"} de ${a}`;
}

/** «Octubre 2026» (cabeceras cortas). */
export function textoMesCorto(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  const nombre = MESES[m - 1] ?? "?";
  return `${nombre[0].toUpperCase()}${nombre.slice(1)} ${a}`;
}

const redondear2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** Normaliza lo que devuelve la RPC (numeric puede llegar como texto). */
export function normalizarResumenMes(filas: unknown): FilaResumenMes[] {
  if (!Array.isArray(filas)) return [];
  return filas
    .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null && typeof (f as { proveedor?: unknown }).proveedor === "string")
    .map((f) => ({
      proveedor: String(f.proveedor),
      manual_importe: num(f.manual_importe),
      manual_moneda: typeof f.manual_moneda === "string" ? f.manual_moneda : null,
      manual_nota: typeof f.manual_nota === "string" ? f.manual_nota : null,
      coste_variable: costeVariableDe({ coste_variable: f.coste_variable as CosteVariable | null }),
      ultima_lectura: typeof f.ultima_lectura === "string" ? f.ultima_lectura : null,
      lecturas: num(f.lecturas) ?? 0,
    }));
}

export type MotivoFalta = "sin_precio" | "sin_coste_uso";

export const TEXTO_FALTA: Record<MotivoFalta, string> = {
  sin_precio: "Falta el precio del plan",
  sin_coste_uso: "Falta el coste de uso de ese mes",
};

export type OrigenCoste = "manual" | "estimado" | "falta" | "gratis";

export interface CosteServicioMes {
  proveedor: string;
  nombre: string;
  categoria: string;
  /** Cuota del plan en euros (null = sin precio). */
  fijoEur: number | null;
  /** Por uso según la última lectura del mes, en euros (null = sin dato). */
  usoEur: number | null;
  /** Lo metido a mano, en euros. */
  manualEur: number | null;
  manualNota: string | null;
  /** Lo que cuenta: lo manual o la estimación (lo que se sepa). */
  totalEur: number;
  origen: OrigenCoste;
  /** Por qué falta (solo con origen «falta»). */
  falta: MotivoFalta | null;
  /** La cuota o el importe está en una moneda que no se sabe pasar a euros. */
  monedaDesconocida: boolean;
}

const esGratis = (s: ServicioContratado) => {
  const c = cuotaMensual(s);
  return c != null && c.importe === 0 && s.ciclo !== "por_uso";
};

/** El coste de un servicio en un mes (ver la cabecera). */
export function costeServicioMes(s: ServicioContratado, fila: FilaResumenMes | null | undefined, eurPorUsd: number): CosteServicioMes {
  const cuota = cuotaMensual(s);
  const fijoEur = cuota ? aEur(cuota.importe, cuota.moneda, eurPorUsd) : null;
  const variable = fila?.coste_variable ?? null;
  const usoEur = variable ? aEur(variable.importe, variable.moneda, eurPorUsd) : null;
  const manualEur = fila?.manual_importe != null ? aEur(fila.manual_importe, fila.manual_moneda ?? "EUR", eurPorUsd) : null;
  const monedaDesconocida = (cuota != null && fijoEur == null) || (variable != null && usoEur == null) || (fila?.manual_importe != null && manualEur == null);
  let falta: MotivoFalta | null = null;
  if (manualEur == null) {
    if (cuota == null) falta = "sin_precio";
    else if (s.ciclo === "por_uso" && variable == null) falta = "sin_coste_uso";
  }
  const estimado = (fijoEur ?? 0) + (usoEur ?? 0);
  const origen: OrigenCoste = manualEur != null ? "manual" : falta ? "falta" : esGratis(s) && !usoEur ? "gratis" : "estimado";
  return {
    proveedor: s.proveedor,
    nombre: sinAclaracion(s.nombre),
    categoria: s.categoria,
    fijoEur: fijoEur == null ? null : redondear2(fijoEur),
    usoEur: usoEur == null ? null : redondear2(usoEur),
    manualEur: manualEur == null ? null : redondear2(manualEur),
    manualNota: fila?.manual_nota ?? null,
    totalEur: redondear2(manualEur ?? estimado),
    origen,
    falta,
    monedaDesconocida,
  };
}

export interface CosteFaltante {
  proveedor: string;
  nombre: string;
  motivo: MotivoFalta;
  /** Meses sin coste («AAAA-MM-01», del más reciente al más antiguo). Vacío con «sin precio». */
  meses: string[];
  /** Solo falta el mes en curso (aún sin factura): se avisa, pero no cuenta como pendiente. */
  soloMesEnCurso: boolean;
}

/**
 * Lo que falta por meter en los últimos meses (`meses`, del más reciente al más
 * antiguo; el primero es el mes en curso). No se revisan los meses anteriores al
 * primero con datos (lecturas o costes metidos): antes no se medía nada.
 */
export function costesFaltantes(args: {
  servicios: ServicioContratado[];
  resumenes: Map<string, FilaResumenMes[]>;
  meses: string[];
  eurPorUsd: number;
}): CosteFaltante[] {
  const { servicios, resumenes, eurPorUsd } = args;
  const enCurso = args.meses[0];
  const conDatos = args.meses.filter((m) => (resumenes.get(m) ?? []).some((f) => f.lecturas > 0 || f.manual_importe != null));
  const primero = conDatos.length ? conDatos[conDatos.length - 1] : enCurso;
  const meses = args.meses.filter((m) => m >= primero && resumenes.has(m));
  const salida: CosteFaltante[] = [];
  for (const s of servicios) {
    if (s.activo === false) continue;
    if (cuotaMensual(s) == null) {
      salida.push({ proveedor: s.proveedor, nombre: sinAclaracion(s.nombre), motivo: "sin_precio", meses: [], soloMesEnCurso: false });
      continue;
    }
    const sinCoste = meses.filter((m) => {
      const fila = (resumenes.get(m) ?? []).find((f) => f.proveedor === s.proveedor);
      return costeServicioMes(s, fila, eurPorUsd).falta === "sin_coste_uso";
    });
    if (sinCoste.length) {
      salida.push({
        proveedor: s.proveedor, nombre: sinAclaracion(s.nombre), motivo: "sin_coste_uso", meses: sinCoste,
        soloMesEnCurso: sinCoste.length === 1 && sinCoste[0] === enCurso,
      });
    }
  }
  return salida.sort((a, b) => Number(a.soloMesEnCurso) - Number(b.soloMesEnCurso) || a.nombre.localeCompare(b.nombre, "es"));
}

/** Cuántas cosas pendientes de verdad (sin contar lo que solo falta del mes en curso). */
export const cuentaFaltantes = (lista: CosteFaltante[]) => lista.filter((f) => !f.soloMesEnCurso).length;

export interface InformeMes {
  mes: string;
  anterior: string;
  filas: Array<CosteServicioMes & { anteriorEur: number | null; diferenciaEur: number | null }>;
  totalEur: number;
  /** null: el mes anterior no tiene ningún dato. */
  totalAnteriorEur: number | null;
  diferenciaEur: number | null;
  /** % frente al mes anterior (null si el anterior es 0 o no hay datos). */
  diferenciaPct: number | null;
  manualEur: number;
  estimadoEur: number;
  faltan: CosteServicioMes[];
  /** El mes elegido es el mes en curso: las cifras aún pueden crecer. */
  enCurso: boolean;
  eurPorUsd: number;
}

/** El informe de un mes: gasto por servicio, total, comparación con el mes anterior y lo que falta. */
export function informeMes(args: {
  mes: string;
  servicios: ServicioContratado[];
  resumen: FilaResumenMes[];
  resumenAnterior: FilaResumenMes[] | null;
  eurPorUsd: number;
  hoy?: Date;
}): InformeMes {
  const { mes, servicios, resumen, resumenAnterior, eurPorUsd, hoy = new Date() } = args;
  const anterior = mesAnterior(mes);
  const fila = (lista: FilaResumenMes[] | null, p: string) => lista?.find((f) => f.proveedor === p) ?? null;
  const anteriorConDatos = !!resumenAnterior?.some((f) => f.lecturas > 0 || f.manual_importe != null);
  const filas = servicios
    .filter((s) => s.activo !== false)
    .map((s) => {
      const c = costeServicioMes(s, fila(resumen, s.proveedor), eurPorUsd);
      const anteriorEur = anteriorConDatos ? costeServicioMes(s, fila(resumenAnterior, s.proveedor), eurPorUsd).totalEur : null;
      return { ...c, anteriorEur, diferenciaEur: anteriorEur == null ? null : redondear2(c.totalEur - anteriorEur) };
    })
    .sort((a, b) => b.totalEur - a.totalEur || a.nombre.localeCompare(b.nombre, "es"));
  const totalEur = redondear2(filas.reduce((t, f) => t + f.totalEur, 0));
  const totalAnteriorEur = anteriorConDatos ? redondear2(filas.reduce((t, f) => t + (f.anteriorEur ?? 0), 0)) : null;
  const diferenciaEur = totalAnteriorEur == null ? null : redondear2(totalEur - totalAnteriorEur);
  return {
    mes,
    anterior,
    filas,
    totalEur,
    totalAnteriorEur,
    diferenciaEur,
    diferenciaPct: totalAnteriorEur && diferenciaEur != null ? Math.round((diferenciaEur / totalAnteriorEur) * 1000) / 10 : null,
    manualEur: redondear2(filas.filter((f) => f.origen === "manual").reduce((t, f) => t + f.totalEur, 0)),
    estimadoEur: redondear2(filas.filter((f) => f.origen === "estimado").reduce((t, f) => t + f.totalEur, 0)),
    faltan: filas.filter((f) => f.origen === "falta"),
    enCurso: mes === mesDe(hoy),
    eurPorUsd,
  };
}

export const TEXTO_ORIGEN: Record<OrigenCoste, string> = {
  manual: "Metido a mano",
  estimado: "Estimado",
  falta: "Falta meterlo",
  gratis: "Gratis",
};

/** «+12,5 %», «−3 %», «=». */
export function textoDiferenciaPct(p: number | null): string | null {
  if (p == null) return null;
  if (p === 0) return "=";
  return `${p > 0 ? "+" : "−"}${Math.abs(p).toLocaleString("es-ES", { maximumFractionDigits: 1 })}\u00a0%`;
}

/** «+3,20 €», «−1,00 €». */
export function textoDiferenciaEur(n: number | null): string | null {
  if (n == null) return null;
  if (n === 0) return formatearEur(0);
  return `${n > 0 ? "+" : "−"}${formatearEur(Math.abs(n))}`;
}

const celdaCsv = (v: string | number | null) => {
  if (v == null) return "";
  const t = typeof v === "number" ? v.toFixed(2).replace(".", ",") : v;
  return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/**
 * CSV del informe (separado por «;» y con coma decimal: lo abre bien Excel en
 * español). Una fila por servicio y, al final, el total y la comparación.
 */
export function informeCsv(inf: InformeMes): string {
  const lineas: Array<Array<string | number | null>> = [
    [`Informe de servicios · ${textoMesCorto(inf.mes)}${inf.enCurso ? " (mes en curso)" : ""}`],
    [],
    ["Servicio", "Cuota (€)", "Por uso (€)", "Metido a mano (€)", "Total (€)", `${textoMesCorto(inf.anterior)} (€)`, "Diferencia (€)", "Origen", "Nota"],
    ...inf.filas.map((f) => [
      f.nombre, f.fijoEur, f.usoEur, f.manualEur, f.totalEur, f.anteriorEur, f.diferenciaEur,
      f.origen === "falta" && f.falta ? `${TEXTO_ORIGEN.falta}: ${TEXTO_FALTA[f.falta].toLowerCase()}` : TEXTO_ORIGEN[f.origen],
      f.manualNota,
    ]),
    [],
    ["Total", null, null, null, inf.totalEur, inf.totalAnteriorEur, inf.diferenciaEur, null, inf.diferenciaPct == null ? null : `${textoDiferenciaPct(inf.diferenciaPct)} frente a ${textoMes(inf.anterior)}`],
    ["Faltan por meter", inf.faltan.length ? inf.faltan.map((f) => f.nombre).join(", ") : "Nada"],
    ["Tipo de cambio", `1 US$ = ${inf.eurPorUsd.toLocaleString("es-ES", { maximumFractionDigits: 4 })} €`],
  ];
  return lineas.map((l) => l.map(celdaCsv).join(";")).join("\r\n") + "\r\n";
}

/** «informe-servicios-2026-10». */
export const nombreArchivoInforme = (mes: string) => `informe-servicios-${mes.slice(0, 7)}`;
