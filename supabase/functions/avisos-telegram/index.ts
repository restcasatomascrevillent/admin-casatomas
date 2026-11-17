import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { exigirSuperAdmin } from "../_shared/autorizacion.ts";
import { compararTiempoConstante } from "../_shared/tiempo-constante.ts";
import {
  type Accion, agruparEnMensajes, aplicarTopesPorGrupo, type Aviso, type ConfigTelegram, construirResumen, construirSemanal, cuerpoSendMessage, type DatosSemanales,
  diaMadrid, type Envio, errorSaneado, esAccion, evaluarPendientes, mensajeAviso, notaTope, type ReservaInfo, SIN_CONFIGURAR, silencioAhora,
  type Sugerencia, TEXTO_PRUEBA, TIPOS_RESERVA, TOPE_DIA, TOPE_HORA, TOPE_RESERVAS_DIA, TOPE_RESERVAS_HORA,
} from "./logica.ts";
import { type Contexto, type Fallo, idAlbaran, mensajeFallo } from "./fallos.ts";
const createClient = clienteConAuditoria(createClientBase, "avisos-telegram");

// ============================================================================
//  avisos-telegram · Avisos del panel por Telegram (11-nov-2026)
// ----------------------------------------------------------------------------
//  POST { accion: "pendientes" }  manda al momento los avisos nuevos de los tipos
//       marcados (avisos_telegram_config.tipos_al_momento) sin enviar, fuera del
//       silencio nocturno. Varios a la vez van juntos en mensajes de ≤ 4.096.
//  POST { accion: "resumen" }     un mensaje con los avisos de las últimas 24 h
//       agrupados por tipo; guarda resumen_ultimo_dia (uno al día).
//  POST { accion: "fallos" }      fallos internos para desarrolladores (fallos.ts): un mensaje
//       por fila pendiente de fallos_internos, sin silencio nocturno.
//  POST { accion: "semanal" }     resumen semanal del dueño (lunes por la mañana, configurable): vinos y
//       tienda bajo el mínimo de margen, facturas por verificar y albaranes sin factura (RPC
//       avisos_telegram_datos_semanal). Sin nada que contar, no manda nada.
//  POST { accion: "probar" }      «Prueba de avisos de Casa Tomás» al chat
//       configurado (aunque esté desactivado: sirve para montarlo).
//  Todo queda en avisos_telegram_envios (ok o error).
//
//  Secretos: TELEGRAM_BOT_TOKEN (sin él no envía nada, responde y registra
//  «Telegram sin configurar»); PANEL_URL opcional (enlace al panel en cada aviso).
//  18/11/2026 (revisión de producción): el resumen no cuela avisos con campana=false ni unidades dudosas ni
//  repite «Por revisar» cada día, y no se manda vacío; sin nombres de clientes (RGPD); las reservas nuevas y
//  canceladas de hoy y mañana van al momento (no las pendientes de verificar ni las canceladas desde el
//  panel); tope de avisos al momento por hora y día («…y N más»).
//  14/11/2026: mensajes de 2-4 líneas (título, qué ha pasado, qué hacer, enlace). En
//  «Margen bajo» con precio sugerido (RPC avisos_precio_sugerido), el enlace abre
//  /aplicar-precio/<aviso> en el panel: sesión + permiso de carta + confirmación.
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
const NOTA_TOPE = "nota tope";

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

const pausa = () => new Promise((r) => setTimeout(r, 1100)); // Telegram: ~20 mensajes/min por grupo

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any;

