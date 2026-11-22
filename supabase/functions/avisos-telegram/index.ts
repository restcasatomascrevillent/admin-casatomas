import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { exigirSuperAdmin } from "../_shared/autorizacion.ts";
import { compararTiempoConstante } from "../_shared/tiempo-constante.ts";
import {
  type Accion, agruparEnMensajes, aplicarTopes, type Aviso, type CanalAviso, canalDeTipo, chatDe, type ConfigTelegram, construirResumen, construirSemanal,
  cuerpoSendMessage, type DatosSemanales, destinos, diaMadrid, type Envio, errorSaneado, esAccion, evaluarPendientes, mensajeAviso, NOMBRE_CANAL, notaTope,
  type ReservaInfo, SIN_CONFIGURAR, silencioAhora, type Sugerencia, textoPrueba, tipoRegistro, TIPOS_RESERVA, topesDeCanal,
} from "./logica.ts";
import { type Contexto, type Fallo, idAlbaran, mensajeFallo } from "./fallos.ts";
const createClient = clienteConAuditoria(createClientBase, "avisos-telegram");

// ============================================================================
//  avisos-telegram · Avisos del panel por Telegram (11-nov-2026)
// ----------------------------------------------------------------------------
//  22/11/2026 (dueño: «diferentes subchats para que no se pete uno» y «mensajes más concisos»): cuatro
//  chats, uno por canal (migración 20261216100000):
//    Reservas             reservas nuevas y canceladas de hoy y mañana         chat_reservas  (o chat_id)
//    Facturas y márgenes  los demás avisos al momento (precio, margen…)        chat_facturas  (o chat_id)
//    Resúmenes            resumen diario y semanal                              chat_resumenes (o chat_id)
//    Fallos técnicos      fallos internos para desarrolladores                  chat_fallos (sin él, no se envían)
//  Cada aviso es UNA línea con emoji (y el enlace debajo si sirve para actuar). El resumen diario no repite lo
//  que ya llegó al momento. Cada canal tiene su tope; si Telegram pide esperar (429), no cuenta como fallo.
//
//  POST { accion: "pendientes" }  manda al momento los avisos nuevos (tipos marcados en tipos_al_momento y,
//       salvo que se apague, las reservas de hoy y mañana) fuera del silencio nocturno, cada uno a su canal.
//  POST { accion: "resumen" }     un mensaje con los avisos de las últimas 24 h que no salieron al momento;
//       guarda resumen_ultimo_dia (uno al día).
//  POST { accion: "fallos" }      fallos internos (fallos.ts): un mensaje por fila pendiente de fallos_internos,
//       sin silencio nocturno.
//  POST { accion: "semanal" }     resumen semanal del dueño (lunes por la mañana, configurable).
//  POST { accion: "probar" }      una prueba a cada chat configurado, diciendo qué llegará ahí (aunque esté
//       desactivado: sirve para montarlo).
//  Todo queda en avisos_telegram_envios (ok o error, con el chat).
//
//  Secretos: TELEGRAM_BOT_TOKEN (sin él no envía nada, responde y registra «Telegram sin configurar»);
//  PANEL_URL opcional (enlaces al panel). La llaman pg_cron (avisos_telegram_disparar, x-ocr-secret = Vault
//  «ocr_trabajos_secret») y un SUPER ADMIN con su JWT desde Super Admin › Servicios › Configurar.
//  verify_jwt = false (pg_net no lleva JWT): la autenticación es el secreto o el super admin. Texto plano
//  (sin parse_mode): no hay HTML que escapar. Sin nombres de clientes (RGPD).
// ============================================================================

