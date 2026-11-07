import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { exigirSuperAdmin } from "../_shared/autorizacion.ts";
import { claveOpenAI } from "../_shared/clave-openai.ts";
import { AcumuladorUso, registrarUso } from "../_shared/registrar-uso-ia.ts";
import { compararTiempoConstante } from "../_shared/tiempo-constante.ts";
import {
  compatibilidadHerramientas, costeUsd, cuerpoPrueba, esModeloDeChat, modelosDeRespuesta, peticionEvaluar, type PrecioModelo, procesoDeFuncion, sumarUsage,
  textoRespuesta,
} from "./logica.ts";
import { ejecutarConversacion, type Traza } from "../chat-facturas/bucle.ts";
const createClient = clienteConAuditoria(createClientBase, "ia-modelos-openai");

// ============================================================================
//  ia-modelos-openai · Centro de modelos de IA (07-nov-2026)
// ----------------------------------------------------------------------------
//  POST { accion: "sincronizar" }
//       GET https://api.openai.com/v1/models con la clave del servidor (gratis)
//       → ia_modelos_registrar(): guarda la lista y genera los avisos de la
//       campana (modelo nuevo, modelo en uso retirado, en uso sin precio).
//       → { ok, total, nuevos, retirados, en_uso_no_disponibles, en_uso_sin_precio, avisos }
//  POST { accion: "probar", modelo, funcion? }   (super admin, o el servidor con el secreto)
//       Una llamada mínima a chat/completions con ese modelo y la clave del
//       proyecto de esa función. → { ok, modelo, latencia_ms, respuesta, tokens }
//       Su gasto queda en ia_uso (función ia-modelos-openai).
//       La llamada lleva una herramienta: el resultado (admite o no Chat
//       Completions + herramientas con nuestros parámetros) se guarda en
//       ia_modelos_disponibles.compatible_herramientas/_motivo/_probado_en
//       (20261107620000) y la respuesta trae compatible_herramientas.
//  POST { accion: "evaluar", modelo, preguntas: [{ id, mensaje, historial? }], presupuesto_usd?, reasoning_effort? }
//       (07/11/2026, docs/facturas/EVAL-MODELOS.md) Ejecuta el MISMO bucle de
//       chat-facturas (chat-facturas/bucle.ts: prompt, herramientas y RPC
//       contra la BD, con el cliente de service role como chat-facturas) con
//       ese modelo, SIN guardar conversación. Máx. 3 preguntas por llamada.
//       Se niega si el gasto acumulado de evaluaciones (ia_uso, disparador
//       «evaluar:…») ya llega a presupuesto_usd (tope 3 $). reasoning_effort
//       ("low"/"medium") pisa el "none" de GPT-6 SOLO aquí: gpt-6.1-sol no lo admite.
//       → { ok, modelo, resultados: [{ id, respuesta, herramientas, llamadas_chat,
//            tokens{entrada,cacheados,salida,razonamiento,embedding}, coste_usd, latencia_ms, error? }] }
//
//  La llaman: pg_cron «ia-modelos-openai» (diario, x-ocr-secret = Vault
//  «ocr_trabajos_secret»; también sirve para una prueba desde SQL con
//  net.http_post, sin sacar el secreto de Vault) y un SUPER ADMIN con su JWT
//  desde Super Admin › Servicios › Modelos. verify_jwt = false (pg_net no
//  lleva JWT): la autenticación es el secreto o el super admin.
//  La clave de OpenAI nunca sale de aquí: los errores se devuelven saneados.
// ============================================================================

const SECRETO = Deno.env.get("OCR_TRABAJOS_SECRET");
const URL_SB = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI = "https://api.openai.com/v1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/** Mensaje de error de OpenAI sin nada que se parezca a una clave. */
function errorSaneado(cuerpo: unknown, status: number): string {
  const m = (cuerpo as { error?: { message?: unknown } } | null)?.error?.message;
  const texto = typeof m === "string" ? m : `HTTP ${status}`;
  return texto.replace(/sk-[A-Za-z0-9_\-*.]+/g, "sk-…").replace(/Bearer\s+\S+/gi, "Bearer …").slice(0, 300);
}

async function conTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const control = new AbortController();
  const t = setTimeout(() => control.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: control.signal });
  } finally {
    clearTimeout(t);
  }
}

