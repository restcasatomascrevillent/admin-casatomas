// ============================================================================
//  Facturas › Análisis › EXPLORAR (cuentas puras, sin React)
// ----------------------------------------------------------------------------
//  Un explorador ligero estilo Vega-Lite/Tableau: el dueño elige
//    MEDIDA (qué se suma) × EJE (agrupar) × COLOR (desglose) × FILTROS
//  y la gráfica cambia al instante. Los datos los calcula la RPC
//  `explorar_compras` (migración 20261105170000); de cualquier barra se baja a
//  los documentos con `documentos_de_cifra` (la misma tabla de hechos: cuadra).
//
//  Aquí: catálogos (medidas, ejes, desgloses, tipos de gráfica), reglas de
//  combinación (gasto y abonos van por documento con IVA; familias y productos
//  por líneas sin IVA), elección automática de gráfica, parámetros de la RPC,
//  lectura defensiva del JSON, formatos es-ES, colores fijos por entidad, CSV,
//  presets, «fijar en el tablero» y la acción de tocar un punto.
// ============================================================================
import { etiquetaMes } from "./agrupacionDocumentos";
import { mesCorto } from "./resumenCompras";
import { finDeMes, nombreCorto, textoPct } from "./tableroCompras";
import { sumarDiasIso, textoRango } from "./periodoAnalisis";

// ─── Catálogos ──────────────────────────────────────────────────────────────

export type Medida = "gasto" | "base" | "documentos" | "abonos" | "regalado" | "cantidad" | "precio";
export type Agrupar = "dia" | "semana" | "mes" | "trimestre" | "proveedor" | "familia" | "producto" | "local" | "tipo";
export type Desglose = "local" | "proveedor" | "familia" | "tipo";
export type TipoGrafica = "barras" | "apiladas" | "lineas" | "area" | "horizontales" | "tabla";
export type TipoDoc = "factura" | "albaran" | "abono";
export type FormatoMedida = "eur" | "entero" | "cantidad" | "precio";

export interface InfoMedida {
  valor: Medida;
  etiqueta: string;
  /** Rótulo del IVA, que va SIEMPRE con la cifra. */
  iva: "con IVA" | "sin IVA" | null;
  formato: FormatoMedida;
  /** Se cuenta por líneas (no se puede con gasto/abonos). */
  porLineas: boolean;
  requiereProducto: boolean;
  ayuda: string;
}

export const MEDIDAS: InfoMedida[] = [
  { valor: "gasto", etiqueta: "Gasto", iva: "con IVA", formato: "eur", porLineas: false, requiereProducto: false, ayuda: "Total de facturas y albaranes sin factura" },
  { valor: "base", etiqueta: "Base", iva: "sin IVA", formato: "eur", porLineas: true, requiereProducto: false, ayuda: "Importe de las líneas" },
  { valor: "documentos", etiqueta: "Nº de documentos", iva: null, formato: "entero", porLineas: false, requiereProducto: false, ayuda: "Facturas, albaranes y abonos" },
  { valor: "abonos", etiqueta: "Abonos", iva: "con IVA", formato: "eur", porLineas: false, requiereProducto: false, ayuda: "Importe devuelto (documentos en negativo)" },
  { valor: "regalado", etiqueta: "Regalado y descuentos", iva: "sin IVA", formato: "eur", porLineas: true, requiereProducto: false, ayuda: "Lo que valía menos lo que se pagó" },
  { valor: "cantidad", etiqueta: "Cantidad comprada", iva: null, formato: "cantidad", porLineas: true, requiereProducto: true, ayuda: "Filtra antes un producto" },
  { valor: "precio", etiqueta: "Precio medio", iva: "sin IVA", formato: "precio", porLineas: true, requiereProducto: true, ayuda: "Filtra antes un producto" },
];

export const AGRUPACIONES: { valor: Agrupar; etiqueta: string; tiempo: boolean }[] = [
  { valor: "dia", etiqueta: "Día", tiempo: true },
  { valor: "semana", etiqueta: "Semana", tiempo: true },
  { valor: "mes", etiqueta: "Mes", tiempo: true },
  { valor: "trimestre", etiqueta: "Trimestre", tiempo: true },
  { valor: "proveedor", etiqueta: "Proveedor", tiempo: false },
  { valor: "familia", etiqueta: "Familia", tiempo: false },
  { valor: "producto", etiqueta: "Producto", tiempo: false },
  { valor: "local", etiqueta: "Local", tiempo: false },
  { valor: "tipo", etiqueta: "Tipo de documento", tiempo: false },
];

export const DESGLOSES: { valor: Desglose; etiqueta: string }[] = [
  { valor: "local", etiqueta: "Local" },
  { valor: "proveedor", etiqueta: "Proveedor" },
  { valor: "familia", etiqueta: "Familia" },
  { valor: "tipo", etiqueta: "Tipo" },
];

