// ============================================================================
//  guardado.ts · Guardar un documento ya extraído (compartido)
// ----------------------------------------------------------------------------
//  Pasos 4-9 del camino síncrono (index.ts v101 :1393-1463 + completarFactura
//  + compensarFacturaHuerfana), extraídos para que los use también
//  ocr-trabajo (multipágina / franjas), y la SUSTITUCIÓN EN SITIO de una
//  factura existente (decisión del dueño, 05-oct-2026, opción b de Q2).
//  Sin Deno.env: recibe cliente de Supabase, cliente de OpenAI y Drive.
// ============================================================================

import type { OrigenImporte } from "./esquema.ts";
import type { DatosNormalizados } from "./extraccion.ts";
import { type ClienteOpenAI, vec } from "./openai.ts";
import { costeDeCliente, guardarCosteLectura, leerCosteTrabajo, sumarCostes } from "./costeLectura.ts";
import {
  archivarDesdeStorage,
  archivarOriginal,
  type ConfigDrive,
  driveActivo,
  limpiarPendientesTrabajo,
  marcarPendienteDrive,
  type ResultadoArchivo,
  rutaTemporal,
  STORAGE_BUCKET,
} from "./archivo.ts";
import { decidirCoincidencia, leerPagina, type PaginaDocumento } from "./paginasDocumento.ts";

// deno-lint-ignore no-explicit-any
type Supa = any;
// deno-lint-ignore no-explicit-any
type Alerta = Record<string, any>;

export interface ContextoGuardado {
  supabase: Supa;
  openai: ClienteOpenAI;
  drive: ConfigDrive;
}

export type OriginalDocumento =
  | { tipo: "base64"; b64: string; mime: string; nombre: string }
  | { tipo: "storage"; path: string; mime: string; nombre: string };

export interface EntradaGuardado {
  datos: DatosNormalizados;
  alertasPrevias: Alerta[];
  totalOrigen: OrigenImporte | null;
  original: OriginalDocumento;
  /** Páginas del documento (facturas.paginas). */
  paginas?: number;
  /** Trabajo de OCR que lo produce (facturas.ocr_trabajo_id, UNIQUE). */
  ocrTrabajoId?: string | null;
  /**
   * El documento viene COMPLETO (importación histórica, 04/11/2026): no se
   * busca «página x/y» en las observaciones para marcarlo como página suelta.
   */
  documentoCompleto?: boolean;
  /** Columnas extra de la cabecera, en el MISMO insert (importación: local, import_clave). */
  cabeceraExtra?: Record<string, unknown>;
}

/** Resumen de la factura que ya existe (ocr_factura_existente). */
export interface ResumenExistente {
  id: number;
  numero_documento: string;
  proveedor: string | null;
  cif?: string | null;
  fecha: string | null;
  total: number | null;
  total_origen: string | null;
  tipo?: string;
  lineas: number;
  historial?: number;
  alertas: number;
  alertas_graves: number;
  archivo_path?: string | null;
  updated_at?: string | null;
  motivo?: string | null;
  /** 20261010150000: para no ofrecer «Sustituir» entre páginas distintas. */
  paginas?: number | null;
  paginas_lineas?: number[] | null;
  totales_lineas?: (number | null)[] | null;
  trabajo_pendiente?: boolean | null;
  created_at?: string | null;
}

/** «Añadir como página x a la factura N» (en vez de duplicado). */
export interface Anadible {
  trabajo_id: string;
  existente: ResumenExistente;
  pagina: PaginaDocumento;
  nuevo: ReturnType<typeof resumenNuevo>;
}

export interface RespuestaProcesado {
  success: true;
  nombre: string;
  tipo: string;
  duplicado?: boolean;
  sustituida?: boolean;
  /** USD que costó leer este documento (todas sus llamadas a OpenAI). Lo pinta «Cargar». */
  coste_usd?: number;
  message: string;
  alertas: Alerta[];
  archivo_guardado: boolean;
  archivo_error: string | null;
  /** Dónde quedó el original (QA 05/11/2026, UI-8). Solo en documentos guardados. */
  archivo_estado?: EstadoArchivo;
  webhookResponse: Record<string, unknown>;
  /** Solo si duplicado: lo que el panel necesita para «Sustituir la existente». */
  sustituible?: {
    trabajo_id: string;
    existente: ResumenExistente;
    nuevo: { total: number | null; total_origen: OrigenImporte | null; lineas: number; alertas: number; proveedor: string | null; fecha: string };
  } | null;
  /** Es otra página de un documento que ya existe: se ofrece añadirla (nunca sustituir). */
  anadible?: Anadible | null;
  /** Por qué no se ofrece «Sustituir» (si no se ofrece). */
  motivo_no_sustituible?: string | null;
  /** Página añadida a una factura existente. */
  pagina_anadida?: boolean;
}

export type ResultadoGuardado =
  | { estado: "guardado"; facturaId: number; respuesta: RespuestaProcesado }
  | { estado: "duplicado"; existente: ResumenExistente | null; respuesta: RespuestaProcesado };

const COLUMNAS_04B = /\b(paginas|ocr_trabajo_id|pagina|orden|albaran_ref)\b/;
/** ¿El error es de una columna que aún no existe (migración 20261005120000 sin aplicar)? */
export function esColumnaNueva(msg: string | undefined | null): boolean {
  return !!msg && /column|columna|schema cache/i.test(msg) && COLUMNAS_04B.test(msg);
}

/** Paso 4: ¿existe ya? Usa ocr_factura_existente (número normalizado) y, si la
 *  migración no está aplicada, el verificar_duplicado_factura de siempre. */