const SECRETO = Deno.env.get("OCR_TRABAJOS_SECRET");
const URL_SB = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = (Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "").trim();
const PANEL_URL = Deno.env.get("PANEL_URL") ?? null;
/** Registro de la nota «➕ N avisos más» de cada canal (como mucho una por hora si no hay nada más que mandar). */
const notaTopeDe = (canal: CanalAviso) => `nota tope · ${canal}`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/** Resultado de un envío. `esperar`: Telegram pidió parar (429); no es un fallo del aviso, se reintenta luego. */
type Resultado = { ok: true; mensaje_id: number | null } | { ok: false; error: string; esperar?: boolean };

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
    if (!res.ok || !cuerpo?.ok) {
      return { ok: false, error: errorSaneado(`Telegram ${res.status}: ${cuerpo?.description ?? "sin respuesta"}`), esperar: res.status === 429 };
    }
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
  const { data, error } = await sb.from("reservas").select("id, fecha, hora, numero_comensales, canal, estado, cancelada_por").in("id", ids);
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
  const cfg = (cfgFila ?? { chat_id: null }) as ConfigTelegram;
  if (cfgFila && !("chat_fallos" in cfgFila)) return json({ ok: false, error: "Falta la migración 20261216100000_telegram_canales" }, 500);

  type Fila = { tipo: string; chat: string | null; aviso_id?: string | null; fallo_id?: number | null; ok: boolean; error?: string | null; mensaje_id?: number | null };
  const registrar = async (filas: Fila[]) => {
    if (filas.length === 0) return;
    const { error } = await sb.from("avisos_telegram_envios").insert(filas.map(({ chat, ...f }) => ({ chat_id: chat, ...f })));
    if (error) console.error("[avisos-telegram] registro:", error.message);
  };
  const resultadoFila = (r: Resultado) => ({ ok: r.ok, error: r.ok ? null : r.error, mensaje_id: r.ok ? r.mensaje_id : null });

  // Sin token: no se envía nada. Se registra (como mucho una vez por hora y acción) y se responde sin fallar.
  if (!TOKEN) {
    const tipo = tipoRegistro(accion);
    const { data: reciente } = await sb.from("avisos_telegram_envios").select("id")
      .eq("tipo", tipo).eq("error", SIN_CONFIGURAR).gte("enviado_en", new Date(Date.now() - 3600_000).toISOString()).limit(1);
    if (accion === "probar" || !reciente?.length) await registrar([{ tipo, chat: null, ok: false, error: SIN_CONFIGURAR }]);
    console.warn(`[avisos-telegram] ${quien} · ${accion}: ${SIN_CONFIGURAR} (falta TELEGRAM_BOT_TOKEN)`);
    return json({ ok: false, sin_configurar: true, error: SIN_CONFIGURAR });
  }

  if (accion === "probar") {
    const lista = destinos(cfg);
    if (lista.length === 0) return json({ ok: false, error: "Falta el chat de Telegram en la configuración" });
    const resultados: { chat: string; canales: string[]; ok: boolean; error?: string }[] = [];
    for (const [i, d] of lista.entries()) {
      if (i > 0) await pausa();
      const r = await enviarTelegram(d.chat, textoPrueba(d.canales));
      await registrar([{ tipo: "prueba", chat: d.chat, ...resultadoFila(r) }]);
      resultados.push({ chat: d.chat, canales: d.canales.map((c) => NOMBRE_CANAL[c]), ok: r.ok, ...(r.ok ? {} : { error: r.error }) });
    }
    const fallidos = resultados.filter((r) => !r.ok);
    console.log(`[avisos-telegram] ${quien} · probar · ${resultados.length - fallidos.length}/${resultados.length}${fallidos.length ? ` · ${fallidos[0].error}` : ""}`);
    return json({
      ok: fallidos.length === 0,
      resultados,
      ...(fallidos.length ? { error: fallidos.map((f) => `${f.canales.join(", ")}: ${f.error}`).join(" · ") } : {}),
    });
  }

  if (!cfg.activo) return json({ ok: true, enviados: 0, motivo: "inactivo" });
  const ahora = new Date();

  if (accion === "fallos") {
    // Fallos internos (tabla fallos_internos): un mensaje por fallo, sin silencio nocturno, solo a su chat.
    const chat = chatDe(cfg, "fallos");
    if (!chat) return json({ ok: true, enviados: 0, motivo: "sin chat de Fallos técnicos" });
    const { data: filas, error: eRec } = await sb.rpc("fallos_internos_reclamar", { p_limite: 20 });
    if (eRec) return json({ ok: false, error: eRec.message }, 500);
    const fallos = (filas ?? []) as (Fallo & { intentos?: number })[];
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
      const r = await enviarTelegram(chat, mensajeFallo(f, ctx));
      await registrar([{ tipo: "fallo", chat, fallo_id: f.id, ...resultadoFila(r) }]);
      if (!r.ok && r.esperar) {
        // Telegram pide esperar: este y los que quedan se devuelven a la cola sin gastar un intento.
        for (const g of fallos.slice(i)) {
          await sb.from("fallos_internos").update({ intentos: Math.max(0, (g.intentos ?? 1) - 1), reclamado_en: null, ultimo_error: r.error }).eq("id", g.id);
        }
        errores.push(r.error);
        break;
      }
      await sb.from("fallos_internos").update(r.ok ? { enviado_en: new Date().toISOString(), ultimo_error: null } : { ultimo_error: r.error }).eq("id", f.id);
      if (r.ok) enviados++;
      else errores.push(r.error);
    }
    console.log(`[avisos-telegram] ${quien} · fallos · ${enviados}/${fallos.length}${errores.length ? ` · ${errores[0]}` : ""}`);
    return json({ ok: errores.length === 0, enviados, fallos: fallos.length, error: errores[0] });
  }

  if (accion === "semanal") {
    if (cfg.semanal_activo === false) return json({ ok: true, enviados: 0, motivo: "semanal apagada" });
    const chat = chatDe(cfg, "resumenes");
    if (!chat) return json({ ok: true, enviados: 0, motivo: "sin chat de Resúmenes" });
    const { data, error: eSem } = await sb.rpc("avisos_telegram_datos_semanal");
    if (eSem) return json({ ok: false, error: eSem.message }, 500);
    const datosSem = (data ?? {}) as DatosSemanales;
    // Total de albaranes sin factura (el aviso solo cuenta los de más de 35 días); si falla, se omite esa parte.
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
    const r = await enviarTelegram(chat, semanal.texto);
    await registrar([{ tipo: "semanal", chat, ...resultadoFila(r) }]);
    if (r.ok) await marcar();
    console.log(`[avisos-telegram] ${quien} · semanal · ${semanal.secciones} secciones · ${r.ok ? "ok" : r.error}`);
    return json(r.ok ? { ok: true, secciones: semanal.secciones } : { ok: false, error: r.error });
  }

  if (accion === "pendientes") {
    if (silencioAhora(cfg, ahora)) return json({ ok: true, enviados: 0, motivo: "silencio" });
    const chats: Record<CanalAviso, string | null> = { reservas: chatDe(cfg, "reservas"), facturas: chatDe(cfg, "facturas") };
    const canales = new Set((Object.keys(chats) as CanalAviso[]).filter((c) => chats[c]));
    if (canales.size === 0) return json({ ok: true, enviados: 0, motivo: "sin chat" });
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
    const ev = evaluarPendientes(lista, envios, cfg, ahora, { reservas, canales });
    // Lo que no se va a mandar nunca (unidades dudosas, reserva cancelada desde el panel…) se da por consumido.
    await registrar(ev.descartar.map((d) => ({ tipo: "aviso", chat: null, aviso_id: d.aviso.id, ok: true, error: d.motivo })));

    // Lo ya mandado en las últimas 24 h, por canal (solo los envíos correctos de avisos): para los topes.
    const desdeHora = new Date(ahora.getTime() - 3600_000).toISOString();
    const { data: envsOk } = await sb.from("avisos_telegram_envios").select("aviso_id, enviado_en")
      .eq("tipo", "aviso").eq("ok", true).is("error", null).gte("enviado_en", desde).limit(2000);
    const idsEnv = [...new Set((envsOk ?? []).map((e: { aviso_id: string | null }) => e.aviso_id).filter(Boolean))] as string[];
    const canalDe = new Map<string, CanalAviso>();
    if (idsEnv.length) {
      const { data: tt } = await sb.from("notificaciones_dashboard").select("id, tipo").in("id", idsEnv);
      for (const x of (tt ?? []) as { id: string; tipo: string }[]) canalDe.set(x.id, canalDeTipo(x.tipo));
    }
    const usados: Record<CanalAviso, { hora: number; dia: number }> = { reservas: { hora: 0, dia: 0 }, facturas: { hora: 0, dia: 0 } };
    for (const e of (envsOk ?? []) as { aviso_id: string | null; enviado_en: string }[]) {
      const c = (e.aviso_id && canalDe.get(e.aviso_id)) || "facturas";
      usados[c].dia++;
      if (e.enviado_en >= desdeHora) usados[c].hora++;
    }

    let enviados = 0;
    let total = 0;
    let topados = 0;
    const errores: string[] = [];
    let primero = true;
    for (const canal of canales) {
      const chat = chats[canal] as string;
      const delCanal = ev.enviar.filter((a) => canalDeTipo(a.tipo) === canal);
      if (delCanal.length === 0) continue;
      const { enviar, resto } = aplicarTopes(delCanal, usados[canal], topesDeCanal(canal, cfg));
      const pendientes = enviar.slice(0, 50);
      total += pendientes.length;
      // El resto va en una nota («➕ N avisos más»); si no hay nada más que mandar, como mucho una vez por hora.
      let nota: string | null = null;
      if (resto.length > 0) {
        const { data: previa } = await sb.from("avisos_telegram_envios").select("id").eq("tipo", "pendientes").eq("ok", true).eq("error", notaTopeDe(canal))
          .gte("enviado_en", desdeHora).limit(1);
        if (pendientes.length > 0 || !previa?.length) nota = notaTope(resto.length, PANEL_URL);
      }
      // Margen bajo: el precio sugerido (20261130160000) para «→ súbelo a …» y el enlace «Aplicar el precio».
      const sugerencias = new Map<string, Sugerencia | null>();
      for (const a of pendientes.filter((x) => x.tipo === "facturas_margen_bajo")) {
        const { data, error } = await sb.rpc("avisos_precio_sugerido", { p_aviso: a.id });
        if (error) console.warn("[avisos-telegram] precio sugerido:", error.message);
        sugerencias.set(a.id, (data as Sugerencia | null) ?? null);
      }
      const textos = pendientes.map((a) => mensajeAviso(a, PANEL_URL, sugerencias.get(a.id), { ahora, reservas }));
      const mensajes = agruparEnMensajes(nota ? [...textos, nota] : textos);
      const iNota = nota ? textos.length : -1;
      let notaEnviada = false;
      for (const m of mensajes) {
        if (!primero) await pausa();
        primero = false;
        const r = await enviarTelegram(chat, m.texto);
        const deAvisos = m.indices.filter((k) => k !== iNota);
        if (!r.ok && r.esperar) {
          // Telegram pide esperar: no se registra como fallo (se reintenta en la próxima vuelta) y se deja este chat.
          errores.push(`${NOMBRE_CANAL[canal]}: ${r.error}`);
          break;
        }
        await registrar(deAvisos.map((k) => ({ tipo: "aviso", chat, aviso_id: pendientes[k].id, ...resultadoFila(r) })));
        if (r.ok) {
          enviados += deAvisos.length;
          if (m.indices.includes(iNota)) notaEnviada = true;
        } else errores.push(`${NOMBRE_CANAL[canal]}: ${r.error}`);
      }
      if (nota && notaEnviada) {
        topados += resto.length;
        await registrar([
          ...resto.map((a) => ({ tipo: "aviso", chat, aviso_id: a.id, ok: true, error: `tope: agrupado en «${resto.length} avisos más»` })),
          { tipo: "pendientes", chat, ok: true, error: notaTopeDe(canal) },
        ]);
      }
    }
    console.log(`[avisos-telegram] ${quien} · pendientes · ${enviados}/${total}${topados ? ` · tope: ${topados} más` : ""}${errores.length ? ` · ${errores[0]}` : ""}`);
    return json({ ok: errores.length === 0, enviados, pendientes: total, tope: topados, error: errores[0] });
  }

  // resumen
  const chat = chatDe(cfg, "resumenes");
  if (!chat) return json({ ok: true, enviados: 0, motivo: "sin chat de Resúmenes" });
  const desde = new Date(ahora.getTime() - 24 * 3600_000).toISOString();
  const { data: avisos, error: eAv } = await sb.from("notificaciones_dashboard")
    .select("id, tipo, titulo, mensaje, referencia_tipo, referencia_id, created_at, caduca_en, datos")
    .gt("created_at", desde).order("created_at", { ascending: false }).limit(500);
  if (eAv) return json({ ok: false, error: eAv.message }, 500);
  const lista = (avisos ?? []) as Aviso[];
  // Lo que ya llegó al momento no se repite (envío correcto y sin «error»: no los descartados ni los del tope).
  const { data: yaEnviados, error: eEnv } = await sb.from("avisos_telegram_envios").select("aviso_id")
    .eq("tipo", "aviso").eq("ok", true).is("error", null)
    .gte("enviado_en", new Date(ahora.getTime() - 48 * 3600_000).toISOString()).limit(5000);
  if (eEnv) return json({ ok: false, error: eEnv.message }, 500);
  const enviados = new Set(((yaEnviados ?? []) as { aviso_id: string | null }[]).map((e) => e.aviso_id).filter(Boolean) as string[]);
  const reservas = await cargarReservas(sb, lista);
  const resumen = construirResumen(lista, ahora, PANEL_URL, { reservas, revision: cfg.resumen_revision ?? {}, enviados });
  if (resumen.total === 0 || !resumen.texto) {
    // Nada que contar: no se manda «sin avisos», y hoy no se vuelve a mirar.
    const { error } = await sb.from("avisos_telegram_config").update({ resumen_ultimo_dia: diaMadrid(ahora) }).eq("id", true);
    if (error) console.error("[avisos-telegram] resumen_ultimo_dia:", error.message);
    console.log(`[avisos-telegram] ${quien} · resumen · sin avisos que contar: no se envía`);
    return json({ ok: true, total: 0, omitido: true });
  }
  const r = await enviarTelegram(chat, resumen.texto);
  await registrar([{ tipo: "resumen", chat, ...resultadoFila(r) }]);
  if (r.ok) {
    const { error } = await sb.from("avisos_telegram_config").update({ resumen_ultimo_dia: diaMadrid(ahora), resumen_revision: resumen.revision }).eq("id", true);
    if (error) console.error("[avisos-telegram] resumen_ultimo_dia:", error.message);
  }
  console.log(`[avisos-telegram] ${quien} · resumen · ${resumen.total} avisos · ${r.ok ? "ok" : r.error}`);
  return json(r.ok ? { ok: true, total: resumen.total } : { ok: false, error: r.error });
}));