export const GRAFICAS: { valor: TipoGrafica; etiqueta: string }[] = [
  { valor: "barras", etiqueta: "Barras" },
  { valor: "apiladas", etiqueta: "Barras apiladas" },
  { valor: "lineas", etiqueta: "Líneas" },
  { valor: "area", etiqueta: "Área" },
  { valor: "horizontales", etiqueta: "Ranking (barras horizontales)" },
  { valor: "tabla", etiqueta: "Tabla" },
];

export const TIPOS_DOC: { valor: TipoDoc; etiqueta: string }[] = [
  { valor: "factura", etiqueta: "Factura" },
  { valor: "albaran", etiqueta: "Albarán sin factura" },
  { valor: "abono", etiqueta: "Abono" },
];

export const infoMedida = (m: Medida): InfoMedida => MEDIDAS.find((x) => x.valor === m) ?? MEDIDAS[0];
export const etiquetaAgrupar = (a: Agrupar): string => AGRUPACIONES.find((x) => x.valor === a)?.etiqueta ?? a;
export const etiquetaDesglose = (d: Desglose): string => DESGLOSES.find((x) => x.valor === d)?.etiqueta ?? d;
export const esTiempo = (a: Agrupar | null | undefined): boolean => a === "dia" || a === "semana" || a === "mes" || a === "trimestre";

// ─── Configuración ──────────────────────────────────────────────────────────

export interface EntidadFiltro {
  id: number;
  nombre: string;
}

export interface FiltrosExplorador {
  proveedores: EntidadFiltro[];
  familias: EntidadFiltro[];
  productos: string[];
  tipos: TipoDoc[];
  unidad: string | null;
}

export interface ConfigExplorador {
  medida: Medida;
  agrupar: Agrupar;
  desglose: Desglose | null;
  filtros: FiltrosExplorador;
  /** «auto» = la elige el explorador (elegirGrafica). */
  grafica: TipoGrafica | "auto";
  top: number;
}

export const FILTROS_VACIOS: FiltrosExplorador = { proveedores: [], familias: [], productos: [], tipos: [], unidad: null };

export const CONFIG_POR_DEFECTO: ConfigExplorador = {
  medida: "gasto",
  agrupar: "mes",
  desglose: "local",
  filtros: FILTROS_VACIOS,
  grafica: "auto",
  top: 10,
};

/** El eje, el color o los filtros obligan a contar por líneas (familia, producto, unidad). */
export function fuerzaLineas(c: Pick<ConfigExplorador, "agrupar" | "desglose" | "filtros">): boolean {
  return (
    c.agrupar === "familia" ||
    c.agrupar === "producto" ||
    c.desglose === "familia" ||
    c.filtros.familias.length > 0 ||
    c.filtros.productos.length > 0 ||
    !!c.filtros.unidad
  );
}

/** Igual que `explorar_compras_por_lineas` de la RPC. */
export function cuentaPorLineas(c: Pick<ConfigExplorador, "medida" | "agrupar" | "desglose" | "filtros">): boolean {
  return infoMedida(c.medida).porLineas || fuerzaLineas(c);
}

/** ¿Se puede elegir esta medida con el resto de la configuración? (null = sí; si no, por qué). */
export function motivoMedidaNoDisponible(m: Medida, c: ConfigExplorador): string | null {
  const info = infoMedida(m);
  if (info.requiereProducto && c.filtros.productos.length === 0) return "Filtra antes un producto";
  if ((m === "gasto" || m === "abonos") && fuerzaLineas(c))
    return "Con familias o productos se mide la base sin IVA";
  return null;
}

/**
 * Deja la configuración en algo que la RPC acepta, con un aviso cuando hay que
 * cambiar la medida (p. ej. «Gasto» por familia pasa a «Base sin IVA»).
 */
export function ajustarConfig(c: ConfigExplorador): { config: ConfigExplorador; aviso: string | null } {
  let config: ConfigExplorador = { ...c, top: Math.min(50, Math.max(1, Math.round(c.top || 10))) };
  let aviso: string | null = null;
  if (config.desglose === config.agrupar) config = { ...config, desglose: null };
  if (infoMedida(config.medida).requiereProducto && config.filtros.productos.length === 0) {
    config = { ...config, medida: "gasto" };
    aviso = "Cantidad y precio necesitan un producto: se mide el gasto.";
  }
  if ((config.medida === "gasto" || config.medida === "abonos") && fuerzaLineas(config)) {
    config = { ...config, medida: "base" };
    aviso = "Por familias o productos se mide la base sin IVA de las líneas (el IVA va por documento).";
  }
  if (config.grafica === "apiladas" && !config.desglose) config = { ...config, grafica: "auto" };
  return { config, aviso };
}

/**
 * Gráfica que elige el explorador si el dueño no fija otra:
 *   tiempo → días y semanas en línea (área sin desglose); meses y trimestres
 *            en barras (apiladas con desglose); el precio siempre en línea.
 *   categoría → ranking horizontal ordenado.
 */
