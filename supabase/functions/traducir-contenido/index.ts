// traducir-contenido
// ---------------------------------------------------------------------------
// Sustituye a traducir-carta, traducir-carta-auto, traducir-novedad y
// traducir-novedad-auto: unifica los 4 en una sola función que SOLO traduce.
//
// A diferencia del diseño anterior (n8n hacía el INSERT/UPDATE final en
// Supabase), esta función nunca escribe en la base de datos. Recibe
// {tipo, datos}, llama a OpenAI con el prompt especializado de ese tipo
// (ver prompts.ts) y devuelve un objeto con las columnas *_en/*_fr ya listas
// para que el panel las guarde junto con el resto del producto. Quien
// escribe la carta es el panel (los hooks en src/hooks/), con RLS detrás;
// esta función solo lleva la clave de OpenAI.
//
// Modo bulk (relleno masivo, TAREA 5): ver bulk.ts. Gateado a la service
// role key — implementado pero nunca invocado desde aquí.
//
// Modo genérico "campos" (Bot web): ver campos.ts. Se activa cuando el body
// trae `campos` y NO trae `tipo`, así que los llamantes existentes
// ({tipo, datos}) no cambian de comportamiento.
//
// Autorización (CT-REM-FN-01, 30-oct-2026): ya NO está en ADMITE_INTEGRACION.
//   · bulk → solo service role (como antes).
//   · campos / tipo → usuario con la sección Carta (gestor_carta) o Novedades
//     (gestion_web) en modo "view" — el mismo listón con el que hoy la RLS deja
//     guardar la carta (`can_write_section` mira can_view). 401 sin usuario,
//     403 sin sección.
// Clave por `claveOpenAI("otros")` y cada llamada deja su fila en ia_uso.
// ---------------------------------------------------------------------------
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { buildPromptSpec, type TipoContenido } from "./prompts.ts";
import { runBulkFill } from "./bulk.ts";
import { buildCamposSpec, validarPayloadCampos } from "./campos.ts";
import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { esServiceRole, exigirPermiso } from "../_shared/autorizacion.ts";
import { claveOpenAI } from "../_shared/clave-openai.ts";
import { AcumuladorUso, registrarUso } from "../_shared/registrar-uso-ia.ts";

const createClient = clienteConAuditoria(createClientBase, "traducir-contenido");

/** Secciones del panel desde las que se traduce (basta con una). */
export const SECCIONES_TRADUCCION = ["gestor_carta", "gestion_web"] as const;

/** Tope del modo `tipo` (el modo `campos` ya tiene el suyo en campos.ts). */
export const MAX_CARACTERES_DATOS = 20000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4.1-mini";

const TIPOS_VALIDOS: TipoContenido[] = ["plato", "bebida", "vino", "coctel", "tapas", "menu", "novedad"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callOpenAI(uso: AcumuladorUso, system: string, user: string): Promise<unknown> {
  const OPENAI_KEY = claveOpenAI("otros");
  if (!OPENAI_KEY) {
    throw new Error("OPENAI_API_KEY no configurada en los secrets de la función");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  let res: Response;
  try {
    res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    // La llamada se ha hecho: cuenta como llamada aunque no traiga usage.
    uso.sumar(null);
    const errText = await res.text();
    throw new Error(`OpenAI ${res.status}: ${errText}`);
  }

  const body = await res.json();
  uso.sumar(body?.usage);
  const content = body?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("OpenAI no devolvió contenido");
  }

  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`OpenAI devolvió JSON inválido: ${cleaned.slice(0, 300)}`);
  }
}

serve(conAuditoriaDePeticion("traducir-contenido", createClientBase, async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // La autorización va ANTES de leer el cuerpo y de tocar OpenAI. La service
  // role solo abre el modo bulk (se comprueba abajo); con ella no se traduce
  // en nombre de nadie por las otras ramas.
  const servicio = esServiceRole(req);
  let disparador = "bulk";
  if (!servicio) {
    const auth = await exigirPermiso(req, SECCIONES_TRADUCCION, "view", { crearCliente: createClient, corsHeaders });
    if (!auth.ok) return auth.response;
    disparador = `usuario:${auth.userId}`;
  }

  const uso = new AcumuladorUso("traducir-contenido", MODEL, "chat");
  const inicioMs = Date.now();
  const llamar = (system: string, user: string) => callOpenAI(uso, system, user);
  try {
    return await atender(req, servicio, llamar, uso);
  } finally {
    await registrarUso(uso, { disparador, duracionMs: Date.now() - inicioMs });
  }
}));

