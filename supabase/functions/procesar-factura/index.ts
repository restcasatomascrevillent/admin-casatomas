import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { diagnosticoResolucion } from "./imagen.ts";
import { autenticar, type ConfigAuth, corsHeaders, jsonResponse } from "./auth.ts";
import { configModelo } from "./modelo.ts";
import { bloqueContenido, crearClienteOpenAI } from "./openai.ts";
import { extraerDocumentoUnico } from "./extraccion.ts";
import { type ContextoGuardado, guardarDocumento, guardarOriginalPendiente, sustituirFactura } from "./guardado.ts";
import { iniciarTrabajo, registrarDuplicadoSincrono, validarInicio } from "./trabajos.ts";

// ============================================================================
//  procesar-factura  ·  OCR de facturas/albaranes SIN n8n
// ----------------------------------------------------------------------------
//  Tres modos (el panel siempre llama con el JWT del usuario):
//
//   · SIN `modo` (camino síncrono de UNA página, el de siempre):
//       IN : { tipo, archivo:{ nombre, tipo, size, contenido_base64 }, fecha }
//       OUT: { success, tipo, webhookResponse:{ tipo, numero_documento, ... } }
//     Si el documento ya existe → { duplicado: true, sustituible: {...} } para
//     que el panel ofrezca «Sustituir la existente».
//
//   · `modo: "iniciar"` (documentos LARGOS, 04b): el panel ya ha subido las
//     piezas (páginas de un PDF o franjas de una imagen muy alta) a
//     facturas-originales/pendientes/{uid}/{trabajo}/ y aquí solo se crea el
//     trabajo y se despacha; la lectura la hace `ocr-trabajo` en segundo
//     plano. Responde en < 2 s.
//
//   · `modo: "sustituir"`: reemplaza EN SITIO la factura duplicada por el
//     documento nuevo ya leído (exige permiso de EDICIÓN en Facturas).
//
//  Desde el 05-oct-2026 el código vive en módulos (prompts, modelo, openai,
//  extraccion, guardado, archivo, auth, pagina, pieza, consolidacion,
//  trabajos) que también importa `ocr-trabajo` y el banco local de Node.
// ============================================================================

const cfgAuth: ConfigAuth = {
  supabaseUrl: Deno.env.get("SUPABASE_URL")!,
  anonKey: Deno.env.get("SUPABASE_ANON_KEY")!,
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  crearCliente: createClient,
};

// Google Drive (Opción A: OAuth de usuario real con refresh token). Mientras
// los secrets GOOGLE_* no existan, el original va a Supabase Storage.
const drive = {
  clientId: Deno.env.get("GOOGLE_CLIENT_ID") ?? "",
  clientSecret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "",
  refreshToken: Deno.env.get("GOOGLE_REFRESH_TOKEN") ?? "",
  parentFolder: Deno.env.get("GOOGLE_DRIVE_PARENT_FOLDER_ID") ?? "",
};

// Modelo de visión: secreto opcional OCR_MODELO (ver modelo.ts).
const envModelo = {
  OCR_MODELO: Deno.env.get("OCR_MODELO"),
  OCR_MODELO_PIEZAS: Deno.env.get("OCR_MODELO_PIEZAS"),
  OCR_DETALLE: Deno.env.get("OCR_DETALLE"),
};
const cfgModelo = configModelo(envModelo, "unico");
const modeloPiezas = configModelo(envModelo, "piezas").modelo;

