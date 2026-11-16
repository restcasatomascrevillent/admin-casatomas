// ============================================================================
//  Facturas › Análisis › «Subidas y proveedor» (informe fijo, 16/11/2026)
// ----------------------------------------------------------------------------
//  Dos bloques, una RPC cada uno (migración 20261207110000):
//    · informe_subidas_precio       → última compra frente a la de hace 3, 6 y
//      12 meses (mismo proveedor y unidad) e impacto anual;
//    · informe_proveedor_mas_barato → mismo producto y unidad en 2 o más
//      proveedores, y lo que se ahorraría al año.
//  Las cuentas van en SQL. Aquí solo: leer el JSON sin fiarse de él, los textos
//  y las notas para «Comparar facturas». Sin React.
// ============================================================================
import type { DocumentoCifra, TipoDocumentoCifra } from "./documentosCifra";
import type { ProductoBuscado } from "./comprasProducto";
import { proveedorCorto, type NotaComparar } from "./vistasAnalisis";

export type Confianza = "alta" | "media" | "baja";
export type MesesInforme = 3 | 6 | 12;
export const MESES_INFORME: MesesInforme[] = [3, 6, 12];
export const MESES_POR_DEFECTO: MesesInforme = 12;
/** Filas por página (la RPC admite hasta 1000). */
export const PAGINA_INFORME = 100;
export const LIMITE_MAXIMO_INFORME = 1000;

/** Etiqueta de cada nivel: la confianza baja se enseña como «Revisar» y no suma. */
export const ETIQUETA_CONFIANZA: Record<Confianza, string> = { alta: "Fiable", media: "Probable", baja: "Revisar" };

export interface PrecioAntes {
  precio: number;
  fecha: string | null;
  variacionPct: number | null;
}

export interface FilaSubida {
  id: string;
  productoId: number | null;
  producto: string;
  nombreNormalizado: string | null;
  familiaId: number | null;
  familia: string | null;
  proveedorId: number | null;
  proveedor: string | null;
  unidad: string;
  precio: number;
  fecha: string | null;
  precioRef: number;
  fechaRef: string | null;
  variacionPct: number;
  hace3: PrecioAntes | null;
  hace6: PrecioAntes | null;
  hace12: PrecioAntes | null;
  compras12m: number;
  cantidad12m: number;
  gasto12m: number;
  impactoAnual: number;
  confianza: Confianza;
  motivo: string;
  doc: DocumentoCifra | null;
  docRef: DocumentoCifra | null;
}

export interface FilaBarato {
  id: string;
  productoId: number | null;
  producto: string;
  nombreNormalizado: string | null;
  familiaId: number | null;
  familia: string | null;
  unidad: string;
  proveedorId: number | null;
  proveedor: string | null;
  precio: number;
  fecha: string | null;
  compras12m: number;
  cantidad12m: number;
  gasto12m: number;
  esHabitual: boolean;
  proveedorBaratoId: number | null;
  proveedorBarato: string | null;
  precioBarato: number;
  fechaBarato: string | null;
  comprasBarato12m: number;
  diferenciaPct: number;
  ahorroAnual: number;
  confianza: Confianza;
  motivo: string;
  doc: DocumentoCifra | null;
  docBarato: DocumentoCifra | null;
}

export interface TotalNivel {
  n: number;
  importe: number;
}

export interface OpcionFiltro {
  id: number;
  nombre: string;
  n: number;
}

export interface ProductoExcluido {
  productoId: number | null;
  producto: string;
  motivo: string;
  gasto12m: number;
  proveedores: number;
}

export interface Excluidos {
  nGenericos: number;
  gastoGenericos: number;
  genericos: ProductoExcluido[];
}

interface Comun {
  hoy: string | null;
  totalFilas: number;
  porConfianza: Record<Confianza, TotalNivel>;
  /** Lo que suma arriba: solo confianza alta y media. */
  fiable: TotalNivel;
  proveedores: OpcionFiltro[];
  familias: OpcionFiltro[];
  excluidos: Excluidos;
}