/** Las reservas de los avisos de reserva (por id), para filtrar por estado y no mandar nombres. null si no se pueden leer. */
async function cargarReservas(sb: Cliente, avisos: Aviso[]): Promise<Map<string, ReservaInfo> | null> {
  const ids = [...new Set(avisos.filter((a) => TIPOS_RESERVA.includes(a.tipo) && a.referencia_id).map((a) => a.referencia_id as string))];
  const mapa = new Map<string, ReservaInfo>();
  if (ids.length === 0) return mapa;
  let { data, error } = await sb.from("reservas").select("id, fecha, hora, numero_comensales, canal, estado, cancelada_por").in("id", ids);
  if (error) {
    // Sin la columna cancelada_por (migración 20261205100200 sin aplicar).
    ({ data, error } = await sb.from("reservas").select("id, fecha, hora, numero_comensales, canal, estado").in("id", ids));
  }
  if (error) {
    console.warn("[avisos-telegram] reservas:", error.message);
    return null;
  }
  for (const r of (data ?? []) as ReservaInfo[]) mapa.set(r.id, r);
  return mapa;
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
  if (!accion) return json({ ok: false, error: "Acción desconocida (pendientes, resumen, semanal, fallos o probar)" }, 400);

  const sb = createClient(URL_SB, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: cfgFila, error: eCfg } = await sb.from("avisos_telegram_config").select("*").eq("id", true).maybeSingle();
  if (eCfg) {
    const falta = /does not exist|schema cache/i.test(eCfg.message ?? "");
    return json({ ok: false, error: falta ? "Falta la migración 20261126001000_avisos_telegram" : eCfg.message }, 500);
  }
  const cfg = cfgFila as ConfigTelegram | null;
  const chatId = cfg?.chat_id?.trim() ?? "";

  const registrar = async (filas: { tipo: string; aviso_id?: string | null; fallo_id?: number | null; ok: boolean; error?: string | null; mensaje_id?: number | null }[]) => {
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

  if (accion === "fallos") {
    // Fallos internos (tabla fallos_internos): un mensaje por fallo, sin silencio nocturno.
    const { data: filas, error: eRec } = await sb.rpc("fallos_internos_reclamar", { p_limite: 20 });
    if (eRec) return json({ ok: false, error: eRec.message }, 500);
    const fallos = (filas ?? []) as Fallo[];
    let enviados = 0;
    const errores: string[] = [];
    for (const [i, f] of fallos.entries()) {
      if (i > 0) await pausa();
      const ctx: Contexto = {};
      const idAlb = f.tipo === "albaran_aviso" ? idAlbaran(f) : null;
      if (idAlb) {
        const { data: alb } = await sb.from("facturas").select("id, proveedor, fecha").eq("id", idAlb).maybeSingle();
        if (alb) ctx.albaran = alb as Contexto["albaran"];
      }
      const r = await enviarTelegram(chatId, mensajeFallo(f, ctx));
      await registrar([{ tipo: "fallo", fallo_id: f.id, ok: r.ok, error: r.ok ? null : r.error, mensaje_id: r.ok ? r.mensaje_id : null }]);
      await sb.from("fallos_internos").update(r.ok ? { enviado_en: new Date().toISOString(), ultimo_error: null } : { ultimo_error: r.error }).eq("id", f.id);
      if (r.ok) enviados++;
      else errores.push(r.error);
    }
    console.log(`[avisos-telegram] ${quien} · fallos · ${enviados}/${fallos.length}${errores.length ? ` · ${errores[0]}` : ""}`);
    return json({ ok: errores.length === 0, enviados, fallos: fallos.length, error: errores[0] });
  }

  if (accion === "semanal") {
    if (cfg.semanal_activo === false) return json({ ok: true, enviados: 0, motivo: "semanal apagada" });
    const { data, error: eSem } = await sb.rpc("avisos_telegram_datos_semanal");
    if (eSem) return json({ ok: false, error: eSem.message }, 500);
    const datosSem = (data ?? {}) as DatosSemanales;
    // Total de albaranes sin factura (el aviso solo cuenta los de más de 35 días); si falla, se omite esa línea.
    const { data: tot, error: eTot } = await sb.rpc("avisos_telegram_albaranes_total");
    if (eTot) console.warn("[avisos-telegram] albaranes total:", eTot.message);
    else if (datosSem.albaranes) datosSem.albaranes = { ...datosSem.albaranes, ...(tot as object) };
    const semanal = construirSemanal(datosSem, ahora, PANEL_URL);
    const marcar = async () => {
      const { error } = await sb.from("avisos_telegram_config").update({ semanal_ultimo_dia: diaMadrid(ahora) }).eq("id", true);
      if (error) console.error("[avisos-telegram] semanal_ultimo_dia:", error.message);
    };
    if (!semanal.texto) {
      await marcar(); // nada que contar: no se manda y no se vuelve a mirar hoy
      return json({ ok: true, secciones: 0, omitido: true });
    }
    const r = await enviarTelegram(chatId, semanal.texto);
    await registrar([{ tipo: "semanal", ok: r.ok, error: r.ok ? null : r.error, mensaje_id: r.ok ? r.mensaje_id : null }]);
    if (r.ok) await marcar();
    console.log(`[avisos-telegram] ${quien} · semanal · ${semanal.secciones} secciones · ${r.ok ? "ok" : r.error}`);
    return json(r.ok ? { ok: true, secciones: semanal.secciones } : { ok: false, error: r.error });
  }

  if (accion === "pendientes") {
    if (silencioAhora(cfg, ahora)) return json({ ok: true, enviados: 0, motivo: "silencio" });
    const desde = new Date(ahora.getTime() - 24 * 3600_000).toISOString();
    // Los tipos marcados y, salvo que se apague, las reservas nuevas/canceladas (solo valen las de hoy y mañana).
    const tipos = [...cfg.tipos_al_momento, ...(cfg.reservas_al_momento === false ? [] : TIPOS_RESERVA)];
    const { data: avisos, error: eAv } = await sb.from("notificaciones_dashboard")
      .select("id, tipo, titulo, mensaje, referencia_tipo, referencia_id, created_at, caduca_en, datos")
      .in("tipo", tipos.length ? tipos : ["-"])
      .gt("created_at", desde).order("created_at", { ascending: true }).limit(200);
    if (eAv) return json({ ok: false, error: eAv.message }, 500);
    const lista = (avisos ?? []) as Aviso[];
    const ids = lista.map((a) => a.id);
    let envios: Envio[] = [];
    if (ids.length) {
      const { data, error } = await sb.from("avisos_telegram_envios").select("aviso_id, ok").in("aviso_id", ids);
      if (error) return json({ ok: false, error: error.message }, 500);
      envios = (data ?? []) as Envio[];
    }
    const reservas = await cargarReservas(sb, lista);
    const ev = evaluarPendientes(lista, envios, cfg, ahora, { reservas });
    // Lo que no se va a mandar nunca (unidades dudosas, reserva cancelada desde el panel…) se da por consumido.
    await registrar(ev.descartar.map((d) => ({ tipo: "aviso", aviso_id: d.aviso.id, ok: true, error: d.motivo })));

    // Topes contra la inundación: por hora y por día (solo cuentan los envíos correctos de avisos). Las reservas
    // tienen el suyo y se cuentan aparte, para que los avisos de precio no las dejen sin avisar.
    const desdeHora = new Date(ahora.getTime() - 3600_000).toISOString();
    const { data: envsOk } = await sb.from("avisos_telegram_envios").select("aviso_id, enviado_en")
      .eq("tipo", "aviso").eq("ok", true).is("error", null).gte("enviado_en", desde).limit(2000);
    const idsEnv = [...new Set((envsOk ?? []).map((e: { aviso_id: string | null }) => e.aviso_id).filter(Boolean))] as string[];
    const idsReserva = new Set<string>();
    if (idsEnv.length) {
      const { data: tr } = await sb.from("notificaciones_dashboard").select("id").in("id", idsEnv).in("tipo", TIPOS_RESERVA);
      for (const x of tr ?? []) idsReserva.add((x as { id: string }).id);
    }
    const usados = { hora: 0, dia: 0, reservasHora: 0, reservasDia: 0 };
    for (const e of (envsOk ?? []) as { aviso_id: string | null; enviado_en: string }[]) {
      const res = !!e.aviso_id && idsReserva.has(e.aviso_id);
      const reciente = e.enviado_en >= desdeHora;
      if (res) { usados.reservasDia++; if (reciente) usados.reservasHora++; } else { usados.dia++; if (reciente) usados.hora++; }
    }
    const topes = { hora: cfg.tope_hora ?? TOPE_HORA, dia: cfg.tope_dia ?? TOPE_DIA, reservasHora: TOPE_RESERVAS_HORA, reservasDia: TOPE_RESERVAS_DIA };
    const { enviar, resto } = aplicarTopesPorGrupo(ev.enviar, (a) => TIPOS_RESERVA.includes(a.tipo), usados, topes);
    const pendientes = enviar.slice(0, 50);
    // El resto va en una nota («…y N más»); si no hay nada que mandar, la nota sale como mucho una vez por hora.
    let nota: string | null = null;
    if (resto.length > 0) {
      const { data: previa } = await sb.from("avisos_telegram_envios").select("id").eq("tipo", "pendientes").eq("ok", true).eq("error", NOTA_TOPE)
        .gte("enviado_en", new Date(ahora.getTime() - 3600_000).toISOString()).limit(1);
      if (pendientes.length > 0 || !previa?.length) nota = notaTope(resto.length, PANEL_URL);
    }
    // Margen bajo: el precio sugerido (20261130160000) para «Qué hacer» y el enlace «Aplicar el precio».
    const sugerencias = new Map<string, Sugerencia | null>();
    for (const a of pendientes.filter((x) => x.tipo === "facturas_margen_bajo")) {
      const { data, error } = await sb.rpc("avisos_precio_sugerido", { p_aviso: a.id });
      if (error) console.warn("[avisos-telegram] precio sugerido:", error.message);
      sugerencias.set(a.id, (data as Sugerencia | null) ?? null);
    }
    const textos = pendientes.map((a) => mensajeAviso(a, PANEL_URL, sugerencias.get(a.id), { ahora, reservas }));
    if (nota && textos.length > 0) textos[textos.length - 1] += `\n\n${nota}`;
    const mensajes = agruparEnMensajes(textos);
    if (nota && textos.length === 0) mensajes.push({ texto: nota, indices: [] });
    let enviados = 0;
    let notaEnviada = false;
    const errores: string[] = [];
    for (const [i, m] of mensajes.entries()) {
      if (i > 0) await pausa();
      const r = await enviarTelegram(chatId, m.texto);
      await registrar(m.indices.map((k) => ({
        tipo: "aviso", aviso_id: pendientes[k].id, ok: r.ok, error: r.ok ? null : r.error, mensaje_id: r.ok ? r.mensaje_id : null,
      })));
      if (r.ok) {
        enviados += m.indices.length;
        if (nota && (m.indices.includes(textos.length - 1) || textos.length === 0)) notaEnviada = true;
      } else errores.push(r.error);
    }
    if (nota && notaEnviada) {
      await registrar([
        ...resto.map((a) => ({ tipo: "aviso", aviso_id: a.id, ok: true, error: `tope: agrupado en «…y ${resto.length} más»` })),
        { tipo: "pendientes", ok: true, error: NOTA_TOPE },
      ]);
    }
    console.log(`[avisos-telegram] ${quien} · pendientes · ${enviados}/${pendientes.length}${resto.length ? ` · tope: ${resto.length} más` : ""}${errores.length ? ` · ${errores[0]}` : ""}`);
    return json({ ok: errores.length === 0, enviados, pendientes: pendientes.length, tope: resto.length, error: errores[0] });
  }

  // resumen
  const desde = new Date(ahora.getTime() - 24 * 3600_000).toISOString();
  const { data: avisos, error: eAv } = await sb.from("notificaciones_dashboard")
    .select("id, tipo, titulo, mensaje, referencia_tipo, referencia_id, created_at, caduca_en, datos")
    .gt("created_at", desde).order("created_at", { ascending: false }).limit(500);
  if (eAv) return json({ ok: false, error: eAv.message }, 500);
  const lista = (avisos ?? []) as Aviso[];
  const reservas = await cargarReservas(sb, lista);
  const resumen = construirResumen(lista, ahora, PANEL_URL, { reservas, revision: cfg.resumen_revision ?? {} });
  if (resumen.total === 0 || !resumen.texto) {
    // Nada que contar: no se manda «sin avisos», y hoy no se vuelve a mirar.
    const { error } = await sb.from("avisos_telegram_config").update({ resumen_ultimo_dia: diaMadrid(ahora) }).eq("id", true);
    if (error) console.error("[avisos-telegram] resumen_ultimo_dia:", error.message);
    console.log(`[avisos-telegram] ${quien} · resumen · sin avisos que contar: no se envía`);
    return json({ ok: true, total: 0, omitido: true });
  }
  const r = await enviarTelegram(chatId, resumen.texto);
  await registrar([{ tipo: "resumen", ok: r.ok, error: r.ok ? null : r.error, mensaje_id: r.ok ? r.mensaje_id : null }]);
  if (r.ok) {
    const { error } = await sb.from("avisos_telegram_config").update({ resumen_ultimo_dia: diaMadrid(ahora), resumen_revision: resumen.revision }).eq("id", true);
    if (error) console.error("[avisos-telegram] resumen_ultimo_dia:", error.message);
  }
  console.log(`[avisos-telegram] ${quien} · resumen · ${resumen.total} avisos · ${r.ok ? "ok" : r.error}`);
  return json(r.ok ? { ok: true, total: resumen.total } : { ok: false, error: r.error });
}));
