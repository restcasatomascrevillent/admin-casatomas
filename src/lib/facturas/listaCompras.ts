// ============================================================================
//  Facturas › Compras — la lista LIGERA de documentos (05/11/2026)
// ----------------------------------------------------------------------------
//  Antes la lista traía cada documento con TODAS sus líneas (≈ 5,9 MB y ~8,5 s
//  con el histórico) solo para calcular en el navegador tres cosas: el aviso
//  de precio atípico, el «regalado» y la búsqueda por producto. Desde la
//  migración 20261105190000 el servidor da las CABECERAS con eso ya calculado
//  (`documentos_lista()`, ≈ 0,5 MB en una sola respuesta), las líneas se piden
//  al abrir la ficha (`documento_compras(id)`) y la búsqueda por línea la hace
//  el servidor (`buscar_documentos_compras(texto)`).
//
//  Aquí, cuentas puras (sin React ni Supabase): decodificar la respuesta
//  compacta, sacar las cabeceras de documentos completos (si la migración aún
//  no está, la carga de antes), los avisos de una cabecera, el proveedor de la
//  lista y la copia guardada en el dispositivo para pintar al instante.
// ============================================================================
import type { AlertaValidacion, Factura, ProductoFactura } from "@/hooks/useFacturas";
import { avisosDocumento, indiceAnomaliasPrecio, indicePreciosLinea, precioAnomalo } from "@/components/facturas/shared/formatters";
import type { ProveedorResuelto, ResolverProveedor } from "./proveedores";
import { regaladoDocumento, type Regalado } from "./resumenCompras";

/** Un documento en la lista: la cabecera y lo calculado de sus líneas (sin las líneas). */
export interface CabeceraDocumento {
  id: number;
  tipo: string;
  numero_documento: string;
  proveedor: string | null;
  /** `facturas.proveedor_id`: el proveedor unificado (null sin la migración de proveedores). */
  proveedor_id: number | null;
  /** Nombre de ese proveedor unificado (`proveedores.nombre`). */
  proveedor_canonico: string | null;
  cif: string | null;
  fecha: string;
  facturado_en_id: number | null;
  local: "casa_tomas" | "touza" | null;
  subtotal: number | null;
  total: number | null;
  total_origen: "leido" | "deducido" | null;
  drive_url: string | null;
  archivo_path: string | null;
  verificada: boolean;
  verificacion_origen: "auto" | "manual" | null;
  /** Nº de líneas del documento. */
  n_lineas: number;
  /** Avisos guardados al procesarlo (solo código y severidad; el texto está en la ficha). */
  alertas: Pick<AlertaValidacion, "codigo" | "severidad">[];
  /** Regalado / descuentos del documento (sin IVA). */
  regalado: Regalado;
  /** Algún producto cuesta más del doble que en otros documentos del mismo proveedor y tipo. */
  precio_atipico: boolean;
  /** Retención de IRPF (20261106310000: docs[i][20]); null = sin retención o sin la migración. */
  retencion_irpf: number | null;
}

export const SIN_REGALADO: Regalado = Object.freeze({ importe: 0, estimado: false, regalos: 0 }) as Regalado;

