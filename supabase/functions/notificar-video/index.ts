// notificar-video
// ---------------------------------------------------------------------------
// Avisa por Web Push (VAPID) al que grabó un vídeo del plato y lo mandó a un
// dispositivo potente, cuando ese dispositivo lo termina (listo o error).
// Ver docs/video-dispositivo-potente.md.
//
// - Auth: verify_jwt (config.toml) + permiso de escritura en `gestor_carta`
//   + el llamante tiene que ser quien procesó (o creó) el trabajo, y el
//   trabajo tiene que estar terminado (logica.ts:autorizarNotificacion).
// - Lee el trabajo y las suscripciones de `creado_por` con service role y
//   borra las caducadas (404/410 del servicio push).
// - Secretos: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
//   (mailto:… o https://…). Sin ellos responde 503 y el panel sigue igual
//   (el vídeo ya está guardado; solo no llega el aviso).
//
// Body: { trabajo_id: uuid, tipo?: "video" | "recorte" | "reel" }
//   o   { evento_id: uuid, tipo: "encargo" }
//   tipo "encargo" (10-11-2026): evento de instagram_encargo_eventos (encargo
//   de Instagram). Vale con Marketing o con Instagram · Agencia; solo lo pide
//   el autor del evento en los 15 min siguientes, y avisa a la otra parte
//   (RPC instagram_encargo_destinatarios). Ver docs/instagram-encargos.md.
//   Desde 20261111000000 el aviso de un encargo sale UNA sola vez por evento
//   (instagram_encargo_eventos.notificado_at).
//   tipo "reel" (09-11-2026): trabajo de `instagram_trabajos_render` (reel de
//   Instagram generado por el trabajador de render); exige «Editar» en la
//   sección del trabajador («instagram_render») o en «marketing», en vez de
//   «gestor_carta». Ver docs/instagram-video.md.
//   tipo "recorte" (02-11-2026): trabajo de `trabajos_recorte` (foto de la
//   carta guardada sin recortar desde un móvil y recortada en un ordenador).
// Respuesta: { ok: true, enviadas, borradas, fallidas } | { ok: false, error }
// ---------------------------------------------------------------------------
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { comprobarPermisoSeccion, type ClientePermiso } from "../_shared/permiso-marketing.ts";
import {
  autorizarNotificacion,
  autorizarNotificacionEncargo,
  autorizarNotificacionRecorte,
  autorizarNotificacionReel,
  construirCarga,
  construirCargaEncargo,
  construirCargaRecorte,
  construirCargaReel,
  leerEventoId,
  leerTipo,
  modoPermisoDeTipo,
  reclamarAvisoEncargo,
  seccionesDeTipo,
  type ClienteAviso,
  leerTrabajoId,
  suscripcionCaducada,
  type EncargoNotificable,
  type EventoEncargoNotificable,
  type PlatoNotificable,
  type TrabajoNotificable,
  type TrabajoRecorteNotificable,
  type TrabajoReelNotificable,
} from "./logica.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FUNCION = "notificar-video";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const VAPID_PUBLIC = (Deno.env.get("VAPID_PUBLIC_KEY") ?? "").trim();
const VAPID_PRIVATE = (Deno.env.get("VAPID_PRIVATE_KEY") ?? "").trim();
const VAPID_SUBJECT = (Deno.env.get("VAPID_SUBJECT") ?? "").trim();