export function elegirGrafica(c: Pick<ConfigExplorador, "medida" | "agrupar" | "desglose">): TipoGrafica {
  if (esTiempo(c.agrupar)) {
    if (c.medida === "precio") return "lineas";
    if (c.agrupar === "dia" || c.agrupar === "semana") return c.desglose ? "lineas" : "area";
    return c.desglose ? "apiladas" : "barras";
  }
  return "horizontales";
}

export function graficaEfectiva(c: ConfigExplorador): TipoGrafica {
  if (c.grafica === "auto") return elegirGrafica(c);
  if (c.grafica === "apiladas" && !c.desglose) return "barras";
  return c.grafica;
}

/** «Gasto con IVA por mes, por local» */
export function tituloConfig(c: Pick<ConfigExplorador, "medida" | "agrupar" | "desglose">): string {
  const m = infoMedida(c.medida);
  const medida = m.iva ? `${m.etiqueta} ${m.iva}` : m.etiqueta;
  const eje = etiquetaAgrupar(c.agrupar).toLowerCase();
  return `${medida} por ${eje}${c.desglose ? `, por ${etiquetaDesglose(c.desglose).toLowerCase()}` : ""}`;
}

// ─── Parámetros de la RPC ───────────────────────────────────────────────────

export type LocalRpc = "casa_tomas" | "touza" | null;

export interface ParametrosExplorar {
  p_desde: string | null;
  p_hasta: string | null;
  p_medida: Medida;
  p_agrupar: Agrupar;
  p_desglose: Desglose | null;
  p_filtros: Record<string, unknown>;
  p_top: number;
}

/** Filtros tal y como los entiende la RPC (solo los que hay). */
export function filtrosRpc(f: FiltrosExplorador, local: LocalRpc): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  if (f.proveedores.length) salida.proveedores = f.proveedores.map((p) => p.id);
  if (f.familias.length) salida.familias = f.familias.map((p) => p.id);
  if (f.productos.length) salida.productos = f.productos;
  if (f.tipos.length) salida.tipos = f.tipos;
  if (local) salida.local = local;
  if (f.unidad) salida.unidad = f.unidad;
  return salida;
}

export function parametrosExplorar(c: ConfigExplorador, periodo: { desde: string | null; hasta: string | null }, local: LocalRpc): ParametrosExplorar {
  return {
    p_desde: periodo.desde,
    p_hasta: periodo.hasta,
    p_medida: c.medida,
    p_agrupar: c.agrupar,
    p_desglose: c.desglose,
    p_filtros: filtrosRpc(c.filtros, local),
    p_top: c.top,
  };
}

// ─── Lectura del JSON ───────────────────────────────────────────────────────

export interface PuntoExploracion {
  clave: string;
  etiqueta: string;
  id: number | null;
  valor: number | null;
  documentos: number;
  desglose: Record<string, number | null> | null;
}

export interface SerieExploracion {
  clave: string;
  etiqueta: string;
  id: number | null;
  valor: number | null;
}

export interface Exploracion {
  parametros: {
    desde: string | null;
    hasta: string | null;
    hastaEfectivo: string | null;
    medida: Medida;
    agrupar: Agrupar;
    desglose: Desglose | null;
    porLineas: boolean;
    soloProductos: boolean;
    unidad: string | null;
  };
  sinDatos: boolean;
  total: { valor: number | null; documentos: number; lineas: number | null; variacionPct: number | null };
  anterior: { desde: string; hasta: string; valor: number | null; documentos: number } | null;
  unidades: { unidad: string; lineas: number }[] | null;
  series: SerieExploracion[];
  puntos: PuntoExploracion[];
  resto: { entidades: number; valor: number | null; documentos: number } | null;
}

/** La RPC devolvió `{error}` (parámetros que no acepta). */
export class ErrorExplorador extends Error {}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const lista = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);
const numONulo = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const num = (v: unknown): number => numONulo(v) ?? 0;
const txt = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const txtONulo = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const idONulo = (v: unknown): number | null => {
  const n = Number(v);
  return v != null && Number.isInteger(n) && n > 0 ? n : null;
};
const enLista = <T extends string>(v: unknown, permitidos: readonly { valor: T }[]): T | null =>
  permitidos.some((p) => p.valor === v) ? (v as T) : null;

