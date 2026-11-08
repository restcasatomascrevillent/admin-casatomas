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
  const todas: Decision[] = [
    ...d.cambios.sube.map((c) => ({ tipo: "sube" as const, id: c.alerta.id, eurosMes: Math.max(0, c.impactoMes ?? 0), cambio: c })),
    ...d.cambios.mejor.map((c) => ({ tipo: "mejor" as const, id: c.alerta.id, eurosMes: Math.max(0, c.alerta.datos.ahorro ?? 0) / 3, cambio: c })),
    ...d.familias
      .filter((f) => f.aviso && f.referencia !== null)
      .map((f) => {
        const exceso = f.importe - (f.referencia ?? 0);
        return { tipo: "familia" as const, id: `fam-${f.id ?? f.familia}`, eurosMes: exceso / meses, familia: f, exceso };
      }),
  ];
  return todas.filter((x) => x.eurosMes > 0).sort((a, b) => b.eurosMes - a.eurosMes).slice(0, n);
}

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
