// ============================================================================
// PROCESAR-LOGS-WEB — Edge Function (Super Admin › Logs, segundo plano)
// ============================================================================
// Agrupa errores en incidencias, aplica umbrales, crea/actualiza tickets en
// Linear (o en el destino de pruebas), lee integraciones y despliegues y purga
// lo caducado. Lógica en proceso.ts; contrato con Linear en linear.ts.
//
//   POST /functions/v1/procesar-logs-web
//     · pg_cron cada 5 min con x-webhook-secret == LOGS_WEB_CRON_SECRET
//       (Vault 'logs_web_cron_secret'), comparado en tiempo constante y
//       FALLANDO CERRADO si el secreto no existe; o
//     · botón «Procesar ahora» del panel: JWT de super admin (exigirSuperAdmin).
//     200 { resumen } · 202 { ocupado: true } · 401/403 · 405
//
//   POST { accion: "probar_linear" } — botón «Probar conexión con Linear»
//     (Logs › Configuración). SOLO super admin (con el secreto del cron, 403).
//     No procesa nada: con LINEAR_API_KEY devuelve si la clave funciona, el
//     espacio de trabajo y los equipos con sus proyectos, estados y etiquetas.
//     200 { ok, estado, mensaje, espacio?, equipos? } · la clave nunca sale.
//
// Secretos: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (plataforma),
//   LOGS_WEB_CRON_SECRET, LINEAR_API_KEY (solo con linear_modo = real),
//   OPENAI_API_KEY (vía claveOpenAI), y para los despliegues uno de
//   LOGS_WEB_VERCEL_TOKEN / SERVICIOS_VERCEL_TOKEN / VERCEL_ANALYTICS_TOKEN.
//   Opcional: LOGS_WEB_URL_PANEL (si no, la del entorno).
// ============================================================================

import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { exigirSuperAdmin } from "../_shared/autorizacion.ts";
import { compararTiempoConstante } from "../_shared/tiempo-constante.ts";
import { crearLlamadaIa } from "../_shared/logs-web/openai.ts";
import { entornoDeSupabase } from "../_shared/logs-web/clasificacion.ts";
import { crearDestinoLinear, crearDestinoPrueba, MENSAJES_LINEAR, probarConexion } from "./linear.ts";
import { leerDesplieguesVercel } from "./recolectores.ts";
import { procesar, type RepoProceso } from "./proceso.ts";