export function normalizarExploracion(entrada: unknown): Exploracion {
  const r = obj(entrada);
  if (typeof r.error === "string") throw new ErrorExplorador(r.error);
  const p = obj(r.parametros);
  const t = obj(r.total);
  const a = r.anterior ? obj(r.anterior) : null;
  const resto = r.resto ? obj(r.resto) : null;
  return {
    parametros: {
      desde: txtONulo(p.desde),
      hasta: txtONulo(p.hasta),
      hastaEfectivo: txtONulo(p.hasta_efectivo),
      medida: enLista(p.medida, MEDIDAS) ?? "gasto",
      agrupar: enLista(p.agrupar, AGRUPACIONES) ?? "mes",
      desglose: enLista(p.desglose, DESGLOSES),
      porLineas: p.por_lineas === true,
      soloProductos: p.solo_productos === true,
      unidad: txtONulo(p.unidad),
    },
    sinDatos: r.sin_datos === true,
    total: { valor: numONulo(t.valor), documentos: num(t.documentos), lineas: numONulo(t.lineas), variacionPct: numONulo(t.variacion_pct) },
    anterior:
      a && typeof a.desde === "string" && typeof a.hasta === "string"
        ? { desde: a.desde, hasta: a.hasta, valor: numONulo(a.valor), documentos: num(a.documentos) }
        : null,
    unidades: Array.isArray(r.unidades) ? lista(r.unidades).map((u) => ({ unidad: txt(u.unidad), lineas: num(u.lineas) })).filter((u) => u.unidad) : null,
    series: lista(r.series)
      .filter((s) => typeof s.clave === "string")
      .map((s) => ({ clave: txt(s.clave), etiqueta: txt(s.etiqueta) || txt(s.clave), id: idONulo(s.id), valor: numONulo(s.valor) })),
    puntos: lista(r.puntos)
      .filter((x) => typeof x.clave === "string")
      .map((x) => {
        const d = x.desglose && typeof x.desglose === "object" ? (x.desglose as Obj) : null;
        return {
          clave: txt(x.clave),
          etiqueta: txt(x.etiqueta) || txt(x.clave),
          id: idONulo(x.id),
          valor: numONulo(x.valor),
          documentos: num(x.documentos),
          desglose: d ? Object.fromEntries(Object.entries(d).map(([k, v]) => [k, numONulo(v)])) : null,
        };
      }),
    resto: resto ? { entidades: num(resto.entidades), valor: numONulo(resto.valor), documentos: num(resto.documentos) } : null,
  };
}

// ─── Formatos es-ES ─────────────────────────────────────────────────────────

const EUR = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", useGrouping: "always" } as unknown as Intl.NumberFormatOptions);
const DEC = (min: number, max: number) =>
  new Intl.NumberFormat("es-ES", { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: "always" } as unknown as Intl.NumberFormatOptions);
const DEC_0_1 = DEC(0, 1);
const DEC_0_3 = DEC(0, 3);
const DEC_2_4 = DEC(2, 4);
const miles = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const menos = (s: string) => s.replace(/^-/, "−");

/**
 * Cifra exacta: «1.234,56 €» · «152» · «24,5 kg» · «2,3333 €/kg».
 * Los ABONOS salen siempre con «−» (la RPC los da en positivo y el tablero en
 * negativo): el mismo signo en todo Análisis (QA 05/11/2026).
 */
export function formatoValor(n: number | null, medida: Medida, unidad?: string | null): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (medida === "abonos") n = -Math.abs(n);
  switch (infoMedida(medida).formato) {
    case "entero":
      return menos(miles(n));
    case "cantidad":
      return `${menos(DEC_0_3.format(n))}${unidad ? ` ${unidad}` : ""}`;
    case "precio":
      return `${menos(DEC_2_4.format(n))} €${unidad ? `/${unidad}` : ""}`;
    default:
      return menos(EUR.format(n));
  }
}

/** Marca del eje, corta: «120 k €» · «1,2 M €» · «850 €» · «1,5 k kg». */
export function formatoEje(n: number, medida: Medida, unidad?: string | null): string {
  const f = infoMedida(medida).formato;
  const suf = f === "eur" ? " €" : f === "precio" ? ` €${unidad ? `/${unidad}` : ""}` : f === "cantidad" && unidad ? ` ${unidad}` : "";
  const abs = Math.abs(n);
  let cuerpo: string;
  if (f === "precio" && abs < 1000) cuerpo = DEC(0, 2).format(n);
  else if (abs >= 1_000_000) cuerpo = `${DEC_0_1.format(n / 1_000_000)} M`;
  else if (abs >= 1_000) cuerpo = `${DEC_0_1.format(n / 1_000)} k`;
  else cuerpo = DEC_0_1.format(n);
  return menos(`${cuerpo}${suf}`.trim());
}

const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Etiqueta del eje (corta) y la del tooltip/tabla (larga) de una clave. */
export function etiquetasClave(agrupar: Agrupar, clave: string, etiqueta: string, variosAnios = false): { corta: string; larga: string } {
  if (agrupar === "dia" && /^\d{4}-\d{2}-\d{2}$/.test(clave)) {
    const d = Number(clave.slice(8, 10));
    return { corta: `${d} ${mesCorto(clave.slice(0, 7))}`, larga: `${d} de ${MESES_LARGOS[+clave.slice(5, 7) - 1]} de ${clave.slice(0, 4)}` };
  }
  if (agrupar === "semana" && /^\d{4}-\d{2}-\d{2}$/.test(clave)) {
    const fin = sumarDiasIso(clave, 6);
    return { corta: `${Number(clave.slice(8, 10))} ${mesCorto(clave.slice(0, 7))}`, larga: `Semana del ${textoRango(clave, fin)}` };
  }
  if (agrupar === "mes" && /^\d{4}-\d{2}$/.test(clave)) {
    return { corta: mesCorto(clave, variosAnios), larga: etiquetaMes(clave) };
  }
  if (agrupar === "trimestre" && /^\d{4}-T[1-4]$/.test(clave)) {
    return { corta: `T${clave.slice(6)} ${variosAnios ? clave.slice(2, 4) : ""}`.trim(), larga: `${clave.slice(6)}.º trimestre de ${clave.slice(0, 4)}` };
  }
  if (agrupar === "proveedor") return { corta: nombreCorto(etiqueta), larga: etiqueta };
  if (agrupar === "producto") {
    const bonito = etiqueta.charAt(0).toUpperCase() + etiqueta.slice(1).toLowerCase();
    return { corta: bonito, larga: bonito };
  }
  return { corta: etiqueta, larga: etiqueta };
}