export async function buscarExistente(supabase: Supa, d: DatosNormalizados): Promise<ResumenExistente | null> {
  const { data, error } = await supabase.rpc("ocr_factura_existente", {
    p_numero: d.numero_documento,
    p_proveedor: d.proveedor ?? "",
    p_cif: d.cif ?? null,
    p_fecha: d.fecha,
    p_total: d.total ?? 0,
  });
  if (!error) return (data as ResumenExistente | null) ?? null;
  console.warn("[duplicado] ocr_factura_existente no disponible, se usa verificar_duplicado_factura:", error.message);
  const { data: dup, error: dupErr } = await supabase.rpc("verificar_duplicado_factura", {
    p_numero_documento: d.numero_documento,
    p_proveedor: d.proveedor ?? "",
    p_fecha: d.fecha,
    p_total: d.total ?? 0,
  });
  if (dupErr) throw new Error(`verificar_duplicado_factura: ${dupErr.message}`);
  if (dup?.es_duplicado !== true) return null;
  const f = dup.factura_existente ?? {};
  return {
    id: Number(f.id),
    numero_documento: f.numero_documento,
    proveedor: f.proveedor ?? null,
    fecha: f.fecha ?? null,
    total: f.total === null || f.total === undefined ? null : Number(f.total),
    total_origen: f.total_origen ?? null,
    lineas: 0,
    alertas: Array.isArray(f.alertas_validacion) ? f.alertas_validacion.length : 0,
    alertas_graves: Array.isArray(f.alertas_validacion)
      ? f.alertas_validacion.filter((a: Alerta) => a?.severidad === "alta").length
      : 0,
    motivo: dup.motivo ?? null,
  };
}

/** Número provisional de una nota sin número: `SN-<PROVEEDOR>-<AAAAMMDD>` (extracción, 10/10/2026). */
export function esNumeroProvisional(n: string | null | undefined): boolean {
  return typeof n === "string" && /^SN-/i.test(n.trim());
}

const MAX_SUFIJO_PROVISIONAL = 9;

/**
 * Dos notas sin número del mismo proveedor y día tendrían el mismo número
 * provisional (y chocarían con el UNIQUE numero_documento + proveedor). Se
 * prueba `SN-…`, `SN-…-2`, `SN-…-3`…: si una ya existe con el MISMO total es
 * la misma nota (duplicado); si no, se usa el primer número libre (cambia
 * `d.numero_documento`). Devuelve el duplicado o null.
 */
