import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { claveOpenAI } from "../_shared/clave-openai.ts";
import { autenticar, corsHeaders, jsonResponse, verificarSecreto } from "../procesar-factura/auth.ts";
import { AcumuladorUso, registrarUso } from "../_shared/registrar-uso-ia.ts";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { embedOpenAI, FUNCION, MODELO, rellenarPendientes } from "./relleno.ts";
const createClient = clienteConAuditoria(createClientBase, FUNCION);

// ============================================================================
//  embeddings-nombres · vector de los nombres de producto que aún no lo tienen
// ----------------------------------------------------------------------------
//  Desde 20261203100000 hay UN embedding por nombre de línea de factura
//  (productos_nombre_embedding). Un trigger crea la fila con embedding NULL
//  cuando entra un nombre nuevo (p. ej. facturas importadas por SQL, sin
//  OpenAI). Esta función toma hasta 500 pendientes, pide sus vectores en UNA
//  llamada y los guarda en lotes de 50. Sin pendientes no llama a OpenAI.
//
//  Quién la llama (verify_jwt = false en config.toml, autenticación propia):
//    · El cron «embeddings-nombres» (pg_net, cada 10 min y solo si hay
//      pendientes): cabecera x-ocr-secret == OCR_TRABAJOS_SECRET (mismo
//      secreto y valor de Vault que ocr-trabajo). Tiempo constante, FALLA CERRADO.
//    · A mano, con el JWT de un usuario con permiso de EDICIÓN en facturas.
//  No acepta datos del cuerpo. Secretos: OPENAI_API_KEY (claveOpenAI("ocr")).
//  Respuesta: { ok, pendientes, guardados }
// ============================================================================

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cfgAuth = {
  supabaseUrl: URL_SB,
  anonKey: Deno.env.get("SUPABASE_ANON_KEY")!,
  serviceKey: SERVICE,
  crearCliente: createClient,
};

serve(conAuditoriaDePeticion(FUNCION, createClientBase, async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);

  let disparador: string;
  if (req.headers.has("x-ocr-secret")) {
    const denegado = verificarSecreto(req, Deno.env.get("OCR_TRABAJOS_SECRET"));
    if (denegado) return denegado;
    disparador = "cron";
  } else {
    const a = await autenticar(req, cfgAuth, "edit");
    if (!a.ok) return a.response;
    disparador = `usuario:${a.userId}`;
  }

  const supabase = createClient(URL_SB, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
  const uso = new AcumuladorUso(FUNCION, MODELO, "embedding");
  const t0 = Date.now();
  try {
    const r = await rellenarPendientes({
      supabase,
      embed: (textos) => embedOpenAI(textos, { apiKey: claveOpenAI("ocr"), alUsar: (u) => uso.sumar(u as never) }),
    });
    console.log(`[${FUNCION}] ${disparador} · ${JSON.stringify(r)}`);
    return jsonResponse({ ok: true, ...r });
  } catch (e) {
    uso.marcarError();
    console.error(`[${FUNCION}] ${disparador} · error:`, (e as Error)?.message ?? e);
    return jsonResponse({ ok: false, error: (e as Error)?.message ?? String(e) }, 500);
  } finally {
    if (uso.llamadas > 0) await registrarUso(uso, { disparador, duracionMs: Date.now() - t0, cliente: supabase });
  }
}));