const createClient = clienteConAuditoria(createClientBase, "procesar-logs-web");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("LOGS_WEB_CRON_SECRET") ?? "";
const LINEAR_API_KEY = Deno.env.get("LINEAR_API_KEY") ?? "";
const VERCEL_TOKEN = Deno.env.get("LOGS_WEB_VERCEL_TOKEN") || Deno.env.get("SERVICIOS_VERCEL_TOKEN") || Deno.env.get("VERCEL_ANALYTICS_TOKEN") || "";
const ENTORNO = entornoDeSupabase(SUPABASE_URL);
const URL_PANEL = Deno.env.get("LOGS_WEB_URL_PANEL")
  || (ENTORNO === "produccion" ? "https://admin-casatomas.vercel.app" : "https://admin-casatomas-git-staging-casa-tomas.vercel.app");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function crearRepo(sb: any): RepoProceso {
  const comprobar = <T>(r: { data: T; error: { message: string } | null }, que: string): T => {
    if (r.error) throw new Error(`${que}: ${r.error.message}`);
    return r.data;
  };
  return {
    async config() {
      return comprobar(await sb.from("web_logs_config").select("*").eq("id", true).single(), "leer configuración");
    },
    async tomarTurno(ahora, hasta) {
      const r = await sb.from("web_logs_estado")
        .update({ proceso_bloqueado_hasta: hasta.toISOString(), ultimo_proceso_inicio: ahora.toISOString() })
        .eq("id", true)
        .or(`proceso_bloqueado_hasta.is.null,proceso_bloqueado_hasta.lt.${ahora.toISOString()}`)
        .select("id");
      return (comprobar(r, "tomar turno") ?? []).length > 0;
    },
    async terminarTurno({ ok, error, resumen, ahora }) {
      comprobar(await sb.from("web_logs_estado").update({
        proceso_bloqueado_hasta: null, ultimo_proceso_fin: ahora.toISOString(), ultimo_error: error,
        ultimo_resumen: resumen, ...(ok ? { ultimo_proceso_ok: ahora.toISOString() } : {}),
      }).eq("id", true), "guardar estado");
    },
    async cursores() {
      const d = comprobar(await sb.from("web_logs_estado").select("cursores").eq("id", true).single(), "leer cursores");
      return (d?.cursores ?? {}) as Record<string, string>;
    },
    async guardarCursores(c) {
      comprobar(await sb.from("web_logs_estado").update({ cursores: c }).eq("id", true), "guardar cursores");
    },
    async ingerir(eventos, entorno) {
      return comprobar(await sb.rpc("web_logs_ingerir", { p_eventos: eventos, p_ctx: { entorno } }), "ingerir");
    },
    async fallosCron(desde) {
      const r = await sb.rpc("web_logs_fallos_cron", { p_desde: desde });
      if (r.error && /does not exist|Could not find/i.test(r.error.message)) return []; // sin pg_cron
      return comprobar(r, "leer cron") ?? [];
    },
    async estadosSyncTrafico() {
      const r = await sb.from("trafico_web_sync_estado").select("proyecto, ultimo_error, ultimo_intento_en, fallos_consecutivos");
      if (r.error && /does not exist|Could not find/i.test(r.error.message)) return [];
      return comprobar(r, "leer trafico_web_sync_estado") ?? [];
    },
    async agrupar() {
      return comprobar(await sb.rpc("web_logs_agrupar_errores", { p_limite: 5000 }), "agrupar errores");
    },
    async incidenciasConTicket(limite) {
      // Dos colas para que ninguna se coma a la otra: antes era una sola lista de 200 por
      // «última vez», y con muchos tickets ya creados una pendiente antigua no entraba nunca.
      //   · por crear (pendiente/error): las que antes toca reintentar;
      //   · con ticket: las que llevan más tiempo sin sincronizar.
      const mitad = Math.max(1, Math.floor(limite / 2));
      const porCrear = comprobar(await sb.from("web_incidencias").select("*")
        .in("linear_estado", ["pendiente", "error"]).neq("estado", "ignorada")
        .order("linear_proximo_intento", { ascending: true, nullsFirst: true }).order("id").limit(mitad), "leer incidencias por crear") ?? [];
      const conTicket = comprobar(await sb.from("web_incidencias").select("*")
        .eq("linear_estado", "creado").neq("estado", "ignorada")
        .order("linear_pendiente_reapertura", { ascending: false })
        .order("linear_ultima_sync", { ascending: true, nullsFirst: true }).order("id").limit(limite - mitad), "leer incidencias con ticket") ?? [];
      return [...porCrear, ...conTicket];
    },
    async reclamar(id, ahora, hasta) {
      const r = await sb.from("web_incidencias").update({ linear_bloqueo_hasta: hasta.toISOString() })
        .eq("id", id).or(`linear_bloqueo_hasta.is.null,linear_bloqueo_hasta.lt.${ahora.toISOString()}`).select("id");
      return (comprobar(r, "reclamar incidencia") ?? []).length > 0;
    },
    async actualizar(id, cambios) {
      comprobar(await sb.from("web_incidencias").update(cambios).eq("id", id), "actualizar incidencia");
    },
    async muestras(id) {
      return comprobar(await sb.from("web_eventos")
        .select("id, tipo, accion, categoria, ruta, objetivo, valor, ocurrido_en, secuencia, navegador, so, dispositivo, version, propiedades, mensaje")
        // Sin bots: los repartos (navegador, versión…) son de visitantes reales, como las cifras.
        .eq("incidencia_id", id).eq("es_bot", false).order("ocurrido_en", { ascending: false }).limit(50), "leer muestras") ?? [];
    },
    async ultimoErrorConSesion(id) {
      // Con consentimiento: solo esas tienen recorrido (sin él, el id de sesión es efímero y solo trae el error).
      const d = comprobar(await sb.from("web_eventos").select("id").eq("incidencia_id", id).eq("consentimiento", true).not("sesion_id", "is", null)
        .order("ocurrido_en", { ascending: false }).limit(1), "leer última ocurrencia");
      return d?.[0]?.id ?? null;
    },
    async contexto(eventoId) {
      const d = comprobar(await sb.rpc("web_contexto_evento", { p_evento_id: eventoId, p_antes: 15, p_despues: 5 }), "leer contexto") ?? [];
      // deno-lint-ignore no-explicit-any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return d.sort((a: any, b: any) => a.ocurrido_en.localeCompare(b.ocurrido_en) || (a.secuencia ?? 0) - (b.secuencia ?? 0) || a.id - b.id);
    },
    async ticketsCreadosDesde(desde, destino) {
      const r = await sb.from("web_incidencias").select("id", { count: "exact", head: true })
        .gte("linear_creado_en", desde.toISOString()).eq("linear_destino", destino);
      comprobar(r, "contar tickets");
      return r.count ?? 0;
    },
    async analisisDesde(desde) {
      const r = await sb.from("web_incidencias").select("id", { count: "exact", head: true }).gte("analisis_ia_en", desde.toISOString());
      comprobar(r, "contar análisis");
      return r.count ?? 0;
    },
    async ultimaPurga() {
      const d = comprobar(await sb.from("web_logs_estado").select("ultima_purga").eq("id", true).single(), "leer purga");
      return d?.ultima_purga ?? null;
    },
    async purgar() {
      return comprobar(await sb.rpc("web_logs_purgar", { p_lote: 20000 }), "purgar");
    },
  };
}

