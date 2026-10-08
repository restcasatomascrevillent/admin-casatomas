import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { claveOpenAI } from "../_shared/clave-openai.ts";
import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { autenticar, type ConfigAuth, corsHeaders, jsonResponse } from "./auth.ts";
import { configModelo } from "./modelo.ts";
import { crearClienteOpenAI } from "./openai.ts";
import { crearRegistroUso, type RegistroUsoOcr } from "./registroUso.ts";
import { type ContextoGuardado, sustituirFactura } from "./guardado.ts";
import { iniciarTrabajo, validarInicio } from "./trabajos.ts";
import { ficheroDesdePayload, procesarSincrono } from "./unico.ts";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
const createClient = clienteConAuditoria(createClientBase, "procesar-factura");

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
//   · `modo: "iniciar"` (documentos LARGOS, 04b, y desde el 05-oct-2026
//     también los de UNA página): el panel ya ha subido las piezas (páginas
//     de un PDF, franjas de una imagen muy alta, o el fichero entero como
//     pieza única) a facturas-originales/pendientes/{uid}/{trabajo}/ y aquí
//     solo se crea el trabajo y se despacha; la lectura la hace
//     `ocr-trabajo` en segundo plano. Responde en < 2 s. Una pieza única se
//     lee con el MISMO código y modelo que el camino síncrono (unico.ts).
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

// Cada llamada a OpenAI deja su fila en ia_uso (registroUso.ts), con el
// documento en el disparador: `trabajo:<uuid>` al sustituir, `subida:<uuid>`
// (uno nuevo por petición) en el camino síncrono.
function contexto(disparador = `subida:${crypto.randomUUID()}`): ContextoGuardado & { registro: RegistroUsoOcr } {
  const supabase = createClient(cfgAuth.supabaseUrl, cfgAuth.serviceKey);
  const registro = crearRegistroUso({ funcion: "procesar-factura", disparador, cliente: supabase });
  return {
    supabase,
    openai: crearClienteOpenAI({ apiKey: claveOpenAI("ocr"), config: cfgModelo, alUsar: registro.alUsar }),
    drive,
    registro,
  };
}

serve(conAuditoriaDePeticion("procesar-factura", createClientBase, async (req) => {
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
      // Una sola pieza = documento de una página leído en segundo plano con
      // el código y el modelo (OCR_MODELO) del camino síncrono.
      const modelo = v.peticion.piezas.length === 1 ? cfgModelo.modelo : modeloPiezas;
      return jsonResponse(await iniciarTrabajo(ctx.supabase, auth.userId, v.peticion, modelo));
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
      const ctx = contexto(`trabajo:${trabajoId.slice(0, 36)}`);
      try {
        return jsonResponse(await sustituirFactura(ctx, { trabajoId, facturaId, userId: authEdit.userId, esperado }));
      } finally {
        await ctx.registro.esperar();
      }
    }

    // ── Camino síncrono de una página (v101; el panel nuevo solo lo usa si
    //    el servidor no admite trabajos de una pieza). Código en unico.ts,
    //    el MISMO que lee y guarda los trabajos de una pieza de ocr-trabajo.
    const archivo = payload.archivo;
    if (!archivo?.contenido_base64) throw new Error("No se recibió ningún archivo");
    const fichero = ficheroDesdePayload(archivo);

    console.log(
      `[procesar-factura] ${archivo.nombre} (${fichero.mime}) — user ${auth.userId} — modelo ${cfgModelo.modelo}/${cfgModelo.detalle}`,
    );
    const ctx = contexto();
    try {
      return jsonResponse(await procesarSincrono(ctx, fichero, auth.userId));
    } finally {
      await ctx.registro.esperar();
    }
  } catch (error) {
    console.error("[procesar-factura] Error:", error);
    const msg = error instanceof Error ? error.message : "Error desconocido";
    // HTTP 200 a propósito: el panel lee `success:false` del cuerpo.
    return jsonResponse({ success: false, error: msg });
  }
}));
