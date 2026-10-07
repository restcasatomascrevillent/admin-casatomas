// Preguntas rápidas del chat de facturas: fechas, formato y tipos de las RPC.
//
// Las preguntas rápidas NO pasan por la IA: cada botón llama a una RPC SQL
// `*_agente` (las mismas que usa el chatbot como herramientas) y pinta su
// JSON con un componente propio. 0 tokens, al instante. Este módulo es la
// parte pura (sin React) para poder probarla sola.

// ─── Fechas (zona del restaurante) ───────────────────────────────────────────

export const ZONA_RESTAURANTE = "Europe/Madrid";

export interface FechaCivil {
  anio: number;
  /** 1–12 */
  mes: number;
  dia: number;
}

export interface Rango {
  /** AAAA-MM-DD */
  desde: string;
  /** AAAA-MM-DD */
  hasta: string;
}

const dos = (n: number) => String(n).padStart(2, "0");

/** Día de hoy en Madrid (no en la zona del navegador ni en UTC). */
export function hoyMadrid(ahora: Date = new Date()): FechaCivil {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA_RESTAURANTE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ahora);
  const valor = (t: string) => Number(partes.find((p) => p.type === t)?.value);
  return { anio: valor("year"), mes: valor("month"), dia: valor("day") };
}

export const fechaIso = (f: FechaCivil) => `${f.anio}-${dos(f.mes)}-${dos(f.dia)}`;
export const claveMes = (anio: number, mes: number) => `${anio}-${dos(mes)}`;

/** Días del mes (mes 1–12). */
export const diasDelMes = (anio: number, mes: number) => new Date(Date.UTC(anio, mes, 0)).getUTCDate();

/** Mes desplazado `delta` meses (negativo = hacia atrás). */
export function moverMes(anio: number, mes: number, delta: number): { anio: number; mes: number } {
  const total = anio * 12 + (mes - 1) + delta;
  return { anio: Math.floor(total / 12), mes: (total % 12) + 1 };
}

/** Primer y último día de un mes natural. */
export function rangoMes(anio: number, mes: number): Rango {
  return { desde: `${claveMes(anio, mes)}-01`, hasta: `${claveMes(anio, mes)}-${dos(diasDelMes(anio, mes))}` };
}

/**
 * «Gasto este mes»: el mes natural en curso y el anterior, completos.
 * El mes en curso va hasta su último día (no hay documentos con fecha futura);
 * `hoy` sirve para decir en pantalla que es un mes a medias.
 */
export function rangosGastoMes(ahora: Date = new Date()) {
  const hoy = hoyMadrid(ahora);
  const ant = moverMes(hoy.anio, hoy.mes, -1);
  return {
    hoy,
    actual: { ...rangoMes(hoy.anio, hoy.mes), anio: hoy.anio, mes: hoy.mes },
    anterior: { ...rangoMes(ant.anio, ant.mes), anio: ant.anio, mes: ant.mes },
  };
}

/** Año natural en curso (Madrid). */
export function rangoAnioActual(ahora: Date = new Date()): Rango & { anio: number } {
  const { anio } = hoyMadrid(ahora);
  return { anio, desde: `${anio}-01-01`, hasta: `${anio}-12-31` };
}

/** Los 12 meses que acaban en el mes en curso, del más antiguo al actual ("AAAA-MM"). */
export function ultimos12Meses(ahora: Date = new Date()): string[] {
  const hoy = hoyMadrid(ahora);
  return Array.from({ length: 12 }, (_, i) => {
    const m = moverMes(hoy.anio, hoy.mes, i - 11);
    return claveMes(m.anio, m.mes);
  });
}

/** Rango de los últimos 12 meses (día 1 del primero → último día del actual). */
export function rangoUltimos12Meses(ahora: Date = new Date()): Rango {
  const meses = ultimos12Meses(ahora);
  const [a0, m0] = meses[0].split("-").map(Number);
  const [a1, m1] = meses[11].split("-").map(Number);
  return { desde: rangoMes(a0, m0).desde, hasta: rangoMes(a1, m1).hasta };
}

// ─── Formato es-ES ───────────────────────────────────────────────────────────

const NBSP = " ";

/**
 * Número con punto de miles y coma decimal SIEMPRE («1.234,56»). Se hace a
 * mano porque `Intl` en es-ES no agrupa los números de 4 cifras («1234,56»).
 */
export function formatNumeroEs(n: number, decimales = 2, minimoDecimales = decimales): string {
  const factor = 10 ** decimales;
  const redondeado = Math.round(Math.abs(n) * factor) / factor;
  let [entera, dec = ""] = redondeado.toFixed(decimales).split(".");
  entera = entera.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  dec = dec.replace(/0+$/, "").padEnd(minimoDecimales, "0");
  const signo = n < 0 && redondeado !== 0 ? "-" : "";
  return `${signo}${entera}${dec ? `,${dec}` : ""}`;
}