export async function numeroProvisionalLibre(supabase: Supa, d: DatosNormalizados): Promise<ResumenExistente | null> {
  const base = d.numero_documento.trim();
  for (let k = 1; k <= MAX_SUFIJO_PROVISIONAL; k++) {
    const numero = k === 1 ? base : `${base}-${k}`;
    const ex = await buscarExistente(supabase, { ...d, numero_documento: numero });
    const mismoNumero = !!ex && String(ex.numero_documento ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase() ===
      numero.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (!ex || !mismoNumero) {
      d.numero_documento = numero;
      return null;
    }
    const mismoTotal = ex.total !== null && d.total !== null && Math.abs(Number(ex.total) - Number(d.total)) < 0.01;
    if (mismoTotal) return ex;
  }
  d.numero_documento = `${base}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
  return null;
}

function textoEmbedding(d: DatosNormalizados): string {
  return d.resumen
    ? d.resumen
    : `${d.tipo} de ${d.proveedor || "proveedor desconocido"}, ${d.fecha}, total ${d.total}€. Productos: ${
      d.productos.map((p) => p.nombre).join(", ")
    }`;
}

function filasProductos(
  d: DatosNormalizados,
  embeddings: number[][],
  conColumnas04b: boolean,
  conBultos = true,
  conIvaPct = true,
) {
  return igualarColumnasValor(filasProductosSinIgualar(d, embeddings, conColumnas04b, conBultos, conIvaPct));
}

/**
 * En un insert por lotes, PostgREST toma la unión de claves de todas las filas
 * y pone NULL (no el DEFAULT) en las que no la traen. `importe_bruto_estimado`
 * es NOT NULL: si alguna línea trae el valor sin descuento, todas deben traer
 * las tres columnas. Si ninguna las trae (OCR), no se añaden.
 */
export function igualarColumnasValor<T extends Record<string, unknown>>(filas: T[]): T[] {
  const alguna = filas.some((f) => "importe_bruto" in f || "descuento_pct" in f);
  if (!alguna) return filas;
  return filas.map((f) => ({
    descuento_pct: null,
    importe_bruto: null,
    importe_bruto_estimado: false,
    ...f,
  }));
}

function filasProductosSinIgualar(
  d: DatosNormalizados,
  embeddings: number[][],
  conColumnas04b: boolean,
  conBultos = true,
  conIvaPct = true,
) {
  return d.productos.map((p, i) => ({
    nombre: p.nombre,
    cantidad: p.cantidad,
    unidad: p.unidad,
    precio_unitario: p.precio_unitario,
    total: p.total,
    embedding: embeddings[i] ? vec(embeddings[i]) : null,
    ...(conColumnas04b ? { pagina: p.pagina ?? 1, orden: p.orden ?? i, albaran_ref: p.albaran_ref ?? null } : {}),
    // Unidades/bultos de una línea guardada por peso (migración
    // 20261005150000). Solo se manda si hay valor: un documento sin líneas al
    // peso se guarda igual aunque la columna aún no exista.
    ...(conBultos && p.bultos !== null && p.bultos !== undefined ? { bultos: p.bultos } : {}),
    // Tipo de IVA impreso en la línea (migración 20261006105000). Igual que
    // `bultos`: solo si hay valor, para no depender de que la columna exista.
    ...(conIvaPct && p.iva_pct !== null && p.iva_pct !== undefined ? { iva_pct: p.iva_pct } : {}),
    // Valor sin descuento (migración 20261104170000). Solo lo trae la
    // importación histórica: el OCR no lo rellena y no depende de la columna.
    ...valorSinDescuento(p),
  }));
}

/** descuento_pct / importe_bruto / importe_bruto_estimado de la línea, solo si vienen. */
export function valorSinDescuento(p: unknown): Record<string, number | boolean> {
  const l = p as { descuento_pct?: unknown; importe_bruto?: unknown; importe_bruto_estimado?: unknown };
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  return {
    ...(num(l.descuento_pct) ? { descuento_pct: l.descuento_pct as number } : {}),
    ...(num(l.importe_bruto)
      ? { importe_bruto: l.importe_bruto as number, importe_bruto_estimado: l.importe_bruto_estimado === true }
      : {}),
  };
}

/** ¿El error es que falta la columna `bultos` (migración 20261005150000 sin aplicar)? */
export function faltaColumnaBultos(msg: string | undefined | null): boolean {
  return !!msg && /bultos/i.test(msg) && /column|columna|schema cache/i.test(msg);
}

/** ¿El error es que falta la columna `iva_pct` (migración 20261006105000 sin aplicar)? */
export function faltaColumnaIvaPct(msg: string | undefined | null): boolean {
  return !!msg && /iva_pct/i.test(msg) && /column|columna|schema cache/i.test(msg);
}

/** Mezcla alertas pre-guardado con las de validar_cordura_factura (manda SQL por código). */
export async function validarYGuardarAlertas(supabase: Supa, facturaId: number, previas: Alerta[]): Promise<Alerta[]> {
  let alertas: Alerta[] = [];
  try {
    const { data, error } = await supabase.rpc("validar_cordura_factura", { p_factura_id: facturaId });
    if (error) throw new Error(error.message);
    const sql = Array.isArray(data) ? data : [];
    const codigosSql = new Set(sql.map((a: Alerta) => a?.codigo));
    alertas = [...sql, ...previas.filter((a) => !codigosSql.has(a?.codigo))];
  } catch (e) {
    console.error("[validacion] Error validando importes:", e);
    alertas = previas;
  }
  const { error: updErr } = await supabase.from("facturas")
    .update({ alertas_validacion: alertas.length > 0 ? alertas : null }).eq("id", facturaId);
  if (updErr) console.error("[validacion] No se pudieron guardar las alertas:", updErr.message);
  return alertas;
}

/**
 * Guarda en la factura dónde quedó su original (drive_url, o archivo_path
 * temporal + «pendiente de Drive») y devuelve lo que se cuenta al panel.
 */
export async function apuntarOriginal(
  supabase: Supa,
  facturaId: number,
  a: ResultadoArchivo,
  opciones: { esperaMs?: number } = {},
): Promise<{ ok: boolean; error: string | null; estado: EstadoArchivo }> {
  if (a.drive_url || a.archivo_path) {
    // QA 05/11/2026 (S-7): si el UPDATE falla, la factura NO apunta a su
    // original aunque esté en Drive. Se reintenta (un corte puntual) en vez
    // de volver a subir otra copia, y si no hay manera se devuelve el error.
    const cambios = a.drive_url ? { drive_url: a.drive_url, archivo_path: null } : { archivo_path: a.archivo_path };
    let ultimo: string | null = null;
    for (let intento = 0; intento < 3; intento++) {
      if (intento > 0) await new Promise((r) => setTimeout(r, (opciones.esperaMs ?? 500) * intento));
      const { error } = await supabase.from("facturas").update(cambios).eq("id", facturaId);
      if (!error) {
        ultimo = null;
        break;
      }
      ultimo = error.message ?? String(error);
      console.error(`[archivo] No se pudo guardar la referencia al original de la factura ${facturaId} (intento ${intento + 1}):`, ultimo);
    }
    if (ultimo) {
      const donde = a.drive_url ? `está en Drive: ${a.drive_url}` : `copia temporal en ${a.archivo_path}`;
      console.error(`[archivo] PERDIDA DE LA REFERENCIA AL ORIGINAL de la factura ${facturaId} (${donde})`);
      return { ok: false, estado: "perdido", error: `no se pudo apuntar el original en la factura (${ultimo}); ${donde}` };
    }
  }
  if (!a.drive_url && a.archivo_path) await marcarPendienteDrive(supabase, facturaId, a.drive_error);
  return {
    ok: !!(a.drive_url || a.archivo_path),
    estado: a.drive_url ? "drive" : a.archivo_path ? "temporal" : "perdido",
    error: a.error ?? (a.drive_error ? `original pendiente de subir a Drive (${a.drive_error})` : null),
  };
}

/** Dónde quedó el original: Drive, copia temporal (pendiente de Drive) o en ningún sitio. */
export type EstadoArchivo = "drive" | "temporal" | "perdido";

function respuestaExito(
  d: DatosNormalizados,
  nombre: string,
  facturaId: number,
  alertas: Alerta[],
  totalOrigen: OrigenImporte | null,
  archivo: { ok: boolean; error: string | null; estado?: EstadoArchivo },
  extra: Partial<RespuestaProcesado> = {},
): RespuestaProcesado {
  const graves = alertas.filter((a) => a?.severidad === "alta").length;
  return {
    success: true,
    nombre,
    tipo: d.tipo,
    message: alertas.length > 0
      ? `Documento procesado. Revisa ${alertas.length} aviso(s) sobre los importes.`
      : "Documento procesado correctamente",
    alertas,
    archivo_guardado: archivo.ok,
    archivo_error: archivo.error,
    archivo_estado: archivo.estado ?? (archivo.ok ? (archivo.error ? "temporal" : "drive") : "perdido"),
    webhookResponse: {
      tipo: d.tipo,
      numero_documento: d.numero_documento,
      proveedor: d.proveedor,
      total: d.total,
      total_origen: totalOrigen,
      factura_id: facturaId,
      alertas: alertas.length,
      alertas_graves: graves,
      archivo_guardado: archivo.ok,
    },
    ...extra,
  };
}

/**
 * Deshace una factura que quedó a medias (cabecera insertada, resto fallido).
 * Best-effort: nunca enmascara el error original (ver index.ts v101).
 */
export async function compensarFacturaHuerfana(supabase: Supa, facturaId: number, causa: unknown): Promise<void> {
  const causaMsg = causa instanceof Error ? causa.message : String(causa);
  try {
    const { error: e1 } = await supabase.from("productos_factura").delete().eq("factura_id", facturaId);
    if (e1) console.error(`[compensacion] factura ${facturaId}: fallo borrando productos_factura: ${e1.message}`);
    // historial_precios.factura_id NO tiene ON DELETE CASCADE: el trigger lo
    // rellenó al insertar las líneas, así que hay que vaciarlo antes.
    const { error: e2 } = await supabase.from("historial_precios").delete().eq("factura_id", facturaId);
    if (e2) console.error(`[compensacion] factura ${facturaId}: fallo borrando historial_precios: ${e2.message}`);
    const { error: e3 } = await supabase.from("facturas").delete().eq("id", facturaId);
    if (e3) {
      console.error(
        `[compensacion] FALLO AL LIMPIAR: la factura ${facturaId} quedó huérfana y NO se pudo borrar: ${e3.message}. ` +
          `Revisar y borrar a mano. Causa original: ${causaMsg}`,
      );
      return;
    }
    console.warn(`[compensacion] factura ${facturaId} deshecha tras un fallo posterior al insert. Causa: ${causaMsg}`);
  } catch (e) {
    console.error(`[compensacion] FALLO AL LIMPIAR la factura ${facturaId}: ${e}. Causa original: ${causaMsg}`);
  }
}

/**
 * Pasos 4-9: duplicado → embeddings → insert cabecera → líneas → validación →
 * archivo. Si el documento ya existe devuelve «duplicado» (sin escribir nada).
 */
export async function guardarDocumento(ctx: ContextoGuardado, e: EntradaGuardado): Promise<ResultadoGuardado> {
  const { supabase, openai } = ctx;
  const d = e.datos;

  // Idempotencia multipágina: si este trabajo ya guardó su factura (reintento
  // tras un corte), se devuelve esa en vez de crear otra.
  if (e.ocrTrabajoId) {
    const { data: ya, error: eYa } = await supabase.from("facturas")
      .select("id, drive_url, archivo_path").eq("ocr_trabajo_id", e.ocrTrabajoId).maybeSingle();
    if (eYa) throw new Error(`No se pudo comprobar si el documento ya se guardó: ${eYa.message}`);
    if (ya?.id) return await completarGuardada(ctx, e, ya);
  }

  // 4) Duplicado (las notas sin número llevan uno provisional, ver abajo)
  const existente = esNumeroProvisional(d.numero_documento)
    ? await numeroProvisionalLibre(supabase, d)
    : await buscarExistente(supabase, d);
  if (existente) {
    console.log(`[procesar-factura] DUPLICADO: ${d.numero_documento} (ya existe la factura ${existente.id})`);
    return {
      estado: "duplicado",
      existente,
      respuesta: {
        success: true,
        nombre: e.original.nombre,
        tipo: d.tipo,
        duplicado: true,
        message: "El documento ya existía (duplicado)",
        alertas: [],
        archivo_guardado: false,
        archivo_error: null,
        webhookResponse: { tipo: d.tipo, numero_documento: d.numero_documento, duplicado: true, factura_existente_id: existente.id },
      },
    };
  }

  // Página suelta de un documento de varias («Página 2/2»): sus líneas llevan
  // su número de página (así, al llegar las demás, se sabe cuáles faltan) y
  // un aviso de que faltan las otras.
  const pagSuelta = !e.documentoCompleto && (e.paginas ?? 1) <= 1 ? leerPagina(d) : null;
  const alertasPrevias = pagSuelta ? [...e.alertasPrevias, alertaPaginaSuelta(pagSuelta)] : e.alertasPrevias;
  if (pagSuelta) d.productos = d.productos.map((p) => ({ ...p, pagina: pagSuelta.actual }));

  // 5) Embedding de la factura
  const [embFactura] = await openai.embed(textoEmbedding(d));

  // 6) Cabecera
  const cabecera = {
    tipo: d.tipo,
    proveedor: d.proveedor,
    cif: d.cif,
    numero_documento: d.numero_documento,
    fecha: d.fecha,
    subtotal: d.subtotal,
    iva: d.iva,
    total: d.total,
    total_origen: e.totalOrigen,
    observaciones: d.observaciones,
    resumen: d.resumen,
    embedding: vec(embFactura),
    verificada: false,
    procesado_en: new Date().toISOString(),
  };
  const extra04b = { paginas: Math.min(20, Math.max(1, e.paginas ?? 1)), ...(e.ocrTrabajoId ? { ocr_trabajo_id: e.ocrTrabajoId } : {}) };
  let conColumnas04b = true;
  const extra = e.cabeceraExtra ?? {};
  let ins = await supabase.from("facturas").insert({ ...cabecera, ...extra04b, ...extra }).select("id").single();
  if (ins.error && esColumnaNueva(ins.error.message) && !e.ocrTrabajoId) {
    // Migración 20261005120000 sin aplicar: el camino de una página sigue
    // funcionando como en v101 (sin pagina/orden).
    console.warn("[procesar-factura] columnas 04b ausentes; se guarda sin ellas:", ins.error.message);
    conColumnas04b = false;
    ins = await supabase.from("facturas").insert({ ...cabecera, ...extra }).select("id").single();
  }
  if (ins.error) throw new Error(`insert factura: ${ins.error.message}`);
  const facturaId: number = ins.data.id;

  try {
    // 7) Líneas (embeddings en lotes de 100)
    await insertarLineas(ctx, facturaId, d, conColumnas04b);

    // 8) Validación de cordura
    const alertas = await validarYGuardarAlertas(supabase, facturaId, alertasPrevias);

    // 9) Original: a Drive (carpeta del proveedor → mes). Storage solo como
    //    copia TEMPORAL si Drive falla (el cron facturas-originales-drive la
    //    sube después y la borra).
    const archivo = await archivarYApuntar(ctx, e, facturaId);

    console.log(
      `[procesar-factura] OK ${d.tipo} ${d.numero_documento} · ${d.productos.length} productos · alertas: ${alertas.length}`,
    );
    return { estado: "guardado", facturaId, respuesta: respuestaExito(d, e.original.nombre, facturaId, alertas, e.totalOrigen, archivo) };
  } catch (err) {
    await compensarFacturaHuerfana(supabase, facturaId, err);
    throw err;
  }
}

/** Paso 7: líneas con sus embeddings. Un solo INSERT (todas o ninguna). */
async function insertarLineas(ctx: ContextoGuardado, facturaId: number, d: DatosNormalizados, conColumnas04b: boolean): Promise<void> {
  if (d.productos.length === 0) return;
  const { supabase, openai } = ctx;
  const embs = await openai.embed(d.productos.map((p) => p.nombre));
  const insertar = (conBultos: boolean, conIvaPct: boolean) =>
    supabase.from("productos_factura")
      .insert(
        filasProductos(d, embs, conColumnas04b, conBultos, conIvaPct).map((f) => ({ factura_id: facturaId, ...f })),
      );
  // Columnas opcionales que puede faltar por migrar: se quita la que falte
  // y se reintenta (a lo sumo una vez por columna).
  let conBultos = true;
  let conIvaPct = true;
  let { error } = await insertar(conBultos, conIvaPct);
  for (let i = 0; i < 2 && error; i++) {
    if (conBultos && faltaColumnaBultos(error.message)) {
      console.warn("[procesar-factura] columna bultos ausente; se guardan las líneas sin ella:", error.message);
      conBultos = false;
    } else if (conIvaPct && faltaColumnaIvaPct(error.message)) {
      console.warn("[procesar-factura] columna iva_pct ausente; se guardan las líneas sin ella:", error.message);
      conIvaPct = false;
    } else break;
    ({ error } = await insertar(conBultos, conIvaPct));
  }
  if (error) throw new Error(`insert productos: ${error.message}`);
}

/** Paso 9: el original a Drive (o copia temporal) y la referencia en la factura. */
async function archivarYApuntar(
  ctx: ContextoGuardado,
  e: EntradaGuardado,
  facturaId: number,
): Promise<{ ok: boolean; error: string | null; estado: EstadoArchivo }> {
  const { supabase } = ctx;
  const d = e.datos;
  if (e.original.tipo === "base64" && !e.original.b64) {
    return { ok: false, estado: "perdido", error: "el original ya no estaba disponible para archivarlo" };
  }
  const proveedorCarpeta = driveActivo(ctx.drive) ? await nombreProveedorFactura(supabase, facturaId, d.proveedor) : null;
  const a: ResultadoArchivo = e.original.tipo === "base64"
    ? await archivarOriginal(
      ctx.drive, supabase, e.original.b64, e.original.nombre, e.original.mime, d.fecha, facturaId, proveedorCarpeta,
    )
    : await archivarDesdeStorage(
      ctx.drive, supabase, e.original.path, e.original.nombre, e.original.mime, d.fecha, facturaId, proveedorCarpeta,
    );
  return await apuntarOriginal(supabase, facturaId, a);
}

/**
 * Reintento de un trabajo cuya factura YA se insertó (la consolidación murió
 * a medias). QA 05/11/2026:
 *  - S-2: si se cortó entre la cabecera y las líneas, la factura no tiene
 *    líneas: se insertan ahora (el INSERT de líneas es uno: todas o ninguna).
 *  - S-1: si se cortó antes de apuntar el original, la factura no tiene ni
 *    drive_url ni archivo_path: se archiva ahora. Antes se daba por guardado
 *    y la limpieza borraba el ÚNICO original.
 */
async function completarGuardada(
  ctx: ContextoGuardado,
  e: EntradaGuardado,
  ya: { id: number; drive_url?: string | null; archivo_path?: string | null },
): Promise<ResultadoGuardado> {
  const { supabase } = ctx;
  const d = e.datos;
  if (d.productos.length > 0) {
    const { count, error } = await supabase.from("productos_factura")
      .select("id", { count: "exact", head: true }).eq("factura_id", ya.id);
    if (error) throw new Error(`No se pudieron contar las líneas de la factura ${ya.id}: ${error.message}`);
    if (!count) {
      console.warn(`[procesar-factura] factura ${ya.id} sin líneas tras un corte: se insertan ahora (${d.productos.length})`);
      await insertarLineas(ctx, ya.id, d, true);
    }
  }
  const alertas = await validarYGuardarAlertas(supabase, ya.id, e.alertasPrevias);
  let archivo: { ok: boolean; error: string | null; estado: EstadoArchivo };
  if (ya.drive_url) archivo = { ok: true, error: null, estado: "drive" };
  else if (ya.archivo_path) archivo = { ok: true, error: "original pendiente de subir a Drive", estado: "temporal" };
  else {
    console.warn(`[procesar-factura] factura ${ya.id} sin original tras un corte: se archiva ahora`);
    archivo = await archivarYApuntar(ctx, e, ya.id);
  }
  return {
    estado: "guardado",
    facturaId: ya.id,
    respuesta: respuestaExito(d, e.original.nombre, ya.id, alertas, e.totalOrigen, archivo),
  };
}

export const CODIGO_PAGINA_SUELTA = "pagina_suelta";

export function alertaPaginaSuelta(p: PaginaDocumento): Alerta {
  return {
    codigo: CODIGO_PAGINA_SUELTA,
    severidad: "media",
    mensaje: `Es la página ${p.actual} de ${p.total} y las demás no están: súbelas y se ofrecerá añadirlas a este documento.`,
    pagina: p,
  };
}

// ─── Duplicado pendiente de sustituir ───────────────────────────────────────

export interface DocumentoPendiente {
  datos: DatosNormalizados;
  alertasPrevias: Alerta[];
  totalOrigen: OrigenImporte | null;
  paginas: number;
  existente: ResumenExistente;
  /** Si es OTRA página de la existente: cuál (se añade, nunca se sustituye). */
  pagina?: PaginaDocumento | null;
}

/**
 * Qué se ofrece para un documento pendiente: «Añadir como página x» (otra
 * página del mismo documento), «Sustituir la existente» (solo si es seguro)
 * o nada (duplicado sin más). Rellena `pendiente.pagina`.
 */
export function ofertasDuplicado(pendiente: DocumentoPendiente, trabajoId: string): {
  sustituible: NonNullable<RespuestaProcesado["sustituible"]> | null;
  anadible: Anadible | null;
  motivo: string | null;
} {
  const dec = decidirCoincidencia(
    { ...pendiente.datos, paginas: pendiente.paginas },
    { ...pendiente.existente, lineas: Number(pendiente.existente.lineas ?? 0) },
  );
  const nuevo = resumenNuevo(pendiente);
  if (dec.tipo === "pagina") {
    pendiente.pagina = dec.pagina;
    return { sustituible: null, anadible: { trabajo_id: trabajoId, existente: pendiente.existente, pagina: dec.pagina, nuevo }, motivo: null };
  }
  pendiente.pagina = null;
  return {
    sustituible: dec.sustituible ? { trabajo_id: trabajoId, existente: pendiente.existente, nuevo } : null,
    anadible: null,
    motivo: dec.motivo,
  };
}

export function resumenNuevo(p: Pick<DocumentoPendiente, "datos" | "alertasPrevias" | "totalOrigen">) {
  return {
    total: p.datos.total,
    total_origen: p.totalOrigen,
    lineas: p.datos.productos.length,
    alertas: p.alertasPrevias.length,
    proveedor: p.datos.proveedor,
    fecha: p.datos.fecha,
  };
}

/**
 * Sustitución EN SITIO (opción b de Q2): mismo id, cabecera nueva, líneas e
 * historial rehechos, copia de auditoría — todo dentro de la RPC
 * ocr_sustituir_factura (una transacción). Antes se mueve el original nuevo a
 * su ruta definitiva (si la RPC falla, solo queda un fichero sin referencia).
 */
export async function sustituirFactura(
  ctx: ContextoGuardado,
  a: { trabajoId: string; facturaId: number; userId: string; esperado: { lineas?: number; updated_at?: string | null } },
): Promise<RespuestaProcesado> {
  const { supabase, openai } = ctx;
  const { data: t, error: tErr } = await supabase.from("ocr_trabajos")
    .select("id, estado, documento_pendiente, original_path, original_mime, nombre_original, creado_por")
    .eq("id", a.trabajoId).maybeSingle();
  if (tErr) throw new Error(`No se pudo leer el trabajo: ${tErr.message}`);
  if (!t) throw new Error("No existe ese documento pendiente de sustituir (puede haber caducado).");
  if (t.estado !== "duplicado" || !t.documento_pendiente) {
    throw new Error("Ese documento ya no está pendiente de sustituir (¿ya se sustituyó?).");
  }
  const p = t.documento_pendiente as DocumentoPendiente;
  if (Number(p.existente?.id) !== Number(a.facturaId)) {
    throw new Error("La factura a sustituir no es la que se detectó como duplicada.");
  }
  if (p.pagina) {
    // Revisión del 10/10/2026 (factura 352): sustituir entre páginas
    // distintas borra la otra página. Se une con «Añadir como página».
    throw new Error(
      `No se ha sustituido nada: es la página ${p.pagina.actual} de ${p.pagina.total} de esa factura. Usa «Añadir como página».`,
    );
  }
  const d = p.datos;

  const [embFactura] = await openai.embed(textoEmbedding(d));
  const embs = d.productos.length > 0 ? await openai.embed(d.productos.map((x) => x.nombre)) : [];

  // El original nuevo se mueve a su carpeta definitiva SOLO si la RPC sale
  // bien: la RPC ya apunta a la ruta definitiva y, si luego no se puede
  // mover, la factura vuelve a apuntar a la copia de pendientes/.
  // QA 05/11/2026 (S-9): la RPC quita el drive_url de la factura cuando se le
  // pasa la ruta del original nuevo. Si ese original ya no está en Storage, la
  // factura se quedaría sin ninguno: se comprueba ANTES y, si falta, se
  // conserva el original que ya tenía.
  const originalNuevo = t.original_path ? await existeEnStorage(supabase, t.original_path) : false;
  if (t.original_path && !originalNuevo) {
    console.warn(`[sustituir] el original nuevo ${t.original_path} ya no está: la factura ${a.facturaId} conserva el anterior`);
  }
  const destino = t.original_path && originalNuevo
    ? rutaTemporal(a.facturaId, `sust-${String(a.trabajoId).slice(0, 8)}-${t.nombre_original}`)
    : null;

  const { data: res, error } = await supabase.rpc("ocr_sustituir_factura", {
    p_factura_id: a.facturaId,
    p_trabajo_id: a.trabajoId,
    p_usuario: a.userId,
    p_cabecera: {
      tipo: d.tipo,
      proveedor: d.proveedor,
      cif: d.cif,
      numero_documento: d.numero_documento,
      fecha: d.fecha,
      subtotal: d.subtotal,
      iva: d.iva,
      total: d.total,
      total_origen: p.totalOrigen,
      observaciones: d.observaciones,
      resumen: d.resumen,
      embedding: vec(embFactura),
      paginas: Math.min(20, Math.max(1, p.paginas ?? 1)),
    },
    p_lineas: filasProductos(d, embs, true),
    p_esperado: a.esperado,
    p_archivo_path: destino,
  });
  if (error) throw new Error(error.message.replace(/^.*SUSTITUCIÓN ABORTADA: /, "No se ha sustituido nada: "));

  // El original nuevo, a Drive; la RPC ya dejó la factura apuntando a la ruta
  // temporal (y sin drive_url) por si Drive falla.
  let archivo: { ok: boolean; error: string | null; estado?: EstadoArchivo } = {
    ok: false,
    error: null as string | null,
  };
  if (t.original_path && destino) {
    const proveedor = driveActivo(ctx.drive) ? await nombreProveedorFactura(supabase, a.facturaId, d.proveedor) : null;
    const r = await archivarDesdeStorage(
      ctx.drive, supabase, t.original_path, t.nombre_original, t.original_mime, d.fecha, a.facturaId, proveedor, destino,
    );
    archivo = await apuntarOriginal(supabase, a.facturaId, r);
  } else {
    // Sin original nuevo: la factura sigue con el que tenía (si tenía).
    const { data: f } = await supabase.from("facturas").select("drive_url, archivo_path").eq("id", a.facturaId).maybeSingle();
    archivo = f?.drive_url
      ? { ok: true, estado: "drive", error: t.original_path ? "el original nuevo no estaba; se conserva el anterior" : null }
      : f?.archivo_path
      ? { ok: true, estado: "temporal", error: "original pendiente de subir a Drive" }
      : { ok: false, estado: "perdido", error: "sin original" };
  }
  await limpiarPendientesTrabajo(supabase, a.trabajoId);

  // Coste de leer el documento nuevo: la lectura del trabajo + los embeddings de esta
  // sustitución. Sustituye al coste que tuviera la factura antes.
  const lectura = sumarCostes(await leerCosteTrabajo(supabase, a.trabajoId), costeDeCliente(openai.uso, null));
  await guardarCosteLectura(supabase, a.facturaId, lectura);

  const alertas = await validarYGuardarAlertas(supabase, a.facturaId, p.alertasPrevias ?? []);
  console.log(
    `[procesar-factura] SUSTITUIDA factura ${a.facturaId} (${d.numero_documento}): ` +
      `${res?.lineas_antes} → ${res?.lineas} líneas, historial ${res?.historial_borrado} → ${res?.historial_creado}`,
  );
  return respuestaExito(d, t.nombre_original, a.facturaId, alertas, p.totalOrigen, archivo, {
    sustituida: true,
    coste_usd: lectura.usd,
    message: `Factura ${a.facturaId} sustituida: ${res?.lineas_antes ?? "?"} → ${res?.lineas ?? d.productos.length} líneas.` +
      (alertas.length > 0 ? ` Revisa ${alertas.length} aviso(s).` : ""),
  });
}

/**
 * «Añadir como página x a la factura N» (revisión del 10/10/2026): AÑADE las
 * líneas de la página nueva a la factura existente SIN borrar las suyas, y
 * recalcula (totales, avisos y coste) — todo lo de base de datos dentro de la
 * RPC ocr_anadir_pagina (una transacción, con copia de auditoría en
 * facturas_sustituciones). El original de la página se mueve a su carpeta
 * definitiva solo si la RPC sale bien.
 */
export async function anadirPagina(
  ctx: ContextoGuardado,
  a: { trabajoId: string; facturaId: number; userId: string; esperado: { lineas?: number; updated_at?: string | null } },
): Promise<RespuestaProcesado> {
  const { supabase, openai } = ctx;
  const { data: t, error: tErr } = await supabase.from("ocr_trabajos")
    .select("id, estado, documento_pendiente, original_path, original_mime, nombre_original, creado_por")
    .eq("id", a.trabajoId).maybeSingle();
  if (tErr) throw new Error(`No se pudo leer el trabajo: ${tErr.message}`);
  if (!t) throw new Error("No existe ese documento pendiente (puede haber caducado).");
  if (t.estado !== "duplicado" || !t.documento_pendiente) {
    throw new Error("Ese documento ya no está pendiente (¿ya se añadió?).");
  }
  const p = t.documento_pendiente as DocumentoPendiente;
  if (Number(p.existente?.id) !== Number(a.facturaId)) {
    throw new Error("La factura no es la que se detectó para esta página.");
  }
  if (!p.pagina) throw new Error("No se ha añadido nada: este documento no es otra página de esa factura.");
  const pag = p.pagina;
  const d = p.datos;

  const embs = d.productos.length > 0 ? await openai.embed(d.productos.map((x) => x.nombre)) : [];
  const lineas = filasProductos({ ...d, productos: d.productos.map((x) => ({ ...x, pagina: pag.actual })) }, embs, true);
  // Igual que al sustituir: si el original de la página ya no está, no se
  // apunta la factura a una ruta vacía.
  const destino = t.original_path && await existeEnStorage(supabase, t.original_path)
    ? rutaTemporal(a.facturaId, `pag${pag.actual}-${String(a.trabajoId).slice(0, 8)}-${t.nombre_original}`)
    : null;

  const { data: res, error } = await supabase.rpc("ocr_anadir_pagina", {
    p_factura_id: a.facturaId,
    p_trabajo_id: a.trabajoId,
    p_usuario: a.userId,
    p_pagina: pag.actual,
    p_paginas_total: pag.total,
    p_cabecera: {
      proveedor: d.proveedor,
      cif: d.cif,
      fecha: d.fecha,
      subtotal: d.subtotal,
      iva: d.iva,
      total: d.total,
      total_origen: p.totalOrigen,
    },
    p_lineas: lineas,
    p_esperado: a.esperado,
    p_archivo_path: destino,
  });
  if (error) throw new Error(error.message.replace(/^.*AÑADIDO ABORTADO: /, "No se ha añadido nada: "));

  // El original de la página, a Drive (misma carpeta proveedor → mes, como
  // «pagN-…»). La RPC solo apunta la factura a la ruta temporal si no tenía
  // archivo_path; si Drive va bien, esa referencia se quita.
  let archivo = {
    ok: !destino,
    error: t.original_path && !destino ? "el original de la página ya no estaba en el servidor" : null as string | null,
  };
  if (t.original_path && destino) {
    const proveedor = driveActivo(ctx.drive) ? await nombreProveedorFactura(supabase, a.facturaId, d.proveedor) : null;
    const r = await archivarDesdeStorage(
      ctx.drive, supabase, t.original_path, `pag${pag.actual}-${t.nombre_original}`, t.original_mime,
      p.existente.fecha ?? d.fecha, a.facturaId, proveedor, destino,
    );
    if (r.drive_url) {
      await supabase.from("facturas").update({ archivo_path: null }).eq("id", a.facturaId).eq("archivo_path", destino);
      archivo = { ok: true, error: null };
    } else {
      // Pendiente de Drive: si la factura apunta a esta copia, el cron la sube
      // (es una «pagN-», no la borra sin subirla); si no, la sube como huérfana.
      if (r.archivo_path && r.archivo_path !== destino) {
        await supabase.from("facturas").update({ archivo_path: r.archivo_path }).eq("id", a.facturaId).eq("archivo_path", destino);
      }
      archivo = { ok: !!r.archivo_path, error: `original de la página pendiente de subir a Drive (${r.drive_error})` };
    }
  }
  await limpiarPendientesTrabajo(supabase, a.trabajoId);

  // Coste: el que ya tenía la factura + la lectura de esta página + estos embeddings.
  const lectura = sumarCostes(await leerCosteTrabajo(supabase, a.trabajoId), costeDeCliente(openai.uso, null));
  const { data: fa } = await supabase.from("facturas")
    .select("coste_lectura_usd, lectura_llamadas, lectura_modelo").eq("id", a.facturaId).maybeSingle();
  const previo = {
    usd: Number(fa?.coste_lectura_usd ?? 0) || 0,
    llamadas: fa?.lectura_llamadas === null || fa?.lectura_llamadas === undefined ? null : Number(fa.lectura_llamadas),
    modelo: fa?.lectura_modelo ?? null,
  };
  await guardarCosteLectura(supabase, a.facturaId, sumarCostes(previo, lectura));

  // Avisos: los que ya tenía (menos «página suelta») + los de la página nueva;
  // si siguen faltando páginas, el aviso vuelve con lo que falta.
  const recogidas: number[] = Array.isArray(res?.paginas_lineas) ? res.paginas_lineas.map(Number) : [];
  const faltan = Array.from({ length: pag.total }, (_, i) => i + 1).filter((n) => !recogidas.includes(n));
  const antes: Alerta[] = Array.isArray(res?.alertas_antes) ? res.alertas_antes : [];
  const sinSuelta = (xs: Alerta[]) => xs.filter((x) => x?.codigo !== CODIGO_PAGINA_SUELTA);
  const previas: Alerta[] = [...sinSuelta(antes), ...sinSuelta(p.alertasPrevias ?? [])];
  if (faltan.length > 0) {
    previas.push({
      codigo: CODIGO_PAGINA_SUELTA,
      severidad: "media",
      mensaje: `Faltan la${faltan.length > 1 ? "s" : ""} página${faltan.length > 1 ? "s" : ""} ${faltan.join(", ")} de ${pag.total}.`,
    });
  }
  const alertas = await validarYGuardarAlertas(supabase, a.facturaId, previas);
  console.log(
    `[procesar-factura] PÁGINA ${pag.actual}/${pag.total} añadida a la factura ${a.facturaId}: ` +
      `${res?.lineas_antes} + ${res?.lineas_anadidas} líneas; total ${res?.total}`,
  );
  const r = respuestaExito(d, t.nombre_original, a.facturaId, alertas, (res?.total_origen ?? p.totalOrigen) as OrigenImporte | null, archivo, {
    pagina_anadida: true,
    coste_usd: lectura.usd,
    message: `Página ${pag.actual} añadida a la factura ${p.existente.numero_documento}: ` +
      `${res?.lineas_antes ?? "?"} + ${res?.lineas_anadidas ?? d.productos.length} líneas.` +
      (alertas.length > 0 ? ` Revisa ${alertas.length} aviso(s).` : ""),
  });
  r.webhookResponse = { ...r.webhookResponse, numero_documento: p.existente.numero_documento, total: res?.total ?? null };
  return r;
}

/** ¿Existe el fichero en el bucket? (lista su carpeta). Ante un error, se da por que NO. */
export async function existeEnStorage(supabase: Supa, path: string): Promise<boolean> {
  try {
    const carpeta = path.slice(0, path.lastIndexOf("/"));
    const nombre = path.slice(path.lastIndexOf("/") + 1);
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).list(carpeta, { search: nombre, limit: 100 });
    if (error) return false;
    return Array.isArray(data) && data.some((o: { name?: string } | null) => o?.name === nombre);
  } catch {
    return false;
  }
}

/** Guarda en Storage (pendientes/) el original de un duplicado del camino síncrono. */
export async function guardarOriginalPendiente(
  supabase: Supa,
  userId: string,
  trabajoId: string,
  b64: string,
  mime: string,
): Promise<string | null> {
  const ext = mime.includes("pdf") ? "pdf" : mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  const path = `pendientes/${userId}/${trabajoId}/original.${ext}`;
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const { error } = await supabase.storage.from(STORAGE_BUCKET)
      .upload(path, new Blob([bytes], { type: mime }), { contentType: mime, upsert: false });
    if (error) {
      console.warn("[duplicado] no se pudo guardar el original pendiente:", error.message);
      return null;
    }
    return path;
  } catch (e) {
    console.warn("[duplicado] no se pudo guardar el original pendiente:", e);
    return null;
  }
}

/**
 * Nombre del proveedor para la carpeta de Drive. El trigger de `facturas`
 * resuelve `proveedor_id` al insertar (proveedores_unificados), así que se usa
 * el nombre canónico de `proveedores`; si no lo hay, el leído del documento.
 * Nunca lanza.
 */
// deno-lint-ignore no-explicit-any
async function nombreProveedorFactura(supabase: any, facturaId: number, leido: string | null): Promise<string | null> {
  try {
    const { data } = await supabase.from("facturas").select("proveedor_id").eq("id", facturaId).single();
    if (data?.proveedor_id) {
      const { data: p } = await supabase.from("proveedores").select("nombre").eq("id", data.proveedor_id).single();
      if (p?.nombre) return p.nombre;
    }
  } catch (e) {
    console.warn("[Drive] No se pudo leer el proveedor canónico; se usa el leído:", e);
  }
  return leido ?? null;
}