/** El aviso que se añade cuando el servidor (o el cálculo de antes) ve un precio atípico. */
export const AVISO_PRECIO_ATIPICO: AlertaValidacion = {
  codigo: "precio_atipico_pagina",
  severidad: "media",
  mensaje: "Algún producto cuesta más del doble que en otros documentos cargados del mismo proveedor",
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const texto = (v: unknown): string | null => (typeof v === "string" ? v : v === null || v === undefined ? null : String(v));
const local = (v: unknown): CabeceraDocumento["local"] => (v === "casa_tomas" || v === "touza" ? v : null);
const origenTotal = (v: unknown): CabeceraDocumento["total_origen"] => (v === "leido" || v === "deducido" ? v : null);
const origenVerificacion = (v: unknown): CabeceraDocumento["verificacion_origen"] => (v === "auto" || v === "manual" ? v : null);

/**
 * Decodifica `documentos_lista()`: `{ v: 1, proveedores: {id: nombre}, docs: [[…]] }`
 * (orden de cada array: el de la migración 20261105190000). Lanza si no es eso.
 */
export function decodificarLista(crudo: unknown): CabeceraDocumento[] {
  const r = crudo as { v?: unknown; proveedores?: Record<string, unknown>; docs?: unknown } | null;
  if (!r || r.v !== 1 || !Array.isArray(r.docs)) throw new Error("Respuesta de documentos_lista() no reconocida");
  const nombres = r.proveedores ?? {};
  const salida: CabeceraDocumento[] = [];
  for (const fila of r.docs as unknown[][]) {
    if (!Array.isArray(fila)) continue;
    const proveedorId = num(fila[4]);
    const alertas = Array.isArray(fila[17])
      ? (fila[17] as unknown[][]).filter(Array.isArray).map((a) => ({ codigo: String(a[0] ?? ""), severidad: String(a[1] ?? "") }))
      : [];
    const reg = Array.isArray(fila[18]) ? (fila[18] as unknown[]) : null;
    salida.push({
      id: Number(fila[0]),
      tipo: String(fila[1] ?? ""),
      numero_documento: texto(fila[2]) ?? "",
      proveedor: texto(fila[3]),
      proveedor_id: proveedorId,
      proveedor_canonico: proveedorId !== null ? texto(nombres[String(proveedorId)]) : null,
      cif: texto(fila[5]),
      fecha: texto(fila[6]) ?? "",
      facturado_en_id: num(fila[7]),
      local: local(fila[8]),
      subtotal: num(fila[9]),
      total: num(fila[10]),
      total_origen: origenTotal(fila[11]),
      drive_url: texto(fila[12]),
      archivo_path: texto(fila[13]),
      verificada: fila[14] === true,
      verificacion_origen: origenVerificacion(fila[15]),
      n_lineas: num(fila[16]) ?? 0,
      alertas,
      regalado: reg ? { importe: num(reg[0]) ?? 0, estimado: reg[1] === true, regalos: num(reg[2]) ?? 0 } : SIN_REGALADO,
      precio_atipico: fila[19] === true,
      retencion_irpf: num(fila[20]) || null,
    });
  }
  return salida;
}

/**
 * Meses incompletos de `documentos_lista()` (migración 20261106310000): los
 * «AAAA-MM» con muchos menos documentos de lo normal (faltan facturas por
 * subir). Sin la migración, o si no viene, ninguno.
 */
export function decodificarMesesIncompletos(crudo: unknown): Set<string> {
  const lista = (crudo as { meses_incompletos?: unknown } | null)?.meses_incompletos;
  if (!Array.isArray(lista)) return new Set();
  const meses = lista
    .map((m) => (typeof m === "string" ? m : (m as { mes?: unknown } | null)?.mes))
    .filter((m): m is string => typeof m === "string" && /^\d{4}-\d{2}$/.test(m));
  return new Set(meses);
}

/** Cabecera de un documento COMPLETO (la carga de antes, sin la migración). */
export function cabeceraDeFactura(f: Factura, precioAtipico: boolean): CabeceraDocumento {
  return {
    id: f.id,
    tipo: f.tipo,
    numero_documento: f.numero_documento,
    proveedor: f.proveedor,
    proveedor_id: null,
    proveedor_canonico: null,
    cif: f.cif,
    fecha: f.fecha,
    facturado_en_id: f.facturado_en_id ?? null,
    local: f.local ?? null,
    subtotal: f.subtotal,
    total: f.total,
    total_origen: f.total_origen,
    drive_url: f.drive_url,
    archivo_path: f.archivo_path,
    verificada: f.verificada,
    verificacion_origen: f.verificacion_origen ?? null,
    n_lineas: f.productos.length,
    alertas: f.alertas.map((a) => ({ codigo: a.codigo, severidad: a.severidad })),
    regalado: regaladoDocumento(f),
    precio_atipico: precioAtipico,
    retencion_irpf: f.retencion_irpf ?? null,
  };
}

/**
 * Sin la migración: de las facturas y albaranes completos, sus cabeceras (con
 * el precio atípico calculado como siempre, cada tipo con los suyos) y cada
 * documento con la media de referencia de sus líneas ya puesta (la ficha la usa).
 */
export function listaDesdeCompletos(facturas: Factura[], albaranes: Factura[]): { cabeceras: CabeceraDocumento[]; completos: Map<number, Factura> } {
  const cabeceras: CabeceraDocumento[] = [];
  const completos = new Map<number, Factura>();
  for (const grupo of [facturas, albaranes]) {
    const media = indicePreciosLinea(grupo);
    const anomalia = indiceAnomaliasPrecio(grupo, media);
    for (const f of grupo) {
      cabeceras.push(cabeceraDeFactura(f, anomalia(f)));
      completos.set(f.id, { ...f, productos: f.productos.map((p) => ({ ...p, media_referencia: media(p, f) ?? null })) });
    }
  }
  cabeceras.sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? "") || b.id - a.id);
  return { cabeceras, completos };
}

