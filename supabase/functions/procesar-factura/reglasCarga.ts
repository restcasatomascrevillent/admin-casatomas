// ============================================================================
//  reglasCarga.ts · Reglas aprendidas en la carga manual del histórico
// ----------------------------------------------------------------------------
//  15/11/2026. Al pasar a mano ~2.400 facturas históricas
//  (facturas-conocimiento/INSTRUCCIONES-EXTRACCION.md, carga2/PROMPT-AGENTE.md
//  y las fichas por CIF) salieron reglas que el OCR diario no aplicaba. Las que
//  el código puede decidir sin ver la imagen viven aquí; las que exigen mirar
//  el papel van en el prompt (prompts.ts, sección 7) y en el esquema.
//
//  Dos momentos:
//   · aplicarReglasLectura(doc): sobre la lectura del modelo, ANTES del cuadre
//     (Pluxee, líneas con IVA incluido). Así el cuadre ve ya el documento
//     corregido y no pide relecturas inútiles. Sus avisos viajan en
//     `avisos_reglas` hasta normalizarDatos.
//   · El resto (abonos, local, no-compra, CIF conocidos, fecha, cajas,
//     duplicados) lo llaman normalizarDatos y guardado.ts.
//  Puro: sin Deno ni red. Lo importa vitest.
// ============================================================================

export interface AvisoRegla {
  codigo: string;
  severidad: "alta" | "media";
  mensaje: string;
  detalle: Record<string, unknown>;
}

const esNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const cifNorm = (c: unknown) => String(c ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^ES(?=[A-Z0-9]{9}$)/, "");
const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

// ─── CIF de proveedores con regla propia ────────────────────────────────────
export const CIF_PLUXEE = "A78604113";
export const CIF_RECHGO = "B16926669";
export const CIF_TRANSGOURMET = "A17371758";
export const CIF_NICOLAS_VALERO = "B06805246";
/** CIF que imprime Nicolás y Valero en sus facturas de 2025 (ficha B06805246). */
export const CIF_NICOLAS_VALERO_2025 = "B30120745";
export const CIF_LONJA_SANTA_POLA = "B54490115";

// ─── Clase de documento: lo que NO es una compra ────────────────────────────
export const CLASES_DOCUMENTO = [
  "compra",
  "adeudo_bancario",
  "comision_tpv",
  "comision_bancaria",
  "cuota_leasing_prestamo",
  "dividendo",
  "venta_emitida",
  "recibo_sgae",
  "otro_no_compra",
] as const;
export type ClaseDocumento = typeof CLASES_DOCUMENTO[number];

const QUE_ES: Record<Exclude<ClaseDocumento, "compra">, string> = {
  adeudo_bancario: "un adeudo o recibo SEPA del banco",
  comision_tpv: "una liquidación o comisión del TPV",
  comision_bancaria: "una comisión o custodia bancaria",
  cuota_leasing_prestamo: "una cuota de leasing o de préstamo",
  dividendo: "un aviso de dividendos",
  venta_emitida: "una factura EMITIDA por MASIDE 2011 (una venta, no una compra)",
  recibo_sgae: "un recibo de la SGAE",
  otro_no_compra: "un documento que no es una factura de proveedor",
};

export interface NoCompra {
  clase: Exclude<ClaseDocumento, "compra">;
  mensaje: string;
}

/**
 * ¿El documento NO es una factura de compra? (no se carga como gasto).
 * Manda la clase que da el modelo; además, si el emisor es el propio
 * restaurante (MASIDE / B54583356) y el destinatario es otro, es una venta.
 * Rechgo (B16926669) es siempre compra: la carga 2 la descartó por error.
 */
