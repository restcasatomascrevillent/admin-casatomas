// ============================================================================
//  Facturas › Análisis — tablero de compras (cuentas puras, sin React)
// ----------------------------------------------------------------------------
//  Rediseño del 05/11/2026: la pestaña «Análisis» es un TABLERO DE GRÁFICAS
//  FIJAS que sale hecho al abrirla; el copiloto de IA va plegado en un panel.
//  Los datos llegan en UN JSON de la RPC `tablero_compras(desde, hasta, local)`
//  (migración 20261105150000): la tablet no descarga los ~1.900 documentos.
//
//  Aquí: lectura defensiva de ese JSON, el periodo (Mes · Trimestre · Año ·
//  Todo, naturales, como Compras: resumenCompras.ts), el periodo anterior
//  equivalente, textos y resúmenes para lectores de pantalla, los enlaces a
//  Compras y las sugerencias del copiloto sacadas de los propios datos.
//
//  Reglas (las mismas que Compras y la RPC): gasto de documentos CON IVA; las
//  líneas (familias, precios) SIN IVA; el albarán ya facturado no suma; un
//  documento sin local es de Casa Tomás.
// ============================================================================
import { etiquetaMes } from "./agrupacionDocumentos";
import { mesCorto, rangoPeriodo, type FiltroLocal, type PeriodoPreset } from "./resumenCompras";

// ─── Periodo ────────────────────────────────────────────────────────────────

export type PeriodoAnalisis = "mes" | "trimestre" | "anio" | "todo";

/** Mes · Trimestre · Año <año> · Todo (por defecto, Año). */
export function periodosAnalisis(hoy: Date): { valor: PeriodoAnalisis; etiqueta: string }[] {
  return [
    { valor: "mes", etiqueta: "Mes" },
    { valor: "trimestre", etiqueta: "Trimestre" },
    { valor: "anio", etiqueta: `Año ${hoy.getFullYear()}` },
    { valor: "todo", etiqueta: "Todo" },
  ];
}

export const PERIODO_ANALISIS_POR_DEFECTO: PeriodoAnalisis = "anio";

const PRESET: Record<PeriodoAnalisis, PeriodoPreset> = { mes: "este_mes", trimestre: "trimestre", anio: "anio", todo: "todo" };

const dos = (n: number) => String(n).padStart(2, "0");
/** Último día del mes `YYYY-MM` como `YYYY-MM-DD`. */
export function finDeMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return `${mes}-${dos(new Date(Date.UTC(a, m, 0)).getUTCDate())}`;
}

/**
 * Fechas que se mandan a la RPC. Trimestre y año NATURALES (los de Compras y
 * del IVA), enteros aunque aún no hayan acabado: la RPC compara solo hasta hoy.
 * «Todo» = sin fechas.
 */
export function fechasPeriodo(p: PeriodoAnalisis, hoy: Date): { desde: string | null; hasta: string | null } {
  const r = rangoPeriodo({ tipo: PRESET[p] }, hoy);
  if (!r) return { desde: null, hasta: null };
  return { desde: `${r.desde}-01`, hasta: finDeMes(r.hasta) };
}

export const localRpc = (l: FiltroLocal): "casa_tomas" | "touza" | null => (l === "todos" ? null : l);

