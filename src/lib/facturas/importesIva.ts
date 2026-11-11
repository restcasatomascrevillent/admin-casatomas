// Ficha de un documento de compra: base imponible, IVA y total por separado (11/11/2026, petición
// del dueño: «Que para márgenes y facturas tenga la capacidad de calcular con bases imponibles,
// antes de impuestos y después de impuestos, y que salgan como avisos explicándolos para tontos»).
// Si el documento no trae la base o el IVA, se calcula con el total (y la retención, si la hay) y
// se dice que es calculado. Sin React: se prueba suelto.

export interface ImportesIva {
  base: number | null;
  baseCalculada: boolean;
  iva: number | null;
  ivaCalculado: boolean;
  /** IVA sobre la base, en %: 21, 10, 4… o una media si el documento mezcla tipos. */
  ivaPct: number | null;
  /** El % no es un tipo de IVA conocido: el documento mezcla varios (p. ej. 10 % y 21 %). */
  variosTipos: boolean;
}

/** Tipos de IVA de España (y el 0 % de lo exento). */
const TIPOS = [0, 4, 5, 10, 21];

const redondeo = (n: number) => Math.round(n * 100) / 100;

export function importesIva(doc: {
  subtotal: number | null;
  iva: number | null;
  total: number | null;
  retencion_irpf?: number | null;
}): ImportesIva {
  const ret = doc.retencion_irpf ?? 0;
  const baseCalculada = doc.subtotal == null && doc.total != null && doc.iva != null;
  const base = doc.subtotal ?? (baseCalculada ? redondeo((doc.total as number) + ret - (doc.iva as number)) : null);
  const ivaCalculado = doc.iva == null && doc.total != null && doc.subtotal != null;
  const iva = doc.iva ?? (ivaCalculado ? redondeo((doc.total as number) + ret - (doc.subtotal as number)) : null);
  if (base === null || iva === null || base === 0) return { base, baseCalculada, iva, ivaCalculado, ivaPct: null, variosTipos: false };
  const pct = (iva / base) * 100;
  const tipo = TIPOS.find((t) => Math.abs(pct - t) <= 0.3);
  return {
    base,
    baseCalculada,
    iva,
    ivaCalculado,
    ivaPct: tipo ?? Math.round(pct * 10) / 10,
    variosTipos: tipo === undefined,
  };
}

/** «IVA (21 %)», «IVA (mezcla, 12,4 %)» (varios tipos en el documento), «IVA (21 %, calculado)». Corto: la etiqueta se recorta. */
export function etiquetaIva(i: Pick<ImportesIva, "ivaPct" | "variosTipos" | "ivaCalculado">): string {
  const partes: string[] = [];
  if (i.ivaPct !== null) {
    const pct = i.ivaPct.toLocaleString("es-ES", { maximumFractionDigits: 1 });
    partes.push(i.variosTipos ? `mezcla, ${pct} %` : `${pct} %`);
  }
  if (i.ivaCalculado) partes.push("calculado");
  return partes.length ? `IVA (${partes.join(", ")})` : "IVA";
}

/** Para tontos, debajo de las cifras. */
export const EXPLICACION_IMPORTES =
  "Base imponible: lo que cuesta sin impuestos (con esto se calculan los márgenes). IVA: el impuesto que pagas encima y que luego te descuentas. Total: lo que pagas.";