Deno.serve(conAuditoriaDePeticion("procesar-logs-web", createClientBase, async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "metodo_no_permitido" }, 405);

  const cuerpo = await req.clone().json().catch(() => ({})) as { accion?: unknown };

  // Probar la conexión con Linear: solo un super admin desde el panel.
  if (cuerpo?.accion === "probar_linear") {
    if (req.headers.get("x-webhook-secret") !== null) return json({ ok: false, error: "solo_panel" }, 403);
    const sa = await exigirSuperAdmin(req, { crearCliente: createClient, corsHeaders: cors });
    if (!sa.ok) return sa.response;
    return json(await probarConexion({ apiKey: LINEAR_API_KEY }));
  }

  // Autenticación: secreto del cron (falla cerrado) o super admin.
  const secreto = req.headers.get("x-webhook-secret");
  if (secreto !== null) {
    if (!CRON_SECRET) return json({ ok: false, error: "falta_secreto" }, 500);
    if (!compararTiempoConstante(secreto, CRON_SECRET)) return json({ ok: false, error: "no_autorizado" }, 401);
  } else {
    const sa = await exigirSuperAdmin(req, { crearCliente: createClient, corsHeaders: cors });
    if (!sa.ok) return sa.response;
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const resumen = await procesar({
    repo: crearRepo(sb),
    destino: (modo, config) => {
      if (modo === "prueba") {
        return crearDestinoPrueba({
          async buscarCreado(linearUuid) {
            const { data } = await sb.from("web_linear_prueba").select("id").eq("linear_uuid", linearUuid).eq("operacion", "crear").limit(1);
            return data?.[0] ?? null;
          },
          async insertar(fila) {
            const { data, error } = await sb.from("web_linear_prueba").insert(fila).select("id").single();
            if (error) throw new Error(`destino de pruebas: ${error.message}`);
            return data;
          },
        }, URL_PANEL);
      }
      if (modo === "real" && LINEAR_API_KEY && config.linear_equipo_id) return crearDestinoLinear({ apiKey: LINEAR_API_KEY });
      return null;
    },
    motivoSinDestino: (modo, config) =>
      modo === "real" && !LINEAR_API_KEY ? MENSAJES_LINEAR.sinClave
        : modo === "real" && !config.linear_equipo_id ? "Falta elegir el equipo de Linear: Logs › Configuración › Linear › «Probar conexión con Linear» y elige el equipo." : null,
    ia: crearLlamadaIa("procesar-logs-web", sb),
    despliegues: VERCEL_TOKEN ? (desdeMs) => leerDesplieguesVercel(VERCEL_TOKEN, desdeMs) : null,
    urlPanel: URL_PANEL,
    log: (m) => console.log(m),
  });
  return json(resumen, resumen.ocupado ? 202 : 200);
}));
