// extraer-vino-foto
// ---------------------------------------------------------------------------
// Lee la etiqueta de una botella de vino a partir de una foto y devuelve los
// datos para PRECARGAR el formulario de alta de vino del panel (VinoForm).
//
// - Nunca escribe en la base de datos: el usuario revisa y guarda desde el
//   panel (crearVino en useVinos.ts, que además traduce al guardar).
// - Solo devuelve campos que existen en la tabla `Vinos`. El precio no está
//   en la etiqueta: nunca se devuelve.
// - Auth: verify_jwt (config.toml) + permiso de ESCRITURA en `gestor_carta`
//   (misma función que la RLS de la carta, resuelta con el JWT del usuario).
// - Mismo secreto que traducir-contenido: OPENAI_API_KEY.
//
// Body: { imagen: "<base64 JPEG, con o sin prefijo data:>", categorias?: string[] }
// Respuesta: { ok: true, vino: {...} } | { ok: false, error }
// ---------------------------------------------------------------------------
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { comprobarPermisoSeccion, type ClientePermiso } from "../_shared/permiso-marketing.ts";
import { AcumuladorUso, registrarUso } from "../_shared/registrar-uso-ia.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FUNCION = "extraer-vino-foto";
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4.1-mini";
// ~1024px JPEG 0.8 en base64 ronda 150-400 KB; 4 MB de margen sobra.
const MAX_BASE64 = 4_000_000;

const CAMPOS = [
  "nombre",
  "categoria",
  "descripcion",
  "ingredientes",
  "denominacion_origen",
  "ubicacion_region",
  "ubicacion_pais",
  "contiene_sulfitos",
] as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function textoONull(v: unknown, max = 300): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

// Ejemplos de tono: descripciones reales de la carta (las más largas), leídas
// con el cliente del propio usuario. Si la consulta falla, se sigue sin ellos.
async function leerEjemplosTono(cliente: ReturnType<typeof createClientBase>): Promise<string[]> {
  try {
    const { data, error } = await cliente
      .from("Vinos")
      .select("descripcion")
      .not("descripcion", "is", null)
      .neq("descripcion", "")
      .limit(80);
    if (error || !Array.isArray(data)) return [];
    const textos = (data as Array<{ descripcion?: unknown }>)
      .map((f) => (typeof f.descripcion === "string" ? f.descripcion.trim() : ""))
      .filter((t) => t.length >= 40);
    return [...new Set(textos)].sort((a, b) => b.length - a.length).slice(0, 5).map((t) => t.slice(0, 400));
  } catch {
    return [];
  }
}

function buildSystem(categorias: string[], ejemplos: string[]): string {
  const listaCat = categorias.length
    ? `Categorías existentes en la carta (elige EXACTAMENTE una de ellas si encaja, si no null): ${JSON.stringify(categorias)}.`
    : "No hay categorías existentes: deja categoria en null.";
  return [
    "Eres un sumiller que lee etiquetas de botellas de vino a partir de una foto para dar de alta el vino en la carta de un restaurante gallego.",
    "Devuelve SOLO un objeto JSON con estas claves exactas:",
    "nombre (string: nombre comercial del vino tal como aparece en la etiqueta, incluyendo la bodega si forma parte del nombre visible; incluye la añada si aparece, p.ej. 'Pazo Señorans 2022'),",
    "categoria (string o null),",
    "descripcion (string: descripción de sumiller para la carta, ver REGLAS DE LA DESCRIPCIÓN),",
    "ingredientes (string o null: variedad/es de uva, p.ej. 'Albariño' o 'Mencía, Garnacha'. Si la etiqueta no la dice pero el vino concreto o su D.O. y tipo la hacen muy probable, rellénala (p.ej. Rioja blanco → 'Viura'; Rías Baixas → 'Albariño'; Rueda → 'Verdejo'; Ribera del Duero tinto → 'Tempranillo'). Si no hay certeza razonable: null),",
    "denominacion_origen (string o null: D.O./D.O.Ca./IGP tal como figura, p.ej. 'Rías Baixas', 'Ribera del Duero'),",
    "ubicacion_region (string o null: región o comunidad, p.ej. 'Galicia', 'Castilla y León', 'Borgoña'),",
    "ubicacion_pais (string o null: país en español, p.ej. 'España', 'Francia'),",
    "contiene_sulfitos (boolean: true si la etiqueta dice 'contiene sulfitos'/'contains sulphites', si no false).",
    listaCat,
    "Puedes deducir región y país a partir de una D.O. conocida. Nombre, D.O. y sulfitos: solo lo que se lea con claridad, si no null. Nunca incluyas precio.",
    "",
    "REGLAS DE LA DESCRIPCIÓN:",
    "- Tras leer la etiqueta, usa lo que SABES de ese vino, su bodega y su D.O. para escribir como un sumiller en la carta de un restaurante.",
    "- Español, 2-3 frases, unos 200-300 caracteres: estilo/elaboración (joven, crianza, barrica, lías…), notas de cata (nariz y boca) y un maridaje breve.",
    "- Tono cálido y elegante. Sin tópicos vacíos ('un vino único', 'toda una experiencia') ni superlativos exagerados.",
    "- No empieces con una ficha literal tipo 'Vino blanco de la bodega X con denominación Y'.",
    "- Si no conoces ese vino concreto, describe con prudencia lo típico de ese tipo + D.O. + uva.",
    "- Nunca inventes premios, puntuaciones, añadas, meses exactos de crianza ni otros datos concretos que no conozcas con seguridad.",
    ...(ejemplos.length
      ? ["", "Ejemplos de descripciones de esta carta (imita su tono y longitud, no su contenido):", ...ejemplos.map((e) => `- ${e}`)]
      : []),
  ].join("\n");
}

