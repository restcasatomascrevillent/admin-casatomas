// «Facturas › Márgenes › Coste vinos»: lo que devuelve la RPC vinos_coste_carta
// (migración 20261207150000_coste_carta_vinos), ya tipado, y la lógica de la
// pantalla que no necesita la base de datos: filtros, orden, textos y cifras.
//
// El cálculo (coste efectivo, estado, avisos, precio sugerido, copa) vive en la
// RPC: es la misma fuente que usa el chat de Facturas. `costeEfectivo` y
// `estadoVino` de aquí son esas mismas reglas en limpio, para explicarlas en la
// pantalla y probarlas sin base de datos.
import { euros, fmt, normalizarFactura, type FacturaUsada } from "./margenesCarta";

export type EstadoVino = "bien" | "bajo" | "sin_enlazar" | "sin_compra" | "sin_precio" | "dudoso" | "revisar";

export type AvisoVino =
  | "formato_distinto"
  | "coste_mayor_que_carta"
  | "coste_por_caja"
  | "salto_precio"
  | "coste_muy_bajo"
  | "anada_distinta"
  | "sin_cargo_sin_convertir";

export const ETIQUETA_ESTADO: Record<EstadoVino, string> = {
  bien: "Bien",
  bajo: "Por debajo",
  sin_enlazar: "Sin enlazar",
  sin_compra: "Sin compra",
  sin_precio: "Sin precio",
  dudoso: "Dato dudoso",
  revisar: "Revisar",
};

export const ETIQUETA_AVISO: Record<AvisoVino, string> = {
  formato_distinto: "Otro formato",
  coste_mayor_que_carta: "Cuesta más que la carta",
  coste_por_caja: "Precio por caja",
  salto_precio: "Salto de precio",
  coste_muy_bajo: "Coste muy bajo",
  anada_distinta: "Otra añada",
  sin_cargo_sin_convertir: "Sin cargo sin contar",
};

/** Avisos que hacen el dato dudoso (los demás solo piden revisar). */
export const AVISOS_DUDOSOS: readonly AvisoVino[] = ["coste_mayor_que_carta", "coste_por_caja", "salto_precio", "coste_muy_bajo"];

export interface CopaVino {
  venta: number;
  coste: number;
  multiplicador: number | null;
  margen: number;
  margenPct: number;
}

export interface CandidatoBreve {
  id: number;
  nombre: string;
  similitud: number;
}

export interface VinoCoste {
  id: string;
  nombre: string;
  categoria: string;
  /** Precio de carta, con IVA. */
  precio: number | null;
  /** Precio de carta sin IVA. */
  venta: number | null;
  productoId: number | null;
  producto: string | null;
  origen: "estimado" | "manual" | null;
  litros: number;
  litrosProducto: number | null;
  /** Precio por botella de la última factura, sin IVA. */
  costeFactura: number | null;
  /** Total pagado ÷ (botellas pagadas + sin cargo), sin IVA. */
  costeEfectivo: number | null;
  botellasPagadas: number | null;
  botellasSinCargo: number;
  importePagado: number | null;
  /** Nº de facturas que entran en el coste efectivo (1 con «última factura»). */
  facturas: number | null;
  factura: FacturaUsada | null;
  /** Venta sin IVA ÷ coste efectivo. null si no se puede comparar. */
  multiplicador: number | null;
  margen: number | null;
  margenPct: number | null;
  estado: EstadoVino;
  avisos: AvisoVino[];
  /** Precio de carta (con IVA) para llegar al mínimo; solo en los que están por debajo. */
  precioSugerido: number | null;
  anadaCarta: number | null;
  anadaCompra: number | null;
  copeo: boolean;
  precioCopa: number | null;
  copa: CopaVino | null;
  mejorCandidato: CandidatoBreve | null;
}

export interface ResumenCosteVinos {
  total: number;
  conCoste: number;
  sinCoste: number;
  sinEnlazar: number;
  sinCompra: number;
  sinPrecio: number;
  dudosos: number;
  revisar: number;
  anadaDistinta: number;
  porDebajo: number;
  conSinCargo: number;
  conCandidato: number;
  multiplicadorMediana: number | null;
}

export interface CosteCartaVinos {
  hoy: string | null;
  /** null = última factura; N = facturas de los últimos N meses. */
  meses: number | null;
  copasPorBotella: number;
  multiplicadorMin: number;
  ivaPct: number;
  resumen: ResumenCosteVinos;
  vinos: VinoCoste[];
}

export interface CandidatoVino {
  id: number;
  nombre: string;
  categoria: string | null;
  similitud: number;
  lineas: number;
  ultima: string | null;
  litros: number | null;
  formatoDistinto: boolean;
  /** Coste de la botella tal como se compra, última factura, sin IVA. */
  costeBotella: number | null;
  factura: FacturaUsada | null;
  dudoso: boolean;
  enlazadoA: string[];
}