export interface InformeSubidas extends Comun {
  meses: MesesInforme;
  filas: FilaSubida[];
  /** Bajadas fiables del mismo periodo (importe negativo), de contexto. */
  bajadas: TotalNivel;
  /** Productos que se siguen comprando pero sin compra de «hace N meses» con la que comparar. */
  sinReferencia: number;
  comparados: number;
}

export interface InformeBarato extends Comun {
  filas: FilaBarato[];
  /** Productos (y unidad) comprados a 2 o más proveedores en 12 meses. */
  productosVariosProveedores: number;
}

// ─── Lectura del JSON ───────────────────────────────────────────────────────

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const confianza = (v: unknown): Confianza => (v === "alta" || v === "media" ? v : "baja");

const TIPOS_DOC: TipoDocumentoCifra[] = ["factura", "albaran", "abono"];

function documento(v: unknown): DocumentoCifra | null {
  const d = obj(v);
  const id = num(d.id);
  if (id === null) return null;
  const total = num(d.total);
  return {
    id,
    fecha: txt(d.fecha),
    proveedor: txt(d.proveedor) ?? "Proveedor",
    proveedorId: num(d.proveedor_id),
    numero: txt(d.numero),
    tipo: TIPOS_DOC.includes(d.tipo as TipoDocumentoCifra) ? (d.tipo as TipoDocumentoCifra) : "factura",
    local: d.local === "touza" ? "touza" : "casa_tomas",
    total,
    aporta: total ?? 0,
    cantidad: null,
    lineas: null,
    driveUrl: txt(d.drive_url),
    archivoPath: txt(d.archivo_path),
  };
}

function precioAntes(v: unknown): PrecioAntes | null {
  const o = obj(v);
  const precio = num(o.precio);
  return precio === null ? null : { precio, fecha: txt(o.fecha), variacionPct: num(o.variacion_pct) };
}

function opciones(v: unknown): OpcionFiltro[] {
  return arr(v).flatMap((x) => {
    const o = obj(x);
    const id = num(o.id);
    const nombre = txt(o.nombre);
    return id === null || nombre === null ? [] : [{ id, nombre, n: num(o.n) ?? 0 }];
  });
}

function excluidos(v: unknown): Excluidos {
  const o = obj(v);
  return {
    nGenericos: num(o.n_genericos) ?? 0,
    gastoGenericos: num(o.gasto_genericos) ?? 0,
    genericos: arr(o.genericos).map((x) => {
      const g = obj(x);
      return {
        productoId: num(g.producto_id),
        producto: txt(g.producto) ?? "Producto",
        motivo: txt(g.motivo) ?? "",
        gasto12m: num(g.gasto_12m) ?? 0,
        proveedores: num(g.proveedores) ?? 0,
      };
    }),
  };
}

function porConfianza(v: unknown, campo: string): Record<Confianza, TotalNivel> {
  const o = obj(v);
  const nivel = (k: Confianza): TotalNivel => ({ n: num(obj(o[k]).n) ?? 0, importe: num(obj(o[k])[campo]) ?? 0 });
  return { alta: nivel("alta"), media: nivel("media"), baja: nivel("baja") };
}

