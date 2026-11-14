// ============================================================================
//  Facturas › Análisis en UNA pantalla (maqueta aprobada por el dueño, 07/11/2026)
// ----------------------------------------------------------------------------
//  Antes se apilaban ~12 bloques y «se pierde con tanto scroll». Ahora: una
//  barra, cuatro cifras que también son navegación y UNA vista a la vez
//  (pastillas). Aquí, las cuentas puras (sin React):
//    · las vistas, cuál se recuerda (?vista= o localStorage) y qué módulos del
//      configurador viven en cada una;
//    · «Qué decidir hoy»: las 5 decisiones que más dinero mueven;
//    · «¿Dónde puedo ahorrar?» explicado (cantidad comprada y la frase);
//    · la geometría de la gráfica de precio de la vista «Precios».
// ============================================================================
import type { CambioPrecio, DecisionFacturas, FamiliaDecision } from "./decision";
import type { IdModulo } from "./widgetsTablero";

export type IdVista = "decidir" | "precios" | "ahorro" | "gasto" | "proveedores" | "revisar";

export const VISTAS: { id: IdVista; etiqueta: string }[] = [
  { id: "decidir", etiqueta: "Qué decidir hoy" },
  { id: "precios", etiqueta: "Precios" },
  { id: "ahorro", etiqueta: "Ahorro" },
  { id: "gasto", etiqueta: "Gasto" },
  { id: "proveedores", etiqueta: "Proveedores" },
  { id: "revisar", etiqueta: "Por revisar" },
];

export const VISTA_POR_DEFECTO: IdVista = "decidir";
/** Parámetro de la URL (como `?tab=` y `?modo=`). */
export const PARAM_VISTA = "vista";
export const CLAVE_VISTA = "facturas-analisis-vista";

export const esVista = (v: unknown): v is IdVista => typeof v === "string" && VISTAS.some((x) => x.id === v);

/** La vista al entrar: la de la URL; si no, la última elegida en este navegador; si no, «Qué decidir hoy». */
export function vistaInicial(params: URLSearchParams, guardada: string | null): IdVista {
  const url = params.get(PARAM_VISTA);
  if (esVista(url)) return url;
  return esVista(guardada) ? guardada : VISTA_POR_DEFECTO;
}

export function leerVistaGuardada(): string | null {
  try {
    return window.localStorage.getItem(CLAVE_VISTA);
  } catch {
    return null;
  }
}

export function guardarVista(v: IdVista): void {
  try {
    window.localStorage.setItem(CLAVE_VISTA, v);
  } catch {
    /* navegación privada: se queda en la URL */
  }
}

/**
 * Dónde vive cada módulo del configurador («Personalizar»). Los que no están
 * aquí son el contenido fijo de su vista (subidas → Precios, ahorro → Ahorro,
 * familias → Gasto).
 */
export const VISTA_DE_MODULO: Partial<Record<IdModulo, IdVista>> = {
  gasto_mes: "decidir",
  precios_top: "precios",
  fijos: "gasto",
  abonos: "gasto",
  productos: "gasto",
  proveedores: "proveedores",
  locales: "proveedores",
  regalado: "proveedores",
  precio_producto: "gasto",
  por_revisar: "revisar",
};

/** Las cuatro cifras de arriba: cada una abre su vista. */
export const VISTA_DE_CIFRA = { gasto: "gasto", precios: "precios", ahorro: "ahorro", revisar: "revisar" } as const satisfies Record<string, IdVista>;

// ─── «Qué decidir hoy» ──────────────────────────────────────────────────────

export type Decision =
  | { tipo: "sube"; id: string; eurosMes: number; cambio: CambioPrecio }
  | { tipo: "mejor"; id: string; eurosMes: number; cambio: CambioPrecio }
  | { tipo: "familia"; id: string; eurosMes: number; familia: FamiliaDecision; exceso: number };

/**
 * Las `n` decisiones que más dinero mueven, de todo el análisis, ordenadas por
 * € al mes para poder compararlas: una subida, lo que cuesta al mes; un
 * producto más barato en otro proveedor, su ahorro de 90 días / 3; una familia
 * fuera de lo normal, lo que se pasa de su media, al mes.
 */