// ─── Normalización ──────────────────────────────────────────────────────────
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const ESTADOS = new Set<string>(Object.keys(ETIQUETA_ESTADO));
const AVISOS = new Set<string>(Object.keys(ETIQUETA_AVISO));

function normalizarCopa(v: unknown): CopaVino | null {
  const c = obj(v);
  const venta = num(c.venta);
  const coste = num(c.coste);
  if (venta === null || coste === null) return null;
  return { venta, coste, multiplicador: num(c.multiplicador), margen: num(c.margen) ?? venta - coste, margenPct: num(c.margen_pct) ?? 0 };
}

function normalizarVino(v: unknown): VinoCoste | null {
  const e = obj(v);
  const id = txt(e.id);
  if (!id) return null;
  const candidato = obj(e.mejor_candidato);
  const candId = num(candidato.id);
  return {
    id,
    nombre: txt(e.nombre) ?? "Sin nombre",
    categoria: txt(e.categoria) ?? "Sin categoría",
    precio: num(e.precio),
    venta: num(e.venta),
    productoId: num(e.producto_id),
    producto: txt(e.producto),
    origen: e.origen === "manual" ? "manual" : e.origen === "estimado" ? "estimado" : null,
    litros: num(e.litros) ?? 0.75,
    litrosProducto: num(e.litros_producto),
    costeFactura: num(e.coste_factura),
    costeEfectivo: num(e.coste_efectivo),
    botellasPagadas: num(e.botellas_pagadas),
    botellasSinCargo: num(e.botellas_sin_cargo) ?? 0,
    importePagado: num(e.importe_pagado),
    facturas: num(e.facturas),
    factura: normalizarFactura(e.factura),
    multiplicador: num(e.multiplicador),
    margen: num(e.margen),
    margenPct: num(e.margen_pct),
    estado: typeof e.estado === "string" && ESTADOS.has(e.estado) ? (e.estado as EstadoVino) : "sin_enlazar",
    avisos: arr(e.avisos).filter((a): a is AvisoVino => typeof a === "string" && AVISOS.has(a)),
    precioSugerido: num(e.precio_sugerido),
    anadaCarta: num(e.anada_carta),
    anadaCompra: num(e.anada_compra),
    copeo: e.copeo === true,
    precioCopa: num(e.precio_copa),
    copa: normalizarCopa(e.copa),
    mejorCandidato: candId === null ? null : { id: candId, nombre: txt(candidato.nombre) ?? "", similitud: num(candidato.similitud) ?? 0 },
  };
}

export function normalizarCosteVinos(entrada: unknown): CosteCartaVinos {
  const d = obj(entrada);
  const r = obj(d.resumen);
  const c = obj(d.config);
  const ent = (v: unknown) => num(v) ?? 0;
  return {
    hoy: txt(d.hoy),
    meses: num(d.meses),
    copasPorBotella: num(d.copas_por_botella) ?? 6,
    multiplicadorMin: num(c.multiplicador_min_vino) ?? 2.3,
    ivaPct: num(c.iva_pct) ?? 10,
    resumen: {
      total: ent(r.total),
      conCoste: ent(r.con_coste),
      sinCoste: ent(r.sin_coste),
      sinEnlazar: ent(r.sin_enlazar),
      sinCompra: ent(r.sin_compra),
      sinPrecio: ent(r.sin_precio),
      dudosos: ent(r.dudosos),
      revisar: ent(r.revisar),
      anadaDistinta: ent(r.anada_distinta),
      porDebajo: ent(r.por_debajo),
      conSinCargo: ent(r.con_sin_cargo),
      conCandidato: ent(r.con_candidato),
      multiplicadorMediana: num(r.multiplicador_mediana),
    },
    vinos: arr(d.vinos).map(normalizarVino).filter((v): v is VinoCoste => v !== null),
  };
}

export function normalizarCandidatos(entrada: unknown): CandidatoVino[] {
  return arr(entrada)
    .map((v): CandidatoVino | null => {
      const e = obj(v);
      const id = num(e.id);
      if (id === null) return null;
      return {
        id,
        nombre: txt(e.nombre) ?? "Sin nombre",
        categoria: txt(e.categoria),
        similitud: num(e.similitud) ?? 0,
        lineas: num(e.lineas) ?? 0,
        ultima: txt(e.ultima),
        litros: num(e.litros),
        formatoDistinto: e.formato_distinto === true,
        costeBotella: num(e.coste_botella),
        factura: normalizarFactura(e.factura),
        dudoso: e.dudoso === true,
        enlazadoA: arr(e.enlazado_a).filter((n): n is string => typeof n === "string"),
      };
    })
    .filter((c): c is CandidatoVino => c !== null);
}