/** El JSON de `informe_subidas_precio`. Lo que no cuadre se queda en 0 o null; una fila sin producto o sin precios se descarta. */
export function normalizarSubidas(v: unknown): InformeSubidas {
  const r = obj(v);
  const t = obj(r.totales);
  const meses = num(r.meses);
  const filas = arr(r.filas).flatMap((x): FilaSubida[] => {
    const f = obj(x);
    const precio = num(f.precio);
    const precioRef = num(f.precio_ref);
    const producto = txt(f.producto);
    if (precio === null || precioRef === null || producto === null) return [];
    return [
      {
        id: txt(f.id) ?? `${f.producto_id}:${f.proveedor_id}:${f.unidad}`,
        productoId: num(f.producto_id),
        producto,
        nombreNormalizado: txt(f.nombre_normalizado),
        familiaId: num(f.familia_id),
        familia: txt(f.familia),
        proveedorId: num(f.proveedor_id),
        proveedor: txt(f.proveedor),
        unidad: txt(f.unidad) ?? "ud",
        precio,
        fecha: txt(f.fecha),
        precioRef,
        fechaRef: txt(f.fecha_ref),
        variacionPct: num(f.variacion_pct) ?? 0,
        hace3: precioAntes(f.hace_3),
        hace6: precioAntes(f.hace_6),
        hace12: precioAntes(f.hace_12),
        compras12m: num(f.compras_12m) ?? 0,
        cantidad12m: num(f.cantidad_12m) ?? 0,
        gasto12m: num(f.gasto_12m) ?? 0,
        impactoAnual: num(f.impacto_anual) ?? 0,
        confianza: confianza(f.confianza),
        motivo: txt(f.motivo) ?? "",
        doc: documento(f.doc),
        docRef: documento(f.doc_ref),
      },
    ];
  });
  return {
    hoy: txt(r.hoy),
    meses: meses === 3 || meses === 6 ? meses : 12,
    totalFilas: num(r.total_filas) ?? filas.length,
    porConfianza: porConfianza(t.por_confianza, "impacto"),
    fiable: { n: num(t.n_fiable) ?? 0, importe: num(t.impacto_fiable) ?? 0 },
    bajadas: { n: num(obj(t.bajadas_fiable).n) ?? 0, importe: num(obj(t.bajadas_fiable).importe) ?? 0 },
    sinReferencia: num(t.sin_referencia) ?? 0,
    comparados: num(t.comparados) ?? 0,
    filas,
    proveedores: opciones(r.proveedores),
    familias: opciones(r.familias),
    excluidos: excluidos(r.excluidos),
  };
}

/** El JSON de `informe_proveedor_mas_barato`. */
export function normalizarBarato(v: unknown): InformeBarato {
  const r = obj(v);
  const t = obj(r.totales);
  const filas = arr(r.filas).flatMap((x): FilaBarato[] => {
    const f = obj(x);
    const precio = num(f.precio);
    const precioBarato = num(f.precio_barato);
    const producto = txt(f.producto);
    if (precio === null || precioBarato === null || producto === null) return [];
    return [
      {
        id: txt(f.id) ?? `${f.producto_id}:${f.proveedor_id}:${f.unidad}`,
        productoId: num(f.producto_id),
        producto,
        nombreNormalizado: txt(f.nombre_normalizado),
        familiaId: num(f.familia_id),
        familia: txt(f.familia),
        unidad: txt(f.unidad) ?? "ud",
        proveedorId: num(f.proveedor_id),
        proveedor: txt(f.proveedor),
        precio,
        fecha: txt(f.fecha),
        compras12m: num(f.compras_12m) ?? 0,
        cantidad12m: num(f.cantidad_12m) ?? 0,
        gasto12m: num(f.gasto_12m) ?? 0,
        esHabitual: f.es_habitual === true,
        proveedorBaratoId: num(f.proveedor_barato_id),
        proveedorBarato: txt(f.proveedor_barato),
        precioBarato,
        fechaBarato: txt(f.fecha_barato),
        comprasBarato12m: num(f.compras_barato_12m) ?? 0,
        diferenciaPct: num(f.diferencia_pct) ?? 0,
        ahorroAnual: num(f.ahorro_anual) ?? 0,
        confianza: confianza(f.confianza),
        motivo: txt(f.motivo) ?? "",
        doc: documento(f.doc),
        docBarato: documento(f.doc_barato),
      },
    ];
  });
  return {
    hoy: txt(r.hoy),
    totalFilas: num(r.total_filas) ?? filas.length,
    porConfianza: porConfianza(t.por_confianza, "ahorro"),
    fiable: { n: num(t.n_fiable) ?? 0, importe: num(t.ahorro_fiable) ?? 0 },
    productosVariosProveedores: num(t.productos_varios_proveedores) ?? 0,
    filas,
    proveedores: opciones(r.proveedores),
    familias: opciones(r.familias),
    excluidos: excluidos(r.excluidos),
  };
}

// ─── Textos ─────────────────────────────────────────────────────────────────

