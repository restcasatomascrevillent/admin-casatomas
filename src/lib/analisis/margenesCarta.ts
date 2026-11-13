// Facturas › Márgenes (RPC `margenes_carta`, migración 20261115200000_analisis_margenes_carta).
// Aquí: tipos, normalización del jsonb (defensiva: el panel no se cae si falta un
// campo), textos del «porqué» y orden de la lista de «donde no funciona el margen».
// Sin React: se prueba suelto.
//
// 13/11/2026 (dueño: «que siempre salga la última factura… la sección de márgenes
// es muy difícil de entender… explicado para tontos»; migración
// 20261128140000_margenes_ultima_factura): el coste es el de la ÚLTIMA factura de
// cada producto (`factura`: proveedor, fecha, precio tal como se compró y enlace al
// original); la mediana de los últimos 90 días va aparte (`*Mediana`), como
// contexto. Los textos dicen el % de coste como «de cada 100 € que cobras (sin
// IVA), X € se van en…»: es un % del PRECIO DE VENTA sin IVA, no del coste.
import type { DocumentoCifra } from "@/lib/facturas/documentosCifra";

export type Bandera =
  | "coste_alto"
  | "multiplicador_bajo"
  | "sube_coste"
  | "sin_datos"
  | "incompleto"
  | "sin_mapear"
  | "sin_precio"
  /** Vino: el margen de la tienda (precio de tienda sin IVA ÷ coste) baja de su límite (20261125100000). */
  | "tienda_bajo"
  /** Vino: la carta y la compra son formatos distintos (magnum frente a 75 cl): coste estimado. */
  | "formato_distinto";

export const ETIQUETA_BANDERA: Record<Bandera, string> = {
  coste_alto: "Coste alto",
  multiplicador_bajo: "Multiplicador bajo",
  sube_coste: "Sube el coste",
  sin_datos: "Sin datos de coste",
  incompleto: "Faltan costes",
  sin_mapear: "Sin escandallo",
  sin_precio: "Sin precio",
  tienda_bajo: "Tienda: margen bajo",
  formato_distinto: "Coste estimado (otro formato)",
};

export type UnidadEscandallo = "g" | "ml" | "ud";

/**
 * La factura de la que sale el coste (la ÚLTIMA de ese producto): sirve para
 * enseñarla («Última factura: Makro, 03/11 · 21,50 €/kg») y para abrir su original
 * en el visor de documentos.
 */
export interface FacturaUsada extends DocumentoCifra {
  lineaId: number | null;
  nombreLinea: string | null;
  /** Unidad de compra normalizada: «kg», «l», «caja», «botella», «ud»… */
  unidadCompra: string | null;
  /** Precio por unidad de compra (importe de la línea ÷ cantidad), sin IVA. */
  precioUnidad: number | null;
  /** «kg» o «l» si la línea trae el peso o el volumen. */
  medida: string | null;
  /** € por kg o por litro, sin IVA (si la línea trae el peso o el volumen). */
  eurBase: number | null;
}

export interface ConfigMargenes {
  costeMaxPlatoPct: number;
  /** Vino (restaurante): venta SIN IVA ÷ coste sin IVA (20261125100000; antes, carta con IVA). */
  multiplicadorMinVino: number;
  /** Vino (tienda): precio de tienda SIN IVA ÷ coste sin IVA. */
  multiplicadorMinTienda: number;
  /** Artículos al peso: venta sin IVA €/kg / compra sin IVA €/kg (20261115410000). */
  multiplicadorMinPeso: number;
  subidaCostePct: number;
  /** IVA del restaurante (carta). */
  ivaPct: number;
  /** IVA de la tienda de vinos. */
  ivaTiendaPct: number;
  diasReferencia: number;
}

/** De dónde sale el IVA de las compras: el de la línea, el general de su factura o un 10 % supuesto. */
export type OrigenIva = "linea" | "factura" | "supuesto";

export interface Ingrediente {
  id: number | null;
  productoId: number;
  producto: string;
  cantidad: number;
  unidad: UnidadEscandallo;
  origen: "estimado" | "manual";
  nota: string | null;
  /** €/kg, €/l (g/ml) o € por unidad de compra (ud). */
  eur: number | null;
  eur6m: number | null;
  medida: string | null;
  unidadCompra: string | null;
  coste: number | null;
  coste6m: number | null;
  lineas: number | null;
  ultima: string | null;
  ivaPct: number | null;
  ivaOrigen: OrigenIva | null;
  eurIva: number | null;
  costeIva: number | null;
  /** Mediana de los últimos `diasReferencia` días, misma unidad que `eur` (contexto). */
  eurMediana: number | null;
  costeMediana: number | null;
  /** Precio de la factura anterior a la última, misma unidad que `eur`. */
  eurAnterior: number | null;
  fechaAnterior: string | null;
  proveedorAnterior: string | null;
  /** Fecha de la última factura que había hace 6 meses (la de `eur6m`). */
  fecha6m: string | null;
  /** La factura de la que sale `eur` (la última). */
  factura: FacturaUsada | null;
}

