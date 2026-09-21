// procesar-dibujo-perimetro
// ---------------------------------------------------------------------------
// Antes: proxy a la pasarela de IA de Lovable (ai.gateway.lovable.dev,
// google/gemini-2.5-flash), sin ninguna autenticación propia. Ahora llama a
// OpenAI directamente, igual que traducir-contenido/procesar-factura/
// format-novedad. Interpreta el perímetro dibujado a mano en el editor de
// planos (EditorPlanoArquitectonico.tsx) y lo convierte en paredes rectas.
//
// Contrato de entrada y salida SIN CAMBIOS respecto a la versión anterior
// (lo consume EditorPlanoArquitectonico.tsx:244-251, el único llamador):
//   in:  { points: {x,y}[], canvasWidth, canvasHeight, pixelsPerMeter }
//   out (éxito): { walls: {x1,y1,x2,y2,lengthMeters}[], corners: {x,y}[],
//                  perimeter: number, area: number }
//   out (fallo): { error: string }
//
// Único cambio deliberado: SIEMPRE responde HTTP 200 (antes devolvía
// 429/402/500). Mismo motivo que en traducir-contenido y procesar-factura:
// supabase-js `functions.invoke()` no expone el JSON de un cuerpo con status
// != 2xx al llamante (llega como FunctionsHttpError genérico, sin el mensaje
// real — ver EditorPlanoArquitectonico.tsx:253 `if (error) throw error`), así
// que con la versión anterior el toast de error probablemente nunca llegó a
// mostrar el motivo real, solo "Edge Function returned a non-2xx status
// code". El cuerpo sigue llevando exactamente el mismo campo `error`.
//
// Autenticación (antes no tenía NINGUNA — ver
// docs/funcionalidades/09-codigo-muerto-backend-datos.md §8.7, listada junto
// a procesar-factura como "sin autenticar y con gasto asociado"): mismo
// patrón que procesar-factura — usuario real autenticado (auth.getUser())
// + has_section_permission('espacios', 'view'), porque el editor de planos
// vive dentro de /espacios (ProtectedRoute.tsx exige esa sección para entrar
// en la ruta) y procesar-factura exige 'view' (no 'edit') por la misma razón:
// es el mismo nivel que ya exige el panel para entrar en la página.
// ---------------------------------------------------------------------------
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

// gpt-5-mini: el mismo modelo (y el mismo tier) que ya usa procesar-factura,
// la otra función de este proyecto que interpreta contenido visual con
// OpenAI. Justificación:
//   - Soporta `response_format: json_object`, que es lo que de verdad hace
//     falta aquí: la versión Lovable/Gemini original extraía el JSON con un
//     regex sobre texto libre (línea `content.match(/\{[\s\S]*\}/)`), frágil
//     por diseño. Con json_object el modelo está obligado a devolver JSON
//     válido; se conserva el regex solo como red de seguridad.
//   - Tiene visión, que es el requisito explícito del encargo. La entrada de
//     ESTA función concreta no incluye una imagen — son coordenadas de los
//     puntos del trazo, no un snapshot del canvas (ver `points` más abajo) —
//     así que hoy no se ejercita esa capacidad. Se mantiene el mismo modelo
//     igualmente por consistencia con procesar-factura (misma clave, mismo
//     comportamiento probado en este proyecto) y por si en el futuro se
//     decide mandar también una captura del canvas.
//   - Es la opción "mini": la tarea es pequeña (una lista de puntos, una
//     respuesta de unas pocas paredes) y ocurre de forma interactiva mientras
//     el usuario dibuja, así que conviene barata y rápida, no el modelo top.
const MODEL = "gpt-5-mini";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── Autenticación / autorización (mismo patrón que procesar-factura) ───────
// ⚠️ `verify_jwt` NO sirve como autenticación en este proyecto: la anon key es
// un JWT válido y viaja en el bundle público del panel. Hay que comprobar que
// detrás del token hay un USUARIO real y que ese usuario tiene acceso a la
// sección `espacios`.
//
// El panel llama con `supabase.functions.invoke()` desde una sesión iniciada,
// así que el JWT de usuario llega en la cabecera Authorization.
async function autenticar(req: Request): Promise<
  { ok: true; userId: string } | { ok: false; response: Response }
> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    console.error("[procesar-dibujo-perimetro] Sin cabecera Authorization");
    return { ok: false, response: json({ error: "No autorizado" }, 401) };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Cliente con el token del llamante: resuelve QUIÉN es.
  const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
  if (userError || !user) {
    // Aquí cae la anon key suelta: es un JWT válido pero sin usuario detrás.
    console.error("[procesar-dibujo-perimetro] Token sin usuario:", userError?.message);
    return { ok: false, response: json({ error: "Usuario no autenticado" }, 401) };
  }

  // Cliente service role solo para comprobar permisos.
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // `has_section_permission` ya devuelve true para administradores.
  const { data: permitido, error: permError } = await supabaseAdmin.rpc(
    "has_section_permission",
    { _user_id: user.id, _section: "espacios", _permission: "view" },
  );

  if (permError) {
    console.error("[procesar-dibujo-perimetro] Error comprobando permisos:", permError.message);
    return { ok: false, response: json({ error: "Error verificando permisos" }, 500) };
  }

  if (!permitido) {
    console.error("[procesar-dibujo-perimetro] Usuario sin acceso a espacios:", user.id);
    return { ok: false, response: json({ error: "Sin permisos sobre la sección de espacios" }, 403) };
  }

  return { ok: true, userId: user.id };
}

