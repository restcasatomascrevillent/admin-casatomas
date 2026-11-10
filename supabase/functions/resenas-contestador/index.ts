// ============================================================================
// RESENAS-CONTESTADOR — Edge Function (Super Admin › Reseñas Google)
// ============================================================================
// La IA propone respuestas a las reseñas en el tono de Casa Tomás; el dueño
// las revisa, edita y aprueba. NADA se publica sin aprobación salvo que el
// dueño encienda la respuesta automática (apagada por defecto).
//
//   POST (super admin, Authorization: Bearer <JWT>) { accion, ... }
//     estado                                → { ia, google: { configurada, conectada, ... } }
//     proponer        { id, indicacion? }   → { propuesta, modelo, avisos }
//     guardar         { id, texto }         → borrador editado
//     aprobar         { id, texto, publicar? } → aprueba y, si Google está conectado, publica
//     marcar_respondida { id, texto? }      → respondida a mano en Google
//     descartar       { id }
//     ciclo                                  → Places + Business Profile + propuestas (+ automáticas)
//     google_conectar { volver }            → { url } de consentimiento de Google
//     google_ubicaciones / google_elegir_ubicacion { ubicacion } / google_desconectar
//   POST (pg_cron, x-webhook-secret == RESENAS_CRON_SECRET) { accion: "ciclo" }
//   GET  ?code&state  ← vuelta de Google OAuth; redirige al panel.
//
// Secretos: OPENAI_API_KEY (ya existe), RESENAS_CRON_SECRET (nuevo, también
// en Vault como resenas_cron_secret), GOOGLE_BUSINESS_CLIENT_ID y
// GOOGLE_BUSINESS_CLIENT_SECRET (nuevos; si faltan se usan GOOGLE_CLIENT_ID y
// GOOGLE_CLIENT_SECRET, el cliente OAuth de Drive). verify_jwt = false: la
// vuelta de Google y el cron no traen JWT; la autorización va aquí dentro.
// ============================================================================

import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { exigirSuperAdmin } from "../_shared/autorizacion.ts";
import { registrarUso } from "../_shared/registrar-uso-ia.ts";
import { compararTiempoConstante } from "../_shared/tiempo-constante.ts";
import { crearIaContestador } from "../_shared/resenas/ia.ts";
import type { Resena } from "../_shared/resenas/contestador.ts";
import {
  aprobar,
  ciclo,
  completarConexion,
  descartar,
  desconectar,
  elegirUbicacionAccion,
  ErrorAccion,
  estado,
  guardarBorrador,
  iniciarConexion,
  listarUbicaciones,
  marcarRespondida,
  proponer,
  type AjustesFila,
  type Deps,
  type Repo,
} from "./acciones.ts";

const createClient = clienteConAuditoria(createClientBase, "resenas-contestador");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("RESENAS_CRON_SECRET") ?? "";
const CLIENT_ID = Deno.env.get("GOOGLE_BUSINESS_CLIENT_ID") || Deno.env.get("GOOGLE_CLIENT_ID") || "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_BUSINESS_CLIENT_SECRET") || Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
const REDIRECT_URI = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/resenas-contestador`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const COLUMNAS_RESENA =
  "id, nombre_cliente, valoracion, comentario, fecha, fuente, estado, respuesta, respuesta_propuesta, respuesta_estado, respuesta_origen, respuesta_intentos, gbp_review_name, google_review_id, google_maps_uri";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function crearRepo(sb: any): Repo {
  const comprobar = <T>(r: { data: T; error: { message: string } | null }, que: string): T => {
    if (r.error) throw new Error(`${que}: ${r.error.message}`);
    return r.data;
  };
  const diaMas = (fecha: string, dias: number) => new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
  return {
    async ajustes() {
      return comprobar(await sb.from("resenas_ajustes").select("*").eq("id", true).single(), "ajustes") as AjustesFila;
    },
    async actualizarAjustes(cambios) {
      comprobar(await sb.from("resenas_ajustes").update(cambios).eq("id", true), "guardar ajustes");
    },
    async resena(id) {
      const filas = comprobar(await sb.from("resenas").select(COLUMNAS_RESENA).eq("id", id).limit(1), "leer reseña") as Resena[];
      return filas?.[0] ?? null;
    },
    async actualizarResena(id, cambios) {
      comprobar(await sb.from("resenas").update({ ...cambios, updated_at: new Date().toISOString() }).eq("id", id), "guardar reseña");
    },
    async pendientesDePropuesta(limite) {
      // Solo las recientes (60 días): no se gasta IA en el histórico.
      const desde = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
      return comprobar(
        await sb.from("resenas").select(COLUMNAS_RESENA).eq("respuesta_estado", "pendiente").is("respuesta", null)
          .gte("fecha", desde).order("fecha", { ascending: false }).limit(limite),
        "pendientes",
      ) as Resena[];
    },
    async candidatasAutorespuesta(limite) {
      return comprobar(
        await sb.from("resenas").select(COLUMNAS_RESENA).in("respuesta_estado", ["propuesta", "aprobada"]).is("respuesta", null)
          .not("gbp_review_name", "is", null).order("fecha", { ascending: false }).limit(limite),
        "candidatas",
      ) as Resena[];
    },
    async porGbp(nombre) {
      const filas = comprobar(await sb.from("resenas").select(COLUMNAS_RESENA).eq("gbp_review_name", nombre).limit(1), "buscar reseña") as Resena[];
      return filas?.[0] ?? null;
    },
    async sinGbpCerca(fecha) {
      return comprobar(
        await sb.from("resenas").select(COLUMNAS_RESENA).eq("fuente", "google").is("gbp_review_name", null)
          .gte("fecha", diaMas(fecha, -2)).lte("fecha", diaMas(fecha, 2)).limit(50),
        "candidatas a enlazar",
      ) as Resena[];
    },
    async insertarResena(fila) {
      comprobar(await sb.from("resenas").insert(fila), "insertar reseña");
    },
    async leerToken() {
      const filas = comprobar(await sb.from("resenas_google_token").select("refresh_token").eq("id", true).limit(1), "leer token") as Array<{ refresh_token: string }>;
      return filas?.[0]?.refresh_token ?? null;
    },
    async guardarToken(t) {
      comprobar(await sb.from("resenas_google_token").upsert({ id: true, ...t, created_at: new Date().toISOString() }), "guardar token");
    },
    async borrarToken() {
      comprobar(await sb.from("resenas_google_token").delete().eq("id", true), "borrar token");
    },
    async placeId() {
      const filas = comprobar(await sb.from("config_google_places").select("place_id").limit(1), "place_id") as Array<{ place_id: string }>;
      return filas?.[0]?.place_id ?? null;
    },
    async guia() {
      const { data } = await sb.from("instagram_guias_marca").select("guia").eq("marca", "casa-tomas").limit(1);
      return typeof data?.[0]?.guia === "string" ? data[0].guia : null;
    },
  };
}

function crearDeps(): Deps {
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    repo: crearRepo(sb),
    ia: crearIaContestador({ cliente: sb, registrar: registrarUso }),
    fetch,
    oauth: CLIENT_ID && CLIENT_SECRET ? { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: REDIRECT_URI } : null,
    redirectUri: REDIRECT_URI,
    claveEstado: SERVICE_ROLE_KEY,
    // Places API (5 reseñas, valoración y total) la sigue haciendo sync-google-reviews.
    sincronizarPlaces: async () => {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-google-reviews`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY, "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(45_000),
      });
      const cuerpo = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(cuerpo?.error ?? `sync-google-reviews ${res.status}`));
      return { encontradas: cuerpo.reviews_found, nuevas: cuerpo.reviews_inserted, actualizadas: cuerpo.reviews_updated };
    },
  };
}

