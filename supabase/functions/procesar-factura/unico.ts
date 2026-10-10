// ============================================================================
//  unico.ts · Documento de UNA página: lo común a los dos caminos
// ----------------------------------------------------------------------------
//  Desde el 05-oct-2026 un documento de una página puede leerse de dos formas:
//
//   · Camino SÍNCRONO (el de siempre, procesar-factura sin `modo`): el panel
//     espera abierto los 10-40 s. Se mantiene para paneles antiguos y como
//     respaldo si el servidor aún no admite trabajos de una pieza.
//   · Trabajo de UNA pieza (procesar-factura {modo:"iniciar"} con una sola
//     pieza → ocr-trabajo): el panel sube el fichero a pendientes/ y se olvida;
//     la lectura sigue en el servidor aunque se cierre la pestaña.
//
//  Los dos usan EXACTAMENTE el mismo código para leer (leerDocumentoUnico:
//  mismo prompt, modelo OCR_MODELO, relectura por cuadre, verificador de pie,
//  contador, citas, deducción y normalización) y para guardar
//  (guardarLecturaUnica → guardarDocumento: duplicado, embeddings, cabecera,
//  líneas, validación de cordura y archivo en Drive o Storage). Lo único que
//  cambia es de dónde salen los bytes (base64 del panel o Storage) y que el
//  trabajo deja `ocr_trabajo_id` en la factura (idempotencia de reintentos).
//  Sin Deno.env: todo llega por parámetro (vitest y el banco local lo usan).
// ============================================================================

import { costeDeCliente, guardarCosteLectura } from "./costeLectura.ts";
import { type DocumentoListo, type FicheroUnico, leerDocumentoUnico } from "./extraccion.ts";
import {
  type ContextoGuardado,
  type DocumentoPendiente,
  guardarDocumento,
  guardarOriginalPendiente,
  type RespuestaProcesado,
  type ResultadoGuardado,
  resumenNuevo,
} from "./guardado.ts";

// deno-lint-ignore no-explicit-any
type Supa = any;

/**
 * Pasos 4-9 para un documento de una página: el original va en base64 (Drive
 * si está configurado, Storage si no), una página, y en el camino de trabajos
 * el id del trabajo para que un reintento no cree otra factura.
 */
export function guardarLecturaUnica(
  ctx: ContextoGuardado,
  listo: DocumentoListo,
  f: FicheroUnico,
  ocrTrabajoId: string | null,
): Promise<ResultadoGuardado> {
  return guardarDocumento(ctx, {
    ...listo,
    original: { tipo: "base64", b64: f.b64, mime: f.mime, nombre: f.nombre },
    paginas: 1,
    ...(ocrTrabajoId ? { ocrTrabajoId } : {}),
  });
}

/** Documento pendiente de «Sustituir la existente» de una lectura de una página. */
export function pendienteUnico(
  listo: Pick<DocumentoListo, "datos" | "alertasPrevias" | "totalOrigen">,
  existente: DocumentoPendiente["existente"],
  trabajoId: string,
): { pendiente: DocumentoPendiente; sustituible: NonNullable<RespuestaProcesado["sustituible"]> } {
  const pendiente: DocumentoPendiente = {
    datos: listo.datos,
    alertasPrevias: listo.alertasPrevias,
    totalOrigen: listo.totalOrigen,
    paginas: 1,
    existente,
  };
  return { pendiente, sustituible: { trabajo_id: trabajoId, existente, nuevo: resumenNuevo(pendiente) } };
}

/**
 * El camino de una página ha detectado un duplicado: se guarda el documento ya
 * leído (sin volver a pagar el OCR) para que el panel pueda ofrecer
 * «Sustituir la existente». Si la migración no está aplicada, devuelve null y
 * el panel se queda con el aviso de duplicado de siempre.
 */
