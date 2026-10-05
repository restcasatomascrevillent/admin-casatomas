// ============================================================================
//  trabajos.ts · Trabajos de OCR en segundo plano (04b §1.5, §1.7, §1.8)
// ----------------------------------------------------------------------------
//  - validarInicio(): contrato del modo `iniciar` de procesar-factura (puro).
//  - iniciarTrabajo(): inserta ocr_trabajos + ocr_trabajo_paginas y despacha.
//  - procesarPagina() / procesarConsolidacion(): lo que hace ocr-trabajo en
//    segundo plano tras reclamar (lease) una pieza o la consolidación.
//  - registrarDuplicadoSincrono(): guarda el documento de un duplicado del
//    camino de una página para poder «Sustituir la existente» (vive en
//    unico.ts; se reexporta aquí).
//  - Trabajos de UNA pieza (05-oct-2026): un documento de una página leído en
//    segundo plano con el código del camino síncrono (unico.ts). La pieza se
//    lee con leerDocumentoUnico y lo leído (DocumentoListo) se guarda como
//    resultado de la pieza; la «consolidación» es trivial: guardarLecturaUnica
//    con el original en base64 (Drive o Storage, como el síncrono).
//  Sin Deno.env: todo llega por parámetro.
// ============================================================================

import { encodeBase64 } from "./base64.ts";
import { consolidar, prepararDocumentoConsolidado } from "./consolidacion.ts";
import { type DocumentoListo, type FicheroUnico, leerDocumentoUnico } from "./extraccion.ts";
import { type ContextoGuardado, type DocumentoPendiente, guardarDocumento, type RespuestaProcesado, resumenNuevo } from "./guardado.ts";
import { bloqueContenido, type ClienteOpenAI } from "./openai.ts";
import type { MotivoRelectura, PaginaCerrada } from "./pagina.ts";
import { leerPieza } from "./pieza.ts";
import { STORAGE_BUCKET } from "./archivo.ts";
import { guardarLecturaUnica, pendienteUnico } from "./unico.ts";

export { registrarDuplicadoSincrono } from "./unico.ts";

// deno-lint-ignore no-explicit-any
type Supa = any;

export const MAX_PIEZAS = 40;
export const MAX_BYTES = 10 * 1024 * 1024;
const MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PiezaInicio {
  numero: number;
  path: string;
  mime: string;
  bytes: number;
  pieza: "pagina" | "franja";
  pagina_doc: number;
  franja: number | null;
  franjas_pagina: number | null;
}

export interface PeticionInicio {
  modo: "iniciar";
  trabajo_id: string;
  nombre: string;
  origen: "pdf" | "imagen";
  paginas_documento: number;
  original: { path: string; mime: string; bytes: number } | null;
  piezas: PiezaInicio[];
}