export function documentoNoCompra(
  d: { clase_documento?: unknown; cif?: unknown; proveedor?: unknown; cliente?: unknown },
  esCifCliente: (c: string) => boolean,
  esNombreCliente: (n: string) => boolean,
): NoCompra | null {
  if (cifNorm(d.cif) === CIF_RECHGO) return null;
  let clase = typeof d.clase_documento === "string" && (CLASES_DOCUMENTO as readonly string[]).includes(d.clase_documento)
    ? d.clase_documento as ClaseDocumento
    : "compra";
  if (clase === "compra") {
    const emiteMaside = (typeof d.cif === "string" && esCifCliente(d.cif)) &&
      (typeof d.proveedor === "string" && esNombreCliente(d.proveedor));
    const cliente = typeof d.cliente === "string" ? d.cliente.trim() : "";
    if (emiteMaside && cliente && !esNombreCliente(cliente) && !/touza/i.test(cliente)) clase = "venta_emitida";
  }
  if (clase === "compra") return null;
  return {
    clase,
    mensaje: `No es una factura de compra: es ${QUE_ES[clase]}. No se guarda como gasto. ` +
      `Si de verdad es una compra, créala a mano en Facturas.`,
  };
}

// ─── CIF conocidos ───────────────────────────────────────────────────────────

/**
 * CIF que hay que corregir o completar por lo aprendido en el histórico:
 *  · Nicolás y Valero imprime en 2025 el CIF B30120745: su ficha es B06805246.
 *  · Transgourmet: A17371758 aunque el escaneo no lo muestre (por nombre).
 */
export function cifConocido(cif: string | null, proveedor: string | null): { cif: string | null; aviso: AvisoRegla | null } {
  const c = cifNorm(cif);
  const nombre = sinTildes(String(proveedor ?? "")).toUpperCase();
  if (c === CIF_NICOLAS_VALERO_2025) {
    return {
      cif: CIF_NICOLAS_VALERO,
      aviso: {
        codigo: "cif_corregido_ficha",
        severidad: "media",
        mensaje: `El papel trae el CIF ${CIF_NICOLAS_VALERO_2025} (Nicolás y Valero en 2025): se guarda con el de su ficha, ${CIF_NICOLAS_VALERO}.`,
        detalle: { cif_impreso: CIF_NICOLAS_VALERO_2025, cif_guardado: CIF_NICOLAS_VALERO },
      },
    };
  }
  if (!c && /TRANSGOURMET/.test(nombre)) {
    return {
      cif: CIF_TRANSGOURMET,
      aviso: {
        codigo: "cif_completado_ficha",
        severidad: "media",
        mensaje: `No se lee el CIF de Transgourmet: se guarda con el suyo, ${CIF_TRANSGOURMET}.`,
        detalle: { cif_guardado: CIF_TRANSGOURMET },
      },
    };
  }
  return { cif, aviso: null };
}

// ─── Local de destino ────────────────────────────────────────────────────────
export type Local = "casa_tomas" | "touza";

const TOUZA = /\btouza\b|santa\s+mar[ií]a\s+de\s+la\s+cabeza\D{0,20}\b4\b/i;
const CASA_TOMAS = /casa\s+tom[aá]s/i;
const MASIDE = /\bmaside\b/i;

/**
 * Local según el destinatario impreso: Touza (o calle Santa María de la
 * Cabeza nº 4) → touza; Casa Tomás → casa_tomas; solo «MASIDE 2011» →
 * casa_tomas con aviso. Sin datos → null (como hasta ahora).
 */
export function localDestinatario(...textos: (string | null | undefined)[]): { local: Local | null; aviso: AvisoRegla | null } {
  const t = textos.filter((x): x is string => typeof x === "string" && !!x.trim()).join(" · ");
  if (!t) return { local: null, aviso: null };
  if (TOUZA.test(t)) return { local: "touza", aviso: null };
  if (CASA_TOMAS.test(t)) return { local: "casa_tomas", aviso: null };
  if (MASIDE.test(t)) {
    return {
      local: "casa_tomas",
      aviso: {
        codigo: "local_supuesto",
        severidad: "media",
        mensaje: "El destinatario solo dice «MASIDE 2011»: se asigna a Casa Tomás. Cámbialo si era para Touza.",
        detalle: { destinatario: t.slice(0, 200) },
      },
    };
  }
  return { local: null, aviso: null };
}

// ─── Reglas sobre la lectura, antes del cuadre ───────────────────────────────

interface LineaLeida {
  nombre?: string;
  cantidad?: number | null;
  precio_unitario?: number | null;
  total?: number | null;
  iva_pct?: number | null;
  bonificada?: boolean;
}

