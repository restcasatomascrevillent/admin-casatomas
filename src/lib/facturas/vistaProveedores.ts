// ============================================================================
//  Facturas › Análisis › vista «Proveedores» (09/11/2026: «da muy poca info»)
// ----------------------------------------------------------------------------
//  Cuentas puras (sin React) de la vista maestro-detalle de proveedores:
//    · la lista: gasto del periodo, % del total, documentos, ticket medio y
//      cuánto cambia frente al periodo anterior (o si es nuevo / ya no se le
//      compra), con sus avisos de precio, ahorro y albaranes;
//    · los filtros de la lista (Todos, Gastas más, Nuevos, Ya no compras, Con
//      avisos) y la concentración (cuánto pesan los 5 primeros).
//  Datos: `explorar_compras` agrupado por proveedor (periodo y anterior) y las
//  alertas de `facturas_decision`. Sin `explorar_compras`, la lista del
//  tablero (los 10 primeros) sin comparación.
// ============================================================================
import type { CambioPrecio, DecisionFacturas } from "./decision";
import type { Exploracion } from "./explorador";
import type { ProveedorGasto } from "./tableroCompras";

export interface AvisosProveedor {
  /** Precios que le han subido (también los pactados que no respeta). */
  subidas: CambioPrecio[];
  /** Productos que otro proveedor que ya usas vende más barato. */
  masBarato: CambioPrecio[];
  /** Albaranes sin factura, importes inusuales, proveedor nuevo… */
  otros: CambioPrecio[];
  /** € al mes que cuestan sus subidas. */
  impactoMes: number;
  /** € que te ahorrarías en 90 días comprando eso en el otro. */
  ahorro90: number;
}

export type EstadoProveedor = "normal" | "nuevo" | "dejado";

export interface FilaProveedor {
  /** Clave de la RPC (id o «n:nombre» si no está en el catálogo). */
  clave: string;
  id: number | null;
  nombre: string;
  /** Con IVA, en el periodo (0 si ya no se le compra). */
  gasto: number;
  documentos: number;
  /** % del gasto del periodo. */
  pct: number | null;
  /** Gasto / documentos. */
  ticket: number | null;
  /** Gasto con IVA en el periodo anterior (null = no se puede comparar). */
  anterior: number | null;
  variacionPct: number | null;
  estado: EstadoProveedor;
  avisos: AvisosProveedor;
}

export type FiltroProveedores = "todos" | "mas" | "nuevos" | "dejados" | "avisos";

/** Sube al menos esto (y algo de dinero) para salir en «Gastas más». */
export const UMBRAL_MAS_PCT = 10;

const SIN_AVISOS: AvisosProveedor = { subidas: [], masBarato: [], otros: [], impactoMes: 0, ahorro90: 0 };

/** Las alertas de `facturas_decision`, repartidas por proveedor. */
export function avisosPorProveedor(decision: DecisionFacturas | null): Map<number, AvisosProveedor> {
  const mapa = new Map<number, AvisosProveedor>();
  if (!decision) return mapa;
  const de = (id: number) => {
    let a = mapa.get(id);
    if (!a) {
      a = { subidas: [], masBarato: [], otros: [], impactoMes: 0, ahorro90: 0 };
      mapa.set(id, a);
    }
    return a;
  };
  const c = decision.cambios;
  for (const x of [...c.proveedor, ...c.sube, ...c.pactado]) {
    const id = x.alerta.datos.proveedorId;
    if (id === null) continue;
    const a = de(id);
    a.subidas.push(x);
    a.impactoMes += Math.max(0, x.impactoMes ?? 0);
  }
  for (const x of c.mejor) {
    const id = x.alerta.datos.proveedorId;
    if (id === null) continue;
    const a = de(id);
    a.masBarato.push(x);
    a.ahorro90 += Math.max(0, x.alerta.datos.ahorro ?? 0);
  }
  for (const x of c.otros) {
    const id = x.alerta.datos.proveedorId;
    if (id === null) continue;
    de(id).otros.push(x);
  }
  for (const a of mapa.values()) a.subidas.sort((x, y) => (y.impactoMes ?? 0) - (x.impactoMes ?? 0));
  return mapa;
}