/**
 * Desde–hasta del tramo de tiempo de una clave (para «filtrar a este tramo»).
 * Con `limite` (el periodo de la gráfica) se recorta a él: la semana del 29 dic
 * en un periodo que empieza el 1 ene se queda en 1–4 ene (QA 05/11/2026).
 */
export function rangoDeClave(
  agrupar: Agrupar,
  clave: string,
  limite?: { desde: string | null; hasta: string | null },
): { desde: string; hasta: string } | null {
  const r = rangoSinRecortar(agrupar, clave);
  if (!r || !limite) return r;
  const desde = limite.desde && limite.desde > r.desde ? limite.desde : r.desde;
  const hasta = limite.hasta && limite.hasta < r.hasta ? limite.hasta : r.hasta;
  return desde <= hasta ? { desde, hasta } : r;
}

function rangoSinRecortar(agrupar: Agrupar, clave: string): { desde: string; hasta: string } | null {
  if (agrupar === "dia" && /^\d{4}-\d{2}-\d{2}$/.test(clave)) return { desde: clave, hasta: clave };
  if (agrupar === "semana" && /^\d{4}-\d{2}-\d{2}$/.test(clave)) return { desde: clave, hasta: sumarDiasIso(clave, 6) };
  if (agrupar === "mes" && /^\d{4}-\d{2}$/.test(clave)) return { desde: `${clave}-01`, hasta: finDeMes(clave) };
  if (agrupar === "trimestre" && /^\d{4}-T[1-4]$/.test(clave)) {
    const q = Number(clave.slice(6));
    const mesIni = `${clave.slice(0, 4)}-${String(q * 3 - 2).padStart(2, "0")}`;
    const mesFin = `${clave.slice(0, 4)}-${String(q * 3).padStart(2, "0")}`;
    return { desde: `${mesIni}-01`, hasta: finDeMes(mesFin) };
  }
  return null;
}

/** Al acercarse a un tramo, el eje baja un nivel: trimestre → mes → día; semana → día. */
export const ejeAlAcercar = (a: Agrupar): Agrupar => (a === "trimestre" ? "mes" : a === "mes" || a === "semana" ? "dia" : a);

// ─── Colores fijos por entidad ──────────────────────────────────────────────

/** Paleta categórica (contraste ≥ 3:1 sobre blanco y sobre el gris oscuro del tema). */
export const PALETA = ["#0369a1", "#ea580c", "#15803d", "#7c3aed", "#be123c", "#0f766e", "#a16207", "#4338ca", "#c026d3", "#4d7c0f", "#b45309", "#0e7490"];
export const COLOR_OTROS = "#64748b";
/** stone-500 (no stone-400): contraste ≥ 3:1 sobre blanco. */
export const COLOR_SIN_CLASIFICAR = "#78716c";
export const COLOR_UNICO = PALETA[0];
/** Touza en orange-600: el #f97316 de antes no llegaba a 3:1 sobre blanco (QA 05/11/2026). */
const COLOR_LOCAL: Record<string, string> = { casa_tomas: "#0369a1", touza: "#ea580c" };
const COLOR_TIPO: Record<string, string> = { factura: "#0369a1", albaran: "#d97706", abono: "#e11d48" };

/**
 * Color de una serie: Casa Tomás azul y Touza naranja (como el resto del
 * panel); los tipos de documento, fijos; cada familia, el suyo por id; los
 * proveedores, por su puesto en la gráfica (el mismo proveedor, el mismo color
 * en toda la gráfica); «Otros» gris y «Sin clasificar» piedra.
 */
export function colorSerie(desglose: Desglose | Agrupar | null, clave: string, indice: number): string {
  if (clave === "__otros__") return COLOR_OTROS;
  if (desglose === "local") return COLOR_LOCAL[clave] ?? PALETA[indice % PALETA.length];
  if (desglose === "tipo") return COLOR_TIPO[clave] ?? PALETA[indice % PALETA.length];
  if (desglose === "familia") {
    if (clave === "0") return COLOR_SIN_CLASIFICAR;
    const id = Number(clave);
    return Number.isInteger(id) && id > 0 ? PALETA[(id - 1) % PALETA.length] : PALETA[indice % PALETA.length];
  }
  return PALETA[indice % PALETA.length];
}