export interface PlatoMargen {
  tipo: "plato";
  id: string;
  nombre: string;
  categoria: string;
  precio: number | null;
  unidad: string | null;
  gramosVenta: number | null;
  venta: number | null;
  coste: number | null;
  coste6m: number | null;
  /** Coste con el IVA de cada compra (solo para enseñar; el margen va sin IVA). */
  costeIva: number | null;
  /** Algún ingrediente usa un IVA que no es el de su línea. */
  ivaSupuesto: boolean;
  pct: number | null;
  margen: number | null;
  variacionPct: number | null;
  principal: string | null;
  principalCoste: number | null;
  /** Coste y % con la mediana de cada ingrediente (contexto; null si a alguno le falta). */
  costeMediana: number | null;
  pctMediana: number | null;
  /** Última factura del ingrediente que más pesa en el coste. */
  factura: FacturaUsada | null;
  origen: "estimado" | "manual" | null;
  revisado: boolean;
  motivo: string | null;
  banderas: Bandera[];
  ingredientes: Ingrediente[];
}

export interface VinoMargen {
  tipo: "vino";
  id: string;
  nombre: string;
  categoria: string;
  precio: number | null;
  precioCopa: number | null;
  venta: number | null;
  productoId: number | null;
  producto: string | null;
  /** Litros del formato de la CARTA (Magnum = 1,5). */
  litros: number;
  /** Litros del producto comprado (null si no se sabe). */
  litrosProducto: number | null;
  formatoDistinto: boolean;
  /** Lo que cuesta la botella (formato de la carta) según la ÚLTIMA factura, sin IVA. */
  coste: number | null;
  /** Lo mismo con la última factura que había hace 6 meses. */
  coste6m: number | null;
  costeIva: number | null;
  /** Con la mediana de los últimos días de referencia (contexto). */
  costeMediana: number | null;
  multiplicadorMediana: number | null;
  /** Con la factura anterior a la última. */
  costeAnterior: number | null;
  fechaAnterior: string | null;
  proveedorAnterior: string | null;
  fecha6m: string | null;
  factura: FacturaUsada | null;
  ivaCompraPct: number | null;
  ivaOrigen: OrigenIva | null;
  /** Venta SIN IVA ÷ coste sin IVA. */
  multiplicador: number | null;
  pct: number | null;
  margen: number | null;
  /** ¿Estaría a la venta en la tienda? (activado, restaurante, precio > 0, no excluido). */
  enTienda: boolean;
  /** Precio de tienda con IVA (carta − descuento). */
  precioTienda: number | null;
  ventaTienda: number | null;
  multiplicadorTienda: number | null;
  pctTienda: number | null;
  margenTienda: number | null;
  variacionPct: number | null;
  lineas: number | null;
  ultima: string | null;
  origen: "estimado" | "manual" | null;
  nota: string | null;
  revisado: boolean;
  motivo: string | null;
  banderas: Bandera[];
}

/**
 * Artículo que se vende AL PESO (100 g, kg, 50 g…): kilo de venta frente a
 * kilo de compra (migración 20261115410000_margenes_por_peso). Es la vista
 * fiable: no depende de gramos estimados.
 */
export interface PesoMargen {
  tipo: "peso";
  id: string;
  nombre: string;
  categoria: string;
  precio: number | null;
  unidad: string | null;
  gramosVenta: number | null;
  /** Precio de carta por kilo, con IVA. */
  ventaKgIva: number | null;
  /** Precio de carta por kilo, sin IVA. */
  ventaKg: number | null;
  productoId: number | null;
  producto: string | null;
  /** Coste de compra €/kg sin IVA de la ÚLTIMA factura con peso. */
  compraKg: number | null;
  /** €/kg de la última factura que había hace 6 meses. */
  compraKg6m: number | null;
  /** Mediana €/kg de los últimos días de referencia (contexto). */
  compraKgMediana: number | null;
  multiplicadorMediana: number | null;
  compraKgAnterior: number | null;
  fechaAnterior: string | null;
  proveedorAnterior: string | null;
  fecha6m: string | null;
  /** La factura del €/kg (o, si ninguna compra trae el peso, la última compra). */
  factura: FacturaUsada | null;
  /** Compra €/kg con el IVA de sus líneas (solo para enseñar). */
  compraKgIva: number | null;
  ivaCompraPct: number | null;
  ivaOrigen: OrigenIva | null;
  lineas: number | null;
  /** Fecha de la compra más nueva del producto (aunque no traiga el peso). */
  ultima: string | null;
  ultimoProveedor: string | null;
  ultimaFecha: string | null;
  /** ventaKg / compraKg. */
  multiplicador: number | null;
  pct: number | null;
  variacionPct: number | null;
  origen: "estimado" | "manual" | null;
  revisado: boolean;
  motivo: string | null;
  banderas: Bandera[];
}

export type ArticuloMargen = PlatoMargen | VinoMargen | PesoMargen;

export interface ResumenMargenes {
  platos: { total: number; conDatos: number; foodCostMedio: number | null; foodCostMediana: number | null; enRojo: number; subeCoste: number; sinDatos: number; revisados: number };
  vinos: {
    total: number; conDatos: number; multiplicadorMedio: number | null; multiplicadorMediana: number | null; enRojo: number; subeCoste: number; sinDatos: number; revisados: number;
    enTienda: number; multiplicadorTiendaMediana: number | null; tiendaEnRojo: number;
  };
}

