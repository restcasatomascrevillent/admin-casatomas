// ============================================================================
// REGISTRAR-ACTIVIDAD-WEB — Edge Function (Super Admin › Logs)
// ============================================================================
// Recibe los lotes de eventos del navegador de la web (actividad con
// consentimiento «Estadísticas», errores siempre) y los guarda con la RPC
// web_logs_ingerir (migración 20261118100000_logs_web.sql). Contrato y
// respuestas en ingesta.ts. verify_jwt = false (config.toml): la llama
// sendBeacon sin cabeceras; la protección real está en ingesta.ts.
//
// Secretos: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (los pone la plataforma).
// Opcional: LOGS_WEB_ORIGENES_EXTRA ("https://otro-dominio=produccion,…").
// ============================================================================

import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { ipCliente } from "../_shared/ip-cliente.ts";
import { procesarIngesta } from "./ingesta.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ORIGENES_EXTRA = Deno.env.get("LOGS_WEB_ORIGENES_EXTRA") ?? "";

const createClient = clienteConAuditoria(createClientBase, "registrar-actividad-web");
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// Envoltorio común (ADMITE_INTEGRACION): sin usuario; la protección está en ingesta.ts.
Deno.serve(conAuditoriaDePeticion("registrar-actividad-web", createClientBase, (req) =>
  procesarIngesta(req, {
    claveIp: SERVICE_ROLE_KEY,
    ip: ipCliente(req),
    origenesExtra: ORIGENES_EXTRA,
    ingerir: async (eventos, ctx) => {
      const { data, error } = await supabase.rpc("web_logs_ingerir", { p_eventos: eventos, p_ctx: ctx });
      if (error) throw new Error(error.message);
      return (data ?? {}) as Record<string, number>;
    },
  }).catch((e) => {
    console.error("[registrar-actividad-web] error no controlado:", (e as Error)?.message ?? e);
    return new Response(JSON.stringify({ ok: false, error: "interno" }), { status: 500, headers: { "Content-Type": "application/json" } });
  })
));