async function atender(
  req: Request,
  servicio: boolean,
  callOpenAI: (system: string, user: string) => Promise<unknown>,
  uso: AcumuladorUso,
): Promise<Response> {
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Body no es JSON válido" }, 400);
  }

  // ---- Modo relleno masivo (TAREA 5) ----------------------------------
  // Gateado a que el llamante presente la service role key como Bearer:
  // ningún usuario del panel (JWT normal) puede alcanzar esto, solo quien
  // tenga acceso directo al backend (el dueño, vía curl/CLI).
  if (payload.modo === "bulk") {
    if (!servicio) {
      return json({ error: "Modo bulk requiere autenticación con service role key" }, 403);
    }
    try {
      const resultado = await runBulkFill({
        tablas: Array.isArray(payload.tablas) ? (payload.tablas as string[]) : undefined,
        dryRun: payload.dryRun === true,
        callOpenAI,
      });
      return json({ ok: true, ...resultado });
    } catch (error) {
      uso.marcarError();
      const message = error instanceof Error ? error.message : "Error desconocido en modo bulk";
      console.error("[traducir-contenido/bulk]", message);
      return json({ ok: false, error: message }, 500);
    }
  }

  // Con la service role solo hay bulk: el resto es trabajo de un usuario.
  if (servicio) {
    return json({ error: "Con la service role key solo se admite el modo bulk" }, 403);
  }

  // ---- Modo genérico: { campos, destino } (Bot web) --------------------
  if (payload.tipo === undefined && payload.campos !== undefined) {
    const v = validarPayloadCampos(payload);
    if (!v.ok) return json({ error: v.error }, 400);
    try {
      const spec = buildCamposSpec(v.campos, v.destino, v.contexto);
      // Todo vacío: nada que traducir, no se gasta una llamada a OpenAI.
      const raw = spec.clavesATraducir.length ? await callOpenAI(spec.system, spec.userMessage) : {};
      const traducciones = spec.mapResponse(raw);
      return json({ ok: true, modo: "campos", traducciones });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido al traducir";
      uso.marcarError();
      console.error("[traducir-contenido] modo=campos", message);
      // Igual que el modo normal: 200 con ok:false para que el panel lo trate
      // como "traducción pendiente" sin romper lo que ya guardó.
      return json({ ok: false, modo: "campos", error: message });
    }
  }

  // ---- Modo normal: traducir un único contenido ------------------------
  const tipo = payload.tipo as TipoContenido | undefined;
  const datos = (payload.datos ?? payload) as Record<string, unknown>; // acepta {tipo,datos} o el objeto plano (compat)

  if (!tipo || !TIPOS_VALIDOS.includes(tipo as TipoContenido)) {
    return json({ error: `tipo inválido. Debe ser uno de: ${TIPOS_VALIDOS.join(", ")}` }, 400);
  }
  if (!datos || typeof datos !== "object") {
    return json({ error: "Falta el campo 'datos'" }, 400);
  }
  const tamano = JSON.stringify(datos).length;
  if (tamano > MAX_CARACTERES_DATOS) {
    return json({ error: `Demasiado texto para traducir (${tamano} > ${MAX_CARACTERES_DATOS} caracteres)` }, 400);
  }

  try {
    const spec = buildPromptSpec(tipo, datos);
    const raw = await callOpenAI(spec.system, spec.userMessage);
    const translations = spec.mapResponse(raw);
    return json({ ok: true, tipo, translations });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido al traducir";
    uso.marcarError();
    console.error(`[traducir-contenido] tipo=${tipo}`, message);
    // 200 a propósito: el panel debe poder guardar sin traducción en vez de
    // romper el flujo de guardado por un fallo de OpenAI (TAREA 2).
    return json({ ok: false, tipo, error: message });
  }
}
