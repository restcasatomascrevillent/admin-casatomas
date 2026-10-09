// ============================================================================
//  MONITOR DE GASTO DE IA EN FACTURAS — cuentas puras (sin DOM)
// ----------------------------------------------------------------------------
//  Encargo del dueño (08-oct-2026): lo gastado en IA el último mes, en EUROS,
//  por proceso, visible en «IA» (chatbot) y en «Cargar» (OCR). Los datos
//  salen de `gasto_ia_resumen` (agregados de `ia_uso`, en USD) y se pasan a
//  euros con el MISMO tipo de cambio que Super Admin › Costes (`USD_EUR`).
//
//  Regla de oro de Costes: sin filas = «sin datos todavía», nunca «0 €».
// ============================================================================

import { USD_EUR } from "@/components/costes/formato";

export { USD_EUR };

/** Una fila de `gasto_ia_resumen` (una por función). */
export interface FilaGastoIa {
  funcion: string;
  coste_usd: number | null;
  filas: number;
  llamadas: number;
  /** Preguntas (chat), tandas (clasificación) o documentos distintos (OCR). */
  unidades: number;
  filas_sin_tarifa: number;
  /** Documentos distintos entre procesar-factura y ocr-trabajo (igual en todas las filas). */
  documentos_ocr: number;
  ultima: string | null;
}

export type ModoMonitor = "chat" | "ocr";

/** Funciones que entran en el monitor (las mismas que acepta la RPC). */
export const FUNCIONES_GASTO_IA = ["chat-facturas", "procesar-factura", "ocr-trabajo", "clasificar-productos"] as const;
export const DIAS_GASTO_IA = 30;

export interface LineaDesglose {
  clave: "chat" | "ocr" | "clasificacion";
  etiqueta: string;
  /** null = sin filas todavía. */
  eur: number | null;
  unidades: number;
  unidad: string;
}

export interface ResumenGastoIa {
  /** Gasto del proceso de la pestaña (EUR). null = sin datos todavía. */
  eur: number | null;
  unidades: number;
  /** «pregunta» o «documento», ya en singular/plural según `unidades`. */
  unidadTexto: string;
  porUnidadEur: number | null;
  desglose: LineaDesglose[];
  /** Todo lo de Facturas (EUR). null si no hay ninguna fila. */
  totalFacturasEur: number | null;
  /** Filas con un modelo sin tarifa: su coste no se suma (aviso). */
  filasSinTarifa: number;
}

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** USD → EUR con el tipo de Costes. null se queda null. */
export const usdAEur = (usd: number | null | undefined): number | null =>
  usd === null || usd === undefined || !Number.isFinite(Number(usd)) ? null : Number(usd) * USD_EUR;

/** Normaliza lo que llega de PostgREST (numeric puede venir como texto). */
export function normalizarFilas(datos: unknown): FilaGastoIa[] {
  if (!Array.isArray(datos)) return [];
  return datos
    .filter((f) => f && typeof f === "object" && typeof (f as FilaGastoIa).funcion === "string")
    .map((f) => {
      const r = f as Record<string, unknown>;
      return {
        funcion: String(r.funcion),
        coste_usd: r.coste_usd === null || r.coste_usd === undefined ? null : n(r.coste_usd),
        filas: n(r.filas),
        llamadas: n(r.llamadas),
        unidades: n(r.unidades),
        filas_sin_tarifa: n(r.filas_sin_tarifa),
        documentos_ocr: n(r.documentos_ocr),
        ultima: typeof r.ultima === "string" ? r.ultima : null,
      };
    });
}

/** Suma de coste (USD) de unas funciones. null si no hay ninguna fila con coste. */
function sumaUsd(filas: FilaGastoIa[], funciones: string[]): number | null {
  const propias = filas.filter((f) => funciones.includes(f.funcion) && f.filas > 0);
  if (propias.length === 0) return null;
  const conCoste = propias.filter((f) => f.coste_usd !== null);
  return conCoste.length === 0 ? null : conCoste.reduce((s, f) => s + (f.coste_usd ?? 0), 0);
}

const plural = (k: number, uno: string, varios: string) => (k === 1 ? uno : varios);