export interface MargenesCarta {
  hoy: string | null;
  /** De dónde sale el coste: la última factura (20261128140000) o, sin la migración, la mediana. */
  costeDesde: "ultima_factura" | "mediana";
  config: ConfigMargenes;
  /** Tienda de vinos (configuracion_tienda): el margen de tienda se calcula aunque esté desactivada. */
  tienda: { activa: boolean; descuentoPct: number };
  resumen: ResumenMargenes;
  platos: PlatoMargen[];
  vinos: VinoMargen[];
  peso: PesoMargen[];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const ent = (v: unknown): number => num(v) ?? 0;
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const BANDERAS = new Set<string>(Object.keys(ETIQUETA_BANDERA));
const banderas = (v: unknown): Bandera[] => arr(v).filter((b): b is Bandera => typeof b === "string" && BANDERAS.has(b));
const origen = (v: unknown) => (v === "manual" ? "manual" : v === "estimado" ? "estimado" : null);
const unidad = (v: unknown): UnidadEscandallo => (v === "ml" || v === "ud" ? v : "g");
const origenIva = (v: unknown): OrigenIva | null => (v === "linea" || v === "factura" || v === "supuesto" ? v : null);

/** La factura usada (jsonb `factura` de margenes_carta). null si no viene o no tiene id. */
export function normalizarFactura(v: unknown): FacturaUsada | null {
  const f = obj(v);
  const id = num(f.id);
  if (id === null) return null;
  return {
    id,
    fecha: txt(f.fecha),
    proveedor: txt(f.proveedor) ?? "Sin proveedor",
    proveedorId: num(f.proveedor_id),
    numero: txt(f.numero_documento),
    tipo: f.tipo === "albaran" || f.tipo === "abono" ? f.tipo : "factura",
    local: f.local === "touza" ? "touza" : "casa_tomas",
    total: num(f.total),
    aporta: num(f.importe) ?? 0,
    cantidad: num(f.cantidad),
    lineas: null,
    driveUrl: txt(f.drive_url),
    archivoPath: txt(f.archivo_path),
    lineaId: num(f.linea_id),
    nombreLinea: txt(f.nombre_linea),
    unidadCompra: txt(f.unidad_compra),
    precioUnidad: num(f.precio_unidad),
    medida: txt(f.medida),
    eurBase: num(f.eur_base),
  };
}

export const CONFIG_POR_DEFECTO: ConfigMargenes = {
  costeMaxPlatoPct: 35,
  multiplicadorMinVino: 2.3,
  multiplicadorMinTienda: 1.5,
  multiplicadorMinPeso: 2,
  subidaCostePct: 10,
  ivaPct: 10,
  ivaTiendaPct: 21,
  diasReferencia: 90,
};

export function normalizarMargenes(entrada: unknown): MargenesCarta {
  const r = obj(entrada);
  const c = obj(r.config);
  const rs = obj(r.resumen);
  const rp = obj(rs.platos);
  const rv = obj(rs.vinos);
  const ti = obj(r.tienda);
  const platos: PlatoMargen[] = arr(r.platos).map(obj).filter((p) => txt(p.id)).map((p) => ({
    tipo: "plato",
    id: String(p.id),
    nombre: txt(p.nombre) ?? "(sin nombre)",
    categoria: txt(p.categoria) ?? "",
    precio: num(p.precio),
    unidad: txt(p.unidad),
    gramosVenta: num(p.gramos_venta),
    venta: num(p.venta),
    coste: num(p.coste),
    coste6m: num(p.coste_6m),
    costeIva: num(p.coste_iva),
    ivaSupuesto: p.iva_supuesto === true,
    pct: num(p.pct),
    margen: num(p.margen),
    variacionPct: num(p.variacion_pct),
    principal: txt(p.principal),
    principalCoste: num(p.principal_coste),
    costeMediana: num(p.coste_mediana),
    pctMediana: num(p.pct_mediana),
    factura: normalizarFactura(p.factura),
    origen: origen(p.origen),
    revisado: p.revisado === true,
    motivo: txt(p.motivo),
    banderas: banderas(p.banderas),
    ingredientes: arr(p.ingredientes).map(obj).filter((i) => num(i.producto_id) !== null).map((i) => ({
      id: num(i.id),
      productoId: ent(i.producto_id),
      producto: txt(i.producto) ?? `Producto ${String(i.producto_id)}`,
      cantidad: ent(i.cantidad),
      unidad: unidad(i.unidad),
      origen: i.origen === "manual" ? "manual" : "estimado",
      nota: txt(i.nota),
      eur: num(i.eur),
      eur6m: num(i.eur_6m),
      medida: txt(i.medida),
      unidadCompra: txt(i.unidad_compra),
      coste: num(i.coste),
      coste6m: num(i.coste_6m),
      lineas: num(i.lineas),
      ultima: txt(i.ultima),
      ivaPct: num(i.iva_pct),
      ivaOrigen: origenIva(i.iva_origen),
      eurIva: num(i.eur_iva),
      costeIva: num(i.coste_iva),
      eurMediana: num(i.eur_mediana),
      costeMediana: num(i.coste_mediana),
      eurAnterior: num(i.eur_anterior),
      fechaAnterior: txt(i.fecha_anterior),
      proveedorAnterior: txt(i.proveedor_anterior),
      fecha6m: txt(i.fecha_6m),
      factura: normalizarFactura(i.factura),
    })),
  }));
  const vinos: VinoMargen[] = arr(r.vinos).map(obj).filter((v) => txt(v.id)).map((v) => ({
    tipo: "vino",
    id: String(v.id),
    nombre: txt(v.nombre) ?? "(sin nombre)",
    categoria: txt(v.categoria) ?? "",
    precio: num(v.precio),
    precioCopa: num(v.precio_copa),
    venta: num(v.venta),
    productoId: num(v.producto_id),
    producto: txt(v.producto),
    litros: num(v.litros) ?? 0.75,
    litrosProducto: num(v.litros_producto),
    formatoDistinto: v.formato_distinto === true,
    coste: num(v.coste),
    coste6m: num(v.coste_6m),
    costeIva: num(v.coste_iva),
    costeMediana: num(v.coste_mediana),
    multiplicadorMediana: num(v.multiplicador_mediana),
    costeAnterior: num(v.coste_anterior),
    fechaAnterior: txt(v.fecha_anterior),
    proveedorAnterior: txt(v.proveedor_anterior),
    fecha6m: txt(v.fecha_6m),
    factura: normalizarFactura(v.factura),
    ivaCompraPct: num(v.iva_compra_pct),
    ivaOrigen: origenIva(v.iva_origen),
    multiplicador: num(v.multiplicador),
    pct: num(v.pct),
    margen: num(v.margen),
    enTienda: v.en_tienda === true,
    precioTienda: num(v.precio_tienda),
    ventaTienda: num(v.venta_tienda),
    multiplicadorTienda: num(v.multiplicador_tienda),
    pctTienda: num(v.pct_tienda),
    margenTienda: num(v.margen_tienda),
    variacionPct: num(v.variacion_pct),
    lineas: num(v.lineas),
    ultima: txt(v.ultima),
    origen: origen(v.origen),
    nota: txt(v.nota),
    revisado: v.revisado === true,
    motivo: txt(v.motivo),
    banderas: banderas(v.banderas),
  }));
  const peso: PesoMargen[] = arr(r.peso).map(obj).filter((x) => txt(x.id)).map((x) => ({
    tipo: "peso",
    id: String(x.id),
    nombre: txt(x.nombre) ?? "(sin nombre)",
    categoria: txt(x.categoria) ?? "",
    precio: num(x.precio),
    unidad: txt(x.unidad),
    gramosVenta: num(x.gramos_venta),
    ventaKgIva: num(x.venta_kg_iva),
    ventaKg: num(x.venta_kg),
    productoId: num(x.producto_id),
    producto: txt(x.producto),
    compraKg: num(x.compra_kg),
    compraKg6m: num(x.compra_kg_6m),
    compraKgMediana: num(x.compra_kg_mediana),
    multiplicadorMediana: num(x.multiplicador_mediana),
    compraKgAnterior: num(x.compra_kg_anterior),
    fechaAnterior: txt(x.fecha_anterior),
    proveedorAnterior: txt(x.proveedor_anterior),
    fecha6m: txt(x.fecha_6m),
    factura: normalizarFactura(x.factura),
    compraKgIva: num(x.compra_kg_iva),
    ivaCompraPct: num(x.iva_compra_pct),
    ivaOrigen: origenIva(x.iva_origen),
    lineas: num(x.lineas),
    ultima: txt(x.ultima),
    ultimoProveedor: txt(x.ultimo_proveedor),
    ultimaFecha: txt(x.ultima_fecha),
    multiplicador: num(x.multiplicador),
    pct: num(x.pct),
    variacionPct: num(x.variacion_pct),
    origen: origen(x.origen),
    revisado: x.revisado === true,
    motivo: txt(x.motivo),
    banderas: banderas(x.banderas),
  }));
  return {
    hoy: txt(r.hoy),
    costeDesde: r.coste_desde === "ultima_factura" ? "ultima_factura" : "mediana",
    config: {
      costeMaxPlatoPct: num(c.coste_max_plato_pct) ?? CONFIG_POR_DEFECTO.costeMaxPlatoPct,
      multiplicadorMinVino: num(c.multiplicador_min_vino) ?? CONFIG_POR_DEFECTO.multiplicadorMinVino,
      multiplicadorMinTienda: num(c.multiplicador_min_tienda) ?? CONFIG_POR_DEFECTO.multiplicadorMinTienda,
      multiplicadorMinPeso: num(c.multiplicador_min_peso) ?? CONFIG_POR_DEFECTO.multiplicadorMinPeso,
      subidaCostePct: num(c.subida_coste_pct) ?? CONFIG_POR_DEFECTO.subidaCostePct,
      ivaPct: num(c.iva_pct) ?? CONFIG_POR_DEFECTO.ivaPct,
      ivaTiendaPct: num(c.iva_tienda_pct) ?? CONFIG_POR_DEFECTO.ivaTiendaPct,
      diasReferencia: num(c.dias_referencia) ?? CONFIG_POR_DEFECTO.diasReferencia,
    },
    tienda: { activa: ti.activa === true, descuentoPct: num(ti.descuento_pct) ?? 30 },
    resumen: {
      platos: {
        total: ent(rp.total), conDatos: ent(rp.con_datos), foodCostMedio: num(rp.food_cost_medio), foodCostMediana: num(rp.food_cost_mediana),
        enRojo: ent(rp.en_rojo), subeCoste: ent(rp.sube_coste), sinDatos: ent(rp.sin_datos), revisados: ent(rp.revisados),
      },
      vinos: {
        total: ent(rv.total), conDatos: ent(rv.con_datos), multiplicadorMedio: num(rv.multiplicador_medio), multiplicadorMediana: num(rv.multiplicador_mediana),
        enRojo: ent(rv.en_rojo), subeCoste: ent(rv.sube_coste), sinDatos: ent(rv.sin_datos), revisados: ent(rv.revisados),
        enTienda: ent(rv.en_tienda), multiplicadorTiendaMediana: num(rv.multiplicador_tienda_mediana), tiendaEnRojo: ent(rv.tienda_en_rojo),
      },
    },
    platos,
    vinos,
    peso,
  };
}

// ─── Formato ──────────────────────────────────────────────────────────────
export const fmt = (n: number, dec: number) => n.toLocaleString("es-ES", { minimumFractionDigits: dec, maximumFractionDigits: dec });
export const euros = (n: number | null, dec = 2) => (n === null ? "—" : `${fmt(n, dec)} €`);
export const porcentaje = (n: number | null) => (n === null ? "—" : `${fmt(n, 0)} %`);
export const veces = (n: number | null) => (n === null ? "—" : `${fmt(n, 2)}×`);
/** «190 €/kg», «172,73 €/kg». */
export const eurosKg = (n: number | null, dec?: number) =>
  n === null ? "—" : `${fmt(n, dec ?? (Number.isInteger(n) ? 0 : 2))} €/kg`;
/** Número sin ceros que sobran: 2 → «2», 2,3 → «2,3», 1,567 → «1,57». */
export const numero = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
/** Precio de carta: «24 €», «21,82 €» (sin «,00» que sobra). */
export const eurosCarta = (n: number | null) => (n === null ? "—" : Number.isInteger(n) ? `${fmt(n, 0)} €` : euros(n));

/** «140 €/kg», «20 €/l», «29,52 € la cubeta». */
export function precioCompra(i: Pick<Ingrediente, "eur" | "unidad" | "medida" | "unidadCompra">): string {
  if (i.eur === null) return "sin compras";
  if (i.unidad === "ud") return `${euros(i.eur)} ${i.unidadCompra && i.unidadCompra !== "ud" ? `la ${i.unidadCompra}` : "la unidad"}`;
  const m = i.medida ?? (i.unidad === "ml" ? "l" : "kg");
  return `${euros(i.eur, i.eur >= 100 ? 0 : 2)}/${m}`;
}

/** «100 g», «0,05 ud». */
export const cantidadTexto = (i: Pick<Ingrediente, "cantidad" | "unidad">) =>
  `${fmt(i.cantidad, Number.isInteger(i.cantidad) ? 0 : i.cantidad < 0.1 ? 3 : 2)} ${i.unidad}`;

// ─── La última factura ────────────────────────────────────────────────────
/** «03/11» si es del mismo año que `hoy` (o no se sabe `hoy`); si no, «03/11/25». */
export function fechaFactura(fecha: string | null, hoy: string | null = null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha ?? "");
  if (!m) return "sin fecha";
  const mismoAno = !hoy || hoy.slice(0, 4) === m[1];
  return mismoAno ? `${m[3]}/${m[2]}` : `${m[3]}/${m[2]}/${m[1].slice(2)}`;
}