serve(conAuditoriaDePeticion(FUNCION, createClientBase, async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);

  // ---- Auth: usuario del panel con permiso de escritura en la carta ------
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "No autorizado" }, 401);
  const supabaseUser = createClientBase(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const permiso = await comprobarPermisoSeccion(
    supabaseUser as unknown as ClientePermiso,
    "gestor_carta",
    "escribir",
    "No tienes permiso para editar la carta",
  );
  if (!permiso.ok) return json({ ok: false, error: permiso.error }, permiso.status);

  // ---- Body ---------------------------------------------------------------
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  let imagen = typeof payload.imagen === "string" ? payload.imagen.trim() : "";
  if (!imagen) return json({ ok: false, error: "Falta la imagen" }, 400);
  if (imagen.length > MAX_BASE64) return json({ ok: false, error: "La imagen es demasiado grande" }, 413);
  if (!imagen.startsWith("data:")) imagen = `data:image/jpeg;base64,${imagen}`;
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(imagen)) {
    return json({ ok: false, error: "Formato de imagen no soportado" }, 400);
  }
  const categorias = Array.isArray(payload.categorias)
    ? (payload.categorias as unknown[]).filter((c): c is string => typeof c === "string" && c.trim() !== "").slice(0, 50)
    : [];

  if (!OPENAI_KEY) return json({ ok: false, error: "OPENAI_API_KEY no configurada" }, 500);

  const ejemplos = await leerEjemplosTono(supabaseUser);

  const uso = new AcumuladorUso(FUNCION, MODEL, "vision");
  const inicioMs = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.4,
        max_tokens: 700,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildSystem(categorias, ejemplos) },
          {
            role: "user",
            content: [
              { type: "text", text: "Lee la etiqueta de esta botella y devuelve el JSON." },
              { type: "image_url", image_url: { url: imagen, detail: "auto" } },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      uso.sumar(null);
      uso.marcarError();
      const errText = await res.text();
      console.error(`[${FUNCION}] OpenAI ${res.status}: ${errText.slice(0, 300)}`);
      return json({ ok: false, error: "No se pudo leer la etiqueta" }, 502);
    }

    const body = await res.json();
    uso.sumar(body?.usage);
    const content = body?.choices?.[0]?.message?.content;
    let raw: Record<string, unknown> = {};
    try {
      raw = JSON.parse(String(content ?? "{}").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, ""));
    } catch {
      uso.marcarError();
      return json({ ok: false, error: "La IA devolvió una respuesta no válida" }, 502);
    }

    const categoria = textoONull(raw.categoria, 100);
    const vino: Record<string, string | boolean | null> = {};
    for (const campo of CAMPOS) {
      if (campo === "contiene_sulfitos") vino[campo] = raw[campo] === true;
      else if (campo === "categoria") vino[campo] = categoria && categorias.includes(categoria) ? categoria : null;
      else vino[campo] = textoONull(raw[campo], campo === "descripcion" ? 600 : 200);
    }

    return json({ ok: true, vino });
  } catch (error) {
    uso.marcarError();
    const message = error instanceof Error ? error.message : "Error desconocido";
    console.error(`[${FUNCION}]`, message);
    return json({ ok: false, error: "No se pudo leer la etiqueta" }, 500);
  } finally {
    clearTimeout(timeout);
    await registrarUso(uso, { disparador: `usuario:${permiso.userId}`, duracionMs: Date.now() - inicioMs });
  }
}));
