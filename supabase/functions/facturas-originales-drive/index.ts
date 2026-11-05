import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { exigirAdmin } from "../_shared/autorizacion.ts";
import { corsHeaders, jsonResponse, verificarSecreto } from "../procesar-factura/auth.ts";
import { driveActivo } from "../procesar-factura/archivo.ts";
import { pasarLote, type PorPasar } from "../procesar-factura/originalesDrive.ts";
const createClient = clienteConAuditoria(createClientBase, "facturas-originales-drive");

// ============================================================================
//  facturas-originales-drive · Los originales de facturas, a Google Drive
// ----------------------------------------------------------------------------
//  Orden del dueño (05-nov-2026): nada se queda en Supabase Storage. Esta
//  función sube a Drive (carpeta del proveedor → mes) los originales que aún
//  estén en el bucket facturas-originales, los borra de Storage y limpia los
//  restos del OCR por trabajos (procesar-factura/originalesDrive.ts).
//
//  La llaman:
//    - pg_cron «facturas-originales-drive» cada 10 min (solo si hay algo que
//      hacer), con x-ocr-secret = OCR_TRABAJOS_SECRET (Vault
//      «ocr_trabajos_secret», el mismo que ocr-trabajo);
//    - un ADMIN a mano (rescate de lo antiguo) con su JWT.
//
//   POST { accion: "pasar", limite? }  → { ok, informe, queda }
//   POST { accion: "informe" }         → { ok, queda } (no cambia nada)
//
//  Idempotente: llamar otra vez sigue donde se quedó. verify_jwt = false
//  (pg_net no lleva JWT): la autenticación es el secreto o el rol admin.
// ============================================================================

const SECRETO = Deno.env.get("OCR_TRABAJOS_SECRET");
const URL_SB = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const drive = {
  clientId: (Deno.env.get("GOOGLE_CLIENT_ID") ?? "").trim(),
  clientSecret: (Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "").trim(),
  refreshToken: (Deno.env.get("GOOGLE_REFRESH_TOKEN") ?? "").trim(),
  parentFolder: (Deno.env.get("GOOGLE_DRIVE_PARENT_FOLDER_ID") ?? "").trim(),
};

// deno-lint-ignore no-explicit-any
async function queda(supabase: any) {
  const { data, error } = await supabase.rpc("facturas_originales_por_pasar", { p_limite: 500 });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as PorPasar;
  const facturas = d.facturas ?? [];
  return {
    facturas_sin_drive: facturas.filter((f) => !f.drive_url).length,
    facturas_con_copia_sobrante: facturas.filter((f) => !!f.drive_url).length,
    huerfanos: (d.huerfanos ?? []).length,
    pendientes_sobrantes: (d.pendientes ?? []).length,
  };
}

serve(conAuditoriaDePeticion("facturas-originales-drive", createClientBase, async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);

  // Con x-ocr-secret: el cron (falla cerrado si no cuadra). Sin ella: un admin con su JWT.
  if (req.headers.has("x-ocr-secret")) {
    const denegado = verificarSecreto(req, SECRETO);
    if (denegado) return denegado;
  } else {
    const admin = await exigirAdmin(req, { crearCliente: createClient, corsHeaders });
    if (!admin.ok) return admin.response;
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // sin cuerpo = «pasar»
  }
  const supabase = createClient(URL_SB, SERVICE);
  try {
    if (body.accion === "informe") {
      return jsonResponse({ ok: true, drive_configurado: driveActivo(drive), queda: await queda(supabase) });
    }
    const limite = Math.min(50, Math.max(1, Number(body.limite) || 15));
    const informe = await pasarLote({ supabase, drive, limite });
    console.log("[facturas-originales-drive]", JSON.stringify(informe));
    return jsonResponse({ ok: true, drive_configurado: driveActivo(drive), informe, queda: await queda(supabase) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[facturas-originales-drive]", msg);
    return jsonResponse({ ok: false, error: msg }, 500);
  }
}));
