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
import type { CambioPrecio, DecisionFacturas } from "./decision";
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

/**
 * Un aviso «Margen bajo» de un plato o vino (notificaciones_dashboard, tipo
 * facturas_margen_bajo) con el precio de carta sugerido (avisos_precio_sugerido,
 * 20261130160000: redondeado hacia arriba a 0,50 €, con IVA).
 */
export interface MargenDecision {
  /** id del aviso (lo que piden avisos_precio_sugerido / avisos_aplicar_precio_sugerido). */
  id: string;
  canal: "plato" | "vino";
  nombre: string;
  /** Plato: % de coste sobre la venta sin IVA. Vino: veces lo que cuesta. */
  valor: number | null;
  limite: number | null;
  /** Coste sin IVA (ingredientes o botella). */
  coste: number | null;
  fecha: string | null;
  local: "casa_tomas" | "touza" | null;
  /** Precio de carta, con IVA. */
  precioActual: number | null;
  precioSugerido: number | null;
  aplicado: boolean;
  /** «?tab=margenes&articulo=plato:12» (datos.enlace_margenes). */
  enlaceMargenes: string | null;
}

export type Decision =
  | { tipo: "sube"; id: string; eurosMes: number; cambio: CambioPrecio }
  | { tipo: "mejor"; id: string; eurosMes: number; cambio: CambioPrecio }
  | { tipo: "margen"; id: string; eurosMes: number; margen: MargenDecision };

/** Por debajo de esto (€ al mes) una subida o un ahorro no es «una decisión de hoy» (14/11/2026: antes 3 €). */
export const MIN_EUROS_MES = 10;
/** Una subida cuenta si es de MÁS del 10 % frente a la factura anterior. */
export const MIN_SUBIDA_PCT = 10;
/** Cuántos avisos de «poco margen» como mucho, después de los de precio. */
export const MAX_MARGEN = 3;

/** ¿La fecha (AAAA-MM-DD) cae en el periodo elegido? Sin fecha, sí (no se esconde lo que no se sabe fechar). */
export function enPeriodo(fecha: string | null | undefined, periodo: { desde: string; hasta: string }): boolean {
  if (!fecha || !/^\d{4}-\d{2}-\d{2}/.test(fecha)) return true;
  const f = fecha.slice(0, 10);
  return (!periodo.desde || f >= periodo.desde) && (!periodo.hasta || f <= periodo.hasta);
}

/** El mismo producto (en el mismo local) es UNA decisión, aunque venga en kg y en unidades o de dos reglas. */
function claveProductoDecision(c: CambioPrecio): string {
  const d = c.alerta.datos;
  const nombre = d.productoId !== null ? `p${d.productoId}` : (d.nombreNormalizado ?? d.producto ?? c.alerta.titulo);
  return `${d.local ?? ""}|${nombre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim()}`;
}

/**
 * Lo que hay que decidir (14/11/2026, decisiones del dueño): SOLO tres tipos de aviso
 *   · sube de precio: la última factura frente a la anterior del mismo proveedor, más
 *     del 10 % y al menos 10 € al mes;
 *   · más barato en otro proveedor: al menos 10 € al mes de ahorro;
 *   · plato o vino con poco margen (después, como mucho MAX_MARGEN).
 * Las familias ya no salen (daban falsas alarmas a principios de mes). Todo se filtra
 * por el periodo elegido (la fecha de la factura), un producto sale una sola vez (el
 * aviso que más dinero mueve) y se ordena por € al mes.
 */