// ─── Datos listos para la gráfica ───────────────────────────────────────────

export interface FilaGrafica {
  clave: string;
  corta: string;
  larga: string;
  valor: number | null;
  documentos: number;
  id: number | null;
  /** Valor de cada serie del desglose: `s_<índice>`. */
  [serie: `s_${number}`]: number | null;
}

export interface SerieGrafica {
  clave: string;
  dato: `s_${number}`;
  etiqueta: string;
  color: string;
  valor: number | null;
}

/** Medidas que se SUMAN (un tramo sin compras vale 0); el precio medio no. */
export const esSumable = (m: Medida): boolean => m !== "precio";

/**
 * Puntos y series para recharts. «Sin clasificar» (familia) sale aparte cuando
 * aplasta al resto: el 80 % de las líneas aún no tiene familia.
 * En ejes de tiempo con medidas sumables, un tramo sin compras de una serie
 * vale 0 (no un hueco): si no, la línea de Touza (pocos días con compras) no
 * se veía (QA 05/11/2026).
 */
export function datosGrafica(
  ex: Exploracion,
  opciones: { apartarSinClasificar?: boolean } = {},
): { filas: FilaGrafica[]; series: SerieGrafica[]; apartado: PuntoExploracion | null } {
  const { agrupar, desglose, medida } = ex.parametros;
  const rellenar = esTiempo(agrupar) && esSumable(medida);
  const variosAnios = esTiempo(agrupar) && new Set(ex.puntos.map((p) => p.clave.slice(0, 4))).size > 1;
  let puntos = ex.puntos;
  let apartado: PuntoExploracion | null = null;
  if (opciones.apartarSinClasificar && agrupar === "familia") {
    apartado = puntos.find((p) => p.clave === "0") ?? null;
    puntos = puntos.filter((p) => p.clave !== "0");
  }
  const series: SerieGrafica[] = desglose
    ? ex.series.map((s, i) => ({
        clave: s.clave,
        dato: `s_${i}` as const,
        etiqueta: desglose === "proveedor" && s.clave !== "__otros__" ? nombreCorto(s.etiqueta) : s.etiqueta,
        color: colorSerie(desglose, s.clave, i),
        valor: s.valor,
      }))
    : [];
  const filas = puntos.map((p) => {
    const e = etiquetasClave(agrupar, p.clave, p.etiqueta, variosAnios);
    const fila: FilaGrafica = { clave: p.clave, corta: e.corta, larga: e.larga, valor: p.valor ?? (rellenar ? 0 : null), documentos: p.documentos, id: p.id };
    for (const s of series) fila[s.dato] = p.desglose?.[s.clave] ?? (rellenar ? 0 : null);
    return fila;
  });
  return { filas, series, apartado };
}

/** Resumen en una frase para lectores de pantalla y para la cabecera. */
export function resumenExploracion(ex: Exploracion): string {
  const { medida, agrupar, unidad } = ex.parametros;
  const conDatos = ex.puntos.filter((p) => p.valor !== null && (p.documentos > 0 || !esTiempo(agrupar)));
  if (ex.sinDatos || conDatos.length === 0) return "No hay datos para esta combinación.";
  const total = `Total ${formatoValor(ex.total.valor, medida, unidad)}`;
  const max = conDatos.reduce((a, b) => ((b.valor ?? -Infinity) > (a.valor ?? -Infinity) ? b : a));
  const e = etiquetasClave(agrupar, max.clave, max.etiqueta);
  const var_ = ex.total.variacionPct !== null ? `, ${textoPct(ex.total.variacionPct)} frente al periodo anterior` : "";
  return `${total}${var_}. El ${esTiempo(agrupar) ? "tramo" : "primero"} más alto: ${e.larga}, ${formatoValor(max.valor, medida, unidad)}.`;
}

// ─── CSV ────────────────────────────────────────────────────────────────────

/**
 * Celda de texto del CSV. Lo que empieza por = + - @ (o tabulador/retorno)
 * va con «'» delante: Excel no lo ejecuta como fórmula (inyección CSV).
 */