export const numAvisos = (a: AvisosProveedor): number => a.subidas.length + a.masBarato.length + a.otros.length;

/**
 * Proveedores que están en `otra` pero no en `base`, cuando `base` no los trae
 * todos (tiene «resto»): hay que preguntar por ellos para saber si de verdad no
 * se les compró nada. Solo los del catálogo (con id); como mucho 50.
 */
export function idsPorCompletar(base: Exploracion | null | undefined, otra: Exploracion | null | undefined): number[] {
  if (!base || !otra || !base.resto) return [];
  const enBase = new Set(base.puntos.map((p) => p.clave));
  return otra.puntos
    .filter((p) => !enBase.has(p.clave) && p.id !== null && (p.valor ?? 0) > 0)
    .map((p) => p.id as number)
    .slice(0, 50);
}

interface Entrada {
  /** `explorar_compras` del periodo, por proveedor (null = no disponible). */
  actual: Exploracion | null | undefined;
  /** Lo mismo del periodo anterior (null = sin comparar). */
  anterior: Exploracion | null | undefined;
  /** El periodo, solo de los que faltaban en `actual` (ver idsPorCompletar). */
  completarActual?: Exploracion | null;
  /** El anterior, solo de los que faltaban en `anterior`. */
  completarAnterior?: Exploracion | null;
  /** La lista del tablero, si `explorar_compras` no está. */
  respaldo: ProveedorGasto[];
  /** Gasto del periodo con IVA (para el %). */
  total: number;
  /** El periodo anterior está cargado de verdad. */
  comparable: boolean;
  avisos: Map<number, AvisosProveedor>;
}

const valores = (ex: Exploracion | null | undefined) => new Map((ex?.puntos ?? []).map((p) => [p.clave, p.valor ?? 0]));

/** La lista de la vista: los del periodo por gasto y, al final, a los que ya no se compra. */
export function filasProveedores(e: Entrada): FilaProveedor[] {
  const avisos = (id: number | null) => (id !== null ? (e.avisos.get(id) ?? SIN_AVISOS) : SIN_AVISOS);
  const pct = (g: number) => (e.total > 0 ? (g / e.total) * 100 : null);
  if (!e.actual) {
    return e.respaldo.map((p) => ({
      clave: p.id !== null ? String(p.id) : `n:${p.nombre}`,
      id: p.id,
      nombre: p.nombre,
      gasto: p.gasto,
      documentos: p.documentos,
      pct: p.pct ?? pct(p.gasto),
      ticket: p.documentos > 0 ? p.gasto / p.documentos : null,
      anterior: null,
      variacionPct: null,
      estado: "normal",
      avisos: avisos(p.id),
    }));
  }
  const conAnterior = e.comparable && !!e.anterior;
  const ant = valores(e.anterior);
  for (const [k, v] of valores(e.completarAnterior)) ant.set(k, v);
  // Si el anterior trae «resto», quien falta puede estar en él: solo se sabe de los preguntados (con id).
  const sinAnterior = (id: number | null) => !e.anterior?.resto || (!!e.completarAnterior && id !== null);
  const filas: FilaProveedor[] = e.actual.puntos
    .filter((p) => (p.valor ?? 0) > 0)
    .map((p) => {
      const g = p.valor ?? 0;
      const a = !conAnterior ? null : (ant.get(p.clave) ?? (sinAnterior(p.id) ? 0 : null));
      return {
        clave: p.clave,
        id: p.id,
        nombre: p.etiqueta,
        gasto: g,
        documentos: p.documentos,
        pct: pct(g),
        ticket: p.documentos > 0 ? g / p.documentos : null,
        anterior: a,
        variacionPct: a !== null && a > 0 ? (g / a - 1) * 100 : null,
        estado: a === 0 ? "nuevo" : "normal",
        avisos: avisos(p.id),
      };
    });
  if (conAnterior && e.anterior) {
    const act = valores(e.actual);
    for (const [k, v] of valores(e.completarActual)) act.set(k, v);
    for (const p of e.anterior.puntos) {
      if ((p.valor ?? 0) <= 0 || act.has(p.clave)) continue;
      // Con «resto» en el periodo, solo se sabe de los que se han preguntado (con id).
      if (e.actual.resto && !(e.completarActual && p.id !== null)) continue;
      filas.push({
        clave: p.clave,
        id: p.id,
        nombre: p.etiqueta,
        gasto: 0,
        documentos: 0,
        pct: 0,
        ticket: null,
        anterior: p.valor ?? 0,
        variacionPct: -100,
        estado: "dejado",
        avisos: avisos(p.id),
      });
    }
  }
  return filas;
}

