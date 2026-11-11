import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { exigirSuperAdmin } from "../_shared/autorizacion.ts";
import { compararTiempoConstante } from "../_shared/tiempo-constante.ts";
import {
  type Accion, agruparEnMensajes, type Aviso, type ConfigTelegram, construirResumen, cuerpoSendMessage, diaMadrid, type Envio, errorSaneado, esAccion,
  mensajeAviso, pendientesDeEnvio, SIN_CONFIGURAR, silencioAhora, TEXTO_PRUEBA,
} from "./logica.ts";
const createClient = clienteConAuditoria(createClientBase, "avisos-telegram");

// ============================================================================
//  avisos-telegram · Avisos del panel por Telegram (11-nov-2026)
// ----------------------------------------------------------------------------
//  POST { accion: "pendientes" }  manda al momento los avisos nuevos de los tipos
//       marcados (avisos_telegram_config.tipos_al_momento) sin enviar, fuera del
//       silencio nocturno. Varios a la vez van juntos en mensajes de ≤ 4.096.
//  POST { accion: "resumen" }     un mensaje con los avisos de las últimas 24 h
//       agrupados por tipo; guarda resumen_ultimo_dia (uno al día).
//  POST { accion: "probar" }      «Prueba de avisos de Casa Tomás» al chat
//       configurado (aunque esté desactivado: sirve para montarlo).
//  Todo queda en avisos_telegram_envios (ok o error).
//
//  Secretos: TELEGRAM_BOT_TOKEN (sin él no envía nada, responde y registra
//  «Telegram sin configurar»); PANEL_URL opcional (enlace al panel en cada aviso).
//  La llaman: pg_cron (avisos-telegram-pendientes cada 5 min y
//  avisos-telegram-resumen cada hora, x-ocr-secret = Vault «ocr_trabajos_secret»)
//  y un SUPER ADMIN con su JWT desde Super Admin › Servicios › Configurar.
//  verify_jwt = false (pg_net no lleva JWT): la autenticación es el secreto o el
//  super admin. Texto plano (sin parse_mode): no hay HTML que escapar.
// ============================================================================

const SECRETO = Deno.env.get("OCR_TRABAJOS_SECRET");
const URL_SB = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = (Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "").trim();
const PANEL_URL = Deno.env.get("PANEL_URL") ?? null;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

type Resultado = { ok: true; mensaje_id: number | null } | { ok: false; error: string };

async function enviarTelegram(chatId: string, texto: string): Promise<Resultado> {
  const control = new AbortController();
  const t = setTimeout(() => control.abort(), 15_000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpoSendMessage(chatId, texto)),
      signal: control.signal,
    });
    const cuerpo = await res.json().catch(() => null) as { ok?: boolean; description?: string; result?: { message_id?: number } } | null;
    if (!res.ok || !cuerpo?.ok) return { ok: false, error: errorSaneado(`Telegram ${res.status}: ${cuerpo?.description ?? "sin respuesta"}`) };
    return { ok: true, mensaje_id: cuerpo.result?.message_id ?? null };
  } catch (e) {
    return { ok: false, error: errorSaneado(`Telegram no responde: ${(e as Error)?.name ?? "error"}`) };
  } finally {
    clearTimeout(t);
  }
}