const isoUtc = (d: Date) => `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`;
const aFecha = (iso: string) => new Date(`${iso}T00:00:00Z`);
const sumarDias = (iso: string, n: number) => {
  const d = aFecha(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return isoUtc(d);
};
/** Resta meses conservando el día (31 → último del mes si no existe). */
function restarMeses(iso: string, n: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const total = a * 12 + (m - 1) - n;
  const anio = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return `${anio}-${dos(mes)}-${dos(Math.min(d, ultimo))}`;
}

/**
 * Periodo anterior EQUIVALENTE (la misma regla que la RPC):
 *   · periodo abierto (incluye hoy) → se compara solo hasta hoy;
 *   · meses enteros → los mismos meses justo antes (cerrado: enteros; abierto:
 *     hasta el mismo día relativo, «1 ene–5 nov 2026» frente a «1 ene–5 nov 2025»);
 *   · cualquier otro rango → los mismos días justo antes.
 */
export function periodoAnteriorEquivalente(desde: string, hasta: string, hoyIso: string): { desde: string; hasta: string } {
  const hastaEf = desde <= hoyIso && hasta > hoyIso ? hoyIso : hasta;
  const mesesEnteros = desde.endsWith("-01") && hasta === finDeMes(hasta.slice(0, 7));
  if (mesesEnteros) {
    const n = (Number(hasta.slice(0, 4)) * 12 + Number(hasta.slice(5, 7))) - (Number(desde.slice(0, 4)) * 12 + Number(desde.slice(5, 7))) + 1;
    return { desde: restarMeses(desde, n), hasta: hastaEf === hasta ? sumarDias(desde, -1) : restarMeses(hastaEf, n) };
  }
  const dias = Math.round((aFecha(hastaEf).getTime() - aFecha(desde).getTime()) / 86_400_000);
  const finAnterior = sumarDias(desde, -1);
  return { desde: sumarDias(finAnterior, -dias), hasta: finAnterior };
}

// ─── Datos de la RPC ────────────────────────────────────────────────────────

export interface MesGasto {
  mes: string;
  casa_tomas: number;
  touza: number;
  total: number;
  documentos: number;
}
export interface ProveedorGasto {
  id: number | null;
  nombre: string;
  gasto: number;
  pct: number | null;
  documentos: number;
}
export interface Subida {
  producto: string;
  nombre_normalizado: string;
  unidad: string;
  proveedor_id: number | null;
  proveedor: string;
  precio_inicio: number;
  precio_fin: number;
  variacion_pct: number;
  compras_inicio: number;
  compras_fin: number;
  importe: number;
}
export interface Tramo {
  desde: string;
  hasta: string;
}
export interface Familia {
  id: number | null;
  familia: string;
  importe: number;
  lineas: number;
}
export interface GastoFijo {
  id: number | null;
  nombre: string;
  medio_mes: number;
  meses: number;
  meses_con_datos: number;
  documentos: number;
}
export interface AbonoProveedor {
  id: number | null;
  nombre: string;
  importe: number;
  documentos: number;
}

export interface TableroCompras {
  periodo: {
    desde: string | null;
    hasta: string | null;
    hastaEfectivo: string | null;
    local: "casa_tomas" | "touza" | null;
    anterior: Tramo | null;
  };
  sinDatos: boolean;
  indicadores: {
    gasto: number;
    gastoAnterior: number | null;
    documentosAnterior: number | null;
    variacionPct: number | null;
    documentos: number;
    facturas: number;
    albaranesSinFactura: number;
    albaranesSinFacturaImporte: number;
    sinTotal: number;
    abonos: number;
    abonosN: number;
    regalado: number;
    regaladoValia: number;
    regaladoLineas: number;
    regaladoEstimadas: number;
    regaladoEstimadoImporte: number;
    proveedores: number;
  };
  meses: MesGasto[];
  proveedores: ProveedorGasto[];
  subidas: { productos: Subida[]; tramoInicio: Tramo | null; tramoFin: Tramo | null; comparados: number };
  familias: { familias: Familia[]; importeTotal: number; lineas: number; sinClasificar: { lineas: number; importe: number } };
  fijos: { proveedores: GastoFijo[]; totalMedioMes: number; ventana: (Tramo & { mesesConDatos: number }) | null };
  abonos: AbonoProveedor[];
  locales: {
    casaTomas: { gasto: number; documentos: number };
    touza: { gasto: number; documentos: number };
    meses: { mes: string; casa_tomas: number; touza: number }[];
  };
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const lista = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);
/** Número o 0 (Postgres puede mandar numeric como texto). */
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const numONulo = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const texto = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const textoONulo = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const idONulo = (v: unknown): number | null => {
  const n = Number(v);
  return v != null && Number.isInteger(n) && n > 0 ? n : null;
};
const tramo = (v: unknown): Tramo | null => {
  const o = obj(v);
  return typeof o.desde === "string" && typeof o.hasta === "string" ? { desde: o.desde, hasta: o.hasta } : null;
};

/** La RPC devolvió `{error}` (argumentos mal): se enseña como error. */
export class ErrorTablero extends Error {}

/** Lee el JSON de `tablero_compras` sin fiarse de su forma (faltan bloques = vacíos). */
export function normalizarTablero(entrada: unknown): TableroCompras {
  const r = obj(entrada);
  if (typeof r.error === "string") throw new ErrorTablero(r.error);
  const p = obj(r.periodo);
  const i = obj(r.indicadores);
  const s = obj(r.subidas);
  const f = obj(r.familias);
  const fi = obj(r.fijos);
  const v = obj(fi.ventana);
  const l = obj(r.locales);
  const local = p.local === "casa_tomas" || p.local === "touza" ? p.local : null;
  return {
    periodo: {
      desde: textoONulo(p.desde),
      hasta: textoONulo(p.hasta),
      hastaEfectivo: textoONulo(p.hasta_efectivo),
      local,
      anterior: tramo(p.anterior),
    },
    sinDatos: r.sin_datos === true,
    indicadores: {
      gasto: num(i.gasto),
      gastoAnterior: numONulo(i.gasto_anterior),
      documentosAnterior: numONulo(i.documentos_anterior),
      variacionPct: numONulo(i.variacion_pct),
      documentos: num(i.documentos),
      facturas: num(i.facturas),
      albaranesSinFactura: num(i.albaranes_sin_factura),
      albaranesSinFacturaImporte: num(i.albaranes_sin_factura_importe),
      sinTotal: num(i.sin_total),
      abonos: num(i.abonos),
      abonosN: num(i.abonos_n),
      regalado: num(i.regalado),
      regaladoValia: num(i.regalado_valia),
      regaladoLineas: num(i.regalado_lineas),
      regaladoEstimadas: num(i.regalado_estimadas),
      regaladoEstimadoImporte: num(i.regalado_estimado_importe),
      proveedores: num(i.proveedores),
    },
    meses: lista(r.meses)
      .filter((m) => typeof m.mes === "string")
      .map((m) => ({ mes: texto(m.mes), casa_tomas: num(m.casa_tomas), touza: num(m.touza), total: num(m.total), documentos: num(m.documentos) })),
    proveedores: lista(r.proveedores).map((x) => ({
      id: idONulo(x.id),
      nombre: texto(x.nombre) || "Sin proveedor",
      gasto: num(x.gasto),
      pct: numONulo(x.pct),
      documentos: num(x.documentos),
    })),
    subidas: {
      productos: lista(s.productos).map((x) => ({
        producto: texto(x.producto),
        nombre_normalizado: texto(x.nombre_normalizado),
        unidad: texto(x.unidad),
        proveedor_id: idONulo(x.proveedor_id),
        proveedor: texto(x.proveedor),
        precio_inicio: num(x.precio_inicio),
        precio_fin: num(x.precio_fin),
        variacion_pct: num(x.variacion_pct),
        compras_inicio: num(x.compras_inicio),
        compras_fin: num(x.compras_fin),
        importe: num(x.importe),
      })),
      tramoInicio: tramo(s.tramo_inicio),
      tramoFin: tramo(s.tramo_fin),
      comparados: num(s.comparados),
    },
    familias: {
      familias: lista(f.familias).map((x) => ({ id: idONulo(x.id), familia: texto(x.familia), importe: num(x.importe), lineas: num(x.lineas) })),
      importeTotal: num(f.importe_total),
      lineas: num(f.lineas),
      sinClasificar: { lineas: num(obj(f.sin_clasificar).lineas), importe: num(obj(f.sin_clasificar).importe) },
    },
    fijos: {
      proveedores: lista(fi.proveedores).map((x) => ({
        id: idONulo(x.id),
        nombre: texto(x.nombre),
        medio_mes: num(x.medio_mes),
        meses: num(x.meses),
        meses_con_datos: num(x.meses_con_datos),
        documentos: num(x.documentos),
      })),
      totalMedioMes: num(fi.total_medio_mes),
      ventana: typeof v.desde === "string" && typeof v.hasta === "string" ? { desde: v.desde, hasta: v.hasta, mesesConDatos: num(v.meses_con_datos) } : null,
    },
    abonos: lista(r.abonos).map((x) => ({ id: idONulo(x.id), nombre: texto(x.nombre), importe: num(x.importe), documentos: num(x.documentos) })),
    locales: {
      casaTomas: { gasto: num(obj(l.casa_tomas).gasto), documentos: num(obj(l.casa_tomas).documentos) },
      touza: { gasto: num(obj(l.touza).gasto), documentos: num(obj(l.touza).documentos) },
      meses: lista(l.meses).map((m) => ({ mes: texto(m.mes), casa_tomas: num(m.casa_tomas), touza: num(m.touza) })),
    },
  };
}

// ─── Textos ─────────────────────────────────────────────────────────────────

const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** «julio» (mes `YYYY-MM` en minúscula, para frases). */
export const nombreMes = (mes: string): string => MESES_LARGOS[Number(mes.slice(5, 7)) - 1] ?? mes;

/** «5 nov 2025» */
export function fechaCorta(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${mesCorto(iso.slice(0, 7))} ${iso.slice(0, 4)}`;
}

/** Meses con documentos del tablero: «ene – nov 2026», «dic 2025 – nov 2026», «julio 2026». */
export function textoRangoMeses(meses: Pick<MesGasto, "mes" | "documentos">[]): string {
  const con = meses.filter((m) => m.documentos > 0).map((m) => m.mes);
  if (con.length === 0) return "Sin documentos";
  const a = con[0];
  const b = con[con.length - 1];
  if (a === b) return etiquetaMes(a).toLowerCase();
  return a.slice(0, 4) === b.slice(0, 4)
    ? `${mesCorto(a)} – ${mesCorto(b)} ${b.slice(0, 4)}`
    : `${mesCorto(a)} ${a.slice(0, 4)} – ${mesCorto(b)} ${b.slice(0, 4)}`;
}

/** «+15,8 %» / «−3,2 %» (signo menos tipográfico). */
export function textoPct(pct: number, conSigno = true): string {
  const abs = Math.abs(pct).toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (!conSigno) return `${abs} %`;
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${abs} %`;
}

/**
 * Variación frente al periodo anterior, o null si no hay con qué comparar (la
 * RPC solo la da si el periodo anterior está cargado de verdad).
 */
export function textoVariacion(t: Pick<TableroCompras, "indicadores" | "periodo">): { texto: string; sube: boolean } | null {
  const pct = t.indicadores.variacionPct;
  const ant = t.periodo.anterior;
  if (pct === null || !ant) return null;
  return { texto: `${textoPct(pct)} frente a ${fechaCorta(ant.desde)} – ${fechaCorta(ant.hasta)}`, sube: pct > 0 };
}

/** «mismo proveedor, 12 ene – 11 abr vs 9 jul – 6 oct» */
export function textoTramos(inicio: Tramo | null, fin: Tramo | null): string {
  if (!inicio || !fin) return "mismo proveedor";
  const corto = (iso: string) => `${Number(iso.slice(8, 10))} ${mesCorto(iso.slice(0, 7))}`;
  return `mismo proveedor, ${corto(inicio.desde)} – ${corto(inicio.hasta)} vs ${corto(fin.desde)} – ${corto(fin.hasta)}`;
}

/** Nombre de proveedor sin la forma jurídica, para gráficas y frases: «Distribuciones de Bebidas Catral». */
export function nombreCorto(nombre: string): string {
  const sin = nombre
    .replace(/[,.\s]+(S\.?\s?L\.?\s?U\.?|S\.?\s?A\.?\s?U\.?|S\.?\s?L\.?|S\.?\s?A\.?|S\.?\s?R\.?\s?L\.?|C\.?\s?B\.?|S\.?\s?COOP\.?(\s?V\.?)?(\s?L\.?)?)\s*$/i, "")
    .trim();
  const base = sin || nombre.trim();
  // TODO EN MAYÚSCULAS → «Tipo Título» (sin tocar los que ya vienen bien escritos).
  if (base === base.toUpperCase() && /[A-ZÁÉÍÓÚÑ]{3}/.test(base)) {
    const minus = new Set(["de", "del", "la", "las", "los", "y", "e"]);
    return base
      .toLowerCase()
      .split(/\s+/)
      .map((w, i) => (i > 0 && minus.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(" ");
  }
  return base;
}

// ─── Eje de «Gasto por mes» ─────────────────────────────────────────────────

/** Tope «redondo» del eje: 171.526 → 200.000; 4.585 → 5.000. */
export function topeEje(max: number): number {
  if (max <= 0) return 1;
  const potencia = 10 ** Math.floor(Math.log10(max));
  for (const paso of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (paso * potencia >= max) return paso * potencia;
  return 10 * potencia;
}

/** «150 mil €» para las marcas del eje (las cifras exactas, en cada barra y en la tabla). */
export function marcaEje(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")} mil €`;
  return `${Math.round(n)} €`;
}

// ─── Resúmenes para lectores de pantalla ────────────────────────────────────

const eur = (n: number) =>
  `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")} €`;

/** Resumen textual de «Gasto por mes»: el mes más alto y el más bajo (con documentos). */
export function resumenGastoMes(meses: MesGasto[]): string {
  const con = meses.filter((m) => m.documentos > 0);
  if (con.length === 0) return "Sin gasto en el periodo.";
  const max = con.reduce((a, b) => (b.total > a.total ? b : a));
  const min = con.reduce((a, b) => (b.total < a.total ? b : a));
  if (con.length === 1) return `${etiquetaMes(max.mes)}: ${eur(max.total)} con IVA.`;
  return `${con.length} meses. El más alto, ${etiquetaMes(max.mes)} con ${eur(max.total)}; el más bajo, ${etiquetaMes(min.mes)} con ${eur(min.total)}. Con IVA.`;
}

/** Resumen de «Proveedores con más gasto». */
export function resumenProveedores(p: ProveedorGasto[]): string {
  if (p.length === 0) return "Sin proveedores con gasto en el periodo.";
  const top3 = p.slice(0, 3).map((x) => `${nombreCorto(x.nombre)} ${eur(x.gasto)}${x.pct !== null ? ` (${textoPct(x.pct, false)})` : ""}`);
  return `Los que más: ${top3.join(", ")}.`;
}

// ─── Enlaces a Compras ──────────────────────────────────────────────────────

/** Compras › Documentos con solo ese mes. */
export const enlaceMesCompras = (mes: string) => `?tab=compras&modo=documentos&mes=${encodeURIComponent(mes)}`;
/** Compras › Proveedores con ese proveedor desplegado. */
export const enlaceProveedorCompras = (id: number) => `?tab=compras&modo=proveedores&prov=${id}`;
/** Compras › Productos (allí está «Clasificar con IA»). */
export const ENLACE_PRODUCTOS_COMPRAS = "?tab=compras&modo=productos";

/** Lee de la URL lo que piden esos enlaces (`mes` YYYY-MM y `prov` entero > 0). */
export function leerEnlaceCompras(p: URLSearchParams): { mes?: string; prov?: number } {
  const mes = p.get("mes");
  const prov = Number(p.get("prov"));
  return {
    ...(mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes) ? { mes } : {}),
    ...(Number.isInteger(prov) && prov > 0 ? { prov } : {}),
  };
}

// ─── Sugerencias del copiloto, sacadas de los datos ─────────────────────────

/**
 * 3-5 preguntas útiles para empezar: el mes que más subió frente al anterior,
 * comparar el producto que más ha subido entre proveedores y qué le compras al
 * primer proveedor. Si no hay datos, unas genéricas.
 */
export function sugerenciasDeTablero(t: TableroCompras | null | undefined, periodo: PeriodoAnalisis): string[] {
  const salida: string[] = [];
  const meses = (t?.meses ?? []).filter((m) => m.documentos > 0);
  let subida: { mes: string; dif: number } | null = null;
  for (let i = 1; i < meses.length; i++) {
    const dif = meses[i].total - meses[i - 1].total;
    if (dif > 0 && (!subida || dif > subida.dif)) subida = { mes: meses[i].mes, dif };
  }
  if (subida) salida.push(`¿Por qué subió el gasto en ${nombreMes(subida.mes)}?`);
  const producto = t?.subidas.productos[0];
  if (producto) salida.push(`Compara el precio de ${producto.producto.toLowerCase()} entre proveedores`);
  const prov = t?.proveedores[0];
  const cuando = periodo === "mes" ? "este mes" : periodo === "trimestre" ? "este trimestre" : periodo === "anio" ? "este año" : "en total";
  if (prov) salida.push(`¿Qué le he comprado a ${nombreCorto(prov.nombre)} ${cuando}?`);
  const fijo = t?.fijos.proveedores[0];
  if (fijo) salida.push(`¿Ha subido lo que pago a ${nombreCorto(fijo.nombre)}?`);
  if (salida.length < 3) {
    for (const g of ["¿Cuánto hemos gastado este mes?", "¿Qué productos han subido de precio?", "¿Qué albaranes faltan por facturar?"]) {
      if (salida.length >= 4) break;
      salida.push(g);
    }
  }
  return salida.slice(0, 5);
}