// ─── Las reglas, en limpio (las mismas que la RPC) ──────────────────────────

/**
 * Coste efectivo por botella: total pagado ÷ (botellas pagadas + sin cargo).
 * «12 pagadas y 2 de regalo» = total ÷ 14. null si no hay botellas pagadas.
 */
export function costeEfectivo(importePagado: number, botellasPagadas: number, botellasSinCargo = 0): number | null {
  if (!(importePagado > 0) || !(botellasPagadas > 0) || botellasSinCargo < 0) return null;
  return Math.round((importePagado / (botellasPagadas + botellasSinCargo)) * 10000) / 10000;
}

/** ¿El producto enlazado es de otro formato que el vino de la carta? (magnum frente a 75 cl). */
export const formatoDistinto = (litrosCarta: number, litrosProducto: number | null) =>
  litrosProducto !== null && Math.abs(litrosCarta - litrosProducto) > 0.01;

/** Precio de carta (con IVA) para llegar al multiplicador mínimo, hacia arriba a 0,50 €. */
export function precioSugerido(coste: number, multiplicadorMin: number, ivaPct = 10): number {
  return Math.ceil(coste * multiplicadorMin * (1 + ivaPct / 100) * 2 - 1e-9) / 2;
}

export interface DatosEstado {
  /** Precio de carta sin IVA. */
  venta: number | null;
  productoId: number | null;
  costeFactura: number | null;
  costeEfectivo: number | null;
  litros: number;
  litrosProducto: number | null;
  /** Unidad de la línea de la que sale el coste, si no trae el volumen («caja»). */
  unidadSinVolumen?: string | null;
  costeAnterior?: number | null;
}

const UNIDADES_BOTELLA = new Set(["ud", "botella", "bt", "bs"]);

/** Motivos por los que el dato es dudoso (ver AVISOS_DUDOSOS). */
export function avisosDudosos(d: DatosEstado): AvisoVino[] {
  const avisos: AvisoVino[] = [];
  const { venta, costeEfectivo: ce, costeFactura: cf } = d;
  if (venta !== null && venta > 0 && ce !== null && ce > venta) avisos.push("coste_mayor_que_carta");
  if (cf !== null && d.unidadSinVolumen && !UNIDADES_BOTELLA.has(d.unidadSinVolumen)) avisos.push("coste_por_caja");
  if (cf !== null && cf > 0 && d.costeAnterior && d.costeAnterior > 0) {
    const salto = cf / d.costeAnterior;
    if (salto >= 2.5 || salto <= 0.4) avisos.push("salto_precio");
  }
  if (venta !== null && venta > 0 && ce !== null && ce > 0 && venta / ce > 8) avisos.push("coste_muy_bajo");
  return avisos;
}

/** Estado de un vino, por orden: sin precio, sin enlazar, sin compra, otro formato, dudoso, por debajo, bien. */
export function estadoVino(d: DatosEstado, multiplicadorMin: number): EstadoVino {
  if (d.venta === null) return "sin_precio";
  if (d.productoId === null) return "sin_enlazar";
  if (d.costeFactura === null || d.costeEfectivo === null) return "sin_compra";
  if (formatoDistinto(d.litros, d.litrosProducto)) return "revisar";
  if (avisosDudosos(d).length > 0) return "dudoso";
  return d.venta / d.costeEfectivo < multiplicadorMin ? "bajo" : "bien";
}

// ─── Filtros y orden ────────────────────────────────────────────────────────
export type FiltroEstado = "todos" | EstadoVino | "sin_cargo";
export type OrdenVinos = "peor" | "mejor" | "nombre" | "margen" | "precio";

export const ETIQUETA_ORDEN: Record<OrdenVinos, string> = {
  peor: "Multiplicador: peor primero",
  mejor: "Multiplicador: mejor primero",
  margen: "Margen en €: menor primero",
  precio: "Precio de carta: mayor primero",
  nombre: "Nombre",
};

const sinTildes = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** «Revisar» incluye los de otra añada, aunque su estado sea bien o por debajo. */
export function cumpleEstado(v: VinoCoste, filtro: FiltroEstado): boolean {
  if (filtro === "todos") return true;
  if (filtro === "sin_cargo") return v.botellasSinCargo > 0;
  if (filtro === "revisar") return v.estado === "revisar" || v.avisos.includes("anada_distinta");
  return v.estado === filtro;
}

export interface FiltrosVinos {
  estado: FiltroEstado;
  /** "" = todas. */
  categoria: string;
  texto: string;
  orden: OrdenVinos;
}

const nulosAlFinal = (a: number | null, b: number | null, signo: 1 | -1) => {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * signo;
};