const celda = (texto: string) => {
  const s = /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const numeroCsvCrudo = (n: number | null) => (n === null ? "" : String(n).replace(".", ","));

/** CSV para Excel en español: `;` y coma decimal, con BOM. */
export function csvExploracion(ex: Exploracion, titulo: string): string {
  const { agrupar, medida, unidad } = ex.parametros;
  const { filas, series } = datosGrafica(ex);
  const m = infoMedida(medida);
  // Abonos con «−», como en el resto de Análisis.
  const numeroCsv = (n: number | null) => numeroCsvCrudo(medida === "abonos" && n !== null ? -Math.abs(n) : n);
  const nombreMedida = `${m.etiqueta}${m.iva ? ` ${m.iva}` : ""}${unidad && (m.formato === "cantidad" || m.formato === "precio") ? ` (${unidad})` : ""}`;
  const cab = [etiquetaAgrupar(agrupar), ...series.map((s) => `${s.etiqueta}`), nombreMedida, "Documentos"];
  const lineas = [`# ${titulo}`, cab.map(celda).join(";")];
  for (const f of filas) lineas.push([celda(f.larga), ...series.map((s) => numeroCsv(f[s.dato] ?? null)), numeroCsv(f.valor), String(f.documentos)].join(";"));
  if (ex.resto && ex.resto.entidades > 0)
    lineas.push([celda(`Otros (${ex.resto.entidades})`), ...series.map(() => ""), numeroCsv(ex.resto.valor), String(ex.resto.documentos)].join(";"));
  lineas.push([celda("Total"), ...series.map((s) => numeroCsv(s.valor)), numeroCsv(ex.total.valor), String(ex.total.documentos)].join(";"));
  return `\uFEFF${lineas.join("\r\n")}\r\n`;
}

// ─── Presets de un toque ────────────────────────────────────────────────────

export interface PresetExplorador {
  id: string;
  etiqueta: string;
  config: Partial<ConfigExplorador>;
  /** Necesita elegir un producto (abre el buscador). */
  pideProducto?: boolean;
}

export const PRESETS: PresetExplorador[] = [
  { id: "gasto-mes", etiqueta: "Gasto por mes", config: { medida: "gasto", agrupar: "mes", desglose: "local", grafica: "auto" } },
  { id: "top-proveedores", etiqueta: "Top proveedores", config: { medida: "gasto", agrupar: "proveedor", desglose: null, grafica: "auto", top: 10 } },
  { id: "familias", etiqueta: "Por familia", config: { medida: "base", agrupar: "familia", desglose: null, grafica: "auto" } },
  { id: "precio-producto", etiqueta: "Precio de un producto", config: { medida: "precio", agrupar: "mes", desglose: "proveedor", grafica: "auto" }, pideProducto: true },
  { id: "abonos-proveedor", etiqueta: "Abonos por proveedor", config: { medida: "abonos", agrupar: "proveedor", desglose: null, grafica: "auto" } },
];

/** Aplica un preset sobre la configuración actual (conserva los filtros salvo los que no encajan). */
export function aplicarPreset(actual: ConfigExplorador, preset: PresetExplorador): ConfigExplorador {
  const filtros = preset.id === "familias" || preset.id === "precio-producto" ? actual.filtros : { ...actual.filtros, familias: [], productos: [], unidad: null };
  return ajustarConfig({ ...actual, ...preset.config, filtros }).config;
}

/** Qué preset coincide con la configuración (para marcarlo). */
export function presetActivo(c: ConfigExplorador): string | null {
  for (const p of PRESETS) {
    const k = p.config;
    if (k.medida === c.medida && k.agrupar === c.agrupar && (k.desglose ?? null) === c.desglose) return p.id;
  }
  return null;
}

// ─── Tocar un punto ─────────────────────────────────────────────────────────

export type AccionPunto =
  | { tipo: "tramo"; desde: string; hasta: string; eje: Agrupar }
  | { tipo: "filtro"; filtros: FiltrosExplorador; etiqueta: string }
  | { tipo: "local"; local: "casa_tomas" | "touza" };

/**
 * Lo que hace «Filtrar a esto» según el eje (null si no hay nada que filtrar).
 * `limite`: el periodo de la gráfica (el tramo no se sale de él).
 */
export function accionDePunto(
  c: ConfigExplorador,
  p: Pick<PuntoExploracion, "clave" | "etiqueta" | "id">,
  limite?: { desde: string | null; hasta: string | null },
): AccionPunto | null {
  const f = c.filtros;
  if (esTiempo(c.agrupar)) {
    const r = rangoDeClave(c.agrupar, p.clave, limite);
    return r ? { tipo: "tramo", ...r, eje: ejeAlAcercar(c.agrupar) } : null;
  }
  if (p.clave === "__otros__") return null;
  switch (c.agrupar) {
    case "proveedor":
      return p.id && !f.proveedores.some((x) => x.id === p.id)
        ? { tipo: "filtro", filtros: { ...f, proveedores: [...f.proveedores, { id: p.id, nombre: nombreCorto(p.etiqueta) }] }, etiqueta: "Filtrar a este proveedor" }
        : null;
    case "familia": {
      const id = p.clave === "0" ? 0 : p.id;
      return id !== null && !f.familias.some((x) => x.id === id)
        ? { tipo: "filtro", filtros: { ...f, familias: [...f.familias, { id, nombre: p.etiqueta }] }, etiqueta: "Filtrar a esta familia" }
        : null;
    }
    case "producto":
      return !f.productos.includes(p.clave)
        ? { tipo: "filtro", filtros: { ...f, productos: [...f.productos, p.clave] }, etiqueta: "Filtrar a este producto" }
        : null;
    case "tipo":
      return (["factura", "albaran", "abono"] as string[]).includes(p.clave) && !f.tipos.includes(p.clave as TipoDoc)
        ? { tipo: "filtro", filtros: { ...f, tipos: [...f.tipos, p.clave as TipoDoc] }, etiqueta: "Filtrar a este tipo" }
        : null;
    case "local":
      return p.clave === "casa_tomas" || p.clave === "touza" ? { tipo: "local", local: p.clave } : null;
    default:
      return null;
  }
}

// ─── Fijar en el tablero ────────────────────────────────────────────────────

export interface ExploracionFijada {
  id: string;
  titulo: string;
  config: ConfigExplorador;
  fijadaEn: string;
}

export const CLAVE_EXPLORACIONES_FIJADAS = "facturas-analisis-explorador-fijadas";
export const MAX_EXPLORACIONES_FIJADAS = 8;

const entidades = (v: unknown, minId = 1): EntidadFiltro[] =>
  Array.isArray(v)
    ? v
        .map(obj)
        .filter((x) => Number.isInteger(x.id) && (x.id as number) >= minId && typeof x.nombre === "string")
        .slice(0, 50)
        .map((x) => ({ id: x.id as number, nombre: (x.nombre as string).slice(0, 160) }))
    : [];

/** Lee una configuración guardada sin fiarse (lo que no valga, al valor por defecto). */
export function normalizarConfig(v: unknown): ConfigExplorador | null {
  const o = obj(v);
  const medida = enLista(o.medida, MEDIDAS);
  const agrupar = enLista(o.agrupar, AGRUPACIONES);
  if (!medida || !agrupar) return null;
  const f = obj(o.filtros);
  const grafica = o.grafica === "auto" ? "auto" : enLista(o.grafica, GRAFICAS) ?? "auto";
  const top = Number(o.top);
  const config: ConfigExplorador = {
    medida,
    agrupar,
    desglose: enLista(o.desglose, DESGLOSES),
    grafica,
    top: Number.isInteger(top) && top >= 1 && top <= 50 ? top : 10,
    filtros: {
      proveedores: entidades(f.proveedores),
      familias: entidades(f.familias, 0),
      productos: Array.isArray(f.productos) ? f.productos.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 20).map((x) => x.slice(0, 160)) : [],
      tipos: Array.isArray(f.tipos) ? f.tipos.filter((x): x is TipoDoc => x === "factura" || x === "albaran" || x === "abono") : [],
      unidad: typeof f.unidad === "string" && f.unidad.trim() ? f.unidad.trim().slice(0, 20) : null,
    },
  };
  return ajustarConfig(config).config;
}