export function resumirGastoIa(filas: FilaGastoIa[], modo: ModoMonitor): ResumenGastoIa {
  const chat = filas.find((f) => f.funcion === "chat-facturas");
  const clasif = filas.find((f) => f.funcion === "clasificar-productos");
  const docsOcr = filas.find((f) => f.funcion === "procesar-factura" || f.funcion === "ocr-trabajo")?.documentos_ocr ?? 0;

  const eurChat = usdAEur(sumaUsd(filas, ["chat-facturas"]));
  const eurOcr = usdAEur(sumaUsd(filas, ["procesar-factura", "ocr-trabajo"]));
  const eurClasif = usdAEur(sumaUsd(filas, ["clasificar-productos"]));

  const desglose: LineaDesglose[] = [
    { clave: "chat", etiqueta: "Chatbot de facturas", eur: eurChat, unidades: chat?.unidades ?? 0, unidad: plural(chat?.unidades ?? 0, "pregunta", "preguntas") },
    { clave: "ocr", etiqueta: "Lectura de facturas (OCR)", eur: eurOcr, unidades: docsOcr, unidad: plural(docsOcr, "documento", "documentos") },
    { clave: "clasificacion", etiqueta: "Clasificación de productos", eur: eurClasif, unidades: clasif?.unidades ?? 0, unidad: plural(clasif?.unidades ?? 0, "tanda", "tandas") },
  ];

  const sumaNull = (vs: (number | null)[]): number | null =>
    vs.every((v) => v === null) ? null : vs.reduce<number>((s, v) => s + (v ?? 0), 0);

  let eur: number | null;
  let unidades: number;
  let unidadTexto: string;
  if (modo === "chat") {
    eur = eurChat;
    unidades = chat?.unidades ?? 0;
    unidadTexto = plural(unidades, "pregunta", "preguntas");
  } else {
    // Sin lecturas registradas todavía, el OCR está «sin datos» aunque haya
    // alguna tanda de clasificación: el coste por documento no tendría base.
    eur = eurOcr === null ? null : sumaNull([eurOcr, eurClasif]);
    unidades = docsOcr;
    unidadTexto = plural(unidades, "documento", "documentos");
  }

  return {
    eur,
    unidades,
    unidadTexto,
    porUnidadEur: eur !== null && unidades > 0 ? eur / unidades : null,
    desglose,
    totalFacturasEur: sumaNull([eurChat, eurOcr, eurClasif]),
    filasSinTarifa: filas.reduce((s, f) => s + f.filas_sin_tarifa, 0),
  };
}