/** Valida el cuerpo del modo `iniciar`. Devuelve la petición limpia o el error. */
export function validarInicio(
  body: unknown,
  userId: string,
): { ok: true; peticion: PeticionInicio } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const mal = (error: string) => ({ ok: false as const, error });
  const id = String(b.trabajo_id ?? "");
  if (!UUID.test(id)) return mal("trabajo_id no es un UUID válido");
  const prefijo = `pendientes/${userId}/${id}/`;
  const rutaValida = (p: unknown) =>
    typeof p === "string" && p.startsWith(prefijo) && !p.includes("..") && p.length < 300 &&
    /^[A-Za-z0-9._\-/]+$/.test(p);
  const nombre = typeof b.nombre === "string" && b.nombre.trim() ? b.nombre.trim().slice(0, 200) : "";
  if (!nombre) return mal("Falta el nombre del documento");
  const origen = b.origen === "pdf" || b.origen === "imagen" ? b.origen : null;
  if (!origen) return mal("origen tiene que ser 'pdf' o 'imagen'");
  const piezasRaw = Array.isArray(b.piezas) ? b.piezas : null;
  if (!piezasRaw || piezasRaw.length === 0) return mal("Faltan las piezas");
  if (piezasRaw.length > MAX_PIEZAS) return mal(`Como mucho ${MAX_PIEZAS} piezas por documento`);

  const piezas: PiezaInicio[] = [];
  for (const [i, x0] of piezasRaw.entries()) {
    const x = (x0 ?? {}) as Record<string, unknown>;
    const numero = Number(x.numero);
    if (numero !== i + 1) return mal("Las piezas tienen que ir numeradas 1..N, en orden y sin huecos");
    if (!rutaValida(x.path)) return mal(`La pieza ${numero} no está en ${prefijo}`);
    const mime = String(x.mime ?? "");
    if (!MIMES.includes(mime)) return mal(`Tipo de fichero no permitido en la pieza ${numero}`);
    const bytes = Number(x.bytes);
    if (!Number.isInteger(bytes) || bytes < 1 || bytes > MAX_BYTES) return mal(`Tamaño no válido en la pieza ${numero}`);
    const pieza = x.pieza === "franja" ? "franja" : "pagina";
    const paginaDoc = Number(x.pagina_doc ?? 1);
    if (!Number.isInteger(paginaDoc) || paginaDoc < 1 || paginaDoc > 20) return mal(`pagina_doc no válida en la pieza ${numero}`);
    const franja = pieza === "franja" ? Number(x.franja) : null;
    const franjasPagina = pieza === "franja" ? Number(x.franjas_pagina) : null;
    if (pieza === "franja" && (!Number.isInteger(franja) || !Number.isInteger(franjasPagina) || franja! < 1 || franja! > franjasPagina! || franjasPagina! > MAX_PIEZAS)) {
      return mal(`Franja no válida en la pieza ${numero}`);
    }
    piezas.push({ numero, path: String(x.path), mime, bytes, pieza, pagina_doc: paginaDoc, franja, franjas_pagina: franjasPagina });
  }
  // Una sola pieza = documento de una página entero (no una franja suelta).
  if (piezas.length === 1 && (piezas[0].pieza !== "pagina" || piezas[0].pagina_doc !== 1)) {
    return mal("Un documento de una sola pieza tiene que ser la página 1 entera");
  }
  const paginasDocumento = Math.max(...piezas.map((p) => p.pagina_doc));
  let original: PeticionInicio["original"] = null;
  if (b.original) {
    const o = b.original as Record<string, unknown>;
    if (!rutaValida(o.path) || !MIMES.includes(String(o.mime)) || !(Number(o.bytes) >= 1 && Number(o.bytes) <= MAX_BYTES)) {
      return mal("El original no es válido");
    }
    original = { path: String(o.path), mime: String(o.mime), bytes: Number(o.bytes) };
  }
  return {
    ok: true,
    peticion: { modo: "iniciar", trabajo_id: id, nombre, origen, paginas_documento: paginasDocumento, original, piezas },
  };
}

/** Comprueba en Storage que las piezas existen y pesan lo declarado. */
async function comprobarEnStorage(supabase: Supa, p: PeticionInicio, userId: string): Promise<string | null> {
  const carpeta = `pendientes/${userId}/${p.trabajo_id}`;
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).list(carpeta, { limit: 100 });
  if (error) return `No se pudo comprobar la subida: ${error.message}`;
  // deno-lint-ignore no-explicit-any
  const tam = new Map<string, number>((data ?? []).map((o: any) => [`${carpeta}/${o.name}`, Number(o.metadata?.size ?? -1)]));
  const todas = [...p.piezas.map((x) => ({ path: x.path, bytes: x.bytes })), ...(p.original ? [p.original] : [])];
  for (const x of todas) {
    const t = tam.get(x.path);
    if (t === undefined) return `No se encuentra en Storage: ${x.path}`;
    if (t >= 0 && t !== x.bytes) return `El tamaño de ${x.path} no coincide (${t} ≠ ${x.bytes})`;
  }
  return null;
}

