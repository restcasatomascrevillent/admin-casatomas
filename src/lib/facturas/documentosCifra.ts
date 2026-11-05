// ============================================================================
//  Facturas › Análisis — «Ver documentos» de una cifra (cuentas puras)
// ----------------------------------------------------------------------------
//  Desde cualquier cifra del tablero o del explorador se baja a los documentos
//  que la forman (RPC `documentos_de_cifra`, migración 20261105170000: la misma
//  tabla de hechos que `explorar_compras`, así que la suma cuadra). Al tocar un
//  documento se abre su PDF en un visor (vista previa de Drive o URL firmada
//  de Storage).
// ============================================================================
import { urlSegura } from "@/lib/url-segura";
import type { Agrupar, Desglose, LocalRpc, Medida } from "./explorador";

/** Qué cifra se ha tocado (los mismos parámetros que explorar_compras + la clave). */
export interface PeticionDocumentos {
  /** «Gasto con IVA · marzo 2026», para el título del panel. */
  titulo: string;
  /** Explicación corta: «Albaranes sin factura de Touza». */
  detalle?: string;
  desde: string | null;
  hasta: string | null;
  medida: Medida;
  agrupar: Agrupar | null;
  desglose: Desglose | null;
  filtros: Record<string, unknown>;
  clave: string | null;
  claveDesglose: string | null;
  top: number;
  /** La cifra que se tocó, para comprobar que cuadra. */
  cifra?: number | null;
}

export function peticionSimple(
  p: Omit<PeticionDocumentos, "agrupar" | "desglose" | "clave" | "claveDesglose" | "top" | "filtros"> & {
    filtros?: Record<string, unknown>;
    local?: LocalRpc;
    agrupar?: Agrupar | null;
    clave?: string | null;
  },
): PeticionDocumentos {
  const filtros = { ...(p.filtros ?? {}) };
  if (p.local) filtros.local = p.local;
  return {
    titulo: p.titulo,
    detalle: p.detalle,
    desde: p.desde,
    hasta: p.hasta,
    medida: p.medida,
    agrupar: p.agrupar ?? null,
    desglose: null,
    filtros,
    clave: p.clave ?? null,
    claveDesglose: null,
    top: 10,
    cifra: p.cifra,
  };
}

export function argumentosRpc(p: PeticionDocumentos, limite: number, desplazamiento: number): Record<string, unknown> {
  return {
    p_desde: p.desde,
    p_hasta: p.hasta,
    p_medida: p.medida,
    p_agrupar: p.agrupar,
    p_desglose: p.desglose,
    p_filtros: p.filtros,
    p_clave: p.clave,
    p_clave_desglose: p.claveDesglose,
    p_top: p.top,
    p_limite: limite,
    p_desplazamiento: desplazamiento,
  };
}

export type TipoDocumentoCifra = "factura" | "albaran" | "abono";

export interface DocumentoCifra {
  id: number;
  fecha: string | null;
  proveedor: string;
  proveedorId: number | null;
  numero: string | null;
  tipo: TipoDocumentoCifra;
  local: "casa_tomas" | "touza";
  total: number | null;
  aporta: number;
  cantidad: number | null;
  lineas: number | null;
  driveUrl: string | null;
  archivoPath: string | null;
}

export interface PaginaDocumentos {
  cifra: number | null;
  documentos: number;
  importeTotal: number;
  cantidadTotal: number | null;
  unidad: string | null;
  porLineas: boolean;
  filas: DocumentoCifra[];
  desplazamiento: number;
}

export class ErrorDocumentos extends Error {}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const numONulo = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const txtONulo = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export function normalizarPaginaDocumentos(entrada: unknown): PaginaDocumentos {
  const r = obj(entrada);
  if (typeof r.error === "string") throw new ErrorDocumentos(r.error);
  const filas: DocumentoCifra[] = [];
  for (const f of Array.isArray(r.filas) ? r.filas.map(obj) : []) {
    const id = Number(f.id);
    if (!Number.isInteger(id) || id <= 0) continue;
    filas.push({
      id,
      fecha: txtONulo(f.fecha),
      proveedor: txtONulo(f.proveedor) ?? "Sin proveedor",
      proveedorId: numONulo(f.proveedor_id),
      numero: txtONulo(f.numero_documento),
      tipo: f.tipo === "albaran" || f.tipo === "abono" ? f.tipo : "factura",
      local: f.local === "touza" ? "touza" : "casa_tomas",
      total: numONulo(f.total),
      aporta: numONulo(f.importe_aportado) ?? 0,
      cantidad: numONulo(f.cantidad),
      lineas: numONulo(f.lineas),
      driveUrl: txtONulo(f.drive_url),
      archivoPath: txtONulo(f.archivo_path),
    });
  }
  return {
    cifra: numONulo(r.cifra),
    documentos: numONulo(r.documentos) ?? 0,
    importeTotal: numONulo(r.importe_total) ?? 0,
    cantidadTotal: numONulo(r.cantidad_total),
    unidad: txtONulo(r.unidad),
    porLineas: r.por_lineas === true,
    filas,
    desplazamiento: numONulo(r.desplazamiento) ?? 0,
  };
}

export const ETIQUETA_TIPO: Record<TipoDocumentoCifra, string> = { factura: "Factura", albaran: "Albarán", abono: "Abono" };
export const ETIQUETA_LOCAL: Record<"casa_tomas" | "touza", string> = { casa_tomas: "Casa Tomás", touza: "Touza" };

/** ¿La cifra de la lista coincide con la que se tocó? (al céntimo; precios a la diezmilésima). */
export function cuadra(esperada: number | null | undefined, obtenida: number | null): boolean | null {
  if (esperada === null || esperada === undefined || obtenida === null) return null;
  return Math.abs(esperada - obtenida) < 0.006;
}

// ─── El original ────────────────────────────────────────────────────────────

/** Id de un fichero de Google Drive en sus formas habituales de URL. */
export function idDrive(url: string | null | undefined): string | null {
  const segura = urlSegura(url);
  if (!segura) return null;
  let u: URL;
  try {
    u = new URL(segura);
  } catch {
    return null;
  }
  if (!/(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$/.test(u.hostname)) return null;
  const ruta = /\/d\/([A-Za-z0-9_-]{10,})/.exec(u.pathname);
  if (ruta) return ruta[1];
  const q = u.searchParams.get("id");
  return q && /^[A-Za-z0-9_-]{10,}$/.test(q) ? q : null;
}

/** Vista previa incrustable de Drive (`/preview`), o null si la URL no es de Drive. */
export function vistaPreviaDrive(url: string | null | undefined): string | null {
  const id = idDrive(url);
  return id ? `https://drive.google.com/file/d/${id}/preview` : null;
}

export const esPdf = (ruta: string) => /\.pdf$/i.test(ruta.split("?")[0]);

/** Enlace a la ficha del documento en Compras. */
export const enlaceDocumentoCompras = (id: number) => `?tab=compras&modo=documentos&doc=${id}`;