const fmt = (dec: number) =>
  new Intl.NumberFormat("es-ES", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const f2 = fmt(2);
const f3 = fmt(3);
const f4 = fmt(4);

/**
 * Euros de IA: las cifras son de céntimos y milésimas, así que los decimales
 * crecen al bajar el importe (con 2 decimales todo sería «0,00 €» y parecería
 * gratis). null → «sin datos».
 */
export function fmtEurIa(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "sin datos";
  const a = Math.abs(v);
  if (a === 0) return "0 €";
  if (a >= 0.1) return `${f2.format(v)} €`;
  if (a >= 0.001) return `${f3.format(v)} €`;
  return `${f4.format(v)} €`;
}

// ============================================================================
//  GASTO REAL (OpenAI) — migraciones 20261008150000_openai_costes_reales y
//  20261009100000_openai_gasto_por_clave
// ----------------------------------------------------------------------------
//  `gasto_ia_real_resumen(p_dias)` da, por proceso (ocr | chat | chatweb |
//  vinos | otros | sin_asignar), lo REAL facturado por OpenAI hasta el último
//  día cerrado (`usd_real`, `ultimo_dia_real`) y lo ESTIMADO de `ia_uso` desde
//  el día siguiente (`usd_estimado_hoy`). Hay UN proyecto de OpenAI para todo
//  el restaurante: el total real es exacto y se REPARTE por proceso según el
//  coste de cada clave (`reparto`). Las filas `otros:traducciones`, `otros:
//  novedades` y `otros:resto` son un desglose ESTIMADO de «otros» escalado a su
//  real. `sin_asignar` = proyectos sin marcar: informativo, NO suma al total.
//  `tipo_cambio_usd_eur_actual()` da el tipo del BCE (0,92 «por_defecto» si aún
//  no hay ninguno). Todo sin IVA.
//
//  Si la RPC no existe (migración sin aplicar) o no hay datos reales todavía
//  (`ultimo_dia_real` nulo), el monitor sigue con el estimado de siempre.
// ============================================================================

export type ProcesoGasto = "ocr" | "chat" | "chatweb" | "vinos" | "otros" | "sin_asignar";

export interface FilaGastoReal {
  proceso: string;
  usd_real: number;
  /** Fecha UTC (YYYY-MM-DD) del último día cerrado con datos de OpenAI. */
  ultimo_dia_real: string | null;
  usd_estimado_hoy: number;
}

export interface TipoCambioIa {
  eurPorUsd: number;
  /** Fecha del tipo (YYYY-MM-DD); null si es el valor por defecto. */
  fecha: string | null;
  fuente: string;
}

export interface GastoReal {
  /** Una fila por proceso. */
  filas: FilaGastoReal[];
  /** Desglose estimado de «otros» (`otros:xxx`), ya sin el prefijo en `proceso`. */
  subs?: FilaGastoReal[];
  /** Cómo se ha repartido el real: clave_tarifa | clave_peticiones | proyecto | sin_datos (RPC nueva). */
  reparto?: string | null;
  tipo: TipoCambioIa;
}

export const TIPO_CAMBIO_POR_DEFECTO: TipoCambioIa = { eurPorUsd: USD_EUR, fecha: null, fuente: "por_defecto" };

/** Normaliza `tipo_cambio_usd_eur_actual()` (devuelve una fila). Basura → 0,92 por defecto. */
export function normalizarTipoCambio(datos: unknown): TipoCambioIa {
  const f = Array.isArray(datos) ? datos[0] : datos;
  if (!f || typeof f !== "object") return TIPO_CAMBIO_POR_DEFECTO;
  const r = f as Record<string, unknown>;
  const e = n(r.eur_por_usd);
  if (!(e > 0.2 && e < 5)) return TIPO_CAMBIO_POR_DEFECTO;
  return {
    eurPorUsd: e,
    fecha: typeof r.fecha === "string" ? r.fecha : null,
    fuente: typeof r.fuente === "string" ? r.fuente : "bce",
  };
}

const PREFIJO_SUB = "otros:";

/**
 * Normaliza `gasto_ia_real_resumen`. Devuelve null si no hay DATOS REALES
 * (sin filas o ninguna con `ultimo_dia_real`): entonces manda el estimado.
 */
export function normalizarGastoReal(datos: unknown, tipoDatos: unknown): GastoReal | null {
  if (!Array.isArray(datos)) return null;
  const todas: FilaGastoReal[] = datos
    .filter((f) => f && typeof f === "object" && typeof (f as FilaGastoReal).proceso === "string")
    .map((f) => {
      const r = f as Record<string, unknown>;
      return {
        proceso: String(r.proceso),
        usd_real: n(r.usd_real),
        ultimo_dia_real: typeof r.ultimo_dia_real === "string" ? r.ultimo_dia_real : null,
        usd_estimado_hoy: n(r.usd_estimado_hoy),
      };
    });
  if (!todas.some((f) => f.ultimo_dia_real !== null)) return null;
  const filas = todas.filter((f) => !f.proceso.startsWith(PREFIJO_SUB));
  const subs = todas
    .filter((f) => f.proceso.startsWith(PREFIJO_SUB))
    .map((f) => ({ ...f, proceso: f.proceso.slice(PREFIJO_SUB.length) }));
  const rep = (datos.find((f) => f && typeof f === "object" && typeof (f as Record<string, unknown>).reparto === "string") ??
    null) as Record<string, unknown> | null;
  return { filas, subs, reparto: rep ? String(rep.reparto) : null, tipo: normalizarTipoCambio(tipoDatos) };
}

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** «2026-10-07» → «7 oct» (sin pasar por Date: nada de husos horarios). */
export function fmtFechaCorta(iso: string | null | undefined): string {
  const m = typeof iso === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!m) return "—";
  return `${Number(m[3])} ${MESES_CORTOS[Number(m[2]) - 1] ?? ""}`.trim();
}

const f3tipo = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/** «1 USD = 0,921 EUR, BCE 7 oct» (o «tipo por defecto» si aún no hay del BCE). */
export function textoTipoCambioReal(t: TipoCambioIa): string {
  const base = `1 USD = ${f3tipo.format(t.eurPorUsd)} EUR`;
  if (t.fuente === "por_defecto" || !t.fecha) return `${base} (tipo por defecto, aún sin dato del BCE)`;
  return `${base}, ${t.fuente.toUpperCase()} ${fmtFechaCorta(t.fecha)}`;
}

export interface LineaSub {
  clave: string;
  etiqueta: string;
  realEur: number;
  hoyEur: number;
  totalEur: number;
}

export interface LineaReal {
  clave: ProcesoGasto;
  etiqueta: string;
  realEur: number;
  hoyEur: number;
  totalEur: number;
  /** Solo en «otros»: desglose estimado por función (Traducciones, Novedades…). */
  sub: LineaSub[];
}