/** «la caja», «la botella», «la unidad». */
const laUnidad = (u: string | null) => (!u || u === "ud" ? "la unidad" : `la ${u}`);

/**
 * Precio de la factura en SU unidad, con el €/kg (o €/l) entre paréntesis cuando aporta:
 * «21,50 €/kg», «29,52 € la caja (8,20 €/kg)», «12,00 € la botella (16,00 €/l)», «3,20 € la unidad».
 */
export function precioFactura(f: Pick<FacturaUsada, "unidadCompra" | "precioUnidad" | "medida" | "eurBase">): string {
  const u = f.unidadCompra;
  if ((u === "kg" || u === "l") && (f.eurBase ?? f.precioUnidad) !== null) return `${euros(f.eurBase ?? f.precioUnidad)}/${u}`;
  if (f.precioUnidad === null) return f.eurBase !== null && f.medida ? `${euros(f.eurBase)}/${f.medida}` : "—";
  const base = f.eurBase !== null && f.medida ? ` (${euros(f.eurBase)}/${f.medida})` : "";
  return `${euros(f.precioUnidad)} ${laUnidad(u)}${base}`;
}

/** «Makro, 03/11 · 21,50 €/kg». */
export const textoFactura = (f: FacturaUsada, hoy: string | null = null) => `${f.proveedor}, ${fechaFactura(f.fecha, hoy)} · ${precioFactura(f)}`;

