import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { exigirSuperAdmin } from "../_shared/autorizacion.ts";
import { compararTiempoConstante } from "../_shared/tiempo-constante.ts";
import {
  type Accion, agruparEnMensajes, agruparPasos, aplicarTopes, type Aviso, aTextoPlano, chatDe, type ConfigTelegram, construirResumen, construirSemanal,
  cuerpoSendMessage, type DatosSemanales, destinos, diaMadrid, diaSemanaMadrid, type Envio, errorSaneado, esAccion, evaluarPendientes, horaMadrid,
  leerDatosInformes, lineaPasoReserva, mensajeAviso, mensajeInformes, NOMBRE_CANAL, notaTope, type PasoReserva, type ReservaInfo, SIN_CONFIGURAR, silencioAhora, type Sugerencia,
  textoPrueba, tipoRegistro, TOPE_RESERVAS_DIA, TOPE_RESERVAS_HORA, topesDeCanal,
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
//  23/11/2026: Reservas recibe un aviso por paso de cada reserva (petición por aceptar, aceptada, confirmada por el
//  cliente o desde el panel, cancelada y por quién), de la tabla avisos_telegram_reservas (20261217100000). El
//  resumen diario lleva las reservas de hoy y mañana y las peticiones por aceptar, y el día del semanal va con el
//  semanal dentro (un solo mensaje). Mensajes en HTML (negritas y enlaces cortos); si Telegram no lo acepta, se
//  reenvía en texto plano. Los fallos técnicos van en texto plano (llevan textos libres).
//
//  POST { accion: "pendientes" }  manda al momento los avisos nuevos (tipos marcados en tipos_al_momento y,
//       salvo que se apague, las reservas de hoy y mañana) fuera del silencio nocturno, cada uno a su canal.
//  POST { accion: "resumen" }     un mensaje con los avisos de las últimas 24 h que no salieron al momento;
//       guarda resumen_ultimo_dia (uno al día).
//  POST { accion: "fallos" }      fallos internos (fallos.ts): un mensaje por fila pendiente de fallos_internos,
//       sin silencio nocturno.
//  POST { accion: "semanal" }     resumen semanal del dueño (lunes por la mañana, configurable).
//  POST { accion: "informes", mes, carpeta_url, informes: [{ titulo, url }], sin_datos, fallidos }
//       (25/11/2026) los PDF del mes en Drive, al chat de Resúmenes: lo manda la tarea programada del último
//       jueves (.github/workflows/informes-mensuales.yml) con el JWT de su usuario super admin. Solo enlaces de Drive.
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
/** Registro de la nota «➕ N avisos más» (como mucho una por hora si no hay nada más que mandar). */
const NOTA_TOPE = "nota tope · facturas";

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

async function enviarUnaVez(chatId: string, texto: string, html: boolean): Promise<Resultado & { malHtml?: boolean }> {
  const control = new AbortController();
  const t = setTimeout(() => control.abort(), 15_000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpoSendMessage(chatId, texto, html)),
      signal: control.signal,
    });
    const cuerpo = await res.json().catch(() => null) as { ok?: boolean; description?: string; result?: { message_id?: number } } | null;
    if (!res.ok || !cuerpo?.ok) {
      const descripcion = cuerpo?.description ?? "sin respuesta";
      return {
        ok: false, error: errorSaneado(`Telegram ${res.status}: ${descripcion}`), esperar: res.status === 429,
        malHtml: html && res.status === 400 && /can't parse entities|unsupported start tag|can't find end tag/i.test(descripcion),
      };
    }
    return { ok: true, mensaje_id: cuerpo.result?.message_id ?? null };
  } catch (e) {
    return { ok: false, error: errorSaneado(`Telegram no responde: ${(e as Error)?.name ?? "error"}`) };
  } finally {
    clearTimeout(t);
  }
}

/** Manda un mensaje (HTML por defecto). Si Telegram no acepta el HTML, lo reenvía una vez en texto plano. */
async function enviarTelegram(chatId: string, texto: string, html = true): Promise<Resultado> {
  const r = await enviarUnaVez(chatId, texto, html);
  if (!r.ok && r.malHtml) {
    console.warn(`[avisos-telegram] HTML rechazado, se reenvía en texto plano: ${r.error}`);
    return enviarUnaVez(chatId, aTextoPlano(texto), false);
  }
  return r;
}

const pausa = () => new Promise((r) => setTimeout(r, 1100)); // Telegram: ~20 mensajes/min por grupo

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any;