export function decisionesDeHoy(d: DecisionFacturas, n = 5): Decision[] {
  const meses = d.periodo.comparado?.modo === "ultimo_mes" ? 1 : Math.max(1, d.periodo.mesesEquivalentes || 1);
  // 14/11/2026 (dueño: «se equivoca mucho»): solo tarjetas con datos que las respalden
  // (precio de la última factura, el de la factura con que se compara y su fecha) y que
  // muevan al menos MIN_EUROS_MES € al mes; lo demás sigue en «Precios» y «Ahorro».
  const todas: Decision[] = [
    ...d.cambios.sube
      .filter(subidaConDatos)
      .map((c) => ({ tipo: "sube" as const, id: c.alerta.id, eurosMes: Math.max(0, c.impactoMes ?? 0), cambio: c })),
    ...d.cambios.mejor
      .filter(ahorroConDatos)
      .map((c) => ({ tipo: "mejor" as const, id: c.alerta.id, eurosMes: Math.max(0, c.alerta.datos.ahorro ?? 0) / 3, cambio: c })),
    ...d.familias
      .filter((f) => f.aviso && f.referencia !== null)
      .map((f) => {
        const exceso = f.importe - (f.referencia ?? 0);
        return { tipo: "familia" as const, id: `fam-${f.id ?? f.familia}`, eurosMes: exceso / meses, familia: f, exceso };
      }),
  ];
  return todas
    .filter((x) => (x.tipo === "familia" ? x.eurosMes > 0 : x.eurosMes >= MIN_EUROS_MES))
    .sort((a, b) => b.eurosMes - a.eurosMes)
    .slice(0, n);
}

/** Por debajo de esto (€ al mes) una subida o un ahorro no es «una decisión de hoy». */
export const MIN_EUROS_MES = 3;

/** Una subida se enseña si trae la última factura y la ANTERIOR con la que se compara (20261130120000). */
export function subidaConDatos(c: CambioPrecio): boolean {
  const d = c.alerta.datos;
  return d.precio !== null && d.precioRef !== null && d.precio > d.precioRef && !!d.fecha && !!d.fechaRef;
}

/** Un «más barato en otro proveedor» se enseña con los dos precios y quién es el otro. */
export function ahorroConDatos(c: CambioPrecio): boolean {
  const d = c.alerta.datos;
  return d.precio !== null && d.precioOtro !== null && d.precio > d.precioOtro && !!d.proveedorOtro && (d.ahorro ?? 0) > 0;
}

// ─── Textos «para todos» de cada decisión (14/11/2026) ─────────────────────

export interface TextoDecision {
  titulo: string;
  /** Qué ha pasado, con números y la factura concreta (proveedor y fecha). */
  quePasa: string;
  /** Por qué importa: el dinero. */
  porQue: string;
  /** Qué puede hacer. */
  queHacer: string;
  /** La cifra de la derecha. */
  euros: string;
}

const SUFIJOS_EMPRESA = /[,.\s]+(S\.?\s?L\.?\s?U\.?|S\.?\s?A\.?\s?U\.?|S\.?\s?L\.?|S\.?\s?A\.?|S\.?\s?C\.?|C\.?\s?B\.?|SLU|SAU|SL|SA)\.?$/i;
/** «Francisco José Santacruz Gambín, S.L.U.» → «Francisco José Santacruz Gambín». */
export function proveedorCorto(nombre: string | null | undefined): string {
  if (!nombre) return "el proveedor";
  let s = nombre.trim();
  for (let i = 0; i < 2; i++) s = s.replace(SUFIJOS_EMPRESA, "").trim();
  return s || nombre;
}

/** Nombre del producto para leer: el del catálogo si viene en el título; si no, la línea en minúsculas. */
export function nombreProducto(c: CambioPrecio): string {
  const t = c.alerta.titulo;
  const m = /^(.+?) sube un /.exec(t) ?? /^(?:Sube|Baja) (.+?):/.exec(t);
  if (m) return m[1];
  const p = c.alerta.datos.producto ?? t;
  return p === p.toUpperCase() ? p.charAt(0) + p.slice(1).toLowerCase() : p;
}

/** «kilo», «litro» o la unidad tal cual. */
const cadaUnidad = (m: string) => (m === "kg" ? "kilo" : m === "l" ? "litro" : m);
/** «02/10» a partir de «AAAA-MM-DD». */
const ddmm = (f: string | null) => (f && /^\d{4}-\d{2}-\d{2}/.test(f) ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : null);

