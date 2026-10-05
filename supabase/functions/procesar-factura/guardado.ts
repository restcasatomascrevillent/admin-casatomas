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
import { archivarOriginal, type ConfigDrive, moverPendiente, rutaDefinitiva, STORAGE_BUCKET } from "./archivo.ts";

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
}

export interface RespuestaProcesado {
  success: true;
  nombre: string;
  tipo: string;
  duplicado?: boolean;
  sustituida?: boolean;
  message: string;
  alertas: Alerta[];
  archivo_guardado: boolean;
  archivo_error: string | null;
  webhookResponse: Record<string, unknown>;
  /** Solo si duplicado: lo que el panel necesita para «Sustituir la existente». */
  sustituible?: {
    trabajo_id: string;
    existente: ResumenExistente;
    nuevo: { total: number | null; total_origen: OrigenImporte | null; lineas: number; alertas: number; proveedor: string | null; fecha: string };
  } | null;
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

function textoEmbedding(d: DatosNormalizados): string {
  return d.resumen
    ? d.resumen
    : `${d.tipo} de ${d.proveedor || "proveedor desconocido"}, ${d.fecha}, total ${d.total}€. Productos: ${
      d.productos.map((p) => p.nombre).join(", ")
    }`;
}

function filasProductos(d: DatosNormalizados, embeddings: number[][], conColumnas04b: boolean) {
  return d.productos.map((p, i) => ({
    nombre: p.nombre,
    cantidad: p.cantidad,
    unidad: p.unidad,
    precio_unitario: p.precio_unitario,
    total: p.total,
    embedding: embeddings[i] ? vec(embeddings[i]) : null,
    ...(conColumnas04b ? { pagina: p.pagina ?? 1, orden: p.orden ?? i, albaran_ref: p.albaran_ref ?? null } : {}),
  }));
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

function respuestaExito(
  d: DatosNormalizados,
  nombre: string,
  facturaId: number,
  alertas: Alerta[],
  totalOrigen: OrigenImporte | null,
  archivo: { ok: boolean; error: string | null },
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
    const { data: ya } = await supabase.from("facturas").select("id").eq("ocr_trabajo_id", e.ocrTrabajoId).maybeSingle();
    if (ya?.id) {
      const alertas = await validarYGuardarAlertas(supabase, ya.id, e.alertasPrevias);
      return {
        estado: "guardado",
        facturaId: ya.id,
        respuesta: respuestaExito(d, e.original.nombre, ya.id, alertas, e.totalOrigen, { ok: true, error: null }),
      };
    }
  }

  // 4) Duplicado
  const existente = await buscarExistente(supabase, d);
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
  let ins = await supabase.from("facturas").insert({ ...cabecera, ...extra04b }).select("id").single();
  if (ins.error && esColumnaNueva(ins.error.message) && !e.ocrTrabajoId) {
    // Migración 20261005120000 sin aplicar: el camino de una página sigue
    // funcionando como en v101 (sin pagina/orden).
    console.warn("[procesar-factura] columnas 04b ausentes; se guarda sin ellas:", ins.error.message);
    conColumnas04b = false;
    ins = await supabase.from("facturas").insert(cabecera).select("id").single();
  }
  if (ins.error) throw new Error(`insert factura: ${ins.error.message}`);
  const facturaId: number = ins.data.id;

  try {
    // 7) Líneas (embeddings en lotes de 100)
    if (d.productos.length > 0) {
      const embs = await openai.embed(d.productos.map((p) => p.nombre));
      const { error } = await supabase.from("productos_factura")
        .insert(filasProductos(d, embs, conColumnas04b).map((f) => ({ factura_id: facturaId, ...f })));
      if (error) throw new Error(`insert productos: ${error.message}`);
    }

    // 8) Validación de cordura
    const alertas = await validarYGuardarAlertas(supabase, facturaId, e.alertasPrevias);

    // 9) Original
    let archivo = { ok: false, error: null as string | null };
    if (e.original.tipo === "base64") {
      const a = await archivarOriginal(ctx.drive, supabase, e.original.b64, e.original.nombre, e.original.mime, d.fecha, facturaId);
      archivo = { ok: !!(a.drive_url || a.archivo_path), error: a.error };
      if (a.drive_url || a.archivo_path) {
        const { error } = await supabase.from("facturas").update({
          ...(a.drive_url ? { drive_url: a.drive_url } : {}),
          ...(a.archivo_path ? { archivo_path: a.archivo_path } : {}),
        }).eq("id", facturaId);
        if (error) console.error("[archivo] No se pudo guardar la referencia al original:", error.message);
      }
    } else {
      const m = await moverPendiente(supabase, e.original.path, rutaDefinitiva(d.fecha, facturaId, e.original.nombre));
      archivo = { ok: !!m.path, error: m.error };
      if (m.path) {
        const { error } = await supabase.from("facturas").update({ archivo_path: m.path }).eq("id", facturaId);
        if (error) console.error("[archivo] No se pudo guardar la referencia al original:", error.message);
      } else {
        // El original sigue a salvo en pendientes/: se apunta ahí.
        await supabase.from("facturas").update({ archivo_path: e.original.path }).eq("id", facturaId);
        archivo = { ok: true, error: `no se pudo mover a su carpeta definitiva (${m.error}); queda en ${e.original.path}` };
      }
    }

    console.log(
      `[procesar-factura] OK ${d.tipo} ${d.numero_documento} · ${d.productos.length} productos · alertas: ${alertas.length}`,
    );
    return { estado: "guardado", facturaId, respuesta: respuestaExito(d, e.original.nombre, facturaId, alertas, e.totalOrigen, archivo) };
  } catch (err) {
    await compensarFacturaHuerfana(supabase, facturaId, err);
    throw err;
  }
}

// ─── Duplicado pendiente de sustituir ───────────────────────────────────────

export interface DocumentoPendiente {
  datos: DatosNormalizados;
  alertasPrevias: Alerta[];
  totalOrigen: OrigenImporte | null;
  paginas: number;
  existente: ResumenExistente;
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
  const d = p.datos;