/** La factura que manda en el coste: la del artículo (vino, al peso) o la del ingrediente que más pesa (plato). */
export function facturaDeArticulo(a: ArticuloMargen): FacturaUsada | null {
  return a.factura;
}

/** «3 meses» (90 días), «2 meses» (60), «45 días». */
export const periodoMediana = (dias: number) => (dias % 30 === 0 ? (dias === 30 ? "1 mes" : `${dias / 30} meses`) : `${dias} días`);

/**
 * La mediana como contexto, en la misma unidad que el coste que se enseña:
 * «Mediana de 3 meses: 20,10 €/kg» (al peso), «… 10,50 € la botella» (vino),
 * «… 7,80 € (35 % de lo que cobras)» (plato). null si no hay mediana.
 */
export function textoMediana(a: ArticuloMargen, config: ConfigMargenes = CONFIG_POR_DEFECTO): string | null {
  const cab = `Mediana de ${periodoMediana(config.diasReferencia)}`;
  if (a.tipo === "peso") return a.compraKgMediana === null ? null : `${cab}: ${eurosKg(a.compraKgMediana, 2)}`;
  if (a.tipo === "vino") return a.costeMediana === null ? null : `${cab}: ${euros(a.costeMediana)} la botella`;
  if (a.costeMediana === null) return null;
  return `${cab}: hacerlo costaría ${euros(a.costeMediana)}` + (a.pctMediana !== null ? ` (${porcentaje(a.pctMediana)} de lo que cobras)` : "");
}

/** Ingrediente: «Mediana de 3 meses: 20,10 €/kg». */
export function textoMedianaIngrediente(i: Ingrediente, config: ConfigMargenes = CONFIG_POR_DEFECTO): string | null {
  if (i.eurMediana === null) return null;
  return `Mediana de ${periodoMediana(config.diasReferencia)}: ${precioCompra({ ...i, eur: i.eurMediana })}`;
}