interface DocLeido {
  cif?: string | null;
  proveedor?: string | null;
  subtotal?: number | null;
  iva?: number | null;
  total?: number | null;
  total_literal?: string | null;
  sin_importes?: boolean;
  productos?: LineaLeida[];
  avisos_reglas?: AvisoRegla[];
}

const CHEQUES = /importe\s+(de\s+)?(los\s+)?(cheques|vales|tickets)|no\s+sujet/i;

/**
 * Pluxee (A78604113): el gasto es solo la comisión (base + IVA). La línea
 * «Importe de cheques» (no sujeta, es un reembolso) se quita, y si el total
 * impreso la incluía, el total se deja vacío para que se deduzca de base + IVA
 * (queda marcado como deducido).
 */
function reglaPluxee<T extends DocLeido>(d: T, avisos: AvisoRegla[]): T {
  const esPluxee = cifNorm(d.cif) === CIF_PLUXEE || /pluxee|sodexo/i.test(String(d.proveedor ?? ""));
  if (!esPluxee || !Array.isArray(d.productos)) return d;
  const quitadas = d.productos.filter((l) => CHEQUES.test(String(l?.nombre ?? "")));
  if (quitadas.length === 0) return d;
  const productos = d.productos.filter((l) => !CHEQUES.test(String(l?.nombre ?? "")));
  const out = { ...d, productos };
  const base = esNum(d.subtotal) ? d.subtotal : null;
  const iva = esNum(d.iva) ? d.iva : null;
  let totalRetirado: number | null = null;
  if (esNum(d.total) && base !== null && iva !== null && Math.abs(d.total - (base + iva)) > 0.05) {
    totalRetirado = d.total;
    out.total = null;
    out.total_literal = null;
  }
  avisos.push({
    codigo: "pluxee_cheques_quitados",
    severidad: "media",
    mensaje: `Pluxee: solo la comisión es gasto. Se ha quitado ${quitadas.length === 1 ? "la línea" : `${quitadas.length} líneas`} ` +
      `«${quitadas.map((l) => l.nombre).join("», «")}» (importe de cheques, no sujeto)` +
      (totalRetirado !== null ? ` y el total impreso ${totalRetirado} € se sustituye por base + IVA.` : "."),
    detalle: { lineas: quitadas.map((l) => ({ nombre: l.nombre, total: l.total ?? null })), total_impreso: totalRetirado },
  });
  return out;
}

/**
 * Líneas impresas CON IVA incluido: suman el total con IVA y no la base. Se
 * pasan a base (con el tipo de cada línea si lo traen todas; si no, en
 * proporción base/total) y se avisa. Solo si base, IVA y total están leídos.
 */
function reglaIvaIncluido<T extends DocLeido>(d: T, avisos: AvisoRegla[]): T {
  if (d.sin_importes || !Array.isArray(d.productos) || d.productos.length === 0) return d;
  if (!esNum(d.subtotal) || !esNum(d.iva) || !esNum(d.total) || d.iva === 0 || d.subtotal === 0) return d;
  const lineas = d.productos;
  if (!lineas.every((l) => esNum(l?.total))) return d;
  const suma = lineas.reduce((a, l) => a + (l.total as number), 0);
  const tol = Math.max(0.05, lineas.length * 0.01);
  const pareceTotal = Math.abs(suma - d.total) <= tol;
  const pareceBase = Math.abs(suma - d.subtotal) <= tol;
  if (!pareceTotal || pareceBase || Math.abs(d.total - d.subtotal) <= tol) return d;

  const conTipo = lineas.every((l) => esNum(l.iva_pct) && (l.iva_pct as number) >= 0 && (l.iva_pct as number) <= 30);
  const factorProporcional = d.subtotal / suma;
  const productos = lineas.map((l) => {
    const f = conTipo ? 1 / (1 + (l.iva_pct as number) / 100) : factorProporcional;
    return {
      ...l,
      total: r2((l.total as number) * f),
      precio_unitario: esNum(l.precio_unitario) ? r4(l.precio_unitario * f) : l.precio_unitario ?? null,
    };
  });
  const sumaBase = r2(productos.reduce((a, l) => a + (l.total as number), 0));
  avisos.push({
    codigo: "lineas_con_iva_incluido",
    severidad: "media",
    mensaje: `Las líneas venían con el IVA incluido (suman ${r2(suma)} €, el total, y no la base ${d.subtotal} €): ` +
      `se han pasado a base ${conTipo ? "con el tipo de IVA de cada línea" : "en proporción base/total"} ` +
      `(ahora suman ${sumaBase} €). Revísalo contra el papel.`,
    detalle: { suma_con_iva: r2(suma), subtotal: d.subtotal, total: d.total, suma_base: sumaBase, metodo: conTipo ? "iva_por_linea" : "proporcional" },
  });
  return { ...d, productos };
}