  const [embFactura] = await openai.embed(textoEmbedding(d));
  const embs = d.productos.length > 0 ? await openai.embed(d.productos.map((x) => x.nombre)) : [];

  let archivoPath: string | null = null;
  let archivoError: string | null = null;
  if (t.original_path) {
    const destino = rutaDefinitiva(d.fecha, a.facturaId, `sust-${String(a.trabajoId).slice(0, 8)}-${t.nombre_original}`);
    const m = await moverPendiente(supabase, t.original_path, destino);
    archivoPath = m.path ?? t.original_path;
    archivoError = m.error;
  }

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
    p_archivo_path: archivoPath,
  });
  if (error) throw new Error(error.message.replace(/^.*SUSTITUCIÓN ABORTADA: /, "No se ha sustituido nada: "));

  const alertas = await validarYGuardarAlertas(supabase, a.facturaId, p.alertasPrevias ?? []);
  console.log(
    `[procesar-factura] SUSTITUIDA factura ${a.facturaId} (${d.numero_documento}): ` +
      `${res?.lineas_antes} → ${res?.lineas} líneas, historial ${res?.historial_borrado} → ${res?.historial_creado}`,
  );
  return respuestaExito(d, t.nombre_original, a.facturaId, alertas, p.totalOrigen, { ok: !!archivoPath, error: archivoError }, {
    sustituida: true,
    message: `Factura ${a.facturaId} sustituida: ${res?.lineas_antes ?? "?"} → ${res?.lineas ?? d.productos.length} líneas.` +
      (alertas.length > 0 ? ` Revisa ${alertas.length} aviso(s).` : ""),
  });
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