/** Modo `iniciar`: crea el trabajo (idempotente) y despacha la pieza 1. */
export async function iniciarTrabajo(
  supabase: Supa,
  userId: string,
  p: PeticionInicio,
  modelo: string,
): Promise<Record<string, unknown>> {
  const { data: ya } = await supabase.from("ocr_trabajos").select("id, creado_por, estado, num_paginas").eq("id", p.trabajo_id).maybeSingle();
  if (ya) {
    if (ya.creado_por !== userId) return { success: false, error: "Ese trabajo pertenece a otro usuario" };
    return { success: true, trabajo_id: ya.id, estado: ya.estado, num_paginas: ya.num_paginas };
  }
  const fallo = await comprobarEnStorage(supabase, p, userId);
  if (fallo) return { success: false, error: fallo };

  // Pieza única: la pieza ES el original (para «Sustituir la existente»).
  const original = p.original ?? (p.piezas.length === 1 ? { path: p.piezas[0].path, mime: p.piezas[0].mime } : null);
  const { error: e1 } = await supabase.from("ocr_trabajos").insert({
    id: p.trabajo_id,
    creado_por: userId,
    num_paginas: p.piezas.length,
    paginas_documento: p.paginas_documento,
    origen: p.origen,
    nombre_original: p.nombre,
    original_path: original?.path ?? null,
    original_mime: original?.mime ?? null,
    modelo,
  });
  if (e1) return { success: false, error: `No se pudo crear el trabajo: ${e1.message}` };
  const { error: e2 } = await supabase.from("ocr_trabajo_paginas").insert(p.piezas.map((x) => ({
    trabajo_id: p.trabajo_id,
    numero: x.numero,
    pieza: x.pieza,
    pagina_doc: x.pagina_doc,
    franja: x.franja,
    franjas_pagina: x.franjas_pagina,
    storage_path: x.path,
    mime: x.mime,
    bytes: x.bytes,
  })));
  if (e2) {
    await supabase.from("ocr_trabajos").delete().eq("id", p.trabajo_id);
    return { success: false, error: `No se pudieron registrar las páginas: ${e2.message}` };
  }
  const { data: n, error: e3 } = await supabase.rpc("ocr_despachar", { p_trabajo_id: p.trabajo_id });
  if (e3) console.error("[iniciar] ocr_despachar:", e3.message);
  if (!e3 && n === 0) {
    console.warn("[iniciar] ocr_despachar devolvió 0: ¿falta el secreto de Vault ocr_trabajos_secret?");
  }
  return { success: true, trabajo_id: p.trabajo_id, estado: "pagina1", num_paginas: p.piezas.length };
}

// ─── ocr-trabajo: una pieza ──────────────────────────────────────────────────

/** Descarga una pieza de Storage y la devuelve en base64. */
async function descargarB64(supabase: Supa, path: string): Promise<string> {
  const { data: blob, error } = await supabase.storage.from(STORAGE_BUCKET).download(path);
  if (error || !blob) throw new Error(`descarga ${path}: ${error?.message ?? "vacía"}`);
  return encodeBase64(new Uint8Array(await blob.arrayBuffer()));
}

/** Error que puede salir bien al reintentar (red, límites, Storage). */
export function esErrorTransitorio(msg: string): boolean {
  return /\b(429|500|502|503|504)\b|fetch failed|network|timeout|descarga /i.test(msg);
}

/**
 * Procesa una pieza reclamada. `openaiUnico`: cliente con la configuración del
 * camino síncrono (OCR_MODELO), para los trabajos de UNA pieza; si no llega,
 * se usa `openai`.
 */