const redirigir = (url: string) => new Response(null, { status: 302, headers: { Location: url } });

Deno.serve(conAuditoriaDePeticion("resenas-contestador", createClientBase, async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  // Vuelta de Google OAuth (navegador del dueño, sin JWT): el `state` firmado autoriza.
  if (req.method === "GET") {
    const u = new URL(req.url);
    if (!u.searchParams.has("state")) return json({ ok: false, error: "metodo_no_permitido" }, 405);
    try {
      return redirigir(await completarConexion(crearDeps(), u.searchParams.get("code"), u.searchParams.get("state"), u.searchParams.get("error")));
    } catch (e) {
      const msg = e instanceof ErrorAccion ? e.message : "No se pudo completar la conexión con Google.";
      return new Response(`<!doctype html><meta charset="utf-8"><title>Casa Tomás</title><p style="font-family:sans-serif">${msg.replace(/[<>&]/g, "")}</p>`, {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
  }
  if (req.method !== "POST") return json({ ok: false, error: "metodo_no_permitido" }, 405);

  const cuerpo = await req.json().catch(() => ({})) as Record<string, unknown>;
  const accion = String(cuerpo?.accion ?? "");

  // Cron: solo el ciclo, con el secreto compartido (falla cerrado).
  const secreto = req.headers.get("x-webhook-secret");
  if (secreto !== null) {
    if (!CRON_SECRET) return json({ ok: false, error: "falta_secreto" }, 500);
    if (!compararTiempoConstante(secreto, CRON_SECRET)) return json({ ok: false, error: "no_autorizado" }, 401);
    if (accion !== "ciclo") return json({ ok: false, error: "accion_no_valida" }, 400);
    return json(await ciclo(crearDeps(), "cron"));
  }

  const sa = await exigirSuperAdmin(req, { crearCliente: createClient, corsHeaders: cors });
  if (!sa.ok) return sa.response;

  const d = crearDeps();
  try {
    switch (accion) {
      case "estado": return json(await estado(d));
      case "proponer": return json(await proponer(d, cuerpo.id, cuerpo.indicacion));
      case "guardar": return json(await guardarBorrador(d, cuerpo.id, cuerpo.texto));
      case "aprobar": return json(await aprobar(d, cuerpo.id, cuerpo.texto, sa.userId, cuerpo.publicar !== false));
      case "marcar_respondida": return json(await marcarRespondida(d, cuerpo.id, cuerpo.texto, sa.userId));
      case "descartar": return json(await descartar(d, cuerpo.id));
      case "ciclo": return json(await ciclo(d, "panel"));
      case "google_conectar": return json(await iniciarConexion(d, sa.userId, cuerpo.volver));
      case "google_ubicaciones": return json(await listarUbicaciones(d));
      case "google_elegir_ubicacion": return json(await elegirUbicacionAccion(d, cuerpo.ubicacion));
      case "google_desconectar": return json(await desconectar(d));
      default: return json({ ok: false, error: "accion_no_valida" }, 400);
    }
  } catch (e) {
    if (e instanceof ErrorAccion) return json({ ok: false, error: e.codigo, mensaje: e.message }, e.status);
    const mensaje = ((e as Error)?.message ?? "error").slice(0, 300);
    console.error("resenas-contestador:", accion, mensaje);
    return json({ ok: false, error: "error_interno", mensaje }, /OpenAI/.test(mensaje) ? 502 : 500);
  }
}));