serve(conAuditoriaDePeticion("ia-modelos-openai", createClientBase, async (req) => {
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
    // sin cuerpo = sincronizar
  }
  const accion = typeof body.accion === "string" ? body.accion : "sincronizar";
  const supabase = createClient(URL_SB, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

  if (accion === "sincronizar") {
    const clave = claveOpenAI("otros");
    if (!clave) return json({ ok: false, error: "Falta la clave de OpenAI en el servidor" }, 500);
    let res: Response;
    try {
      res = await conTimeout(`${OPENAI}/models`, { headers: { Authorization: `Bearer ${clave}` } }, 20_000);
    } catch (e) {
      return json({ ok: false, error: `OpenAI no responde: ${(e as Error)?.name ?? "error"}` }, 502);
    }
    const cuerpo = await res.json().catch(() => null);
    if (!res.ok) return json({ ok: false, error: `OpenAI ${res.status}: ${errorSaneado(cuerpo, res.status)}` }, 502);
    let modelos;
    try {
      modelos = modelosDeRespuesta(cuerpo);
    } catch (e) {
      return json({ ok: false, error: (e as Error).message }, 502);
    }
    const { data, error } = await supabase.rpc("ia_modelos_registrar", { p_modelos: modelos });
    if (error) {
      console.error("[ia-modelos-openai] ia_modelos_registrar:", error.message);
      return json({ ok: false, error: `No se pudo guardar la lista: ${error.message}` }, 500);
    }
    console.log(`[ia-modelos-openai] ${quien} · ${modelos.length} modelos · ${JSON.stringify({ ...data, en_uso: undefined })}`);
    return json({ ok: true, ...(data as Record<string, unknown>) });
  }

  if (accion === "probar") {
    const modelo = typeof body.modelo === "string" ? body.modelo.trim() : "";
    const funcion = typeof body.funcion === "string" ? body.funcion.trim().slice(0, 80) : null;
    if (!modelo || !esModeloDeChat(modelo)) return json({ ok: false, error: "Ese modelo no se puede probar con chat (no es de texto)" }, 400);
    const { data: disp, error: eDisp } = await supabase.from("ia_modelos_disponibles")
      .select("id, retirado_en").eq("id", modelo).maybeSingle();
    if (eDisp) return json({ ok: false, error: eDisp.message }, 500);
    if (!disp) return json({ ok: false, error: `${modelo} no está en la lista de modelos de la cuenta. Actualiza la lista.` }, 404);

    const clave = claveOpenAI(procesoDeFuncion(funcion));
    if (!clave) return json({ ok: false, error: "Falta la clave de OpenAI en el servidor" }, 500);
    const uso = new AcumuladorUso("ia-modelos-openai", modelo, "chat");
    const t0 = Date.now();
    try {
      const res = await conTimeout(`${OPENAI}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${clave}` },
        body: JSON.stringify(cuerpoPrueba(modelo)),
      }, 45_000);
      const cuerpo = await res.json().catch(() => null);
      const latencia = Date.now() - t0;
      uso.sumar(cuerpo?.usage);
      const compat = compatibilidadHerramientas(res.status, res.ok ? null : errorSaneado(cuerpo, res.status));
      if (compat) {
        const { error: eCompat } = await supabase.from("ia_modelos_disponibles").update({
          compatible_herramientas: compat.compatible, compatible_motivo: compat.motivo, compatible_probado_en: new Date().toISOString(),
        }).eq("id", modelo);
        if (eCompat) console.error("[ia-modelos-openai] compatibilidad:", eCompat.message);
      }
      if (!res.ok) {
        uso.marcarError();
        return json({
          ok: false, modelo, latencia_ms: latencia, error: `OpenAI ${res.status}: ${errorSaneado(cuerpo, res.status)}`,
          compatible_herramientas: compat ? compat.compatible : null,
        }, 200);
      }
      return json({
        compatible_herramientas: true,
        ok: true,
        modelo,
        modelo_respondido: typeof cuerpo?.model === "string" ? cuerpo.model : null,
        latencia_ms: latencia,
        respuesta: textoRespuesta(cuerpo),
        tokens: { entrada: cuerpo?.usage?.prompt_tokens ?? null, salida: cuerpo?.usage?.completion_tokens ?? null },
      });
    } catch (e) {
      uso.marcarError();
      return json({ ok: false, modelo, latencia_ms: Date.now() - t0, error: `OpenAI no responde: ${(e as Error)?.name ?? "error"}` }, 200);
    } finally {
      await registrarUso(uso, { disparador: `prueba:${funcion ?? "-"}:${quien}`.slice(0, 200), duracionMs: Date.now() - t0, cliente: supabase });
    }
  }

  if (accion === "evaluar") {
    let pet;
    try {
      pet = peticionEvaluar(body);
    } catch (e) {
      return json({ ok: false, error: (e as Error).message }, 400);
    }
    const { data: disp, error: eDisp } = await supabase.from("ia_modelos_disponibles")
      .select("id").eq("id", pet.modelo).maybeSingle();
    if (eDisp) return json({ ok: false, error: eDisp.message }, 500);
    if (!disp) return json({ ok: false, error: `${pet.modelo} no está en la lista de modelos de la cuenta.` }, 404);

    // Presupuesto: lo ya gastado por TODAS las evaluaciones (fuente de verdad: ia_uso).
    const { data: gastadas, error: eGasto } = await supabase.from("ia_uso")
      .select("coste_usd").eq("funcion", "ia-modelos-openai").like("disparador", "evaluar:%");
    if (eGasto) return json({ ok: false, error: `No se pudo leer el gasto: ${eGasto.message}` }, 500);
    const gastado = (gastadas ?? []).reduce((s: number, f: { coste_usd: number | null }) => s + Number(f.coste_usd ?? 0), 0);
    if (gastado >= pet.presupuestoUsd) {
      return json({ ok: false, error: `Presupuesto de evaluación agotado: ${gastado.toFixed(4)} $ de ${pet.presupuestoUsd} $` }, 402);
    }

    const { data: precios } = await supabase.from("ia_precios")
      .select("modelo, usd_por_m_input, usd_por_m_cached, usd_por_m_cache_write, usd_por_m_output").in("modelo", [pet.modelo, "text-embedding-3-small"]);
    const precio = (m: string) => ((precios ?? []) as (PrecioModelo & { modelo: string })[]).find((p) => p.modelo === m) ?? null;

    const clave = claveOpenAI("chat");
    if (!clave) return json({ ok: false, error: "Falta la clave de OpenAI en el servidor" }, 500);

    const resultados = [];
    for (const p of pet.preguntas) {
      const usoChat = new AcumuladorUso("ia-modelos-openai", pet.modelo, "chat");
      const usosChat = [usoChat];
      const usoEmbed = new AcumuladorUso("ia-modelos-openai", "text-embedding-3-small", "embedding");
      const traza: Traza = { llamadas: [], herramientas: [] };
      const t0 = Date.now();
      let respuesta = "";
      let error: string | null = null;
      try {
        // Sin respaldo: se evalúa ESE modelo; si OpenAI lo rechaza, es un resultado.
        const r = await ejecutarConversacion({
          supabase, claveOpenAI: clave, mensaje: p.mensaje, historial: p.historial, modelo: pet.modelo, respaldo: null,
          uso: { usosChat, usoEmbed, nuevoAcumuladorChat: (m) => new AcumuladorUso("ia-modelos-openai", m, "chat") },
          traza,
          ...(pet.esfuerzo ? { parametrosExtra: { reasoning_effort: pet.esfuerzo } } : {}),
        });
        respuesta = r.respuesta;
      } catch (e) {
        usosChat[usosChat.length - 1].marcarError();
        error = errorSaneado({ error: { message: (e as Error)?.message ?? String(e) } }, 0);
      }
      const latencia = Date.now() - t0;
      await registrarUso([...usosChat, usoEmbed], {
        disparador: `evaluar:${pet.modelo}${pet.esfuerzo ? "@" + pet.esfuerzo : ""}:${p.id}`.slice(0, 200), duracionMs: latencia, cliente: supabase,
      });
      const tokens = sumarUsage(traza.llamadas.map((l) => l.usage));
      const cChat = costeUsd(precio(pet.modelo), tokens);
      const cEmb = costeUsd(precio("text-embedding-3-small"), { entrada: usoEmbed.prompt, cacheados: 0, escritos_cache: 0, salida: 0, razonamiento: 0 });
      resultados.push({
        id: p.id,
        respuesta,
        error,
        herramientas: traza.herramientas,
        llamadas_chat: traza.llamadas.length,
        llamadas_ms: traza.llamadas.map((l) => l.ms),
        tokens: { ...tokens, embedding: usoEmbed.prompt },
        coste_usd: cChat === null ? null : Math.round((cChat + (cEmb ?? 0)) * 1e6) / 1e6,
        latencia_ms: latencia,
      });
    }
    console.log(`[ia-modelos-openai] ${quien} · evaluar ${pet.modelo} · ${resultados.length} preguntas`);
    return json({ ok: true, modelo: pet.modelo, esfuerzo: pet.esfuerzo, resultados });
  }

  return json({ ok: false, error: "accion desconocida" }, 400);
}));