export function filtrarYOrdenar(vinos: VinoCoste[], f: FiltrosVinos): VinoCoste[] {
  const t = sinTildes(f.texto.trim());
  const lista = vinos.filter(
    (v) =>
      cumpleEstado(v, f.estado) &&
      (!f.categoria || v.categoria === f.categoria) &&
      (!t || sinTildes(v.nombre).includes(t) || sinTildes(v.producto ?? "").includes(t) || sinTildes(v.factura?.proveedor ?? "").includes(t)),
  );
  const porNombre = (a: VinoCoste, b: VinoCoste) => a.nombre.localeCompare(b.nombre, "es");
  return lista.sort((a, b) => {
    const r =
      f.orden === "nombre"
        ? 0
        : f.orden === "peor"
          ? nulosAlFinal(a.multiplicador, b.multiplicador, 1)
          : f.orden === "mejor"
            ? nulosAlFinal(a.multiplicador, b.multiplicador, -1)
            : f.orden === "margen"
              ? nulosAlFinal(a.margen, b.margen, 1)
              : nulosAlFinal(a.precio, b.precio, -1);
    return r || porNombre(a, b);
  });
}

export const categoriasDe = (vinos: VinoCoste[]): string[] => [...new Set(vinos.map((v) => v.categoria))];

/** Subida media de precio (con IVA) que piden los vinos por debajo del mínimo. null si no hay. */
export function subidaMediaSugerida(vinos: VinoCoste[]): number | null {
  const subidas = vinos.filter((v) => v.estado === "bajo" && v.precioSugerido !== null && v.precio !== null).map((v) => (v.precioSugerido as number) - (v.precio as number));
  return subidas.length ? Math.round((subidas.reduce((s, x) => s + x, 0) / subidas.length) * 100) / 100 : null;
}

// ─── Textos ─────────────────────────────────────────────────────────────────
const botellas = (n: number) => `${fmt(n, Number.isInteger(n) ? 0 : 1)}`;

/** «30 pagadas + 6 sin cargo → 579,00 € ÷ 36» (o null si no hay botellas sin cargo ni varias facturas). */
export function textoSinCargo(v: Pick<VinoCoste, "botellasPagadas" | "botellasSinCargo" | "importePagado">): string | null {
  if (!(v.botellasSinCargo > 0) || v.botellasPagadas === null) return null;
  const total = v.importePagado !== null ? ` → ${euros(v.importePagado)} ÷ ${botellas(v.botellasPagadas + v.botellasSinCargo)}` : "";
  return `${botellas(v.botellasPagadas)} pagadas + ${botellas(v.botellasSinCargo)} sin cargo${total}`;
}

export const formatoTexto = (litros: number | null) =>
  litros === null ? "formato sin identificar" : litros === 0.75 ? "75 cl" : litros === 1.5 ? "Magnum (1,5 l)" : litros === 0.375 ? "37,5 cl" : `${fmt(litros, litros % 1 ? 2 : 0)} l`;

/** Por qué está en ese estado, en una frase (para la fila). */
export function motivoEstado(v: VinoCoste, multiplicadorMin: number): string | null {
  switch (v.estado) {
    case "sin_precio":
      return "No tiene precio en la carta.";
    case "sin_enlazar":
      return v.mejorCandidato ? `Sin enlazar. ¿Es «${v.mejorCandidato.nombre}»?` : "Sin enlazar con un producto de compra.";
    case "sin_compra":
      return `No hay compras de «${v.producto ?? "su producto"}».`;
    case "revisar":
      return `En carta es ${formatoTexto(v.litros)} y el producto enlazado es ${formatoTexto(v.litrosProducto)}: no se comparan. Enlaza el formato correcto.`;
    case "dudoso": {
      const m: string[] = [];
      if (v.avisos.includes("coste_mayor_que_carta")) m.push("el coste es mayor que el precio de carta");
      if (v.avisos.includes("coste_por_caja")) m.push("el precio de la factura parece de una caja, no de una botella");
      if (v.avisos.includes("salto_precio")) m.push("el precio ha saltado mucho respecto a la compra anterior");
      if (v.avisos.includes("coste_muy_bajo")) m.push("el coste es demasiado bajo para ese precio de carta");
      return `Dato dudoso: ${m.join("; ")}. Revisa la factura o el enlace.`;
    }
    case "bajo":
      return v.precioSugerido !== null ? `Para llegar a ×${fmt(multiplicadorMin, 1)}: ${euros(v.precioSugerido)} en carta.` : null;
    default:
      return null;
  }
}

export const textoAnada = (v: Pick<VinoCoste, "anadaCarta" | "anadaCompra">) =>
  v.anadaCarta !== null && v.anadaCompra !== null && v.anadaCarta !== v.anadaCompra ? `Carta ${v.anadaCarta}, última compra ${v.anadaCompra}` : null;

export const textoPeriodo = (meses: number | null) => (meses === null ? "última factura" : `facturas de los últimos ${meses} meses`);
