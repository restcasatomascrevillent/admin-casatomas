// Análisis general › Márgenes de carta (RPC `margenes_carta`, migración
// 20261115200000_analisis_margenes_carta). Aquí: tipos, normalización del jsonb
// (defensiva: el panel no se cae si falta un campo), textos del «porqué» y orden
// de la lista de «donde no funciona el margen». Sin React: se prueba suelto.
import type { DocumentoCifra } from "@/lib/facturas/documentosCifra";

export type Bandera =
  | "coste_alto"
  | "multiplicador_bajo"
  | "sube_coste"
  | "sin_datos"
  | "incompleto"
  | "sin_mapear"
  | "sin_precio";

export const ETIQUETA_BANDERA: Record<Bandera, string> = {
  coste_alto: "Coste alto",
  multiplicador_bajo: "Multiplicador bajo",
  sube_coste: "Sube el coste",
  sin_datos: "Sin datos de coste",
  incompleto: "Faltan costes",
  sin_mapear: "Sin escandallo",
  sin_precio: "Sin precio",
};

export type UnidadEscandallo = "g" | "ml" | "ud";

export interface ConfigMargenes {
  costeMaxPlatoPct: number;
  multiplicadorMinVino: number;
  subidaCostePct: number;
  ivaPct: number;
  diasReferencia: number;
}

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
  pct: number | null;
  margen: number | null;
  variacionPct: number | null;
  principal: string | null;
  principalCoste: number | null;
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
  litros: number;
  coste: number | null;
  coste6m: number | null;
  multiplicador: number | null;
  pct: number | null;
  margen: number | null;
  variacionPct: number | null;
  lineas: number | null;
  ultima: string | null;
  origen: "estimado" | "manual" | null;
  nota: string | null;
  revisado: boolean;
  motivo: string | null;
  banderas: Bandera[];
}

export type ArticuloMargen = PlatoMargen | VinoMargen;

export interface ResumenMargenes {
  platos: { total: number; conDatos: number; foodCostMedio: number | null; foodCostMediana: number | null; enRojo: number; subeCoste: number; sinDatos: number; revisados: number };
  vinos: { total: number; conDatos: number; multiplicadorMedio: number | null; multiplicadorMediana: number | null; enRojo: number; subeCoste: number; sinDatos: number; revisados: number };
}

export interface MargenesCarta {
  hoy: string | null;
  config: ConfigMargenes;
  resumen: ResumenMargenes;
  platos: PlatoMargen[];
  vinos: VinoMargen[];
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

export const CONFIG_POR_DEFECTO: ConfigMargenes = {
  costeMaxPlatoPct: 35,
  multiplicadorMinVino: 2.5,
  subidaCostePct: 10,
  ivaPct: 10,
  diasReferencia: 90,
};

export function normalizarMargenes(entrada: unknown): MargenesCarta {
  const r = obj(entrada);
  const c = obj(r.config);
  const rs = obj(r.resumen);
  const rp = obj(rs.platos);
  const rv = obj(rs.vinos);
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
    pct: num(p.pct),
    margen: num(p.margen),
    variacionPct: num(p.variacion_pct),
    principal: txt(p.principal),
    principalCoste: num(p.principal_coste),
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
    coste: num(v.coste),
    coste6m: num(v.coste_6m),
    multiplicador: num(v.multiplicador),
    pct: num(v.pct),
    margen: num(v.margen),
    variacionPct: num(v.variacion_pct),
    lineas: num(v.lineas),
    ultima: txt(v.ultima),
    origen: origen(v.origen),
    nota: txt(v.nota),
    revisado: v.revisado === true,
    motivo: txt(v.motivo),
    banderas: banderas(v.banderas),
  }));
  return {
    hoy: txt(r.hoy),
    config: {
      costeMaxPlatoPct: num(c.coste_max_plato_pct) ?? CONFIG_POR_DEFECTO.costeMaxPlatoPct,
      multiplicadorMinVino: num(c.multiplicador_min_vino) ?? CONFIG_POR_DEFECTO.multiplicadorMinVino,
      subidaCostePct: num(c.subida_coste_pct) ?? CONFIG_POR_DEFECTO.subidaCostePct,
      ivaPct: num(c.iva_pct) ?? CONFIG_POR_DEFECTO.ivaPct,
      diasReferencia: num(c.dias_referencia) ?? CONFIG_POR_DEFECTO.diasReferencia,
    },
    resumen: {
      platos: {
        total: ent(rp.total), conDatos: ent(rp.con_datos), foodCostMedio: num(rp.food_cost_medio), foodCostMediana: num(rp.food_cost_mediana),
        enRojo: ent(rp.en_rojo), subeCoste: ent(rp.sube_coste), sinDatos: ent(rp.sin_datos), revisados: ent(rp.revisados),
      },
      vinos: {
        total: ent(rv.total), conDatos: ent(rv.con_datos), multiplicadorMedio: num(rv.multiplicador_medio), multiplicadorMediana: num(rv.multiplicador_mediana),
        enRojo: ent(rv.en_rojo), subeCoste: ent(rv.sube_coste), sinDatos: ent(rv.sin_datos), revisados: ent(rv.revisados),
      },
    },
    platos,
    vinos,
  };
}