export interface ResumenGastoReal {
  /** Último día cerrado con datos reales (YYYY-MM-DD). */
  ultimoDia: string;
  tipo: TipoCambioIa;
  /** Texto de cómo se ha repartido el real («real repartido por clave»). */
  repartoTexto: string;
  lineas: LineaReal[];
  totalRealEur: number;
  totalHoyEur: number;
  /** Real + hoy estimado, todos los procesos del restaurante (mes de la pestaña «IA»). */
  totalEur: number;
  /** Real + hoy estimado del proceso del monitor (chat u ocr). */
  procesoEur: number;
  procesoRealEur: number;
  procesoHoyEur: number;
  /** Proyectos de OpenAI sin marcar: informativo, no suma a ningún total. */
  sinAsignarEur: number;
}

const ETIQUETA_PROCESO: Record<ProcesoGasto, string> = {
  ocr: "Lectura de facturas",
  chat: "Chatbot",
  chatweb: "Chat de la web",
  vinos: "Vinos desde foto",
  otros: "Otros (traducciones, novedades…)",
  sin_asignar: "Proyectos sin marcar (no suman)",
};
const ORDEN_PROCESO: ProcesoGasto[] = ["ocr", "chat", "chatweb", "vinos", "otros", "sin_asignar"];
/** Procesos que solo se pintan con importe (no existen sin la migración 20261009100000 o no tienen gasto). */
const SOLO_CON_IMPORTE: ProcesoGasto[] = ["chatweb", "vinos", "sin_asignar"];

const ETIQUETA_SUB: Record<string, string> = {
  traducciones: "Traducciones",
  novedades: "Novedades (formato)",
  resto: "Resto",
};
const ORDEN_SUB = ["traducciones", "novedades", "resto"];

export function textoReparto(reparto: string | null | undefined): string {
  switch (reparto) {
    case "clave_tarifa":
      return "Real repartido por clave (tokens × tarifa)";
    case "clave_peticiones":
      return "Real repartido por clave (por peticiones: falta alguna tarifa)";
    case "proyecto":
      return "Real por proyecto (aún sin uso por clave)";
    default:
      return "Real repartido por clave";
  }
}

export function resumirGastoReal(g: GastoReal, modo: ModoMonitor): ResumenGastoReal {
  const k = g.tipo.eurPorUsd;
  const lineas: LineaReal[] = ORDEN_PROCESO.map((clave) => {
    const fs = g.filas.filter((f) => f.proceso === clave);
    const realEur = fs.reduce((s, f) => s + f.usd_real, 0) * k;
    const hoyEur = fs.reduce((s, f) => s + f.usd_estimado_hoy, 0) * k;
    const sub: LineaSub[] =
      clave === "otros"
        ? (g.subs ?? [])
            .map((f) => ({
              clave: f.proceso,
              etiqueta: ETIQUETA_SUB[f.proceso] ?? f.proceso,
              realEur: f.usd_real * k,
              hoyEur: f.usd_estimado_hoy * k,
              totalEur: (f.usd_real + f.usd_estimado_hoy) * k,
            }))
            .filter((l) => l.totalEur > 0)
            .sort((a, b) => ORDEN_SUB.indexOf(a.clave) - ORDEN_SUB.indexOf(b.clave))
        : [];
    return { clave, etiqueta: ETIQUETA_PROCESO[clave], realEur, hoyEur, totalEur: realEur + hoyEur, sub };
  }).filter((l) => !SOLO_CON_IMPORTE.includes(l.clave) || l.totalEur > 0);
  const propio = lineas.find((l) => l.clave === modo);
  const delRestaurante = lineas.filter((l) => l.clave !== "sin_asignar");
  const totalRealEur = delRestaurante.reduce((s, l) => s + l.realEur, 0);
  const totalHoyEur = delRestaurante.reduce((s, l) => s + l.hoyEur, 0);
  return {
    ultimoDia: g.filas.find((f) => f.ultimo_dia_real)?.ultimo_dia_real ?? "",
    tipo: g.tipo,
    repartoTexto: textoReparto(g.reparto),
    lineas,
    totalRealEur,
    totalHoyEur,
    totalEur: totalRealEur + totalHoyEur,
    procesoEur: propio?.totalEur ?? 0,
    procesoRealEur: propio?.realEur ?? 0,
    procesoHoyEur: propio?.hoyEur ?? 0,
    sinAsignarEur: lineas.find((l) => l.clave === "sin_asignar")?.totalEur ?? 0,
  };
}