// deno-lint-ignore no-explicit-any
export async function procesarPagina(supabase: Supa, openai: ClienteOpenAI, pagina: any, openaiUnico?: ClienteOpenAI): Promise<void> {
  try {
    const { data: t, error: tErr } = await supabase.from("ocr_trabajos")
      .select("id, num_paginas, contexto_p1, estado, nombre_original").eq("id", pagina.trabajo_id).single();
    if (tErr) throw new Error(`trabajo: ${tErr.message}`);
    if (Number(t.num_paginas) === 1) {
      await leerPiezaUnica(supabase, openaiUnico ?? openai, pagina, t);
      return;
    }
    const b64 = await descargarB64(supabase, pagina.storage_path);
    const bloque = bloqueContenido(b64, pagina.mime, `pieza-${pagina.numero}`, openai.config.detalle);
    const motivosPrevios = Array.isArray(pagina.motivo_relectura) ? pagina.motivo_relectura as MotivoRelectura[] : null;
    const r = await leerPieza(openai, bloque, {
      numero: pagina.numero,
      total: t.num_paginas,
      pieza: pagina.pieza,
      paginaDoc: pagina.pagina_doc,
      franja: pagina.franja,
      franjasDePagina: pagina.franjas_pagina,
    }, {
      contexto: pagina.numero === 1 ? null : t.contexto_p1,
      esUltima: pagina.numero === t.num_paginas,
      yaReleida: (pagina.relecturas ?? 0) > 0,
      motivosPrevios,
      // 150 s de reloj por worker: la relectura en la misma llamada solo si
      // la primera lectura ha tardado menos de 70 s.
      presupuestoRelecturaMs: 70_000,
    });
    const extraidas = r.resultado.lineas.filter((l) => !l.es_fila_arrastre).length;
    const { error } = await supabase.rpc("ocr_cerrar_pagina", {
      p_pagina_id: pagina.id,
      p_resultado: r.resultado,
      p_recuento: r.recuento,
      p_verificacion: r.verificacionPie,
      p_motivos: r.motivos,
      p_filas_extraidas: extraidas,
      p_filas_contadas: r.recuento?.filas_tabla ?? null,
      p_relecturas: r.relecturas,
      p_duracion_ms: r.duracionMs,
      p_tokens_entrada: openai.uso.tokensEntrada,
      p_tokens_salida: openai.uso.tokensSalida,
      p_coste: openai.uso.costeUsd,
      p_contexto: r.contexto,
      p_modelo: openai.config.modelo,
    });
    if (error) throw new Error(`ocr_cerrar_pagina: ${error.message}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ocr-trabajo] pieza ${pagina.id} falló:`, msg);
    const { error } = await supabase.rpc("ocr_fallo_pagina", { p_pagina_id: pagina.id, p_error: msg });
    if (error) console.error("[ocr-trabajo] ocr_fallo_pagina:", error.message);
  }
}

// ─── ocr-trabajo: trabajo de UNA pieza ─────────────────────────────────────

/** Lo que guarda la pieza de un trabajo de una pieza en `resultado`. */
export type LecturaUnica = DocumentoListo & { documento_unico: true };

function esLecturaUnica(x: unknown): x is LecturaUnica {
  const r = x as LecturaUnica | null;
  return !!r && r.documento_unico === true && !!r.datos && Array.isArray(r.alertasPrevias);
}

/**
 * Lee la pieza única con leerDocumentoUnico (el camino síncrono) y la cierra
 * con lo leído. Un fallo transitorio (red, 429/5xx, Storage) se reintenta con
 * ocr_fallo_pagina (hasta 3 intentos, como las piezas); uno que no lo es (el
 * modelo se niega, respuesta cortada, contrato incumplido…) falla a la
 * primera, como en el síncrono, sin volver a pagar dos lecturas más.
 */