export async function registrarDuplicadoSincrono(
  supabase: Supa,
  a: {
    userId: string;
    trabajoId: string;
    nombre: string;
    mime: string;
    originalPath: string | null;
    datos: DocumentoListo["datos"];
    alertasPrevias: Record<string, unknown>[];
    totalOrigen: DocumentoListo["totalOrigen"];
    existente: DocumentoPendiente["existente"];
    modelo: string;
    /** Coste de la lectura (USD) y nº de llamadas: «Sustituir la existente» los hereda. */
    costeUsd?: number;
    llamadas?: number | null;
  },
): Promise<RespuestaProcesado["sustituible"]> {
  const { pendiente, sustituible } = pendienteUnico(a, a.existente, a.trabajoId);
  const { error } = await supabase.from("ocr_trabajos").insert({
    id: a.trabajoId,
    creado_por: a.userId,
    estado: "duplicado",
    num_paginas: 1,
    origen: "sincrono",
    nombre_original: a.nombre,
    original_path: a.originalPath,
    original_mime: a.mime,
    modelo: a.modelo,
    ...(a.costeUsd ? { coste_usd: a.costeUsd } : {}),
    documento_pendiente: pendiente,
    resultado: { success: true, duplicado: true, sustituible },
    terminado_at: new Date().toISOString(),
  });
  if (error) {
    console.warn("[duplicado] no se pudo registrar el pendiente (¿migración sin aplicar?):", error.message);
    return null;
  }
  // El nº de llamadas va aparte: si la columna aún no existe (migración
  // 20261010120000 sin aplicar) no puede tumbar el registro del pendiente.
  if (a.llamadas) {
    const { error: eLl } = await supabase.from("ocr_trabajos").update({ llamadas: a.llamadas }).eq("id", a.trabajoId);
    if (eLl) console.warn("[coste-lectura] no se pudo anotar las llamadas del duplicado:", eLl.message);
  }
  return sustituible;
}

/** Cuerpo `archivo` del camino síncrono → fichero (quita la cabecera data:). */
export function ficheroDesdePayload(archivo: { nombre?: string; tipo?: string; contenido_base64: string }): FicheroUnico {
  const mime = archivo.tipo || "application/pdf";
  const b64 = archivo.contenido_base64.includes(",") ? archivo.contenido_base64.split(",")[1] : archivo.contenido_base64;
  return { b64, mime, nombre: archivo.nombre as string };
}

/**
 * Camino SÍNCRONO de una página (v101), movido desde index.ts sin cambios de
 * comportamiento para poder compararlo en tests con el de trabajos.
 */
export async function procesarSincrono(
  ctx: ContextoGuardado,
  f: FicheroUnico,
  userId: string,
  generarId: () => string = () => crypto.randomUUID(),
): Promise<Record<string, unknown>> {
  const listo = await leerDocumentoUnico(ctx.openai, f);
  // 4) → 9) Duplicado, embeddings, cabecera, líneas, validación, archivo.
  const g = await guardarLecturaUnica(ctx, listo, f, null);
  // Todo lo que costó leer este documento: visión, relecturas, pie, contador y embeddings.
  const lectura = costeDeCliente(ctx.openai.uso, ctx.openai.config.modelo);

  if (g.estado === "duplicado" && g.existente) {
    // Se guarda lo leído (sin volver a pagar el OCR) para «Sustituir la existente».
    // Primero el registro (si la migración no está aplicada, no se sube nada
    // a pendientes/); después el original, que es el que se archivará.
    const trabajoId = generarId();
    const sustituible = await registrarDuplicadoSincrono(ctx.supabase, {
      userId,
      trabajoId,
      nombre: f.nombre,
      mime: f.mime,
      originalPath: null,
      datos: listo.datos,
      alertasPrevias: listo.alertasPrevias,
      totalOrigen: listo.totalOrigen,
      existente: g.existente,
      modelo: ctx.openai.config.modelo,
      costeUsd: lectura.usd,
      llamadas: lectura.llamadas,
    });
    if (sustituible) {
      const originalPath = await guardarOriginalPendiente(ctx.supabase, userId, trabajoId, f.b64, f.mime);
      if (originalPath) {
        await ctx.supabase.from("ocr_trabajos").update({ original_path: originalPath }).eq("id", trabajoId);
      }
    }
    return { ...g.respuesta, sustituible, coste_usd: lectura.usd };
  }
  if (g.estado === "guardado") await guardarCosteLectura(ctx.supabase, g.facturaId, lectura);
  return { ...g.respuesta, coste_usd: lectura.usd } as unknown as Record<string, unknown>;
}