export function textoDecision(x: Decision, mesComparado: string | null): TextoDecision {
  if (x.tipo === "familia") {
    const f = x.familia;
    const cuando = mesComparado ? `En ${mesComparado}` : "En este periodo";
    return {
      titulo: `${f.familia}: gastas más de lo normal`,
      quePasa: `${cuando} has gastado ${eur0(f.importe)} € en ${f.familia.toLowerCase()}. Lo normal (la media de los meses anteriores) es ${eur0(f.referencia ?? 0)} €: son ${eur0(x.exceso)} € más (un ${ent(Math.abs(f.variacionPct ?? 0))} % más).`,
      porQue: "Puede que hayas comprado más porque has tenido más trabajo, o que algo de esta familia haya subido de precio.",
      queHacer: "Pulsa «Ver qué se compró» y mira qué factura se sale de lo normal. Si tuviste más clientes, márcalo como normal.",
      euros: `+${ent(x.exceso)} €`,
    };
  }
  const d = x.cambio.alerta.datos;
  const med = d.medida ?? d.unidad ?? "ud";
  const prov = proveedorCorto(d.proveedor);
  if (x.tipo === "mejor") {
    const a = explicarAhorro(x.cambio);
    const otro = proveedorCorto(a.proveedorOtro);
    const dif = (a.precio ?? 0) - (a.precioOtro ?? 0);
    const fecha = ddmm(d.fecha);
    const fechaOtro = ddmm(d.fechaOtro);
    const cantidad = d.cantidad90 ?? a.cantidad;
    return {
      titulo: `${a.producto}: ${otro} te lo vende más barato`,
      quePasa: `En tu última factura de ${prov}${fecha ? ` (${fecha})` : ""} lo pagaste a ${eur2(a.precio ?? 0)} €/${med}. ${otro}${fechaOtro ? `, en su última factura (${fechaOtro}),` : ""} te lo cobró a ${eur2(a.precioOtro ?? 0)} €/${med}: ${eur2(dif)} € menos por cada ${cadaUnidad(med)}.`,
      porQue: cantidad !== null ? `En los últimos 90 días compraste unos ${textoCantidad(cantidad, med)}: habrías ahorrado unos ${ent(a.ahorro)} €.` : `En los últimos 90 días habrías ahorrado unos ${ent(a.ahorro)} €.`,
      queHacer: `Pídeselo a ${otro} la próxima vez, o enséñale este precio a ${prov}. Antes, mira que sea la misma calidad y el mismo formato.`,
      euros: `ahorras ${ent(a.ahorro)} €`,
    };
  }
  const precio = d.precio ?? 0;
  const ref = d.precioRef ?? 0;
  const mes = Math.max(0, x.cambio.impactoMes ?? 0);
  const cantidadMes = d.cantidad90 !== null ? d.cantidad90 / 3 : null;
  return {
    titulo: `${nombreProducto(x.cambio)} ha subido un ${ent(Math.abs(d.variacionPct ?? ((precio / ref - 1) * 100)))} % en ${prov}`,
    quePasa: `En la factura del ${ddmm(d.fecha) ?? "?"} lo pagaste a ${eur2(precio)} €/${med}. En la anterior (${ddmm(d.fechaRef) ?? "?"}) estaba a ${eur2(ref)} €/${med}: ${eur2(precio - ref)} € más por cada ${cadaUnidad(med)}.`,
    porQue:
      cantidadMes !== null && cantidadMes > 0
        ? `Compras unos ${textoCantidad(cantidadMes, med)} al mes: te cuesta unos ${ent(mes)} € más al mes.`
        : `Con lo que compras, te cuesta unos ${ent(mes)} € más al mes.`,
    queHacer: `Pregunta a ${prov} por qué ha subido, o mira si otro proveedor te lo deja más barato. Si es de temporada, márcalo como normal.`,
    euros: `+${ent(mes)} €/mes`,
  };
}

const eur0 = (n: number) => Math.round(n).toLocaleString("es-ES");

// ─── «¿Dónde puedo ahorrar?» ────────────────────────────────────────────────

export interface AhorroExplicado {
  producto: string;
  /** Lo que pagas ahora y a quién. */
  proveedor: string | null;
  precio: number | null;
  /** El más barato que ya usas. */
  proveedorOtro: string | null;
  precioOtro: number | null;
  medida: string;
  /** Ahorro en 90 días con lo que se compró. */
  ahorro: number;
  /** Cuánto se compró en 90 días (ahorro / diferencia de precio), si se puede saber. */
  cantidad: number | null;
  /** Lo que baja el precio, en % (18 = −18 %). */
  pct: number | null;
}

/**
 * Lo que hace falta para explicar un «más barato en otro proveedor». La RPC
 * calcula el ahorro como (precio − precio_otro) × cantidad de 90 días, así que
 * la cantidad sale de dividir.
 */
export function explicarAhorro(c: CambioPrecio): AhorroExplicado {
  const d = c.alerta.datos;
  const ahorro = Math.max(0, d.ahorro ?? 0);
  const dif = d.precio !== null && d.precioOtro !== null ? d.precio - d.precioOtro : null;
  const cantidad = dif !== null && dif > 0 && ahorro > 0 ? ahorro / dif : null;
  return {
    producto: d.producto ?? c.alerta.titulo,
    proveedor: d.proveedor,
    precio: d.precio,
    proveedorOtro: d.proveedorOtro,
    precioOtro: d.precioOtro,
    medida: d.medida ?? d.unidad ?? "ud",
    ahorro,
    cantidad,
    pct: dif !== null && d.precio ? Math.round((dif / d.precio) * 100) : null,
  };
}