// deno-lint-ignore no-explicit-any
async function leerPiezaUnica(supabase: Supa, cliente: ClienteOpenAI, pagina: any, t: any): Promise<void> {
  const t0 = Date.now();
  try {
    const fichero: FicheroUnico = {
      b64: await descargarB64(supabase, pagina.storage_path),
      mime: pagina.mime,
      nombre: t.nombre_original,
    };
    console.log(
      `[ocr-trabajo] una pieza: ${t.nombre_original} (${fichero.mime}) — trabajo ${t.id} — modelo ${cliente.config.modelo}/${cliente.config.detalle}`,
    );
    const listo = await leerDocumentoUnico(cliente, fichero);
    const resultado: LecturaUnica = { ...listo, documento_unico: true };
    const { error } = await supabase.rpc("ocr_cerrar_pagina", {
      p_pagina_id: pagina.id,
      p_resultado: resultado,
      p_recuento: null,
      p_verificacion: null,
      p_motivos: [],
      p_filas_extraidas: listo.datos.productos.length,
      p_filas_contadas: null,
      p_relecturas: Math.min(1, Math.max(0, listo.intentos - 1)),
      p_duracion_ms: Date.now() - t0,
      p_tokens_entrada: cliente.uso.tokensEntrada,
      p_tokens_salida: cliente.uso.tokensSalida,
      p_coste: cliente.uso.costeUsd,
      p_contexto: null,
      p_modelo: cliente.config.modelo,
    });
    if (error) throw new Error(`ocr_cerrar_pagina: ${error.message}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ocr-trabajo] pieza única ${pagina.id} falló:`, msg);
    if (esErrorTransitorio(msg)) {
      const { error } = await supabase.rpc("ocr_fallo_pagina", { p_pagina_id: pagina.id, p_error: msg });
      if (error) console.error("[ocr-trabajo] ocr_fallo_pagina:", error.message);
      return;
    }
    await falloDefinitivo(supabase, pagina, msg);
  }
}

/** La pieza queda «fallida» sin más intentos y se despacha la consolidación,
 *  que deja el trabajo en «fallido» con el mensaje. Si algo se corta a medias,
 *  el cron lo recompone (ocr_despachar pasa pagina1 → paginas). */
// deno-lint-ignore no-explicit-any
async function falloDefinitivo(supabase: Supa, pagina: any, msg: string): Promise<void> {
  const { error: e1 } = await supabase.from("ocr_trabajo_paginas")
    .update({ estado: "fallida", error: msg.slice(0, 2000), lease_hasta: null })
    .eq("id", pagina.id).eq("estado", "procesando");
  if (e1) {
    console.error("[ocr-trabajo] no se pudo marcar la pieza fallida:", e1.message);
    const { error } = await supabase.rpc("ocr_fallo_pagina", { p_pagina_id: pagina.id, p_error: msg });
    if (error) console.error("[ocr-trabajo] ocr_fallo_pagina:", error.message);
    return;
  }
  await supabase.from("ocr_trabajos").update({ estado: "paginas" }).eq("id", pagina.trabajo_id).eq("estado", "pagina1");
  const { error: e3 } = await supabase.rpc("ocr_despachar", { p_trabajo_id: pagina.trabajo_id });
  if (e3) console.error("[ocr-trabajo] ocr_despachar:", e3.message);
}

/**
 * «Consolidación» de un trabajo de una pieza: guardar lo leído EXACTAMENTE
 * como el camino síncrono (guardarLecturaUnica, original en base64 → Drive o
 * Storage). Si el original se archivó, se borra la copia de pendientes/; si
 * no se pudo archivar, la factura apunta a la copia de pendientes/ (que así
 * no se pierde). Duplicado → «Pendientes de decidir» con la pieza como original.
 */