// ─── Formato ──────────────────────────────────────────────────────────────
const fmt = (n: number, dec: number) => n.toLocaleString("es-ES", { minimumFractionDigits: dec, maximumFractionDigits: dec });
export const euros = (n: number | null, dec = 2) => (n === null ? "—" : `${fmt(n, dec)} €`);
export const porcentaje = (n: number | null) => (n === null ? "—" : `${fmt(n, 0)} %`);
export const veces = (n: number | null) => (n === null ? "—" : `${fmt(n, 2)}×`);

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

// ─── El porqué ────────────────────────────────────────────────────────────
/**
 * Una frase que explica por qué falla (o por qué no se puede saber):
 *   «Percebes: cuesta 110 €/kg y se vende a 172,73 €/kg sin IVA → 64 % de coste»
 *   «Arroz meloso de langosta: el coste (15,14 €) es el 51 % de lo que se cobra sin IVA (29,55 €); lo que más pesa, Langosta»
 */
export function razon(a: ArticuloMargen, config: ConfigMargenes = CONFIG_POR_DEFECTO): string {
  if (a.banderas.includes("sin_precio")) return `${a.nombre}: no tiene precio en la carta.`;
  if (a.banderas.includes("sin_mapear")) return `${a.nombre}: ${a.motivo ?? (a.tipo === "vino" ? "sin producto de compra asociado" : "sin escandallo")}.`;
  if (a.banderas.includes("sin_datos")) return `${a.nombre}: no hay compras de ${a.tipo === "vino" ? a.producto ?? "la botella" : "sus ingredientes"} para calcular el coste.`;
  const partes: string[] = [];
  if (a.tipo === "vino") {
    partes.push(
      `${a.nombre}: la botella cuesta ${euros(a.coste)} y se vende a ${euros(a.precio)} → ${veces(a.multiplicador)} (mínimo ${veces(config.multiplicadorMinVino)})`,
    );
  } else {
    const unico = a.ingredientes.length === 1 ? a.ingredientes[0] : null;
    if (unico && unico.unidad !== "ud" && a.gramosVenta && unico.eur !== null && a.venta !== null && unico.cantidad === a.gramosVenta) {
      const ventaKg = (a.venta / a.gramosVenta) * 1000;
      const m = unico.medida ?? "kg";
      partes.push(`${a.nombre}: cuesta ${precioCompra(unico)} y se vende a ${euros(ventaKg)}/${m} sin IVA → ${porcentaje(a.pct)} de coste`);
    } else {
      partes.push(
        `${a.nombre}: el coste (${euros(a.coste)}) es el ${porcentaje(a.pct)} de lo que se cobra sin IVA (${euros(a.venta)})` +
          (a.principal && a.ingredientes.length > 1 ? `; lo que más pesa, ${a.principal}` : ""),
      );
    }
  }
  if (a.banderas.includes("sube_coste") && a.variacionPct !== null) {
    partes.push(`el coste ha subido un ${porcentaje(a.variacionPct)} en 6 meses y la carta sigue igual`);
  }
  if (a.banderas.includes("incompleto")) partes.push("falta el coste de algún ingrediente");
  return partes.join("; ") + ".";
}

/** ¿Está entre «donde no funciona el margen»? */
export const fallaMargen = (a: ArticuloMargen) =>
  a.banderas.includes("coste_alto") || a.banderas.includes("multiplicador_bajo") || a.banderas.includes("sube_coste");

/**
 * Orden de la lista de problemas: primero lo que más se aleja del umbral (en
 * platos, % de coste; en vinos, cuánto falta para el multiplicador mínimo,
 * en la misma escala de % de coste), y después «sube el coste».
 */
export function gravedad(a: ArticuloMargen, config: ConfigMargenes): number {
  if (a.tipo === "plato") return a.pct !== null ? a.pct - config.costeMaxPlatoPct : -Infinity;
  if (a.multiplicador === null) return -Infinity;
  return (config.multiplicadorMinVino / a.multiplicador - 1) * 100;
}

export function problemas(lista: ArticuloMargen[], config: ConfigMargenes): ArticuloMargen[] {
  return lista.filter(fallaMargen).sort((x, y) => {
    const gx = gravedad(x, config);
    const gy = gravedad(y, config);
    const rx = gx > 0 ? 1 : 0;
    const ry = gy > 0 ? 1 : 0;
    if (rx !== ry) return ry - rx;
    return gy - gx || x.nombre.localeCompare(y.nombre, "es");
  });
}

/** Puntos de la gráfica de dispersión: precio de venta (con IVA) frente a % de coste. */
export interface PuntoDispersion {
  id: string;
  nombre: string;
  precio: number;
  pct: number;
  rojo: boolean;
}

export function puntosDispersion(lista: ArticuloMargen[], umbralPct: number): PuntoDispersion[] {
  return lista
    .filter((a) => a.precio !== null && a.precio > 0 && a.pct !== null)
    .map((a) => ({ id: a.id, nombre: a.nombre, precio: a.precio as number, pct: Math.min(a.pct as number, 150), rojo: (a.pct as number) > umbralPct }));
}

/** % de coste equivalente al multiplicador mínimo de vinos (precio con IVA): 2,5× con IVA 10 % → 44 %. */
export const pctDeMultiplicador = (multiplicador: number, ivaPct: number) => (100 * (1 + ivaPct / 100)) / multiplicador;

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