/**
 * Si la compra más nueva del producto es posterior a la factura usada (esa compra no
 * trae el peso o la unidad que hace falta), se dice: «Hay una compra más nueva (05/11)
 * sin precio por kilo: se usa esta».
 */
export function avisoCompraMasNueva(f: FacturaUsada | null, ultima: string | null, hoy: string | null = null): string | null {
  if (!f?.fecha || !ultima || ultima <= f.fecha) return null;
  return `Hay una compra más nueva (${fechaFactura(ultima, hoy)}) que no trae ${f.medida === "l" ? "el volumen" : f.medida === "kg" ? "el peso" : "la misma unidad"}: se usa esta`;
}

// ─── El porqué (en sencillo) ──────────────────────────────────────────────
/**
 * Lo que pasa con el artículo, para quien no sabe de márgenes:
 *   «Lo vendes a 24 € (21,82 € sin IVA). Hacerlo te cuesta 8,10 €. De cada 100 € que
 *    cobras, 37 € se van en ingredientes (máximo 35 €).»
 * El % es SIEMPRE sobre el precio de venta sin IVA. El coste es el de la última factura.
 */
export function explicacion(a: ArticuloMargen, config: ConfigMargenes = CONFIG_POR_DEFECTO): string {
  if (a.banderas.includes("sin_precio")) return "No tiene precio en la carta.";
  if (a.banderas.includes("sin_mapear")) {
    const m = a.motivo ?? (a.tipo === "plato" ? "Sin escandallo (no se sabe qué lleva)" : "Sin producto de compra asociado");
    return `${m.charAt(0).toUpperCase()}${m.slice(1)}.`;
  }
  if (a.banderas.includes("sin_datos")) {
    if (a.tipo === "peso" && a.motivo) return `${a.motivo}.`;
    return `No hay compras de ${a.tipo === "plato" ? "sus ingredientes" : a.producto ?? "la botella"} para saber lo que cuesta.`;
  }
  const frases: string[] = [];
  // «De cada 100 € que cobras, X € se van en…»: el % de coste sobre la venta sin IVA
  // (si no viene, sale del multiplicador: 100 ÷ ×).
  const deCada100 = (pct: number | null, mult: number | null, en: string) => {
    const p = pct ?? (mult && mult > 0 ? 100 / mult : null);
    return p === null ? null : `De cada 100 € que cobras, ${fmt(p, 0)} € se van en ${en}.`;
  };
  const poner = (...xs: (string | null)[]) => frases.push(...xs.filter((x): x is string => !!x));
  if (a.tipo === "peso") {
    poner(
      `Lo vendes a ${eurosCarta(a.ventaKgIva)} el kilo (${euros(a.ventaKg)} sin IVA) y el kilo te cuesta ${euros(a.compraKg)}: ` +
        `cobras ${numero(a.multiplicador)} veces lo que pagas (mínimo ${numero(config.multiplicadorMinPeso)}).`,
      deCada100(a.pct, a.multiplicador, "comprarlo"),
    );
  } else if (a.tipo === "vino") {
    poner(
      `La botella te cuesta ${euros(a.coste)} y la vendes a ${eurosCarta(a.precio)} (${euros(a.venta)} sin IVA): ` +
        `cobras ${numero(a.multiplicador)} veces lo que pagas (mínimo ${numero(config.multiplicadorMinVino)}).`,
      deCada100(a.pct, a.multiplicador, "pagar la botella"),
    );
    if (a.banderas.includes("tienda_bajo")) {
      frases.push(
        `En la tienda la vendes a ${euros(a.precioTienda)} (${euros(a.ventaTienda)} sin IVA): cobras ${numero(a.multiplicadorTienda)} veces lo que pagas (mínimo ${numero(config.multiplicadorMinTienda)}).`,
      );
    }
    if (a.formatoDistinto) frases.push(`Coste calculado desde la botella de ${litrosTexto(a.litrosProducto)} (en la carta es de ${litrosTexto(a.litros)}).`);
  } else {
    poner(
      `Lo vendes a ${eurosCarta(a.precio)} (${euros(a.venta)} sin IVA). Hacerlo te cuesta ${euros(a.coste)}.`,
      a.pct === null ? null : `De cada 100 € que cobras, ${fmt(a.pct, 0)} € se van en ingredientes (máximo ${numero(config.costeMaxPlatoPct)} €).`,
    );
    if (a.principal && a.ingredientes.length > 1) frases.push(`Lo que más pesa: ${a.principal}.`);
  }
  if (a.banderas.includes("sube_coste") && a.variacionPct !== null) {
    frases.push(`Te cuesta un ${porcentaje(a.variacionPct)} más que hace 6 meses (de factura a factura) y el precio de la carta sigue igual.`);
  }
  if (a.banderas.includes("incompleto")) frases.push("Falta el precio de algún ingrediente: en realidad cuesta más.");
  return frases.join(" ");
}

/** «Nombre: explicación» (la lista y los avisos de una línea). */
export const razon = (a: ArticuloMargen, config: ConfigMargenes = CONFIG_POR_DEFECTO): string => `${a.nombre}: ${explicacion(a, config)}`;

/** % de coste corto y claro: «coste: 37 % de lo que cobras». */
export const textoPctCoste = (pct: number | null) => (pct === null ? "coste: —" : `coste: ${porcentaje(pct)} de lo que cobras`);

/** Etiqueta larga del % de coste (fichas y umbrales). */
export const ETIQUETA_PCT_COSTE = "% de coste sobre el precio de venta (sin IVA)";