/** Las reservas de unos pasos (por id), con su estado de ahora y sin nombre ni teléfono. null si no se pueden leer. */
async function cargarReservas(sb: Cliente, ids: string[]): Promise<Map<string, ReservaInfo> | null> {
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

/** Cifras del semanal (RPC) con el total de albaranes sin factura; null si la RPC falla. */
async function datosSemanales(sb: Cliente): Promise<DatosSemanales | null> {
  const { data, error } = await sb.rpc("avisos_telegram_datos_semanal");
  if (error) {
    console.error("[avisos-telegram] semanal:", error.message);
    return null;
  }
  const datos = (data ?? {}) as DatosSemanales;
  // Total de albaranes sin factura (el aviso solo cuenta los de más de 35 días); si falla, se omite esa parte.
  const { data: tot, error: eTot } = await sb.rpc("avisos_telegram_albaranes_total");
  if (eTot) console.warn("[avisos-telegram] albaranes total:", eTot.message);
  else if (datos.albaranes) datos.albaranes = { ...datos.albaranes, ...(tot as object) };
  return datos;
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
  if (!accion) return json({ ok: false, error: "Acción desconocida (pendientes, resumen, semanal, fallos, informes o probar)" }, 400);

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
      const r = await enviarTelegram(chat, mensajeFallo(f, ctx), false);
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

  if (accion === "informes") {
    const datos = leerDatosInformes(body);
    if (!datos) return json({ ok: false, error: "Faltan mes (AAAA-MM) e informes [{ titulo, url de Drive }]" }, 400);
    const chat = chatDe(cfg, "resumenes");
    if (!chat) return json({ ok: true, enviados: 0, motivo: "sin chat de Resúmenes" });
    const r = await enviarTelegram(chat, mensajeInformes(datos));
    await registrar([{ tipo: tipoRegistro(accion), chat, ...resultadoFila(r) }]);
    console.log(`[avisos-telegram] ${quien} · informes ${datos.mes} · ${datos.informes.length} PDF · ${r.ok ? "ok" : r.error}`);
    return json(r.ok ? { ok: true, enviados: 1 } : { ok: false, error: r.error });
  }

  if (accion === "semanal") {
    if (cfg.semanal_activo === false) return json({ ok: true, enviados: 0, motivo: "semanal apagada" });
    const chat = chatDe(cfg, "resumenes");
    if (!chat) return json({ ok: true, enviados: 0, motivo: "sin chat de Resúmenes" });
    const datosSem = await datosSemanales(sb);
    if (!datosSem) return json({ ok: false, error: "No se pudieron leer las cifras del semanal" }, 500);
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
    const chatFacturas = chatDe(cfg, "facturas");
    const chatReservas = cfg.reservas_al_momento === false ? null : chatDe(cfg, "reservas");
    if (!chatFacturas && !chatReservas) return json({ ok: true, enviados: 0, motivo: "sin chat" });
    let enviados = 0;
    let total = 0;
    let topados = 0;
    const errores: string[] = [];
    let primero = true;
    const turno = async () => {
      if (!primero) await pausa();
      primero = false;
    };
    const desde = new Date(ahora.getTime() - 24 * 3600_000).toISOString();
    const desdeHora = new Date(ahora.getTime() - 3600_000).toISOString();

    // ── 1. Facturas y márgenes: los avisos del panel marcados «al momento» (los de reservas, no) ──
    const tipos = cfg.tipos_al_momento.filter((x) => !x.startsWith("reserva_"));
    if (chatFacturas && tipos.length) {
      const { data: avisos, error: eAv } = await sb.from("notificaciones_dashboard")
        .select("id, tipo, titulo, mensaje, referencia_tipo, referencia_id, created_at, caduca_en, datos")
        .in("tipo", tipos).gt("created_at", desde).order("created_at", { ascending: true }).limit(200);
      if (eAv) return json({ ok: false, error: eAv.message }, 500);
      const lista = (avisos ?? []) as Aviso[];
      let envios: Envio[] = [];
      if (lista.length) {
        const { data, error } = await sb.from("avisos_telegram_envios").select("aviso_id, ok").in("aviso_id", lista.map((a) => a.id));
        if (error) return json({ ok: false, error: error.message }, 500);
        envios = (data ?? []) as Envio[];
      }
      const ev = evaluarPendientes(lista, envios, cfg, ahora, { canales: new Set(["facturas"]) });
      // Lo que no se va a mandar nunca (unidades dudosas) se da por consumido.
      await registrar(ev.descartar.map((d) => ({ tipo: "aviso", chat: null, aviso_id: d.aviso.id, ok: true, error: d.motivo })));
      // Tope: lo ya mandado en la última hora y en las últimas 24 h (envíos correctos de avisos).
      const { data: envsOk } = await sb.from("avisos_telegram_envios").select("enviado_en")
        .eq("tipo", "aviso").eq("ok", true).is("error", null).gte("enviado_en", desde).limit(2000);
      const usados = { dia: (envsOk ?? []).length, hora: ((envsOk ?? []) as { enviado_en: string }[]).filter((e) => e.enviado_en >= desdeHora).length };
      const { enviar, resto } = aplicarTopes(ev.enviar, usados, topesDeCanal("facturas", cfg));
      const pendientes = enviar.slice(0, 50);
      total += pendientes.length;
      // El resto va en una nota («➕ N avisos más»); si no hay nada más que mandar, como mucho una vez por hora.
      let nota: string | null = null;
      if (resto.length > 0) {
        const { data: previa } = await sb.from("avisos_telegram_envios").select("id").eq("tipo", "pendientes").eq("ok", true).eq("error", NOTA_TOPE)
          .gte("enviado_en", desdeHora).limit(1);
        if (pendientes.length > 0 || !previa?.length) nota = notaTope(resto.length, PANEL_URL);
      }
      // Margen bajo: el precio sugerido (20261130160000) para «→ súbelo a …» y el enlace «Aplicar precio».
      const sugerencias = new Map<string, Sugerencia | null>();
      for (const a of pendientes.filter((x) => x.tipo === "facturas_margen_bajo")) {
        const { data, error } = await sb.rpc("avisos_precio_sugerido", { p_aviso: a.id });
        if (error) console.warn("[avisos-telegram] precio sugerido:", error.message);
        sugerencias.set(a.id, (data as Sugerencia | null) ?? null);
      }
      const textos = pendientes.map((a) => mensajeAviso(a, PANEL_URL, sugerencias.get(a.id), { ahora }));
      const iNota = nota ? textos.length : -1;
      let notaEnviada = false;
      for (const m of agruparEnMensajes(nota ? [...textos, nota] : textos)) {
        await turno();
        const r = await enviarTelegram(chatFacturas, m.texto);
        if (!r.ok && r.esperar) {
          // Telegram pide esperar: no se registra como fallo (se reintenta en la próxima vuelta).
          errores.push(`${NOMBRE_CANAL.facturas}: ${r.error}`);
          break;
        }
        const deAvisos = m.indices.filter((k) => k !== iNota);
        await registrar(deAvisos.map((k) => ({ tipo: "aviso", chat: chatFacturas, aviso_id: pendientes[k].id, ...resultadoFila(r) })));
        if (r.ok) {
          enviados += deAvisos.length;
          if (m.indices.includes(iNota)) notaEnviada = true;
        } else errores.push(`${NOMBRE_CANAL.facturas}: ${r.error}`);
      }
      if (nota && notaEnviada) {
        topados += resto.length;
        await registrar([
          ...resto.map((a) => ({ tipo: "aviso", chat: chatFacturas, aviso_id: a.id, ok: true, error: `tope: agrupado en «${resto.length} avisos más»` })),
          { tipo: "pendientes", chat: chatFacturas, ok: true, error: NOTA_TOPE },
        ]);
      }
    }

    // ── 2. Reservas: un aviso por paso de cada reserva (avisos_telegram_reservas, 20261217100000) ──
    if (chatReservas) {
      const [{ count: enHora }, { count: enDia }] = await Promise.all([
        sb.from("avisos_telegram_reservas").select("id", { count: "exact", head: true }).gte("enviado_en", desdeHora),
        sb.from("avisos_telegram_reservas").select("id", { count: "exact", head: true }).gte("enviado_en", desde),
      ]);
      // Tope propio (los pasos que no caben esperan a la siguiente vuelta, no se pierden).
      const libres = Math.max(0, Math.min(TOPE_RESERVAS_HORA - (enHora ?? 0), TOPE_RESERVAS_DIA - (enDia ?? 0)));
      if (libres > 0) {
        const { data: filas, error: eRec } = await sb.rpc("avisos_telegram_reservas_reclamar", { p_limite: Math.min(libres, 50) });
        if (eRec) errores.push(`${NOMBRE_CANAL.reservas}: ${eRec.message}`);
        const pasos = (filas ?? []) as (PasoReserva & { intentos: number })[];
        /** Devuelve pasos reclamados a la cola sin gastar un intento (Telegram pide esperar o no se pudo leer la reserva). */
        const soltar = async (lista: (PasoReserva & { intentos: number })[], motivo: string) => {
          for (const p of lista) {
            await sb.from("avisos_telegram_reservas").update({ intentos: Math.max(0, p.intentos - 1), reclamado_en: null, ultimo_error: motivo }).eq("id", p.id);
          }
        };
        if (pasos.length) {
          const reservas = await cargarReservas(sb, [...new Set(pasos.map((p) => p.reserva_id))]);
          if (!reservas) {
            await soltar(pasos, "no se pudieron leer las reservas");
            errores.push(`${NOMBRE_CANAL.reservas}: no se pudieron leer las reservas`);
          } else {
            const grupos = agruparPasos(pasos);
            total += grupos.length;
            const textos = grupos.map((g) => lineaPasoReserva(g, reservas.get(g.reserva_id), ahora, PANEL_URL));
            const mensajes = agruparEnMensajes(textos, undefined, "\n\n"); // cada reserva ocupa dos líneas: una en blanco entre ellas
            for (const [im, m] of mensajes.entries()) {
              await turno();
              const r = await enviarTelegram(chatReservas, m.texto);
              const ids = m.indices.flatMap((k) => grupos[k].ids);
              if (!r.ok && r.esperar) {
                const quedan = new Set(mensajes.slice(im).flatMap((x) => x.indices.flatMap((k) => grupos[k].ids)));
                await soltar(pasos.filter((p) => quedan.has(p.id)), r.error);
                errores.push(`${NOMBRE_CANAL.reservas}: ${r.error}`);
                break;
              }
              await registrar([{ tipo: "reserva", chat: chatReservas, ...resultadoFila(r) }]);
              await sb.from("avisos_telegram_reservas").update(r.ok ? { enviado_en: new Date().toISOString(), ultimo_error: null } : { ultimo_error: r.error }).in("id", ids);
              if (r.ok) enviados += m.indices.length;
              else errores.push(`${NOMBRE_CANAL.reservas}: ${r.error}`);
            }
          }
        }
      }
    }
    console.log(`[avisos-telegram] ${quien} · pendientes · ${enviados}/${total}${topados ? ` · tope: ${topados} más` : ""}${errores.length ? ` · ${errores[0]}` : ""}`);
    return json({ ok: errores.length === 0, enviados, pendientes: total, tope: topados, error: errores[0] });
  }

  // resumen
  const chat = chatDe(cfg, "resumenes");
  if (!chat) return json({ ok: true, enviados: 0, motivo: "sin chat de Resúmenes" });
  const desde = new Date(ahora.getTime() - 24 * 3600_000).toISOString();
  const hoy = diaMadrid(ahora);
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
  // Reservas vivas de hoy en adelante (hoy / mañana y peticiones por aceptar); si falla, el resumen sale sin ellas.
  const { data: proximas, error: eProx } = await sb.from("reservas").select("id, fecha, hora, numero_comensales, canal, estado")
    .gte("fecha", hoy).in("estado", ["pendiente", "verificada", "confirmada"]).order("fecha").order("hora").limit(1000);
  if (eProx) console.warn("[avisos-telegram] reservas próximas:", eProx.message);
  // El día y hora del semanal, el semanal va dentro de este mensaje (y la acción «semanal» ya no lo manda aparte).
  const tocaSemanal = cfg.semanal_activo !== false && diaSemanaMadrid(ahora) === (cfg.semanal_dia ?? 1)
    && horaMadrid(ahora) >= (cfg.semanal_hora ?? 9) && cfg.semanal_ultimo_dia !== hoy;
  const semanal = tocaSemanal ? await datosSemanales(sb) : null;
  const resumen = construirResumen(lista, ahora, PANEL_URL, {
    revision: cfg.resumen_revision ?? {}, enviados, proximas: (proximas ?? []) as ReservaInfo[], semanal,
  });
  if (!resumen.texto) {
    // Nada que contar: no se manda «sin avisos», y hoy no se vuelve a mirar.
    const { error } = await sb.from("avisos_telegram_config").update({ resumen_ultimo_dia: hoy }).eq("id", true);
    if (error) console.error("[avisos-telegram] resumen_ultimo_dia:", error.message);
    console.log(`[avisos-telegram] ${quien} · resumen · sin nada que contar: no se envía`);
    return json({ ok: true, total: 0, omitido: true });
  }
  const r = await enviarTelegram(chat, resumen.texto);
  await registrar([{ tipo: "resumen", chat, ...resultadoFila(r) }]);
  if (r.ok) {
    const { error } = await sb.from("avisos_telegram_config").update({
      resumen_ultimo_dia: hoy, resumen_revision: resumen.revision, ...(resumen.conSemanal ? { semanal_ultimo_dia: hoy } : {}),
    }).eq("id", true);
    if (error) console.error("[avisos-telegram] resumen_ultimo_dia:", error.message);
  }
  console.log(`[avisos-telegram] ${quien} · resumen · ${resumen.total} avisos${resumen.conSemanal ? " + semanal" : ""} · ${r.ok ? "ok" : r.error}`);
  return json(r.ok ? { ok: true, total: resumen.total, semanal: resumen.conSemanal } : { ok: false, error: r.error });
}));
