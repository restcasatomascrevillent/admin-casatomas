import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { jsonResponse, verificarSecreto } from "../procesar-factura/auth.ts";
import { sincronizar } from "./costes.ts";
import { sincronizarUso } from "./uso.ts";

const createClient = clienteConAuditoria(createClientBase, "sincronizar-costes-openai");

// ============================================================================
//  sincronizar-costes-openai · gasto REAL de OpenAI (lo que factura)
// ----------------------------------------------------------------------------
//  La llama SOLO Postgres (pg_cron cada 6 h → pg_net), nunca el panel.
//  verify_jwt = false (pg_net no tiene JWT) y autenticación propia, igual que
//  ocr-trabajo: cabecera x-ocr-secret == OCR_TRABAJOS_SECRET (el mismo valor
//  que el secreto de Vault «ocr_trabajos_secret»), comparación en tiempo
//  constante y FALLA CERRADO (sin secreto → 500).
//
//  No acepta datos del cuerpo. Con OPENAI_ADMIN_KEY (clave de administración,
//  solo lectura) pide a OpenAI los últimos 35 días de costes agrupados por
//  proyecto y concepto y los guarda en `openai_costes_diarios`; da de alta los
//  proyectos nuevos en `openai_proyectos` (proceso null: lo asigna el dueño) y
//  actualiza el tipo de cambio USD→EUR del BCE en `tipo_cambio_usd_eur`.
//  Además trae el uso (tokens) por clave y modelo de /usage/completions y
//  /usage/embeddings a `openai_uso_diario` y da de alta las claves en
//  `openai_claves` (ver uso.ts): con ello la RPC reparte el total real entre
//  procesos (ocr / chat / otros) dentro de UN solo proyecto.
//
//  Secretos: OPENAI_ADMIN_KEY, OCR_TRABAJOS_SECRET (ya existe).
//  Respuesta: { ok, filas, dias, proyectos_nuevos, proyectos_sin_proceso, tipo_cambio, avisos, uso }
// ============================================================================

serve(conAuditoriaDePeticion("sincronizar-costes-openai", createClientBase, async (req) => {
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  const denegado = verificarSecreto(req, Deno.env.get("OCR_TRABAJOS_SECRET"));
  if (denegado) return denegado;

  const adminKey = (Deno.env.get("OPENAI_ADMIN_KEY") ?? "").trim();
  if (!adminKey) {
    console.error("[sincronizar-costes-openai] OPENAI_ADMIN_KEY no configurada");
    return jsonResponse({ ok: false, error: "admin_key_no_configurada" }, 500);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  try {
    const r = await sincronizar({ supabase, adminKey });
    // Uso por clave (para repartir el total real entre procesos). Si falla, los
    // costes ya guardados son válidos: se avisa pero no se tumba la sincronización.
    let uso: Awaited<ReturnType<typeof sincronizarUso>> | null = null;
    try {
      uso = await sincronizarUso({ supabase, adminKey });
      r.avisos.push(...uso.avisos);
    } catch (e) {
      r.avisos.push(`Sin uso por clave: ${(e as Error)?.message ?? e}`);
    }
    console.log(`[sincronizar-costes-openai] ${JSON.stringify({ ...r, uso, tipo_cambio: r.tipo_cambio?.eur_por_usd ?? null })}`);
    return jsonResponse({ ok: true, ...r, uso });
  } catch (e) {
    console.error("[sincronizar-costes-openai] error:", (e as Error)?.message ?? e);
    return jsonResponse({ ok: false, error: (e as Error)?.message ?? String(e) }, 502);
  }
}));