/** «1.234» (sin decimales, con punto de millar también en 4 cifras). */
export const euros0 = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
/** «12,40» */
export const euros2 = (n: number): string => n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** «+14,6 %» / «−3 %» */
export function pct(n: number): string {
  const abs = Math.abs(n).toLocaleString("es-ES", { maximumFractionDigits: 1 });
  return `${n < 0 ? "−" : "+"}${abs} %`;
}
/** «250 kg», «1.956 ud», «12,5 l». */
export function cantidad(n: number, unidad: string): string {
  const v = n < 10 ? n.toLocaleString("es-ES", { maximumFractionDigits: 1 }) : euros0(n);
  return `${v} ${unidad}`;
}
/** «03/11/2026» a partir de «2026-11-03». */
export function fechaEs(iso: string | null): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

/** «hace 12 meses» */
export const textoMeses = (m: MesesInforme): string => `hace ${m} meses`;

/** Frase del total de subidas: solo lo fiable, y qué se queda fuera. */
export function resumenSubidas(i: InformeSubidas): string {
  const partes = [`${i.porConfianza.alta.n} fiables (+${euros0(i.porConfianza.alta.importe)} €) y ${i.porConfianza.media.n} probables (+${euros0(i.porConfianza.media.importe)} €)`];
  if (i.porConfianza.baja.n > 0) partes.push(`${i.porConfianza.baja.n} por revisar que no se suman`);
  if (i.bajadas.n > 0) partes.push(`${i.bajadas.n} bajadas restan ${euros0(Math.abs(i.bajadas.importe))} €`);
  return partes.join(" · ");
}

export function resumenBarato(i: InformeBarato): string {
  const partes = [`${i.porConfianza.alta.n} fiables (${euros0(i.porConfianza.alta.importe)} €) y ${i.porConfianza.media.n} probables (${euros0(i.porConfianza.media.importe)} €)`];
  if (i.porConfianza.baja.n > 0) partes.push(`${i.porConfianza.baja.n} por revisar que no se suman`);
  return partes.join(" · ");
}

/** «Comparar facturas» de una subida: [la de antes, la última], como en «Qué decidir hoy». */
export function notasSubida(f: FilaSubida): [NotaComparar, NotaComparar] {
  return [
    { etiqueta: `Factura del ${fechaEs(f.fechaRef)}`, linea: `${f.producto}: ${euros2(f.precioRef)} €/${f.unidad}` },
    { etiqueta: "Última factura", linea: `${f.producto}: ${euros2(f.precio)} €/${f.unidad}` },
  ];
}

/** «Ver las dos facturas» del proveedor más barato: [la tuya, la barata]. */
export function notasBarato(f: FilaBarato): [NotaComparar, NotaComparar] {
  return [
    { etiqueta: `Factura de ${proveedorCorto(f.proveedor)}`, linea: `${f.producto}: ${euros2(f.precio)} €/${f.unidad}` },
    { etiqueta: `Factura de ${proveedorCorto(f.proveedorBarato)} (más barato)`, linea: `${f.producto}: ${euros2(f.precioBarato)} €/${f.unidad}` },
  ];
}

export function productoDeFila(f: Pick<FilaSubida, "productoId" | "nombreNormalizado" | "producto">): ProductoBuscado {
  return { productoId: f.productoId, nombreNormalizado: f.nombreNormalizado, nombre: f.producto };
}

/** Las opciones de un filtro, juntando las de los dos bloques (sin repetir, por nombre). */
export function unirOpciones(a: OpcionFiltro[], b: OpcionFiltro[]): OpcionFiltro[] {
  const m = new Map<number, OpcionFiltro>();
  for (const o of [...a, ...b]) {
    const ya = m.get(o.id);
    m.set(o.id, ya ? { ...ya, n: ya.n + o.n } : o);
  }
  return [...m.values()].sort((x, y) => x.nombre.localeCompare(y.nombre, "es"));
}

/** Cuántas filas pedir al pulsar «Ver más» (tope de la RPC: 1000). */
export const siguienteLimite = (actual: number): number => Math.min(actual + PAGINA_INFORME, LIMITE_MAXIMO_INFORME);