function contexto(): ContextoGuardado {
  return {
    supabase: createClient(cfgAuth.supabaseUrl, cfgAuth.serviceKey),
    openai: crearClienteOpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY")!, config: cfgModelo }),
    drive,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Autenticación ANTES de tocar OpenAI, Drive o la base de datos.
  const auth = await autenticar(req, cfgAuth, "view");
  if (!auth.ok) return auth.response;

  try {
    const payload = await req.json();

    // ── Documento largo: crear el trabajo ──
    if (payload?.modo === "iniciar") {
      const v = validarInicio(payload, auth.userId);
      if (!v.ok) return jsonResponse({ success: false, error: v.error });
      const ctx = contexto();
      return jsonResponse(await iniciarTrabajo(ctx.supabase, auth.userId, v.peticion, modeloPiezas));
    }

    // ── Sustituir la factura existente por el documento nuevo ──
    if (payload?.modo === "sustituir") {
      const authEdit = await autenticar(req, cfgAuth, "edit");
      if (!authEdit.ok) return authEdit.response;
      const facturaId = Number(payload.factura_id);
      const trabajoId = String(payload.trabajo_id ?? "");
      if (!Number.isInteger(facturaId) || facturaId <= 0 || !trabajoId) {
        return jsonResponse({ success: false, error: "Faltan factura_id o trabajo_id" });
      }
      const esperado = payload.esperado && typeof payload.esperado === "object"
        ? {
          ...(Number.isInteger(payload.esperado.lineas) ? { lineas: payload.esperado.lineas } : {}),
          ...(typeof payload.esperado.updated_at === "string" ? { updated_at: payload.esperado.updated_at } : {}),
        }
        : {};
      const r = await sustituirFactura(contexto(), { trabajoId, facturaId, userId: authEdit.userId, esperado });
      return jsonResponse(r);
    }

    // ── Camino síncrono de una página (v101) ──
    const archivo = payload.archivo;
    if (!archivo?.contenido_base64) throw new Error("No se recibió ningún archivo");

    const mimeType: string = archivo.tipo || "application/pdf";
    const isPdf = mimeType.includes("pdf");
    const b64: string = archivo.contenido_base64.includes(",")
      ? archivo.contenido_base64.split(",")[1]
      : archivo.contenido_base64;

    console.log(
      `[procesar-factura] ${archivo.nombre} (${mimeType}) — user ${auth.userId} — modelo ${cfgModelo.modelo}/${cfgModelo.detalle}`,
    );

    // Diagnóstico de resolución (solo log; ver imagen.ts).
    if (!isPdf) {
      try {
        const cabecera = atob(b64.slice(0, 65536));
        const bytes = new Uint8Array(cabecera.length);
        for (let i = 0; i < cabecera.length; i++) bytes[i] = cabecera.charCodeAt(i);
        const diag = diagnosticoResolucion(bytes);
        if (diag) console.log(diag);
      } catch {
        // Medir es informativo.
      }
    }

    const ctx = contexto();
    const contentBlock = bloqueContenido(b64, mimeType, archivo.nombre || "document.pdf", cfgModelo.detalle);

    // 2) → 2b) Extracción, pie, contador, citas, deducción y normalización.
    const listo = await extraerDocumentoUnico(ctx.openai, contentBlock);

    // 4) → 9) Duplicado, embeddings, cabecera, líneas, validación, archivo.
    const g = await guardarDocumento(ctx, {
      ...listo,
      original: { tipo: "base64", b64, mime: mimeType, nombre: archivo.nombre },
      paginas: 1,
    });

    if (g.estado === "duplicado" && g.existente) {
      // Se guarda lo leído (sin volver a pagar el OCR) para «Sustituir la existente».
      // Primero el registro (si la migración no está aplicada, no se sube nada
      // a pendientes/); después el original, que es el que se archivará.
      const trabajoId = crypto.randomUUID();
      const sustituible = await registrarDuplicadoSincrono(ctx.supabase, {
        userId: auth.userId,
        trabajoId,
        nombre: archivo.nombre,
        mime: mimeType,
        originalPath: null,
        datos: listo.datos,
        alertasPrevias: listo.alertasPrevias,
        totalOrigen: listo.totalOrigen,
        existente: g.existente,
        modelo: cfgModelo.modelo,
      });
      if (sustituible) {
        const originalPath = await guardarOriginalPendiente(ctx.supabase, auth.userId, trabajoId, b64, mimeType);
        if (originalPath) {
          await ctx.supabase.from("ocr_trabajos").update({ original_path: originalPath }).eq("id", trabajoId);
        }
      }
      return jsonResponse({ ...g.respuesta, sustituible });
    }
    return jsonResponse(g.respuesta);
  } catch (error) {
    console.error("[procesar-factura] Error:", error);
    const msg = error instanceof Error ? error.message : "Error desconocido";
    // HTTP 200 a propósito: el panel lee `success:false` del cuerpo.
    return jsonResponse({ success: false, error: msg });
  }
});