// deno-lint-ignore no-explicit-any
async function consolidarUnico(ctx: ContextoGuardado, trabajo: any, f: any): Promise<void> {
  const { supabase } = ctx;
  if (!f || f.estado !== "completada" || !esLecturaUnica(f.resultado)) {
    const msg = f?.error || "No se pudo leer el documento";
    await terminar(supabase, trabajo.id, "fallido", { success: false, error: msg }, null, msg, null);
    return;
  }
  const { documento_unico: _marca, ...listo } = f.resultado as LecturaUnica;

  let b64: string;
  try {
    b64 = await descargarB64(supabase, f.storage_path);
  } catch (e) {
    // Reintento tras un corte: si la factura ya se guardó (y la copia de
    // pendientes/ ya se borró), guardarDocumento la devuelve sin usar el original.
    const { data: ya } = await supabase.from("facturas").select("id").eq("ocr_trabajo_id", trabajo.id).maybeSingle();
    if (!ya?.id) throw e;
    b64 = "";
  }
  const fichero: FicheroUnico = { b64, mime: f.mime ?? trabajo.original_mime ?? "image/jpeg", nombre: trabajo.nombre_original };
  const g = await guardarLecturaUnica(ctx, listo, fichero, trabajo.id);

  const { data: tCoste } = await supabase.from("ocr_trabajos").select("coste_usd, modelo").eq("id", trabajo.id).single();
  const comun = {
    paginas: [{
      numero: 1, pieza: "pagina", franja: null, estado: f.estado, lineas: f.filas_extraidas, contadas: f.filas_contadas,
      relecturas: f.relecturas, duracion_ms: f.duracion_ms,
    }],
    coste_usd: Number(tCoste?.coste_usd ?? 0),
    modelo: tCoste?.modelo ?? null,
  };

  if (g.estado === "guardado") {
    let respuesta = g.respuesta;
    if (b64) {
      if (respuesta.archivo_guardado) {
        const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([f.storage_path]);
        if (error) console.warn("[ocr-trabajo] no se pudo borrar la copia de pendientes/:", error.message);
      } else {
        // Ni Drive ni Storage: el original sigue en pendientes/ y se apunta ahí.
        const { error } = await supabase.from("facturas").update({ archivo_path: f.storage_path }).eq("id", g.facturaId);
        if (!error) {
          respuesta = {
            ...respuesta,
            archivo_guardado: true,
            archivo_error: `no se pudo archivar (${respuesta.archivo_error}); queda en ${f.storage_path}`,
            webhookResponse: { ...respuesta.webhookResponse, archivo_guardado: true },
          };
        }
      }
    }
    await terminar(supabase, trabajo.id, "completado", { ...respuesta, ...comun }, g.facturaId, null, null);
    return;
  }
  const dup = g.existente ? pendienteUnico(listo, g.existente, trabajo.id) : null;
  const respuesta: RespuestaProcesado = { ...g.respuesta, sustituible: dup?.sustituible ?? null };
  await terminar(supabase, trabajo.id, "duplicado", { ...respuesta, ...comun }, g.existente?.id ?? null, null, dup?.pendiente ?? null);
}