/** Avisos de una fila de la lista: los guardados más el de precio atípico (para contarlos y filtrar). */
export function avisosCabecera(d: Pick<CabeceraDocumento, "alertas" | "precio_atipico">): Pick<AlertaValidacion, "codigo" | "severidad">[] {
  return d.precio_atipico ? [...d.alertas, AVISO_PRECIO_ATIPICO] : d.alertas;
}

/** Avisos de la FICHA (documento completo): los guardados y, si alguna línea pasa del doble de su media, el de precio. */
export function avisosFicha(doc: Factura): AlertaValidacion[] {
  return avisosDocumento(doc, [], (d) => d.productos.some((p) => precioAnomalo(p.precio_unitario, p.media_referencia ?? undefined)));
}

/** Media de referencia de cada línea de la ficha (la que trae el servidor). */
export const mediaDeLinea = (p: Pick<ProductoFactura, "media_referencia">): number | undefined => p.media_referencia ?? undefined;

/**
 * Resolver de proveedor para la lista: cada texto de proveedor de un documento,
 * a SU proveedor unificado (el `proveedor_id` del documento); lo que no esté,
 * con `base` (el resolver de `proveedores_listado()` o el de texto). Así la
 * lista enseña el nombre unificado sin esperar a la lista de proveedores.
 */
export function crearResolverDeLista(cabeceras: CabeceraDocumento[], base: ResolverProveedor): ResolverProveedor {
  const porTexto = new Map<string, ProveedorResuelto>();
  for (const d of cabeceras) {
    if (d.proveedor && d.proveedor_id !== null && d.proveedor_canonico && !porTexto.has(d.proveedor)) {
      porTexto.set(d.proveedor, { clave: `#${d.proveedor_id}`, nombre: d.proveedor_canonico });
    }
  }
  if (porTexto.size === 0) return base;
  return (t) => porTexto.get(t) ?? base(t);
}

/**
 * ¿Merece la pena reintentar? No si el error es definitivo (QA 05/11/2026):
 * sin permiso (42501), petición mal hecha o recurso inexistente (HTTP 4xx,
 * códigos `PGRST…`, errores de datos `22…`/`23…`). Sí los de red o 5xx.
 */
export function errorDefinitivo(error: unknown): boolean {
  const e = error as { code?: unknown; status?: unknown } | null;
  if (!e || typeof e !== "object") return false;
  const code = typeof e.code === "string" ? e.code : "";
  if (code === "42501" || /^PGRST/.test(code) || /^2[23]/.test(code) || code === "42883" || code === "42P01") return true;
  const status = typeof e.status === "number" ? e.status : null;
  return status !== null && status >= 400 && status < 500;
}

/** `retry` de react-query para Compras: hasta 2 reintentos, nunca con un error definitivo. */
export const reintentarConsulta = (fallos: number, error: unknown): boolean => fallos < 2 && !errorDefinitivo(error);

/** El texto técnico de un error (para el «Detalle» plegado; nunca como mensaje principal). */
export function detalleError(error: unknown): string {
  const e = error as { message?: unknown; code?: unknown } | null;
  const msg = typeof e?.message === "string" && e.message ? e.message : "error desconocido";
  return typeof e?.code === "string" && e.code ? `${msg} (${e.code})` : msg;
}

/** ¿El error es que falta la función (migración 20261105190000 sin aplicar)? */
export function faltaFuncionCompras(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  return /(documentos_lista|documento_compras|buscar_documentos_compras)/i.test(error.message ?? "") && /does not exist|not find|schema cache|no existe/i.test(error.message ?? "");
}
