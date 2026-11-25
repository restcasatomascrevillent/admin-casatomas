// Precio de compra de un vino según su última factura (tabla vinos_precio_compra, migración
// 20261222140000). Sale del mismo cruce que «Facturas › Márgenes › Coste vinos» y solo lo
// pueden leer quienes editan la carta (RLS). Nunca va a la web.
import { euros, fechaFactura, veces } from "@/lib/analisis/margenesCarta";

export interface PrecioCompraVino {
  vinoId: string;
  /** Precio de la botella en la última factura, sin IVA. */
  precioCompra: number;
  /** Lo mismo con IVA. */
  precioCompraIva: number;
  /** Total pagado ÷ (pagadas + sin cargo), sin IVA: el coste de Márgenes. */
  costeEfectivo: number | null;
  costeEfectivoIva: number | null;
  ivaPct: number;
  /** «linea», «factura» o «supuesto» (21 %). */
  ivaOrigen: string | null;
  botellasSinCargo: number;
  proveedor: string | null;
  fecha: string | null;
  numeroDocumento: string | null;
  tipoDocumento: string | null;
  /** Estado de Márgenes: bien, bajo, dudoso, revisar (otro formato)… */
  estado: string | null;
  ivaVentaPct: number;
  multiplicadorMin: number;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** Fila de la tabla → PrecioCompraVino (o null si no trae precio). */
export function normalizarPrecioCompra(fila: Record<string, unknown>): PrecioCompraVino | null {
  const vinoId = txt(fila.vino_id);
  const precioCompra = num(fila.precio_compra);
  const ivaPct = num(fila.iva_pct) ?? 21;
  if (!vinoId || precioCompra === null || precioCompra <= 0) return null;
  const costeEfectivo = num(fila.coste_efectivo);
  return {
    vinoId,
    precioCompra,
    precioCompraIva: num(fila.precio_compra_iva) ?? Math.round(precioCompra * (1 + ivaPct / 100) * 100) / 100,
    costeEfectivo,
    costeEfectivoIva: num(fila.coste_efectivo_iva) ?? (costeEfectivo === null ? null : Math.round(costeEfectivo * (1 + ivaPct / 100) * 100) / 100),
    ivaPct,
    ivaOrigen: txt(fila.iva_origen),
    botellasSinCargo: num(fila.botellas_sin_cargo) ?? 0,
    proveedor: txt(fila.proveedor),
    fecha: txt(fila.fecha),
    numeroDocumento: txt(fila.numero_documento),
    tipoDocumento: txt(fila.tipo_documento),
    estado: txt(fila.estado),
    ivaVentaPct: num(fila.iva_venta_pct) ?? 10,
    multiplicadorMin: num(fila.multiplicador_min) ?? 2.3,
  };
}

/** Las filas indexadas por vino. */
export function preciosPorVino(filas: ReadonlyArray<Record<string, unknown>>): Map<string, PrecioCompraVino> {
  const mapa = new Map<string, PrecioCompraVino>();
  for (const f of filas) {
    const p = normalizarPrecioCompra(f);
    if (p) mapa.set(p.vinoId, p);
  }
  return mapa;
}

/**
 * Multiplicador como en Márgenes: precio de carta SIN IVA ÷ coste efectivo SIN IVA, con el precio
 * de carta actual. null si no se puede comparar (sin precio, o el producto comprado es de otro
 * formato o el dato es dudoso: eso se revisa en Márgenes).
 */
export function multiplicadorCompra(precioCarta: number | null | undefined, p: PrecioCompraVino): number | null {
  if (!precioCarta || precioCarta <= 0) return null;
  if (p.estado === "revisar" || p.estado === "dudoso") return null;
  const coste = p.costeEfectivo ?? p.precioCompra;
  if (!(coste > 0)) return null;
  return Math.round((precioCarta / (1 + p.ivaVentaPct / 100) / coste) * 100) / 100;
}

/** «Compra: 13,85 € (IVA incl.)». */
export const textoCompra = (p: PrecioCompraVino) => `Compra: ${euros(p.precioCompraIva)} (IVA incl.)`;

/** Segunda línea: botellas sin cargo y de qué factura sale. */
export function detalleCompra(p: PrecioCompraVino, hoy: string | null = null): string {
  const partes: string[] = [];
  if (p.botellasSinCargo > 0 && p.costeEfectivoIva !== null && Math.abs(p.costeEfectivoIva - p.precioCompraIva) >= 0.01) {
    const n = Number.isInteger(p.botellasSinCargo) ? String(p.botellasSinCargo) : p.botellasSinCargo.toLocaleString("es-ES");
    partes.push(`Con ${n} sin cargo: ${euros(p.costeEfectivoIva)}`);
  }
  const origen = [p.proveedor, p.fecha ? fechaFactura(p.fecha, hoy) : null].filter(Boolean).join(" · ");
  if (origen) partes.push(origen);
  return partes.join(" · ");
}

/** Con un «hoy» de otro año, fechaFactura pone siempre el año: «15/11/26». */
const CON_ANO = "0000";

/** Texto largo para el title (ratón) y lectores de pantalla. */
export function explicacionCompra(p: PrecioCompraVino, multiplicador: number | null): string {
  const albaran = p.tipoDocumento === "albaran";
  const doc = albaran ? "el último albarán" : "la última factura";
  const iva = p.ivaOrigen === "supuesto" ? `${p.ivaPct} % de IVA (supuesto: ${albaran ? "el albarán" : "la factura"} no lo dice)` : `${p.ivaPct} % de IVA`;
  const partes = [
    `Precio de compra en ${doc}${p.proveedor ? ` de ${p.proveedor}` : ""}${p.fecha ? ` (${fechaFactura(p.fecha, CON_ANO)}${p.numeroDocumento ? `, nº ${p.numeroDocumento}` : ""})` : ""}: ${euros(p.precioCompra)} sin IVA + ${iva} = ${euros(p.precioCompraIva)}.`,
  ];
  if (p.botellasSinCargo > 0 && p.costeEfectivo !== null && p.costeEfectivo !== p.precioCompra) {
    partes.push(`Con las botellas sin cargo, cada botella sale a ${euros(p.costeEfectivo)} sin IVA (${euros(p.costeEfectivoIva)} con IVA).`);
  }
  if (multiplicador !== null) {
    partes.push(`Multiplicador ${veces(multiplicador)}: precio de carta sin IVA ÷ coste sin IVA (mínimo ${veces(p.multiplicadorMin)}).`);
  } else if (p.estado === "revisar" || p.estado === "dudoso") {
    partes.push("Sin multiplicador: el dato está por revisar en Facturas › Márgenes › Coste vinos.");
  }
  partes.push("Solo lo ven quienes pueden editar la carta.");
  return partes.join(" ");
}
