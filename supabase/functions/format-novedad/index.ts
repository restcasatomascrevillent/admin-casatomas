// format-novedad
// ---------------------------------------------------------------------------
// Antes: proxy a un webhook de n8n ("DescripciónIA.json", nodo "Modelo",
// gpt-4o-mini) que reescribía/mejoraba el texto de una novedad. Ahora llama a
// OpenAI directamente — el prompt y el modelo (gpt-4o-mini) se conservan tal
// cual el workflow original, incluida la normalización de tags (capitaliza
// la primera letra) que hacía el nodo "Parseo JSON".
//
// Contrato de entrada y salida SIN CAMBIOS respecto a la versión anterior
// (lo consume src/components/gestion-web/EditorNovedadesWeb.tsx, fuera del
// alcance de esta tarea, así que no se toca esa parte):
//   in:  { tipo, idioma, tono, texto, canal }
//   out: { tipo, title, body, bullets, cta: {text,url}, tags, meta } en éxito
//        { title:null, subtitle:null, body, bullets:[], cta:null, tags:[],
//          meta:{missing,source:'fallback',...} } si algo falla (nunca 500
//        puro: el editor no debe romperse porque falle la IA).
// ---------------------------------------------------------------------------
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini"; // mismo modelo que usaba el nodo "Modelo" de DescripciónIA.json

const SYSTEM_PROMPT =
  "Eres un editor de contenidos en español para una sección de Novedades. Devuelve SOLO JSON válido y nada más. No uses markdown. No inventes datos: reescribe y mejora SOLO con lo que venga en el Texto.";

function buildUserPrompt(tipo: string, idioma: string, tono: string, texto: string): string {
  return `Vas a REESCRIBIR y MEJORAR el texto de entrada para una sección de Novedades, usando únicamente la información/ideas del propio texto. Mantén el idioma y el tono indicados.

Entrada:
Tipo: ${tipo}
Idioma: ${idioma}
Tono: ${tono}
Texto: ${texto}

Devuelve SOLO este JSON (sin texto extra):
{
  "tipo": "${tipo}",
  "title": "...",
  "body": "...",
  "bullets": ["...","..."],
  "cta": {"text": "...", "url": null},
  "tags": ["...","..."],
  "meta": {"warnings": [], "missing": []}
}

Reglas estrictas:
- title: 6–10 palabras, claro y atractivo, sin comillas.
- body: 2–4 frases, mucho mejor redactado que el texto original, más claro y profesional, sin inventar datos.
- bullets: EXACTAMENTE 2 puntos clave (frases cortas).
- cta.text: OBLIGATORIO (ej: "Descubrir novedades", "Ver detalles", "Más información"). cta.url siempre null.
- tags: EXACTAMENTE 2 o 3 etiquetas, en minúsculas, sin #.
- Si el Texto no incluye datos concretos (fechas, URL, detalles), NO los inventes; añade esos campos a meta.missing.
- Si Tipo = "anuncio": corto, cercano y claro. Si Tono = "formal": lenguaje formal.`;
}