export function normalizarExploracionesFijadas(entrada: unknown): ExploracionFijada[] {
  if (!Array.isArray(entrada)) return [];
  const vistas = new Set<string>();
  const salida: ExploracionFijada[] = [];
  for (const x of entrada) {
    const o = obj(x);
    const config = normalizarConfig(o.config);
    if (typeof o.id !== "string" || !o.id || vistas.has(o.id) || !config) continue;
    vistas.add(o.id);
    salida.push({ id: o.id, titulo: typeof o.titulo === "string" && o.titulo ? o.titulo.slice(0, 200) : tituloConfig(config), config, fijadaEn: typeof o.fijadaEn === "string" ? o.fijadaEn : "" });
  }
  return salida.slice(-MAX_EXPLORACIONES_FIJADAS);
}

/** Clave estable de una configuración (no se fija dos veces la misma). */
export function claveConfig(c: ConfigExplorador): string {
  const f = c.filtros;
  return [
    c.medida,
    c.agrupar,
    c.desglose ?? "-",
    graficaEfectiva(c),
    c.top,
    f.proveedores.map((p) => p.id).sort((a, b) => a - b).join(","),
    f.familias.map((p) => p.id).sort((a, b) => a - b).join(","),
    [...f.productos].sort().join("|"),
    [...f.tipos].sort().join(","),
    f.unidad ?? "",
  ].join("~");
}

/** Texto corto de los filtros: «Embajadores · Pescado y marisco · gamba». */
export function textoFiltros(f: FiltrosExplorador): string {
  return [
    ...f.proveedores.map((p) => p.nombre),
    ...f.familias.map((p) => p.nombre),
    ...f.productos,
    ...f.tipos.map((t) => TIPOS_DOC.find((x) => x.valor === t)?.etiqueta ?? t),
    ...(f.unidad ? [`en ${f.unidad}`] : []),
  ].join(" · ");
}

export function fijarExploracion(lista: ExploracionFijada[], config: ConfigExplorador, ahora: Date = new Date()): ExploracionFijada[] {
  const id = claveConfig(config);
  if (lista.some((x) => x.id === id)) return lista;
  const filtros = textoFiltros(config.filtros);
  const titulo = `${tituloConfig(config)}${filtros ? ` · ${filtros}` : ""}`;
  return [...lista, { id, titulo, config, fijadaEn: ahora.toISOString() }].slice(-MAX_EXPLORACIONES_FIJADAS);
}