type Suscripcion = { id: string; endpoint: string; p256dh: string; auth: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(conAuditoriaDePeticion(FUNCION, createClientBase, async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "No autorizado" }, 401);
  const supabaseUser = createClientBase(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return json({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  const tipo = leerTipo(cuerpo);
  if (!tipo) return json({ ok: false, error: "tipo no válido" }, 400);
  const trabajoId = tipo === "encargo" ? leerEventoId(cuerpo) : leerTrabajoId(cuerpo);
  if (!trabajoId) return json({ ok: false, error: tipo === "encargo" ? "Falta evento_id" : "Falta trabajo_id" }, 400);

  // Carta para vídeos y recortes; Marketing para los reels de Instagram;
  // Marketing o Instagram · Agencia para los encargos.
  let permiso: Awaited<ReturnType<typeof comprobarPermisoSeccion>> | null = null;
  for (const seccion of seccionesDeTipo(tipo)) {
    permiso = await comprobarPermisoSeccion(
      supabaseUser as unknown as ClientePermiso,
      seccion,
      modoPermisoDeTipo(tipo),
      tipo === "encargo" ? "No tienes permiso para editar los encargos de Instagram"
        : tipo === "reel" ? "No tienes permiso de trabajador de render ni para editar Marketing" : "No tienes permiso para editar la carta",
    );
    if (permiso.ok || permiso.status !== 403) break;
  }
  if (!permiso) return json({ ok: false, error: "No autorizado" }, 403);
  if (!permiso.ok) return json({ ok: false, error: permiso.error }, permiso.status);

  if (!VAPID_PUBLIC || !VAPID_PRIVATE || !VAPID_SUBJECT) {
    return json({ ok: false, codigo: "sin_vapid", error: "Avisos push sin configurar (faltan los secretos VAPID_*)" }, 503);
  }

  const admin = createClientBase(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

  let destinatarios: string[] = [];
  let carga: string;
  if (tipo === "encargo") {
    const { data: ev, error: eE } = await admin
      .from("instagram_encargo_eventos")
      .select("id, encargo_id, actor, lado, accion, a_estado, comentario, created_at")
      .eq("id", trabajoId)
      .maybeSingle();
    if (eE) return json({ ok: false, error: "No se pudo leer el evento" }, 500);
    if (!ev) return json({ ok: false, error: "El evento no existe" }, 404);
    const evento = ev as EventoEncargoNotificable;
    const autE = autorizarNotificacionEncargo(evento, permiso.userId);
    if (!autE.ok) return json({ ok: false, error: autE.error }, autE.status);
    // Una sola vez por evento: la primera llamada lo marca; las demás no mandan nada.
    if ((await reclamarAvisoEncargo(admin as unknown as ClienteAviso, evento.id)) === "ya_avisado") {
      return json({ ok: true, enviadas: 0, borradas: 0, fallidas: 0, yaAvisado: true });
    }
    const { data: enc } = await admin.from("instagram_encargos").select("id, numero, titulo").eq("id", evento.encargo_id).maybeSingle();
    const { data: quienes, error: eQ } = await admin.rpc("instagram_encargo_destinatarios", { p_evento_id: evento.id });
    if (eQ) return json({ ok: false, error: "No se pudieron calcular los destinatarios" }, 500);
    destinatarios = ((quienes ?? []) as unknown[]).filter((u): u is string => typeof u === "string");
    carga = JSON.stringify(construirCargaEncargo(evento, (enc ?? null) as EncargoNotificable | null));
  } else if (tipo === "reel") {
    const { data: tr, error: eR } = await admin
      .from("instagram_trabajos_render")
      .select("id, pieza_id, estado, error, creado_por, procesado_por")
      .eq("id", trabajoId)
      .maybeSingle();
    if (eR) return json({ ok: false, error: "No se pudo leer el trabajo" }, 500);
    if (!tr) return json({ ok: false, error: "El trabajo no existe" }, 404);
    const r = tr as TrabajoReelNotificable;
    const autR = autorizarNotificacionReel(r, permiso.userId);
    if (!autR.ok) return json({ ok: false, error: autR.error }, autR.status);
    destinatarios = r.creado_por ? [r.creado_por] : [];
    carga = JSON.stringify(construirCargaReel(r));
  } else if (tipo === "recorte") {
    const { data: tr, error: eR } = await admin
      .from("trabajos_recorte")
      .select("id, tabla, registro_id, nombre, estado, error, creado_por, procesado_por")
      .eq("id", trabajoId)
      .maybeSingle();
    if (eR) return json({ ok: false, error: "No se pudo leer el trabajo" }, 500);
    if (!tr) return json({ ok: false, error: "El trabajo no existe" }, 404);
    const r = tr as TrabajoRecorteNotificable;
    const autR = autorizarNotificacionRecorte(r, permiso.userId);
    if (!autR.ok) return json({ ok: false, error: autR.error }, autR.status);
    destinatarios = r.creado_por ? [r.creado_por] : [];
    // tabla viene de la BD (CHECK: Platos/Vinos/Bebidas/Cocteles).
    const { data: ficha } = await admin.from(r.tabla).select("imagen_url").eq("id", r.registro_id).maybeSingle();
    carga = JSON.stringify(construirCargaRecorte(r, (ficha as { imagen_url?: string | null } | null)?.imagen_url ?? null));
  } else {
    const { data: trabajo, error: eT } = await admin
      .from("trabajos_video")
      .select("id, plato_id, estado, error, creado_por, procesado_por")
      .eq("id", trabajoId)
      .maybeSingle();
    if (eT) return json({ ok: false, error: "No se pudo leer el trabajo" }, 500);
    if (!trabajo) return json({ ok: false, error: "El trabajo no existe" }, 404);
    const t = trabajo as TrabajoNotificable;
    const aut = autorizarNotificacion(t, permiso.userId);
    if (!aut.ok) return json({ ok: false, error: aut.error }, aut.status);
    destinatarios = t.creado_por ? [t.creado_por] : [];
    const { data: plato } = await admin.from("Platos").select("nombre, imagen_url").eq("id", t.plato_id).maybeSingle();
    carga = JSON.stringify(construirCarga(t, (plato ?? null) as PlatoNotificable | null));
  }
  if (!destinatarios.length) return json({ ok: true, enviadas: 0, borradas: 0, fallidas: 0 });

  const { data: subs, error: eS } = await admin
    .from("suscripciones_push")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", destinatarios);
  if (eS) return json({ ok: false, error: "No se pudieron leer las suscripciones" }, 500);

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  let enviadas = 0;
  let fallidas = 0;
  const caducadas: string[] = [];
  await Promise.all(
    ((subs ?? []) as Suscripcion[]).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          carga,
          { TTL: 24 * 60 * 60, urgency: "normal" },
        );
        enviadas++;
      } catch (e) {
        const status = (e as { statusCode?: number })?.statusCode;
        if (suscripcionCaducada(status)) caducadas.push(s.id);
        else {
          fallidas++;
          console.warn(`[${FUNCION}] push fallido`, status, (e as Error)?.message);
        }
      }
    }),
  );
  if (caducadas.length) await admin.from("suscripciones_push").delete().in("id", caducadas);
  return json({ ok: true, enviadas, borradas: caducadas.length, fallidas });
}));