const eur2 = (n: number) => n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ent = (n: number) => Math.round(n).toLocaleString("es-ES");
/** Cantidad legible: «18 kg», «2,5 l», «120 ud». */
export function textoCantidad(cantidad: number, medida: string): string {
  const r = cantidad >= 10 ? Math.round(cantidad) : Math.round(cantidad * 10) / 10;
  return `${r.toLocaleString("es-ES")} ${medida}`;
}

/**
 * La frase en tres trozos (el del medio, el ahorro, va resaltado):
 * «Compraste 18 kg en 90 días. A 29,00 € en lugar de 35,50 € » «habrías pagado 117 € menos» «.»
 */
export function partesFraseAhorro(a: AhorroExplicado): [string, string, string] {
  const pagado = `habrías pagado ${ent(a.ahorro)} € menos`;
  if (a.precio === null || a.precioOtro === null) return ["En 90 días ", pagado, " comprándolo al proveedor más barato que ya usas."];
  const precios = `A ${eur2(a.precioOtro)} € en lugar de ${eur2(a.precio)} € `;
  return [a.cantidad !== null ? `Compraste ${textoCantidad(a.cantidad, a.medida)} en 90 días. ${precios}` : `En 90 días, a ${eur2(a.precioOtro)} € en lugar de ${eur2(a.precio)} € `, pagado, "."];
}

/** «Compraste 18 kg en 90 días. A 29,00 € en lugar de 35,50 € habrías pagado 117 € menos.» */
export const fraseAhorro = (a: AhorroExplicado): string => partesFraseAhorro(a).join("");

// ─── Gráfica de precio (vista «Precios») ────────────────────────────────────

export interface PuntoPrecio {
  mes: string;
  precio: number | null;
}

export interface GeometriaPrecio {
  linea: string;
  puntos: { x: number; y: number; mes: string; precio: number }[];
  /** Raya de referencia (precio de antes o pactado), si cae dentro. */
  referencia: number | null;
  yReferencia: number | null;
  /** Etiquetas del eje Y (mín. y máx.). */
  min: number;
  max: number;
  /** x de cada mes (para las etiquetas del eje X). */
  meses: { x: number; mes: string }[];
}

/** Línea del precio por mes con su raya de referencia, en un viewBox ancho × alto. */
export function geometriaPrecio(serie: PuntoPrecio[], referencia: number | null, ancho = 400, alto = 180, margen = 12): GeometriaPrecio | null {
  const con = serie.map((p, i) => ({ ...p, i })).filter((p): p is PuntoPrecio & { i: number; precio: number } => p.precio !== null && Number.isFinite(p.precio));
  if (con.length === 0) return null;
  const valores = [...con.map((p) => p.precio), ...(referencia !== null && referencia > 0 ? [referencia] : [])];
  let lo = Math.min(...valores);
  let hi = Math.max(...valores);
  const holgura = (hi - lo) * 0.12 || Math.max(1, hi * 0.05);
  lo = Math.max(0, lo - holgura);
  hi += holgura;
  const n = Math.max(1, serie.length - 1);
  const X = (i: number) => margen + (serie.length === 1 ? (ancho - 2 * margen) / 2 : (i * (ancho - 2 * margen)) / n);
  const Y = (v: number) => alto - margen - ((v - lo) / (hi - lo)) * (alto - 2 * margen);
  const f = (v: number) => Math.round(v * 10) / 10;
  const puntos = con.map((p) => ({ x: f(X(p.i)), y: f(Y(p.precio)), mes: p.mes, precio: p.precio }));
  return {
    linea: puntos.map((p, k) => `${k ? "L" : "M"}${p.x},${p.y}`).join(""),
    puntos,
    referencia: referencia !== null && referencia > 0 ? referencia : null,
    yReferencia: referencia !== null && referencia > 0 ? f(Y(referencia)) : null,
    min: lo,
    max: hi,
    meses: serie.map((p, i) => ({ x: f(X(i)), mes: p.mes })),
  };
}

/** Los `n` meses (AAAA-MM) que acaban en `hasta` (AAAA-MM-DD), en orden. */
export function mesesHasta(hasta: string, n = 6): string[] {
  const a = Number(hasta.slice(0, 4));
  const m = Number(hasta.slice(5, 7)) - 1;
  return Array.from({ length: n }, (_, k) => {
    const t = a * 12 + m - (n - 1 - k);
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
  });
}

const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** «septiembre» a partir de «AAAA-MM» o «AAAA-MM-DD». */
export const nombreMes = (mes: string): string => MESES_LARGOS[Number(mes.slice(5, 7)) - 1] ?? mes;