export function decisionesDeHoy(d: DecisionFacturas, margenes: MargenDecision[] = [], n = 5): Decision[] {
  const periodo = d.periodo;
  const precios = [
    ...d.cambios.sube
      .filter((c) => subidaConDatos(c) && pctSubida(c) > MIN_SUBIDA_PCT && enPeriodo(c.alerta.datos.fecha, periodo))
      .map((c) => ({ tipo: "sube" as const, id: c.alerta.id, eurosMes: Math.max(0, c.impactoMes ?? 0), cambio: c })),
    ...d.cambios.mejor
      .filter((c) => ahorroConDatos(c) && enPeriodo(c.alerta.datos.fecha, periodo))
      .map((c) => ({ tipo: "mejor" as const, id: c.alerta.id, eurosMes: Math.max(0, c.alerta.datos.ahorro ?? 0) / 3, cambio: c })),
  ]
    .filter((x) => x.eurosMes >= MIN_EUROS_MES)
    .sort((a, b) => b.eurosMes - a.eurosMes);
  const vistos = new Set<string>();
  const unicos = precios.filter((x) => {
    const k = claveProductoDecision(x.cambio);
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  const nombres = new Set<string>();
  const margen: Decision[] = margenes
    .filter((m) => !m.aplicado && enPeriodo(m.fecha, periodo))
    .filter((m) => {
      const k = `${m.canal}|${m.nombre.toLowerCase()}`;
      if (nombres.has(k)) return false;
      nombres.add(k);
      return true;
    })
    .slice(0, MAX_MARGEN)
    .map((m) => ({ tipo: "margen" as const, id: m.id, eurosMes: 0, margen: m }));
  return [...unicos.slice(0, n), ...margen];
}

/** Lo que sube, en %, frente a la factura anterior. */
export function pctSubida(c: CambioPrecio): number {
  const d = c.alerta.datos;
  if (d.precio !== null && d.precioRef !== null && d.precioRef > 0) return Math.round((d.precio / d.precioRef - 1) * 1000) / 10;
  return d.variacionPct ?? 0;
}

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

/** Cada aviso en tres líneas: qué pasa / los números con su factura / cuánto cuesta o qué hacer. */
export interface TextoDecision {
  /** Qué pasa: «Solomillo te ha subido un 15 % en Makro.» */
  titulo: string;
  /** Los números y las facturas: «Factura del 03/11: 21,50 €/kg. En la anterior (12/10) lo pagabas a 18,70 €/kg.» */
  detalle: string;
  /** Cuánto cuesta o qué hacer: «Son unos 35 € más al mes.» */
  cuanto: string;
  /** En pequeño, debajo: el precio normal de 90 días (solo subidas). */
  contexto: string | null;
  /** La factura de la que sale el aviso aún no está revisada. */
  sinRevisar: boolean;
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

/** «02/10» a partir de «AAAA-MM-DD». */
const ddmm = (f: string | null) => (f && /^\d{4}-\d{2}-\d{2}/.test(f) ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : null);
const num1 = (n: number) => n.toLocaleString("es-ES", { maximumFractionDigits: 1 });

export function textoDecision(x: Decision): TextoDecision {
  if (x.tipo === "margen") {
    const m = x.margen;
    const sug = m.precioSugerido;
    const actual = m.precioActual !== null ? ` y lo vendes a ${eur2(m.precioActual)} €` : "";
    return {
      titulo: m.canal === "plato" ? `El plato «${m.nombre}» te deja poco margen.` : `El vino «${m.nombre}» te deja poco margen.`,
      detalle:
        m.canal === "plato"
          ? `Los ingredientes cuestan ${eur2(m.coste ?? 0)} €${actual}: de cada 100 € que cobras (sin IVA), ${ent(m.valor ?? 0)} € son ingredientes. Tu límite es ${ent(m.limite ?? 0)} €.`
          : `La botella te cuesta ${eur2(m.coste ?? 0)} €${actual}: cobras ${num1(m.valor ?? 0)} veces lo que pagas (sin IVA). Tu límite es ${num1(m.limite ?? 0)} veces.`,
      cuanto: sug !== null ? `Para volver a tu límite, ponlo a ${eur2(sug)} € en la carta.` : "Revisa el precio en Facturas › Márgenes.",
      contexto: null,
      sinRevisar: false,
      euros: sug !== null ? `${eur2(sug)} €` : "",
    };
  }
  const d = x.cambio.alerta.datos;
  const med = d.medida ?? d.unidad ?? "ud";
  const prov = proveedorCorto(d.proveedor);
  const sinRevisar = d.facturaVerificada === false;
  if (x.tipo === "mejor") {
    const a = explicarAhorro(x.cambio);
    const otro = proveedorCorto(a.proveedorOtro);
    const fecha = ddmm(d.fecha);
    const fechaOtro = ddmm(d.fechaOtro);
    return {
      titulo: `${a.producto}: ${otro} te lo vende más barato.`,
      detalle: `${prov}${fecha ? ` (${fecha})` : ""}: ${eur2(a.precio ?? 0)} €/${med}. ${otro}${fechaOtro ? ` (${fechaOtro})` : ""}: ${eur2(a.precioOtro ?? 0)} €/${med}.`,
      cuanto: `Ahorrarías unos ${ent(x.eurosMes)} € al mes. Antes, mira que sea la misma calidad.`,
      contexto: null,
      sinRevisar,
      euros: `ahorras ${ent(x.eurosMes)} €/mes`,
    };
  }
  const precio = d.precio ?? 0;
  const ref = d.precioRef ?? 0;
  const mes = Math.max(0, x.cambio.impactoMes ?? 0);
  return {
    titulo: `${nombreProducto(x.cambio)} te ha subido un ${ent(Math.abs(pctSubida(x.cambio)))} % en ${prov}.`,
    detalle: `Factura del ${ddmm(d.fecha) ?? "?"}: ${eur2(precio)} €/${med}. En la anterior (${ddmm(d.fechaRef) ?? "?"}) lo pagabas a ${eur2(ref)} €/${med}.`,
    cuanto: `Son unos ${ent(mes)} € más al mes.`,
    contexto: d.precioContexto !== null && d.precioContexto > 0 ? `Lo normal en los últimos 90 días: ${eur2(d.precioContexto)} €/${med}.` : null,
    sinRevisar,
    euros: `+${ent(mes)} €/mes`,
  };
}

/** Lo que se enseña en el visor al comparar: qué factura es y la línea del producto (resaltada). */
export interface NotaComparar {
  etiqueta: string;
  linea: string;
}

/** «Ver las dos facturas»: la nueva y la anterior (o la del otro proveedor), cada una con su línea. */
export function notasComparar(x: Decision): [NotaComparar, NotaComparar] | null {
  if (x.tipo === "margen") return null;
  const d = x.cambio.alerta.datos;
  const med = d.medida ?? d.unidad ?? "ud";
  const producto = d.producto ?? nombreProducto(x.cambio);
  if (x.tipo === "sube") {
    return [
      { etiqueta: "Factura nueva", linea: `${producto}: ${eur2(d.precio ?? 0)} €/${med}` },
      { etiqueta: "Factura anterior", linea: `${producto}: ${eur2(d.precioRef ?? 0)} €/${med}` },
    ];
  }
  return [
    { etiqueta: `Factura de ${proveedorCorto(d.proveedor)}`, linea: `${producto}: ${eur2(d.precio ?? 0)} €/${med}` },
    { etiqueta: `Factura de ${proveedorCorto(d.proveedorOtro)} (más barato)`, linea: `${producto}: ${eur2(d.precioOtro ?? 0)} €/${med}` },
  ];
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