serve(conAuditoriaDePeticion("avisos-telegram", createClientBase, async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let quien: string;
  if (req.headers.has("x-ocr-secret")) {
    if (!SECRETO) return json({ ok: false, error: "server_misconfigured" }, 500);
    if (!compararTiempoConstante(req.headers.get("x-ocr-secret") ?? "", SECRETO)) return json({ ok: false, error: "unauthorized" }, 401);
    quien = "servidor";
  } else {
    const sa = await exigirSuperAdmin(req, { crearCliente: createClient, corsHeaders });
    if (!sa.ok) return sa.response;
    quien = `usuario:${sa.userId}`;
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // sin cuerpo
  }
  const accion: Accion | null = esAccion(body.accion) ? body.accion : null;
  if (!accion) return json({ ok: false, error: "Acción desconocida (pendientes, resumen o probar)" }, 400);

  const sb = createClient(URL_SB, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: cfgFila, error: eCfg } = await sb.from("avisos_telegram_config").select("*").eq("id", true).maybeSingle();
  if (eCfg) {
    const falta = /does not exist|schema cache/i.test(eCfg.message ?? "");
    return json({ ok: false, error: falta ? "Falta la migración 20261126001000_avisos_telegram" : eCfg.message }, 500);
  }
  const cfg = cfgFila as ConfigTelegram | null;
  const chatId = cfg?.chat_id?.trim() ?? "";

  const registrar = async (filas: { tipo: string; aviso_id?: string | null; ok: boolean; error?: string | null; mensaje_id?: number | null }[]) => {
    if (filas.length === 0) return;
    const { error } = await sb.from("avisos_telegram_envios").insert(filas.map((f) => ({ chat_id: chatId || null, ...f })));
    if (error) console.error("[avisos-telegram] registro:", error.message);
  };

  // Sin token: no se envía nada. Se registra (como mucho una vez por hora y acción) y se responde sin fallar.
  if (!TOKEN) {
    const { data: reciente } = await sb.from("avisos_telegram_envios").select("id")
      .eq("tipo", accion === "pendientes" ? "pendientes" : accion === "resumen" ? "resumen" : "prueba")
      .eq("error", SIN_CONFIGURAR).gte("enviado_en", new Date(Date.now() - 3600_000).toISOString()).limit(1);
    if (accion === "probar" || !reciente?.length) {
      await registrar([{ tipo: accion === "probar" ? "prueba" : accion, ok: false, error: SIN_CONFIGURAR }]);
    }
    console.warn(`[avisos-telegram] ${quien} · ${accion}: ${SIN_CONFIGURAR} (falta TELEGRAM_BOT_TOKEN)`);
    return json({ ok: false, sin_configurar: true, error: SIN_CONFIGURAR });
  }
  if (!chatId) return json({ ok: false, error: "Falta el chat_id de Telegram en la configuración" });

  if (accion === "probar") {
    const r = await enviarTelegram(chatId, TEXTO_PRUEBA);
    await registrar([{ tipo: "prueba", ok: r.ok, error: r.ok ? null : r.error, mensaje_id: r.ok ? r.mensaje_id : null }]);
    console.log(`[avisos-telegram] ${quien} · probar · ${r.ok ? "ok" : r.error}`);
    return json(r.ok ? { ok: true } : { ok: false, error: r.error });
  }

  if (!cfg?.activo) return json({ ok: true, enviados: 0, motivo: "inactivo" });
  const ahora = new Date();

  if (accion === "pendientes") {
    if (silencioAhora(cfg, ahora)) return json({ ok: true, enviados: 0, motivo: "silencio" });
    const desde = new Date(ahora.getTime() - 24 * 3600_000).toISOString();
    const { data: avisos, error: eAv } = await sb.from("notificaciones_dashboard")
      .select("id, tipo, titulo, mensaje, referencia_tipo, created_at, caduca_en, datos")
      .in("tipo", cfg.tipos_al_momento.length ? cfg.tipos_al_momento : ["-"])
      .gt("created_at", desde).order("created_at", { ascending: true }).limit(200);
    if (eAv) return json({ ok: false, error: eAv.message }, 500);
    const ids = (avisos ?? []).map((a) => a.id as string);
    let envios: Envio[] = [];
    if (ids.length) {
      const { data, error } = await sb.from("avisos_telegram_envios").select("aviso_id, ok").in("aviso_id", ids);
      if (error) return json({ ok: false, error: error.message }, 500);
      envios = (data ?? []) as Envio[];
    }
    const pendientes = pendientesDeEnvio((avisos ?? []) as Aviso[], envios, cfg, ahora).slice(0, 50);
    const mensajes = agruparEnMensajes(pendientes.map((a) => mensajeAviso(a, PANEL_URL)));
    let enviados = 0;
    const errores: string[] = [];
    for (const m of mensajes) {
      const r = await enviarTelegram(chatId, m.texto);
      await registrar(m.indices.map((i) => ({
        tipo: "aviso", aviso_id: pendientes[i].id, ok: r.ok, error: r.ok ? null : r.error, mensaje_id: r.ok ? r.mensaje_id : null,
      })));
      if (r.ok) enviados += m.indices.length;
      else errores.push(r.error);
    }
    console.log(`[avisos-telegram] ${quien} · pendientes · ${enviados}/${pendientes.length}${errores.length ? ` · ${errores[0]}` : ""}`);
    return json({ ok: errores.length === 0, enviados, pendientes: pendientes.length, error: errores[0] });
  }

  // resumen
  const desde = new Date(ahora.getTime() - 24 * 3600_000).toISOString();
  const { data: avisos, error: eAv } = await sb.from("notificaciones_dashboard")
    .select("id, tipo, titulo, mensaje, referencia_tipo, created_at, caduca_en, datos")
    .gt("created_at", desde).order("created_at", { ascending: false }).limit(500);
  if (eAv) return json({ ok: false, error: eAv.message }, 500);
  const resumen = construirResumen((avisos ?? []) as Aviso[], ahora, PANEL_URL);
  const r = await enviarTelegram(chatId, resumen.texto);
  await registrar([{ tipo: "resumen", ok: r.ok, error: r.ok ? null : r.error, mensaje_id: r.ok ? r.mensaje_id : null }]);
  if (r.ok) {
    const { error } = await sb.from("avisos_telegram_config").update({ resumen_ultimo_dia: diaMadrid(ahora) }).eq("id", true);
    if (error) console.error("[avisos-telegram] resumen_ultimo_dia:", error.message);
  }
  console.log(`[avisos-telegram] ${quien} · resumen · ${resumen.total} avisos · ${r.ok ? "ok" : r.error}`);
  return json(r.ok ? { ok: true, total: resumen.total } : { ok: false, error: r.error });
}));