// ─── Handler ─────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Autenticación ANTES de tocar OpenAI.
  const auth = await autenticar(req);
  if (!auth.ok) return auth.response;

  try {
    if (!OPENAI_KEY) {
      throw new Error("OPENAI_API_KEY no configurada en los secrets de la función");
    }

    const { points, canvasWidth, canvasHeight, pixelsPerMeter } = await req.json();

    if (!Array.isArray(points) || points.length === 0) {
      throw new Error("Faltan los puntos del dibujo");
    }
    if (!pixelsPerMeter) {
      throw new Error("Falta pixelsPerMeter");
    }

    // Convertir puntos a metros para el prompt (igual que la versión anterior).
    const pointsInMeters = points.map((p: { x: number; y: number }) => ({
      x: (p.x / pixelsPerMeter).toFixed(2),
      y: (p.y / pixelsPerMeter).toFixed(2),
    }));

    const prompt = `Eres un experto en arquitectura y diseño de planos. Te doy una serie de puntos que representan un dibujo a mano alzada del perímetro de un espacio (restaurante, sala, etc).

Los puntos están en metros. El canvas tiene ${(canvasWidth / pixelsPerMeter).toFixed(1)}m x ${(canvasHeight / pixelsPerMeter).toFixed(1)}m.

Puntos del dibujo (cada 10 puntos aprox del trazo):
${JSON.stringify(pointsInMeters.slice(0, 100), null, 2)}

Tu tarea es:
1. Analizar estos puntos y detectar las paredes del perímetro
2. Simplificar el trazo a líneas rectas (paredes)
3. Identificar las esquinas principales
4. Devolver las paredes como segmentos de línea

IMPORTANTE: Responde SOLO con un JSON válido en este formato exacto, sin texto adicional:
{
  "walls": [
    { "x1": 0, "y1": 0, "x2": 5, "y2": 0, "length": 5.0 },
    { "x1": 5, "y1": 0, "x2": 5, "y2": 4, "length": 4.0 }
  ],
  "corners": [
    { "x": 0, "y": 0 },
    { "x": 5, "y": 0 }
  ],
  "perimeter": 18.0,
  "area": 20.0
}

Las coordenadas deben estar en metros. Intenta crear un perímetro cerrado y coherente.`;

    console.log(`[procesar-dibujo-perimetro] ${points.length} puntos · user ${auth.userId}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let response: Response;
    try {
      response = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          max_completion_tokens: 4000,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: prompt }],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[procesar-dibujo-perimetro] OpenAI error:", response.status, errorText);
      if (response.status === 429) {
        return json({ error: "Límite de peticiones a OpenAI alcanzado, inténtalo de nuevo en unos segundos." });
      }
      throw new Error(`OpenAI ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Extraer JSON de la respuesta (json_object ya lo garantiza casi siempre;
    // se deja el fallback por si acaso, igual que hacía la versión anterior).
    let result;
    try {
      result = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No se pudo extraer JSON válido de la respuesta");
      }
    }

    if (!Array.isArray(result?.walls) || !Array.isArray(result?.corners)) {
      throw new Error("La respuesta de OpenAI no tiene el formato esperado (walls/corners)");
    }

    // Convertir metros de vuelta a píxeles — idéntico a la versión anterior.
    // deno-lint-ignore no-explicit-any
    const wallsInPixels = result.walls.map((wall: any) => ({
      x1: parseFloat(wall.x1) * pixelsPerMeter,
      y1: parseFloat(wall.y1) * pixelsPerMeter,
      x2: parseFloat(wall.x2) * pixelsPerMeter,
      y2: parseFloat(wall.y2) * pixelsPerMeter,
      lengthMeters: parseFloat(wall.length),
    }));

    // deno-lint-ignore no-explicit-any
    const cornersInPixels = result.corners.map((corner: any) => ({
      x: parseFloat(corner.x) * pixelsPerMeter,
      y: parseFloat(corner.y) * pixelsPerMeter,
    }));

    return json({
      walls: wallsInPixels,
      corners: cornersInPixels,
      perimeter: result.perimeter,
      area: result.area,
    });
  } catch (error) {
    console.error("[procesar-dibujo-perimetro] Error:", error);
    return json({
      error: error instanceof Error ? error.message : "Error processing drawing",
    });
  }
});