/** Reglas sobre la lectura del modelo, antes del cuadre. No muta la entrada. */
export function aplicarReglasLectura<T extends DocLeido>(doc: T): T {
  const avisos: AvisoRegla[] = [...(doc.avisos_reglas ?? [])];
  let d = reglaPluxee(doc, avisos);
  d = reglaIvaIncluido(d, avisos);
  return avisos.length > 0 || doc.avisos_reglas ? { ...d, avisos_reglas: avisos } : d;
}

// ─── Abonos ──────────────────────────────────────────────────────────────────
const negativo = (n: unknown) => (esNum(n) ? -Math.abs(n) : n);

/**
 * Abono / factura rectificativa / devolución: TODOS los importes en negativo
 * (cabecera, líneas, recargos) y la cantidad de las líneas también (como la
 * importación histórica). El precio unitario queda positivo. Osborne imprime
 * sus abonos en positivo: por eso se fuerza el signo y no se confía en él.
 * Fuera de un abono, una línea con importe negativo (devolución de envases)
 * lleva también la cantidad en negativo.
 */
// deno-lint-ignore no-explicit-any
export function aplicarSignoAbono(data: any): { data: any; esAbono: boolean } { // eslint-disable-line @typescript-eslint/no-explicit-any
  const esAbono = data?.es_abono === true;
  const productos = Array.isArray(data?.productos)
    // deno-lint-ignore no-explicit-any
    ? data.productos.map((p: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!p || typeof p !== "object") return p;
      if (esAbono) {
        return {
          ...p,
          total: negativo(p.total),
          cantidad: negativo(p.cantidad),
          precio_unitario: esNum(p.precio_unitario) ? Math.abs(p.precio_unitario) : p.precio_unitario,
        };
      }
      if (esNum(p.total) && p.total < 0 && esNum(p.cantidad) && p.cantidad > 0) return { ...p, cantidad: -p.cantidad };
      return p;
    })
    : data?.productos;
  if (!esAbono) return { data: { ...data, productos }, esAbono };
  return {
    data: {
      ...data,
      productos,
      subtotal: negativo(data.subtotal),
      iva: negativo(data.iva),
      total: negativo(data.total),
      recargo_equivalencia: negativo(data.recargo_equivalencia),
      cargos_fuera_base: negativo(data.cargos_fuera_base),
    },
    esAbono,
  };
}

// ─── Avisos tras normalizar ──────────────────────────────────────────────────