// ============================================================================
//  MES EN CURSO Y TOPE (encargo del dueño, 09/10/2026)
// ----------------------------------------------------------------------------
//  El monitor de Facturas y Super Admin › Costes miran el MES EN CURSO, no una
//  ventana de 30 días. `gasto_ia_real_resumen(p_dias)` mide la ventana hacia
//  atrás desde el último día cerrado con datos (`ultimo_dia_real`), así que el
//  mes se pide con `p_dias` = día del mes de ese último día cerrado. El mes
//  anterior sale de restar dos ventanas (aproximado: el reparto por proceso se
//  calcula dentro de cada ventana).
// ============================================================================

/** Tope mensual por defecto (€) si no se puede leer `configuracion_facturas.tope_ia_mes_eur`. */
export const TOPE_IA_POR_DEFECTO = 5;

/** Fracción del tope a partir de la cual el aviso pasa a ámbar. */
export const UMBRAL_AVISO_TOPE = 0.8;

export type NivelTope = "ok" | "aviso" | "superado";

export interface EstadoTope {
  /** Gasto / tope, en % (sin tope, 0). Puede pasar de 100. */
  pct: number;
  nivel: NivelTope;
}

/** ok < 80 % ≤ aviso (ámbar) < 100 % ≤ superado (rojo). */
export function evaluarTope(gastoEur: number | null | undefined, topeEur: number | null | undefined): EstadoTope {
  const g = Number(gastoEur);
  const t = Number(topeEur);
  if (!Number.isFinite(g) || !Number.isFinite(t) || t <= 0 || g <= 0) return { pct: 0, nivel: "ok" };
  const pct = (g / t) * 100;
  return { pct, nivel: pct >= 100 ? "superado" : pct >= UMBRAL_AVISO_TOPE * 100 ? "aviso" : "ok" };
}

/** Día del mes de `hoy` (1 el día 1): ventana del estimado de `gasto_ia_resumen`. */
export const diaDelMes = (hoy: Date): number => hoy.getDate();

/** Días que tiene el mes de `hoy`. */
export const diasDelMes = (hoy: Date): number => new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();

const pad2 = (v: number) => String(v).padStart(2, "0");

/** «2026-10-01» del mes de `hoy` (calendario local). */
export const primerDiaMesIso = (hoy: Date): string => `${hoy.getFullYear()}-${pad2(hoy.getMonth() + 1)}-01`;

/** «2026-09-01» del mes anterior al de `hoy`. */
export const primerDiaMesAnteriorIso = (hoy: Date): string => {
  const d = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
};

/** «2026-10-09» de `hoy` (calendario local): parte de las claves de caché. */
export const hoyIso = (hoy: Date): string => `${primerDiaMesIso(hoy).slice(0, 8)}${pad2(hoy.getDate())}`;

const aUtc = (iso: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
};

/** Días entre dos fechas ISO, ambas incluidas (desde ≤ hasta); 0 si hasta < desde. */
export function diasEntre(desdeIso: string, hastaIso: string): number {
  const d = Math.round((aUtc(hastaIso) - aUtc(desdeIso)) / 86_400_000) + 1;
  return Number.isFinite(d) && d > 0 ? d : 0;
}

/** Último día cerrado con datos reales (YYYY-MM-DD) de unas filas de la RPC, o null. */
export const ultimoDiaDe = (g: GastoReal): string | null => g.filas.find((f) => f.ultimo_dia_real)?.ultimo_dia_real ?? null;

/** Misma ventana pero con el real a 0 (queda el estimado de hoy): mes sin ningún día cerrado todavía. */
export function sinRealCerrado(g: GastoReal): GastoReal {
  const cero = (f: FilaGastoReal): FilaGastoReal => ({ ...f, usd_real: 0 });
  return { ...g, filas: g.filas.map(cero), subs: g.subs?.map(cero) };
}

/**
 * `a − b` en USD por proceso (ventana grande menos ventana corta = mes
 * anterior). Nunca negativo y sin estimado de hoy: es un mes cerrado.
 */
export function restarGastoReal(a: GastoReal, b: GastoReal): GastoReal {
  const resta = (fa: FilaGastoReal[], fb: FilaGastoReal[] | undefined): FilaGastoReal[] =>
    fa.map((f) => {
      const o = (fb ?? []).filter((x) => x.proceso === f.proceso).reduce((s, x) => s + x.usd_real, 0);
      return { ...f, usd_real: Math.max(0, f.usd_real - o), usd_estimado_hoy: 0 };
    });
  return { ...a, filas: resta(a.filas, b.filas), subs: a.subs ? resta(a.subs, b.subs) : a.subs };
}
