// Dashboard › «Márgenes de precio» (10/11/2026, petición del dueño: «añadir dos
// módulos, uno de márgenes de precio y otro de avisos»). Resume lo mismo que
// Facturas › Márgenes (RPC `margenes_carta`) sin rehacer ninguna cuenta: los
// artículos y su orden salen de `problemas`/`gravedad` de lib/analisis, y las
// subidas de proveedor, de las alertas de Facturas (`facturas_precio_sube`,
// cron diario) cruzadas con los productos de compra de cada artículo.
// Sin React: se prueba suelto.
import {
  facturaDeArticulo,
  fmt,
  platosBorrador,
  problemas,
  textoFactura,
  textoPctCoste,
  type ArticuloMargen,
  type MargenesCarta,
} from "@/lib/analisis/margenesCarta";
import type { AlertaFacturas } from "@/lib/facturas/alertas";

/** Artículos que cuentan: al peso y vinos (comparables) y los platos del borrador ya revisados. */
export function articulosFiables(d: MargenesCarta): ArticuloMargen[] {
  return [...d.peso, ...d.vinos, ...platosBorrador(d).filter((p) => p.revisado)];
}

/** Los peores márgenes, del más alejado de su umbral al menos (lo mismo que «No funciona» en Facturas › Márgenes). */
export function peoresMargenes(d: MargenesCarta, limite = 5): ArticuloMargen[] {
  return problemas(articulosFiables(d), d.config).slice(0, limite);
}

/**
 * Cifra corta de un artículo: «×1,58» (peso y vinos) o «coste: 42 % de lo que cobras» (platos;
 * 13/11/2026, dueño: el % de coste es sobre el precio de VENTA sin IVA, que se entienda).
 */
export function cifraMargen(a: ArticuloMargen): string {
  if (a.tipo === "plato") return textoPctCoste(a.pct);
  return a.multiplicador === null ? "—" : `×${fmt(a.multiplicador, 2)}`;
}

/** Umbral con el que se compara: «mín. ×2,00» o «máx. 35 % de lo que cobras». */
export function umbralMargen(a: ArticuloMargen, d: Pick<MargenesCarta, "config">): string {
  if (a.tipo === "plato") return `máx. ${fmt(d.config.costeMaxPlatoPct, 0)} % coste sobre venta`;
  return `mín. ×${fmt(a.tipo === "peso" ? d.config.multiplicadorMinPeso : d.config.multiplicadorMinVino, 2)}`;
}

/** Qué es: «Al peso», «Vino» o «Plato». */
export const tipoMargen = (a: ArticuloMargen) => (a.tipo === "peso" ? "Al peso" : a.tipo === "vino" ? "Vino" : "Plato");

/** Enlace a su ficha en Facturas › Márgenes (los «al peso» son platos de la carta). */
export function enlaceArticulo(a: ArticuloMargen): string {
  const tipo = a.tipo === "vino" ? "vino" : "plato";
  return `/facturas?tab=margenes&articulo=${tipo}:${encodeURIComponent(a.id)}`;
}

/** Lee `?articulo=plato:<id>` / `vino:<id>` (enlace del Dashboard). */
export function leerArticuloEnlace(v: string | null): { tipo: "plato" | "vino"; id: string } | null {
  const m = /^(plato|vino):(.+)$/.exec(v ?? "");
  return m ? { tipo: m[1] as "plato" | "vino", id: m[2] } : null;
}

/** Productos de compra de un artículo (los ingredientes de un plato, la botella de un vino, el producto de un «al peso»). */
export function productosDeArticulo(a: ArticuloMargen): number[] {
  if (a.tipo === "plato") return a.ingredientes.map((i) => i.productoId);
  return a.productoId === null ? [] : [a.productoId];
}

export interface SubidaQueAfecta {
  alerta: AlertaFacturas;
  /** Artículos de la carta que llevan ese producto (sin repetir). */
  articulos: ArticuloMargen[];
}

/**
 * Subidas de precio de proveedor (alertas vigentes) que tocan algún artículo de
 * la carta, de la que más pesa (€ al mes, o % si no hay €) a la que menos. Los
 * platos del borrador cuentan aunque no estén revisados: el producto sí es suyo.
 */
export function subidasQueAfectan(d: MargenesCarta, alertas: AlertaFacturas[], limite = 3): SubidaQueAfecta[] {
  const porProducto = new Map<number, ArticuloMargen[]>();
  const vistos = new Set<string>();
  for (const a of [...d.peso, ...d.vinos, ...d.platos]) {
    const clave = `${a.tipo === "vino" ? "vino" : "plato"}:${a.id}`;
    if (vistos.has(clave)) continue; // los «al peso» también vienen en d.platos
    vistos.add(clave);
    for (const p of new Set(productosDeArticulo(a))) {
      const lista = porProducto.get(p) ?? [];
      lista.push(a);
      porProducto.set(p, lista);
    }
  }
  const salida: SubidaQueAfecta[] = [];
  for (const alerta of alertas) {
    if (alerta.tipo !== "facturas_precio_sube" || alerta.datos.productoId === null) continue;
    const articulos = porProducto.get(alerta.datos.productoId);
    if (articulos?.length) salida.push({ alerta, articulos });
  }
  const peso = (s: SubidaQueAfecta) => [s.alerta.datos.impactoMes ?? -1, s.alerta.datos.variacionPct ?? -1] as const;
  return salida
    .sort((x, y) => {
      const [ix, vx] = peso(x);
      const [iy, vy] = peso(y);
      return iy - ix || vy - vx;
    })
    .slice(0, limite);
}

/** Cuántos artículos fiables tienen el margen en rojo y a cuántos les ha subido el coste. */
export function cuentasMargenes(d: MargenesCarta): { enRojo: number; subeCoste: number } {
  const lista = articulosFiables(d);
  const enRojo = lista.filter((a) => a.banderas.includes("coste_alto") || a.banderas.includes("multiplicador_bajo")).length;
  const subeCoste = lista.filter((a) => a.banderas.includes("sube_coste")).length;
  return { enRojo, subeCoste };
}

/**
 * Lo que cuesta y a cuánto se vende, sin IVA (11/11/2026, dueño: «añade algo más de información»):
 * «te cuesta 12,50 € · lo vendes a 25,00 €» o, al peso, «el kilo te cuesta 20,00 € · lo vendes a
 * 45,00 €». El coste es el de la ÚLTIMA factura (20261128140000). `null` sin datos.
 */
export function costeYVenta(a: ArticuloMargen): string | null {
  const e = (n: number) => `${fmt(n, 2)} €`;
  if (a.tipo === "peso") {
    if (a.compraKg === null || a.ventaKg === null) return null;
    return `el kilo te cuesta ${e(a.compraKg)} · lo vendes a ${e(a.ventaKg)}`;
  }
  if (a.coste === null || a.venta === null) return null;
  return `te cuesta ${e(a.coste)} · lo vendes a ${e(a.venta)}`;
}

/** «Última factura: Makro, 03/11 · 21,50 €/kg» (para la fila del Dashboard). `null` si no hay. */
export function ultimaFacturaCorta(a: ArticuloMargen, hoy: string | null = null): string | null {
  const f = facturaDeArticulo(a);
  return f ? `Última factura: ${textoFactura(f, hoy)}` : null;
}
