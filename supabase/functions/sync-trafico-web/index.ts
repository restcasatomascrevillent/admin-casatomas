// ============================================================================
// SYNC-TRAFICO-WEB — Edge Function
// ============================================================================
// Ingesta diaria de Vercel Web Analytics (casa-tomas-story y
// touza-restaurant-website) en trafico_web_diario / trafico_web_desglose.
// La llama pg_cron a las 03:30 UTC (migración 20260923200000_trafico_web.sql)
// con la cabecera x-webhook-secret leída de Vault.
//
//   POST /functions/v1/sync-trafico-web   body ignorado
//     200 todo OK · 207 un proyecto falló · 502 fallaron los dos
//     401 cabecera ausente/incorrecta · 500 falta un secret (fail closed)
//     405 método distinto de POST
//
// verify_jwt = false (config.toml): la llama pg_net sin usuario. La
// autenticación real es x-webhook-secret == TRAFICO_WEB_CRON_SECRET,
// comparada en tiempo constante y FALLANDO CERRADO si la env var falta
// (mismo criterio que emails-reserva, no el de reservas-web).
//
// Secrets (Deno.env):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (los inyecta la plataforma)
//   VERCEL_ANALYTICS_TOKEN   token PERSONAL de Vercel (el del conector MCP da
//                            404 en /v1/query/web-analytics). Nunca sale al cliente.
//   TRAFICO_WEB_CRON_SECRET  mismo valor que el secreto de Vault
//                            'trafico_web_cron_secret'.
//
// Lógica en sync.ts (rango, fusión, estado, aviso) y contrato de la API en
// vercel.ts. Checklist de despliegue: DEPLOY.md en esta carpeta.
// ============================================================================

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient as createClientBase, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

import { crearClienteVercel } from "./vercel.ts";
import {
  procesarPeticion,
  TITULO_AVISO_PREFIJO,
  type FilaDesglose,
  type FilaDiario,
  type Repositorio,
} from "./sync.ts";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
const createClient = clienteConAuditoria(createClientBase, "sync-trafico-web");

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("TRAFICO_WEB_CRON_SECRET") ?? "";
const VERCEL_TOKEN = Deno.env.get("VERCEL_ANALYTICS_TOKEN") ?? "";

const TAMANO_LOTE_UPSERT = 500;

function crearRepositorio(supabase: SupabaseClient): Repositorio {
  async function upsertEnLotes(tabla: string, filas: unknown[], onConflict: string) {
    for (let i = 0; i < filas.length; i += TAMANO_LOTE_UPSERT) {
      const { error } = await supabase
        .from(tabla)
        .upsert(filas.slice(i, i + TAMANO_LOTE_UPSERT), { onConflict });
      if (error) throw new Error(`upsert ${tabla}: ${error.message}`);
    }
  }

  return {
    async leerEstado(proyecto) {
      const { data, error } = await supabase
        .from("trafico_web_sync_estado")
        .select("ultimo_ok_en, fallos_consecutivos")
        .eq("proyecto", proyecto)
        .maybeSingle();
      if (error) throw new Error(`leer trafico_web_sync_estado: ${error.message}`);
      return data
        ? { ultimo_ok_en: (data.ultimo_ok_en as string | null) ?? null, fallos_consecutivos: Number(data.fallos_consecutivos) || 0 }
        : null;
    },
    upsertDiario: (filas: FilaDiario[]) => upsertEnLotes("trafico_web_diario", filas, "fecha,proyecto,ruta"),
    upsertDesglose: (filas: FilaDesglose[]) =>
      upsertEnLotes("trafico_web_desglose", filas, "fecha,proyecto,dimension,valor"),
    async guardarEstado(fila) {
      // En fallo no se manda ultimo_ok_en ni dias_ultimo_sync: el upsert solo
      // toca las columnas presentes y conserva el último éxito.
      const { error } = await supabase.from("trafico_web_sync_estado").upsert(fila, { onConflict: "proyecto" });
      if (error) throw new Error(`guardar trafico_web_sync_estado: ${error.message}`);
    },
    async existeAvisoDesde(desdeIso) {
      const { data, error } = await supabase
        .from("notificaciones_dashboard")
        .select("id")
        .eq("tipo", "sistema")
        .like("titulo", `${TITULO_AVISO_PREFIJO}%`)
        .gte("created_at", desdeIso)
        .limit(1);
      if (error) throw new Error(`leer notificaciones_dashboard: ${error.message}`);
      return (data?.length ?? 0) > 0;
    },
    async crearAviso({ titulo, mensaje }) {
      const { error } = await supabase.from("notificaciones_dashboard").insert({
        tipo: "sistema",
        origen: null, // el CHECK de origen admite NULL; no se toca el constraint
        prioridad: "normal",
        titulo,
        mensaje,
      });
      if (error) throw new Error(`insertar notificaciones_dashboard: ${error.message}`);
    },
  };
}

serve(conAuditoriaDePeticion("sync-trafico-web", createClientBase, (req) =>
  procesarPeticion(req, {
    secreto: CRON_SECRET,
    token: VERCEL_TOKEN,
    crearDependencias: (token) => ({
      vercel: crearClienteVercel({ token }),
      repo: crearRepositorio(createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })),
      ahora: () => new Date(),
      log: (m) => console.log(m),
    }),
  }).catch((e) => {
    console.error("[sync-trafico-web] error no controlado:", e);
    return new Response(JSON.stringify({ ok: false, error: "internal_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }))
);