/** «1.234,56 €» (espacio duro antes del símbolo). */
export const formatEuros = (n: number | null | undefined): string =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : `${formatNumeroEs(n, 2)}${NBSP}€`;

/** Cantidad con hasta 3 decimales: «53,5», «1.200», «0,125». */
export const formatCantidad = (n: number | null | undefined): string =>
  n === null || n === undefined ? "—" : formatNumeroEs(n, 3, 0);

/** "2026-10-03" → "03/10/2026" (sin pasar por Date: nada de husos). */
export function formatFechaEs(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "2026-10" → "octubre 2026"; con `corto`, "oct 2026". */
export function formatMesEs(clave: string, corto = false): string {
  const [a, m] = clave.split("-").map(Number);
  const nombre = MESES[m - 1] ?? clave;
  return `${corto ? nombre.slice(0, 3) : nombre} ${a}`;
}

export const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "1 factura" / "3 facturas"; "1 albarán" / "2 albaranes". */
export const plural = (n: number, uno: string, varios: string) => `${formatNumeroEs(n, 0)} ${n === 1 ? uno : varios}`;

// ─── Tipos de lo que devuelven las RPC (solo lo que se pinta) ────────────────
// Definiciones en supabase/migrations/20261006100000_chatbot_facturas_deducidos.sql.
// Las claves opcionales solo vienen cuando aplican (jsonb_strip_nulls).

export interface DocRef {
  id: number;
  tipo?: string;
  numero: string | null;
  proveedor: string | null;
  fecha: string | null;
  iva_conocido?: boolean;
}

export interface ListaDocs {
  n: number;
  docs: DocRef[];
}

export interface SiDasImportes {
  sin_total?: ListaDocs;
  deducidos?: ListaDocs;
  sin_iva?: ListaDocs;
}

export interface AlertaCompacta {
  codigo: string;
  mensaje: string;
}

export interface ResumenPeriodo {
  error?: string;
  periodo?: Rango;
  sin_datos?: boolean;
  aviso?: string;
  facturas?: { n: number; gasto: number; base?: number; iva?: number; si_das_importes?: SiDasImportes };
  albaranes?: { n: number; valor: number; si_das_importes?: SiDasImportes };
  con_alertas?: { id: number; numero: string | null; proveedor: string | null; alertas: AlertaCompacta[] }[];
  proveedores?: {
    proveedor: string;
    facturas?: number;
    gasto?: number;
    sin_total?: number;
    deducidos?: number;
    albaranes?: number;
    valor_albaranes?: number;
  }[];
  total_proveedores?: number;
}

export interface MesEstadistica {
  mes: string;
  facturas: number;
  gasto: number;
  sin_total?: number;
  deducidos?: number;
  albaranes?: number;
  fecha_dudosa?: number;
}

export interface EstadisticasGlobales {
  sin_datos?: boolean;
  aviso?: string;
  meses?: MesEstadistica[];
}

export interface FilaGastoProveedor {
  proveedor: string;
  documentos: number;
  importe: number;
  sin_total?: number;
  deducidos?: number;
}

export interface FilaCantidadProducto {
  producto: string;
  cantidad?: number;
  unidad?: string | null;
  veces: number;
  importe?: number;
}

export interface Ranking<F> {
  error?: string;
  criterio: string;
  filas: F[];
  total_filas: number;
  truncado: boolean;
  servicios_excluidos?: { n: number; nombres?: string[] };
  documentos_sin_total?: ListaDocs;
  documentos_deducidos?: ListaDocs;
}

export interface DocumentoCompacto {
  id: number;
  tipo: string;
  numero: string | null;
  proveedor: string | null;
  fecha: string | null;
  total?: number;
  sin_total?: boolean;
  total_origen?: "deducido";
  iva_conocido?: boolean;
  fecha_dudosa?: boolean;
  alertas?: AlertaCompacta[];
}

export interface FiltroDocumentos {
  error?: string;
  criterio: string;
  filas: DocumentoCompacto[];
  total_filas: number;
  truncado: boolean;
  nota?: string;
}

// ─── Avisos de cifra parcial (sin interpretar) ───────────────────────────────

export interface Aviso {
  texto: string;
  docs?: DocRef[];
}

/**
 * Traduce `si_das_importes` (o las listas sueltas de un ranking) a frases
 * cortas. Solo cuenta lo que dice la RPC; no saca conclusiones.
 */
export function avisosDeImportes(
  si: SiDasImportes | undefined,
  nombres: { uno: string; varios: string } = { uno: "factura", varios: "facturas" },
): Aviso[] {
  if (!si) return [];
  const avisos: Aviso[] = [];
  if (si.sin_total && si.sin_total.n > 0) {
    avisos.push({
      texto: `Cifra parcial: ${plural(si.sin_total.n, nombres.uno, nombres.varios)} sin total (no suma${si.sin_total.n === 1 ? "" : "n"}).`,
      docs: si.sin_total.docs,
    });
  }
  if (si.deducidos && si.deducidos.n > 0) {
    const sinIva = si.deducidos.docs.filter((d) => d.iva_conocido === false).length;
    avisos.push({
      texto:
        `${plural(si.deducidos.n, nombres.uno, nombres.varios)} con el total calculado desde las líneas, no leído del documento` +
        (sinIva > 0 ? ` (${formatNumeroEs(sinIva, 0)} sin IVA: el importe real es mayor).` : "."),
      docs: si.deducidos.docs,
    });
  }
  return avisos;
}

/** Documentos de `con_alertas` con la fecha de subida en vez de la impresa. */
export function avisoFechaDudosa(conAlertas: ResumenPeriodo["con_alertas"]): Aviso | null {
  const dudosos = (conAlertas ?? []).filter((d) => d.alertas?.some((a) => a.codigo === "fecha_ausente"));
  if (dudosos.length === 0) return null;
  return {
    texto: `${plural(dudosos.length, "documento", "documentos")} con fecha dudosa (sin fecha impresa: se guardó la de subida).`,
    docs: dudosos.map((d) => ({ id: d.id, numero: d.numero, proveedor: d.proveedor, fecha: null })),
  };
}

/** Error que las RPC devuelven dentro del JSON (`{error: "..."}`) en vez de lanzar. */
export function comprobarErrorRpc<T>(datos: T): T {
  const error = (datos as { error?: unknown } | null)?.error;
  if (typeof error === "string" && error) throw new Error(error);
  if (datos === null || datos === undefined) throw new Error("La consulta no ha devuelto nada.");
  return datos;
}

// ─── Gasto por categoría y variación de precios ──────────────────────────────
// Definiciones en supabase/migrations/20261007170000_chatbot_categorias_precios.sql.

/** Precio unitario: hasta 4 decimales, mínimo 2 («12,9» → «12,90 €/kg»). */
export const formatPrecioUnidad = (precio: number | null | undefined, unidad?: string | null): string =>
  precio === null || precio === undefined ? "—" : `${formatNumeroEs(precio, 4, 2)}${NBSP}€${unidad ? `/${unidad}` : ""}`;

/** «+12,5 %» / «−3 %». */
export const formatPorcentaje = (pct: number): string =>
  `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${formatNumeroEs(Math.abs(pct), 1, 0)}${NBSP}%`;

export interface ImporteLineas {
  importe: number;
  lineas: number;
}

export interface GastoCategoria extends ImporteLineas {
  categoria: string;
  pct?: number;
  sub?: (ImporteLineas & { categoria: string })[];
}

export interface GastoCategorias {
  error?: string;
  periodo?: Partial<Rango>;
  total?: ImporteLineas & { documentos?: number; de_albaranes?: number };
  categorias?: GastoCategoria[];
  sin_categoria?: ImporteLineas;
  sin_clasificar?: ImporteLineas;
  incluye_albaranes?: boolean;
  avisos?: { sin_importe?: number; albaranes_ya_facturados?: number };
  nota?: string;
  sin_datos?: boolean;
}

export interface VariacionPrecio {
  producto: string;
  unidad?: string | null;
  precio: number;
  fecha?: string;
  proveedor?: string | null;
  tipo?: "albaran";
  variacion_pct: number;
  ref_precio: number;
  ref_compras?: number;
  ref_desde?: string;
  ref_hasta?: string;
  ref_proveedor?: string | null;
  cambio_proveedor?: boolean;
  pocas_compras?: boolean;
  ref_antigua?: boolean;
}

export interface VariacionPrecios {
  error?: string;
  umbral_pct?: number;
  productos: VariacionPrecio[];
  total_productos?: number;
  truncado?: boolean;
  comparados?: number;
  avisos?: { sin_referencia?: number; pocas_compras?: number; cambio_proveedor?: number; sin_clasificar?: number };
  sin_datos?: boolean;
}

/** Umbral por defecto si no se puede leer configuracion_facturas. */
export const UMBRAL_SUBIDA_POR_DEFECTO = 10;

/**
 * La RPC no existe en la base de datos (migración sin aplicar). PostgREST
 * contesta PGRST202 («Could not find the function»); Postgres, 42883.
 */
export class RpcNoDisponibleError extends Error {
  constructor(funcion: string) {
    super(`La función ${funcion} todavía no existe en la base de datos.`);
    this.name = "RpcNoDisponibleError";
  }
}

export const esErrorRpcInexistente = (error: { code?: string; message?: string } | null | undefined) =>
  !!error && (error.code === "PGRST202" || error.code === "42883");

export const TEXTO_RPC_NO_DISPONIBLE = "Disponible cuando se aplique la actualización de la base de datos.";