/** «75 cl», «1,5 l». */
export const litrosTexto = (l: number | null) =>
  l === null ? "otro formato" : l < 1 ? `${fmt(l * 100, Number.isInteger(l * 100) ? 0 : 1)} cl` : `${fmt(l, Number.isInteger(l) ? 0 : 1)} l`;

/**
 * ¿Está entre «donde no funciona el margen»? `tienda`: cuenta también el margen de la
 * tienda de vinos (solo en la pestaña Vinos; el Dashboard sigue con el del restaurante).
 */
export const fallaMargen = (a: ArticuloMargen, tienda = false) =>
  a.banderas.includes("coste_alto") || a.banderas.includes("multiplicador_bajo") || a.banderas.includes("sube_coste") ||
  (tienda && a.banderas.includes("tienda_bajo"));

/**
 * Orden de la lista de problemas: primero lo que más se aleja del umbral (en
 * platos, % de coste; en vinos, cuánto falta para el multiplicador mínimo,
 * en la misma escala de % de coste), y después «sube el coste».
 */
export function gravedad(a: ArticuloMargen, config: ConfigMargenes, tienda = false): number {
  if (a.tipo === "plato") return a.pct !== null ? a.pct - config.costeMaxPlatoPct : -Infinity;
  if (a.multiplicador === null) return -Infinity;
  const minimo = a.tipo === "peso" ? config.multiplicadorMinPeso : config.multiplicadorMinVino;
  const g = (minimo / a.multiplicador - 1) * 100;
  if (a.tipo === "vino" && tienda && a.multiplicadorTienda !== null) {
    return Math.max(g, (config.multiplicadorMinTienda / a.multiplicadorTienda - 1) * 100);
  }
  return g;
}

export function problemas(lista: ArticuloMargen[], config: ConfigMargenes, opciones: { tienda?: boolean } = {}): ArticuloMargen[] {
  const tienda = opciones.tienda === true;
  return lista.filter((a) => fallaMargen(a, tienda)).sort((x, y) => {
    const gx = gravedad(x, config, tienda);
    const gy = gravedad(y, config, tienda);
    const rx = gx > 0 ? 1 : 0;
    const ry = gy > 0 ? 1 : 0;
    if (rx !== ry) return ry - rx;
    return gy - gx || x.nombre.localeCompare(y.nombre, "es");
  });
}

/**
 * Cifras de arriba, solo con lo comparable: «Por peso» (kilo con kilo) y
 * «Vinos» (botella con botella). Los platos con escandallo estimado solo
 * cuentan cuando están marcados «Revisado».
 */
export interface ResumenFiable {
  peso: { total: number; conDatos: number; multiplicadorMediana: number | null; pctMediana: number | null; enRojo: number; sinDatos: number; subeCoste: number };
  vinos: { total: number; conDatos: number; multiplicadorMediana: number | null; enRojo: number; sinDatos: number; subeCoste: number };
  borrador: { total: number; revisados: number; enRojoRevisados: number };
}

const mediana = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : Math.round(((o[m - 1] + o[m]) / 2) * 100) / 100;
};

/** Platos de la pestaña «Platos (borrador)»: los que NO se venden al peso. */
export const platosBorrador = (d: Pick<MargenesCarta, "platos" | "peso">): PlatoMargen[] => {
  const alPeso = new Set(d.peso.map((p) => p.id));
  return d.platos.filter((p) => !alPeso.has(p.id) && p.gramosVenta === null);
};

/** ¿Cuenta un plato del borrador? Solo cuando alguien lo ha marcado «Revisado». */
export const cuentaBorrador = (p: PlatoMargen) => p.revisado;

export function resumenFiable(d: MargenesCarta): ResumenFiable {
  const multPeso = d.peso.flatMap((p) => (p.multiplicador === null ? [] : [p.multiplicador]));
  const pctPeso = d.peso.flatMap((p) => (p.pct === null ? [] : [p.pct]));
  const multVino = d.vinos.flatMap((v) => (v.multiplicador === null ? [] : [v.multiplicador]));
  const borr = platosBorrador(d);
  return {
    peso: {
      total: d.peso.length,
      conDatos: multPeso.length,
      multiplicadorMediana: mediana(multPeso),
      pctMediana: mediana(pctPeso),
      enRojo: d.peso.filter((p) => p.banderas.includes("multiplicador_bajo")).length,
      sinDatos: d.peso.length - multPeso.length,
      subeCoste: d.peso.filter((p) => p.banderas.includes("sube_coste")).length,
    },
    vinos: {
      total: d.vinos.length,
      conDatos: multVino.length,
      multiplicadorMediana: mediana(multVino),
      enRojo: d.vinos.filter((v) => v.banderas.includes("multiplicador_bajo")).length,
      sinDatos: d.vinos.length - multVino.length,
      subeCoste: d.vinos.filter((v) => v.banderas.includes("sube_coste")).length,
    },
    borrador: {
      total: borr.length,
      revisados: borr.filter(cuentaBorrador).length,
      enRojoRevisados: borr.filter((p) => cuentaBorrador(p) && p.banderas.includes("coste_alto")).length,
    },
  };
}

/**
 * Marcas del eje X logarítmico (1-2-5 por década) que llegan del mínimo al
 * máximo REAL de los puntos: «2, 5, 10, 20, 50, 100, 200». Antes recharts solo
 * ponía 2, 3, 8 y 15 € aunque había puntos mucho más a la derecha.
 */