/** Cuánto pesan los `n` primeros en el gasto del periodo (null sin gasto o con menos de `n`+1). */
export function concentracion(filas: FilaProveedor[], total: number, n = 5): { n: number; pct: number } | null {
  const conGasto = filas.filter((f) => f.gasto > 0).sort((a, b) => b.gasto - a.gasto);
  if (total <= 0 || conGasto.length <= n) return null;
  const suma = conGasto.slice(0, n).reduce((s, f) => s + f.gasto, 0);
  return { n, pct: Math.min(100, (suma / total) * 100) };
}

const gastaMas = (f: FilaProveedor) =>
  f.estado === "normal" && f.anterior !== null && f.variacionPct !== null && f.variacionPct >= UMBRAL_MAS_PCT && f.gasto - f.anterior > 0;

/** Las filas de un filtro, en su orden: por gasto; «Gastas más» por € de más; «Ya no compras» por lo de antes. */
export function filtrarProveedores(filas: FilaProveedor[], filtro: FiltroProveedores): FilaProveedor[] {
  switch (filtro) {
    case "mas":
      return filas.filter(gastaMas).sort((a, b) => b.gasto - (b.anterior ?? 0) - (a.gasto - (a.anterior ?? 0)));
    case "nuevos":
      return filas.filter((f) => f.estado === "nuevo");
    case "dejados":
      return filas.filter((f) => f.estado === "dejado").sort((a, b) => (b.anterior ?? 0) - (a.anterior ?? 0));
    case "avisos":
      return filas.filter((f) => numAvisos(f.avisos) > 0).sort((a, b) => b.avisos.impactoMes + b.avisos.ahorro90 / 3 - (a.avisos.impactoMes + a.avisos.ahorro90 / 3));
    default:
      return filas.filter((f) => f.estado !== "dejado");
  }
}

export const FILTROS_PROVEEDORES: { id: FiltroProveedores; etiqueta: string; conAnterior?: boolean }[] = [
  { id: "todos", etiqueta: "Todos" },
  { id: "mas", etiqueta: "Gastas más", conAnterior: true },
  { id: "nuevos", etiqueta: "Nuevos", conAnterior: true },
  { id: "dejados", etiqueta: "Ya no compras", conAnterior: true },
  { id: "avisos", etiqueta: "Con avisos" },
];

/** «+1.234 €» / «−560 €» (signo menos tipográfico, miles con punto). */
export function textoDiferencia(n: number): string {
  const abs = String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${n > 0.5 ? "+" : n < -0.5 ? "−" : ""}${abs} €`;
}

/** Último mes (AAAA-MM) con compras de una serie mensual, o null. */
export function ultimoMesConCompras(puntos: { clave: string; valor: number | null }[]): string | null {
  for (let i = puntos.length - 1; i >= 0; i--) if ((puntos[i].valor ?? 0) > 0) return puntos[i].clave.slice(0, 7);
  return null;
}
