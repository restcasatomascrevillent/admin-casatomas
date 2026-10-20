/**
 * Cuentas de la pantalla de Costes (Super Admin), sin DOM.
 *
 * Una sola vista del mes: fijos (€, declarados a mano) + IA (€, lo REAL que
 * factura OpenAI si hay datos; si no, el estimado de `ia_uso`). Regla de oro de
 * Costes: sin dato = `null` ("sin datos"), nunca 0.
 */
import type { CosteFijo, FilaCosteMes } from "@/hooks/useCostes";
import type { GastoRealMes } from "@/hooks/useGastoIa";
import {
  diasDelMes,
  diasEntre,
  primerDiaMesIso,
  resumirGastoReal,
  type LineaSub,
  type ProcesoGasto,
  type ResumenGastoReal,
} from "@/lib/facturas/gastoIa";
import { esNulo, USD_EUR } from "./formato";
import { iaUsdMes } from "./calculos";

export interface PartidaCoste {
  clave: string;
  etiqueta: string;
  tipo: "fijo" | "ia";
  /** € del mes en curso. null = sin datos / sin verificar. */
  mesEur: number | null;
  /** € del mes anterior. null = sin datos. */
  anteriorEur: number | null;
  /** Texto pequeño bajo la etiqueta (proveedor, «real + hoy estimado»…). */
  nota?: string;
  /** El importe del mes anterior es aproximado (resta de ventanas). */
  anteriorAprox?: boolean;
}

export type OrigenIa = "real" | "estimado" | "ninguno";

export interface ResumenCostesMes {
  partidas: PartidaCoste[];
  /** Suma de los fijos con importe verificado (un mínimo si `fijosSinVerificar > 0`). null si ninguno. */
  fijosEur: number | null;
  fijosSinVerificar: number;
  origenIa: OrigenIa;
  /** IA del mes: real + estimado de hoy, o el estimado de `ia_uso`. null = sin datos. */
  iaEur: number | null;
  /** Solo con real: lo ya cerrado y lo estimado de hoy por separado. */
  iaRealEur: number | null;
  iaHoyEur: number | null;
  /** IA del mes anterior (aproximada). null = sin datos. */
  iaAnteriorEur: number | null;
  /** IA proyectada a fin de mes. null = sin datos. */
  iaPrevisionEur: number | null;
  /** Fijos + IA del mes. null si falta alguna de las dos mitades. */
  totalEur: number | null;
  /** Fijos + IA proyectada. null si falta alguna de las dos mitades. */
  previsionEur: number | null;
  /** Último día cerrado con datos reales («7 oct»), si hay. */
  ultimoDiaReal: string | null;
  /** Resumen del real (tipo de cambio, reparto, sub-líneas de «otros»). */
  real: ResumenGastoReal | null;
  /** Sub-líneas ESTIMADAS de «otros». */
  subOtros: LineaSub[];
  /** Proyectos de OpenAI sin marcar (€): no suman. */
  sinAsignarEur: number;
}

const ETIQUETA: Record<ProcesoGasto, string> = {
  ocr: "Lectura de facturas",
  chat: "Chatbot de facturas",
  chatweb: "Chat de la web",
  vinos: "Vinos desde foto",
  otros: "Otros (traducciones, novedades)",
  sin_asignar: "Proyectos sin marcar",
};

const suma = (vs: Array<number | null>): number | null =>
  vs.every((v) => v === null) ? null : vs.reduce<number>((s, v) => s + (v ?? 0), 0);

/** Mayor primero; los «sin datos» al final. */
const porGasto = (a: PartidaCoste, b: PartidaCoste) =>
  (b.mesEur ?? -1) - (a.mesEur ?? -1) || a.etiqueta.localeCompare(b.etiqueta, "es");