// ─── Autenticación / autorización ────────────────────────────────────────────
// Esta función es un proxy de OpenAI. Antes estaba ABIERTA A INTERNET:
// config.toml la declara `verify_jwt = false` y el código no comprobaba nada,
// así que cualquiera podía hacer POST y gastar el saldo de OpenAI sin límite.
//
// ⚠️ Poner `verify_jwt = true` NO habría bastado: la anon key es un JWT válido
// y viaja en el bundle público del panel. Hay que comprobar que detrás del
// token hay un USUARIO real y que tiene acceso a la sección.
//
// Mismo patrón que procesar-factura/index.ts:379-438.
//
// Sección `gestion_web` (no `carta`): el único consumidor es
// src/components/gestion-web/EditorNovedadesWeb.tsx, que vive en
// src/pages/GestionWeb.tsx → ruta /gestion-web → ROUTE_TO_SECTION la mapea a
// `gestion_web` (ProtectedRoute.tsx:21). `carta` ni siquiera es un section_key
// válido: los de la carta son `gestor_carta`.
//
// Nivel 'view' (no 'edit') a propósito: es lo que el panel exige para entrar
// en /gestion-web (ProtectedRoute.tsx:63-64 comprueba can_view) y el editor no
// tiene gating adicional por can_edit. Verificado en la BD: hay 2 usuarios con
// can_view=true y can_edit=false sobre gestion_web, que hoy usan este botón;
// exigir 'edit' se los cargaría en silencio.
async function autenticar(
  req: Request,
): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  const deny = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    console.error("[format-novedad] Sin cabecera Authorization");
    return { ok: false, response: deny({ error: "No autorizado" }, 401) };
  }

  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
  if (userError || !user) {
    // Aquí cae la anon key suelta: JWT válido pero sin usuario detrás.
    console.error("[format-novedad] Token sin usuario:", userError?.message);
    return { ok: false, response: deny({ error: "Usuario no autenticado" }, 401) };
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // has_section_permission ya devuelve true para administradores.
  const { data: permitido, error: permError } = await supabaseAdmin.rpc(
    "has_section_permission",
    { _user_id: user.id, _section: "gestion_web", _permission: "view" },
  );

  if (permError) {
    console.error("[format-novedad] Error comprobando permisos:", permError.message);
    return { ok: false, response: deny({ error: "Error verificando permisos" }, 500) };
  }

  if (!permitido) {
    console.error("[format-novedad] Usuario sin acceso a gestion_web:", user.id);
    return { ok: false, response: deny({ error: "Sin permisos sobre la sección de gestión web" }, 403) };
  }

  return { ok: true, userId: user.id };
}

const capFirst = (s: unknown): unknown => {
  if (typeof s !== "string" || s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function buildFallback(texto: string, message: string, extra?: Record<string, unknown>) {
  return {
    title: null,
    subtitle: null,
    body: texto,
    bullets: [],
    cta: null,
    tags: [],
    meta: {
      // EditorNovedadesWeb ya sabe mostrar warnings si meta.missing tiene contenido
      missing: [message],
      source: "fallback",
      ...(extra || {}),
    },
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Autenticación ANTES de tocar OpenAI. Va FUERA del try/catch de abajo a
  // propósito: ese catch devuelve buildFallback() con HTTP 200, y un rechazo
  // por permisos tiene que salir como 401/403 de verdad, no disfrazado de
  // "la IA no está disponible".
  const auth = await autenticar(req);
  if (!auth.ok) return auth.response;

  let texto = "";
  try {
    const { tipo, idioma, tono, texto: textoIn } = await req.json();
    texto = textoIn ?? "";

    if (!texto || texto.trim() === "") {
      return new Response(
        JSON.stringify({ error: "El campo texto es obligatorio" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!OPENAI_KEY) {
      console.error("[format-novedad] OPENAI_API_KEY no configurada");
      return new Response(
        JSON.stringify(buildFallback(texto, "El generador de contenido no está disponible ahora mismo.")),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const tipoFinal = tipo || "anuncio";
    const idiomaFinal = idioma || "es";
    const tonoFinal = tono || "cercano";

    console.log("Generando novedad:", { tipo: tipoFinal, idioma: idiomaFinal, tono: tonoFinal });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    let openaiRes: Response;
    try {
      openaiRes = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.7,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildUserPrompt(tipoFinal, idiomaFinal, tonoFinal, texto) },
          ],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error("Error de OpenAI:", openaiRes.status, errText);
      return new Response(
        JSON.stringify(buildFallback(texto, `El generador de contenido falló (${openaiRes.status}). Se ha usado el texto original.`, {
          openai_status: openaiRes.status,
        })),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await openaiRes.json();
    const content = body?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      return new Response(
        JSON.stringify(buildFallback(texto, "El generador de contenido no devolvió resultado. Se ha usado el texto original.")),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error("JSON inválido del modelo:", cleaned);
      return new Response(
        JSON.stringify(buildFallback(texto, "El generador de contenido devolvió un formato inesperado. Se ha usado el texto original.")),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Capitalizar la primera letra de cada tag, igual que el nodo "Parseo JSON" de n8n.
    if (Array.isArray(parsed.tags)) {
      parsed.tags = (parsed.tags as unknown[]).map(capFirst);
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error en format-novedad:", error);
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Timeout: el generador de contenido tardó demasiado en responder. Se ha usado el texto original."
        : error instanceof Error
          ? error.message
          : "Error desconocido";

    return new Response(JSON.stringify(buildFallback(texto, message)), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