/** Fecha fuera del año esperado: ni este año ni el anterior, o más de 7 días en el futuro. */
export function avisoFechaFueraDeAnio(fecha: string | null, hoy: Date = new Date()): AvisoRegla | null {
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  const anio = Number(fecha.slice(0, 4));
  const esteAnio = hoy.getUTCFullYear();
  const limiteFuturo = new Date(hoy.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const futura = fecha > limiteFuturo;
  if (!futura && (anio === esteAnio || anio === esteAnio - 1)) return null;
  return {
    codigo: "fecha_fuera_de_anio",
    severidad: "media",
    mensaje: futura
      ? `La fecha leída (${fecha}) es futura: revisa si el día y el mes están al revés o el año mal leído.`
      : `La fecha leída (${fecha}) no es de ${esteAnio} ni de ${esteAnio - 1}: revisa el año.`,
    detalle: { fecha, anio_actual: esteAnio },
  };
}

const ES_CAJA = /^(caja|cajas|cj|cja|pack|fardo|estuche|bandeja)$/i;
// Unidades por caja escritas en el nombre: «C6», «C/12», «C.x06», «CAJA 04 BT», «24x33cl», «* 24»,
// «24 uds», «P6», «contiene 24», «(total 800 g)», «2500 neto». Un volumen o un peso solo («33cl»,
// «500 g») NO dice cuántas trae la caja; a partir de 1 kg o 1 l se da por contenido de la caja
// («CAJA 10 KG», «TOMATE 5 KG»). Misma frontera que contenido_linea (20261207300000).
const UNIDADES_EN_NOMBRE =
  /(\b(c|cj|caja|bandeja|pack)\s*[/.]?\s*x?\s*\d+(bs?|bt|u)?\b)|(\b\d+\s*[x*]\s*\d)|([x*]\s*\d+\b)|(\b\d+\s*(u|ud|uds|unid|unidades|botellas?|latas?|bot|bt)\b)|(\bp\d{1,2}\b)|(\bcontiene\s+\d+)|(\btotal\s+\d)|(\d\s*netos?\b)/i;
const MEDIDA_EN_NOMBRE = /\b(\d+(?:[.,]\d+)?)\s*(kgs?|k|kilos?|grs?|g|litros?|lts?|lt|l|cl|ml)\b/gi;

/** El nombre trae el contenido de la caja entera: 1 kg o 1 l como mínimo (200 «cl» o más son mililitros). */
function contenidoDeCajaEnNombre(nombre: string): boolean {
  for (const m of nombre.matchAll(MEDIDA_EN_NOMBRE)) {
    const n = Number(m[1].replace(",", "."));
    const u = m[2].toLowerCase();
    const base = /^(kgs?|k|kilos?|litros?|lts?|lt|l)$/.test(u) ? n : u === "cl" ? (n >= 200 ? n / 1000 : n / 100) : n / 1000;
    if (base >= 1) return true;
  }
  return false;
}

/** Líneas facturadas por caja sin decir cuántas unidades trae la caja. */
export function avisoCajasSinUnidades(productos: { nombre: string; unidad: string | null; bultos?: number | null }[]): AvisoRegla | null {
  const sin = productos.filter((p) =>
    ES_CAJA.test(String(p.unidad ?? "").trim()) && !UNIDADES_EN_NOMBRE.test(p.nombre) && !contenidoDeCajaEnNombre(p.nombre));
  if (sin.length === 0) return null;
  return {
    codigo: "caja_sin_unidades",
    severidad: "media",
    mensaje: `${sin.length} línea(s) por caja sin las unidades que trae la caja: ` +
      sin.slice(0, 5).map((p) => `«${p.nombre}»`).join(", ") + ". Añádelas para comparar precios por unidad.",
    detalle: { lineas: sin.slice(0, 20).map((p) => p.nombre) },
  };
}

/** Nicolás y Valero: el cargo de embalajes va con IVA del 10 % si el papel no dice otro. */
export function ivaEmbalajeNicolasValero<T extends { nombre: string; iva_pct?: number | null }>(cif: string | null, productos: T[]): T[] {
  if (cifNorm(cif) !== CIF_NICOLAS_VALERO) return productos;
  return productos.map((p) => (/embalaje|envase/i.test(p.nombre) && (p.iva_pct === null || p.iva_pct === undefined) ? { ...p, iva_pct: 10 } : p));
}

// ─── Duplicados ──────────────────────────────────────────────────────────────

const numNorm = (n: unknown) => String(n ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const provisional = (n: unknown) => /^SN-/i.test(String(n ?? "").trim());

/**
 * La coincidencia por «mismo proveedor + fecha + total» solo es duplicado si a
 * alguna de las dos le falta número (o lleva el provisional SN-…). Con números
 * reales distintos son dos facturas (alquiler 10-26 y 11-26 del mismo día e
 * importe; mismo criterio que la importación histórica).
 */
export function esOtraFacturaConNumeroDistinto(
  nuevo: string | null | undefined,
  existente: { numero_documento?: string | null; motivo?: string | null },
): boolean {
  if (existente.motivo !== "datos_coincidentes") return false;
  const a = numNorm(nuevo), b = numNorm(existente.numero_documento);
  if (!a || !b || provisional(nuevo) || provisional(existente.numero_documento)) return false;
  return a !== b;
}