export function marcasLog(min: number, max: number): number[] {
  if (!(min > 0) || !(max > 0)) return [];
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const todas: number[] = [];
  for (let e = Math.floor(Math.log10(lo)) - 1; e <= Math.ceil(Math.log10(hi)) + 1; e++) {
    for (const m of [1, 2, 5]) todas.push(Math.round(m * 10 ** e * 1e6) / 1e6);
  }
  // La marca justo por debajo del mínimo, las de dentro y la justo por encima del máximo.
  const debajo = todas.filter((v) => v <= lo).pop();
  const encima = todas.find((v) => v >= hi);
  return todas.filter((v) => (debajo === undefined || v >= debajo) && (encima === undefined || v <= encima));
}

/** Dominio del eje X logarítmico: de la primera a la última marca. */
export const dominioLog = (valores: number[]): [number, number] => {
  const pos = valores.filter((v) => v > 0);
  if (pos.length === 0) return [1, 10];
  const marcas = marcasLog(Math.min(...pos), Math.max(...pos));
  return [marcas[0], marcas[marcas.length - 1]];
};

/** Puntos de la gráfica de dispersión: precio de venta (con IVA) frente a % de coste. */
export interface PuntoDispersion {
  id: string;
  nombre: string;
  precio: number;
  pct: number;
  rojo: boolean;
}

/** En «Por peso», el eje X es el precio de carta por kilo (con IVA); en el resto, el precio de carta. */
export function puntosDispersion(lista: ArticuloMargen[], umbralPct: number): PuntoDispersion[] {
  return lista.flatMap((a) => {
    const precio = a.tipo === "peso" ? a.ventaKgIva : a.precio;
    if (precio === null || precio <= 0 || a.pct === null) return [];
    return [{ id: a.id, nombre: a.nombre, precio, pct: Math.min(a.pct, 150), rojo: a.pct > umbralPct }];
  });
}

/** % de coste equivalente al multiplicador mínimo de peso (sin IVA / sin IVA): 2× → 50 %. */
export const pctDeMultiplicadorPeso = (multiplicador: number) => 100 / multiplicador;

/** % de coste equivalente al multiplicador mínimo de vinos (sin IVA / sin IVA, 20261125100000): 2,3× → 43,5 %. */
export const pctDeMultiplicador = (multiplicador: number) => 100 / multiplicador;

// ─── Con IVA (interruptor del panel; el margen siempre va sin IVA) ─────────
/** Coste del artículo para enseñar: sin IVA o con el IVA de sus compras. */
export function costeVisible(a: ArticuloMargen, conIva: boolean): number | null {
  if (a.tipo === "peso") return conIva ? a.compraKgIva : a.compraKg;
  return conIva ? a.costeIva : a.coste;
}

/** ¿Se ha usado un IVA supuesto (no el de la línea) para el coste con IVA? */
export function ivaSupuesto(a: ArticuloMargen): boolean {
  if (a.tipo === "plato") return a.ivaSupuesto;
  return a.ivaOrigen !== null && a.ivaOrigen !== "linea";
}

/** Por qué el coste con IVA es aproximado: IVA general de la factura o un 10 % supuesto. */
export function notaIva(a: ArticuloMargen): string | null {
  if (!ivaSupuesto(a)) return null;
  if (a.tipo === "plato") return "IVA supuesto en algún ingrediente (su línea no lo trae)";
  return a.ivaOrigen === "factura"
    ? `IVA general de la factura (${fmt(a.ivaCompraPct ?? 0, 1)} %): la línea no lo trae`
    : "IVA supuesto del 10 %: ni la línea ni la factura lo traen";
}

// ─── Compras que forman el coste (RPC margenes_compras_producto) ──────────
export interface CompraCoste extends DocumentoCifra {
  lineaId: number;
  nombreLinea: string;
  unidad: string | null;
  eurBase: number | null;
  eurUd: number | null;
  medida: string | null;
}

export function normalizarCompras(entrada: unknown): CompraCoste[] {
  return arr(obj(entrada).filas).map(obj).flatMap((f) => {
    const id = num(f.id);
    if (id === null) return [];
    return [{
      id,
      fecha: txt(f.fecha),
      proveedor: txt(f.proveedor) ?? "Sin proveedor",
      proveedorId: num(f.proveedor_id),
      numero: txt(f.numero_documento),
      tipo: f.tipo === "albaran" || f.tipo === "abono" ? f.tipo : "factura",
      local: f.local === "touza" ? "touza" : "casa_tomas",
      total: num(f.total),
      aporta: num(f.importe_aportado) ?? 0,
      cantidad: num(f.cantidad),
      lineas: null,
      driveUrl: txt(f.drive_url),
      archivoPath: txt(f.archivo_path),
      lineaId: ent(f.linea_id),
      nombreLinea: txt(f.nombre_linea) ?? "",
      unidad: txt(f.unidad),
      eurBase: num(f.eur_base),
      eurUd: num(f.eur_ud),
      medida: txt(f.medida),
    }];
  });
}

/** Producto del buscador (RPC margenes_buscar_productos). */
export interface ProductoBuscado {
  id: number;
  nombre: string;
  categoria: string | null;
  lineas: number;
  ultima: string | null;
}

export function normalizarProductos(entrada: unknown): ProductoBuscado[] {
  return arr(entrada).map(obj).flatMap((p) => {
    const id = num(p.id);
    return id === null ? [] : [{ id, nombre: txt(p.nombre) ?? `Producto ${id}`, categoria: txt(p.categoria), lineas: ent(p.lineas), ultima: txt(p.ultima) }];
  });
}