export function construirResumenMes(args: {
  fijos: CosteFijo[] | undefined;
  real: GastoRealMes | null | undefined;
  mes: FilaCosteMes | null | undefined;
  hoy?: Date;
}): ResumenCostesMes {
  const { fijos, real, mes, hoy = new Date() } = args;
  const partidas: PartidaCoste[] = [];

  // ─── Fijos ─────────────────────────────────────────────────────────────────
  const activos = (fijos ?? []).filter((f) => f.activo);
  for (const f of activos) {
    const eur = esNulo(f.eur_mes) ? null : f.eur_mes;
    partidas.push({
      clave: `fijo:${f.id}`,
      etiqueta: f.concepto,
      tipo: "fijo",
      mesEur: eur,
      // Cuota recurrente: el mes anterior costó lo mismo.
      anteriorEur: eur,
      nota: eur === null ? `${f.proveedor} · sin verificar` : f.proveedor,
    });
  }
  const conImporte = activos.filter((f) => !esNulo(f.eur_mes));
  const fijosEur = conImporte.length > 0 ? conImporte.reduce((s, f) => s + (f.eur_mes as number), 0) : null;
  const fijosSinVerificar = activos.length - conImporte.length;

  // ─── IA ────────────────────────────────────────────────────────────────────
  const resumenReal = real ? resumirGastoReal(real.actual, "ocr") : null;
  const resumenAnterior = real?.anterior ? resumirGastoReal(real.anterior, "ocr") : null;
  let origenIa: OrigenIa = "ninguno";
  let iaEur: number | null = null;
  let iaRealEur: number | null = null;
  let iaHoyEur: number | null = null;
  let iaAnteriorEur: number | null = null;
  let iaPrevisionEur: number | null = null;
  let subOtros: LineaSub[] = [];
  let sinAsignarEur = 0;

  if (resumenReal) {
    origenIa = "real";
    iaRealEur = resumenReal.totalRealEur;
    iaHoyEur = resumenReal.totalHoyEur;
    iaEur = resumenReal.totalEur;
    iaAnteriorEur = resumenAnterior ? resumenAnterior.totalRealEur : null;
    sinAsignarEur = resumenReal.sinAsignarEur;
    subOtros = resumenReal.lineas.find((l) => l.clave === "otros")?.sub ?? [];
    for (const l of resumenReal.lineas) {
      if (l.clave === "sin_asignar") continue;
      const ant = resumenAnterior?.lineas.find((x) => x.clave === l.clave);
      partidas.push({
        clave: `ia:${l.clave}`,
        etiqueta: ETIQUETA[l.clave],
        tipo: "ia",
        mesEur: l.totalEur,
        anteriorEur: resumenAnterior ? (ant?.realEur ?? 0) : null,
        anteriorAprox: true,
        nota: l.hoyEur > 0 ? "real + hoy estimado" : "real (OpenAI)",
      });
    }
    // Previsión: ritmo de los días cerrados del mes, nunca por debajo de lo ya gastado.
    const diasCerrados = resumenReal.ultimoDia >= primerDiaMesIso(hoy) ? diasEntre(primerDiaMesIso(hoy), resumenReal.ultimoDia) : 0;
    iaPrevisionEur =
      diasCerrados > 0
        ? Math.max(iaEur, (resumenReal.totalRealEur / diasCerrados) * diasDelMes(hoy) + resumenReal.totalHoyEur)
        : iaEur;
  } else {
    // Sin gasto real de OpenAI: lo medido en `ia_uso` (USD → EUR con el tipo fijo de Costes).
    const acumulado = esNulo(mes?.coste_acumulado_usd) ? null : (mes?.coste_acumulado_usd as number) * USD_EUR;
    const proy = iaUsdMes(mes);
    const proyEur = proy.usd === null ? null : proy.usd * USD_EUR;
    iaEur = acumulado ?? proyEur;
    iaPrevisionEur = proyEur ?? acumulado;
    origenIa = iaEur === null ? "ninguno" : "estimado";
    if (iaEur !== null) {
      partidas.push({
        clave: "ia:estimado",
        etiqueta: "IA (OpenAI), estimada",
        tipo: "ia",
        mesEur: iaEur,
        anteriorEur: null,
        nota: "tokens × tarifa; sin gasto real todavía",
      });
    }
  }

  partidas.sort(porGasto);

  const totalEur = fijosEur === null || iaEur === null ? null : fijosEur + iaEur;
  const previsionEur = fijosEur === null || iaPrevisionEur === null ? null : fijosEur + iaPrevisionEur;

  return {
    partidas,
    fijosEur,
    fijosSinVerificar,
    origenIa,
    iaEur,
    iaRealEur,
    iaHoyEur,
    iaAnteriorEur,
    iaPrevisionEur,
    totalEur,
    previsionEur,
    ultimoDiaReal: resumenReal?.ultimoDia || null,
    real: resumenReal,
    subOtros,
    sinAsignarEur,
  };
}

/** Total de una columna de la tabla (null si ninguna partida tiene dato). */
export const totalColumna = (partidas: PartidaCoste[], col: "mesEur" | "anteriorEur"): number | null =>
  suma(partidas.map((p) => p[col]));