// ─── ocr-trabajo: consolidación ──────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
export async function procesarConsolidacion(ctx: ContextoGuardado, trabajo: any): Promise<void> {
  const { supabase } = ctx;
  try {
    const { data: filas, error } = await supabase.from("ocr_trabajo_paginas")
      .select("id, numero, pieza, pagina_doc, franja, estado, storage_path, mime, error, resultado, recuento, verificacion_pie, relecturas, filas_extraidas, filas_contadas, duracion_ms")
      .eq("trabajo_id", trabajo.id).order("numero");
    if (error) throw new Error(`páginas: ${error.message}`);
    if (Number(trabajo.num_paginas) === 1) {
      await consolidarUnico(ctx, trabajo, (filas ?? [])[0]);
      return;
    }
    // deno-lint-ignore no-explicit-any
    const piezas: PaginaCerrada[] = (filas ?? []).map((f: any) => ({
      pagina_id: f.id,
      numero: f.numero,
      pieza: f.pieza,
      pagina_doc: f.pagina_doc,
      franja: f.franja,
      estado: f.estado === "completada" ? "completada" : "fallida",
      resultado: f.estado === "completada" ? f.resultado : null,
      recuento: f.recuento,
      verificacion_pie: f.verificacion_pie,
      relecturas: f.relecturas ?? 0,
    }));
    const c = consolidar(piezas, trabajo.ronda_relectura ?? 0);
    if (c.relecturas.length > 0 && (trabajo.ronda_relectura ?? 0) === 0) {
      const { data: n, error: rErr } = await supabase.rpc("ocr_pedir_relectura", {
        p_trabajo_id: trabajo.id,
        p_paginas: c.relecturas,
      });
      if (rErr) console.error("[ocr-trabajo] ocr_pedir_relectura:", rErr.message);
      if (!rErr && Number(n) > 0) {
        console.log(`[ocr-trabajo] ${trabajo.id}: relectura diferida de ${n} pieza(s)`);
        return;
      }
    }

    const listo = prepararDocumentoConsolidado(c);
    const original = trabajo.original_path
      ? { tipo: "storage" as const, path: trabajo.original_path, mime: trabajo.original_mime ?? "image/jpeg", nombre: trabajo.nombre_original }
      : { tipo: "storage" as const, path: (filas ?? [])[0]?.storage_path, mime: "image/jpeg", nombre: trabajo.nombre_original };
    const g = await guardarDocumento(ctx, {
      ...listo,
      original,
      paginas: c.paginasDocumento,
      ocrTrabajoId: trabajo.id,
    });

    // deno-lint-ignore no-explicit-any
    const infoPaginas = (filas ?? []).map((f: any) => ({
      numero: f.numero,
      pieza: f.pieza,
      franja: f.franja,
      estado: f.estado,
      lineas: f.filas_extraidas,
      contadas: f.filas_contadas,
      relecturas: f.relecturas,
      duracion_ms: f.duracion_ms,
    }));
    const { data: tCoste } = await supabase.from("ocr_trabajos").select("coste_usd, modelo").eq("id", trabajo.id).single();
    const comun = { paginas: infoPaginas, consolidacion: c.stats, coste_usd: Number(tCoste?.coste_usd ?? 0), modelo: tCoste?.modelo ?? null };

    if (g.estado === "guardado") {
      await terminar(supabase, trabajo.id, "completado", { ...g.respuesta, ...comun }, g.facturaId, null, null);
    } else {
      const pendiente: DocumentoPendiente | null = g.existente
        ? { datos: listo.datos, alertasPrevias: listo.alertasPrevias, totalOrigen: listo.totalOrigen, paginas: c.paginasDocumento, existente: g.existente }
        : null;
      const respuesta: RespuestaProcesado = {
        ...g.respuesta,
        sustituible: pendiente ? { trabajo_id: trabajo.id, existente: pendiente.existente, nuevo: resumenNuevo(pendiente) } : null,
      };
      await terminar(supabase, trabajo.id, "duplicado", { ...respuesta, ...comun }, g.existente?.id ?? null, null, pendiente);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ocr-trabajo] consolidación de ${trabajo.id} falló:`, msg);
    // (La consolidación de varias piezas no descarga nada: «descarga» solo
    //  puede venir de la de una pieza.)
    const transitorio = esErrorTransitorio(msg);
    if (transitorio && (trabajo.intentos_consolidacion ?? 1) < 3) {
      // Se deja caducar el lease: el cron la vuelve a intentar.
      return;
    }
    await terminar(supabase, trabajo.id, "fallido", { success: false, error: msg }, null, msg, null);
  }
}

async function terminar(
  supabase: Supa,
  id: string,
  estado: "completado" | "duplicado" | "fallido",
  resultado: unknown,
  facturaId: number | null,
  error: string | null,
  pendiente: DocumentoPendiente | null,
): Promise<void> {
  const { error: e } = await supabase.rpc("ocr_terminar_trabajo", {
    p_trabajo_id: id,
    p_estado: estado,
    p_resultado: resultado,
    p_factura_id: estado === "duplicado" ? null : facturaId,
    p_error: error,
    p_documento_pendiente: pendiente,
  });
  if (e) console.error("[ocr-trabajo] ocr_terminar_trabajo:", e.message);
}
