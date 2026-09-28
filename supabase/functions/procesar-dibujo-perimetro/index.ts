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
// La aritmética (perímetro y área) la hacemos nosotros, no el modelo: ver la
// justificación medida en geometria.ts.
import {
  areaPoligono,
  longitudSegmento,
  perimetroDeParedes,
  redondear,
} from "./geometria.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

// gpt-5.4-mini. Sustituye a gpt-5-mini, que dejaba esta función al borde del
// fallo (y, con dibujos algo más complejos que los medidos, en fallo seguro).
//
// El problema con gpt-5-mini era el RAZONAMIENTO INTERNO: gasta tokens de
// razonamiento del mismo presupuesto que `max_completion_tokens`, y en los
// croquis reales del restaurante consumía 2.752–3.072 de los 4.000 que había
// configurados ANTES de escribir un solo carácter de JSON. Cuando el
// presupuesto se agota, la API devuelve `finish_reason: "length"` con
// `content` VACÍO, el parseo de abajo falla y el usuario recibe
// "No se pudo extraer JSON válido" tras haber pagado la llamada entera.
// Reproducido de forma determinista bajando el tope (ver el error explícito
// de truncamiento más abajo, añadido justo para que esto no vuelva a
// diagnosticarse a ciegas).
//
// gpt-5.4-mini emite CERO tokens de razonamiento, así que el tope vuelve a
// ser lo que debe ser — un límite, no una reserva que el modelo se come — y
// además:
//   - Es ~10× más rápido: 2,1–3,4 s frente a 28–29 s de gpt-5-mini en el
//     croquis del comedor. Eso importa mucho aquí, porque el `AbortController`
//     de más abajo corta a los 30 s: gpt-5-mini estaba a uno o dos segundos de
//     que el timeout lo matase en cada llamada.
//   - Sale más barato que el modelo anterior.
//   - Acepta `temperature` (los modelos *luna* la rechazan con HTTP 400; si
//     algún día se cambia a uno de ellos hay que quitar ese campo del cuerpo).
//   - Recupera la geometría exacta: en el croquis del comedor devolvió las 8
//     paredes y las 8 esquinas clavadas al metro, y en la terraza las 4.
//
// Sigue soportando `response_format: json_object`, que es lo que de verdad
// hace falta: la versión Lovable/Gemini original extraía el JSON con un regex
// sobre texto libre, frágil por diseño. Se conserva el regex como red de
// seguridad.
//
// ⚠️ La familia a la que pertenecía gpt-5-mini se apaga el 11 de diciembre de
// 2026, así que este cambio era obligado igualmente.
const MODEL = "gpt-5.4-mini";

// El tope es un MÁXIMO, no una reserva: subirlo no encarece nada (se paga por
// tokens realmente emitidos) y es la causa raíz del fallo que arregla este
// cambio. 16.000 deja margen de sobra incluso si un futuro modelo vuelve a
// razonar. Las respuestas reales ocupan 288–560 tokens.
const MAX_COMPLETION_TOKENS = 16000;

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
          max_completion_tokens: MAX_COMPLETION_TOKENS,
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
    const choice = data.choices?.[0];
    const content = choice?.message?.content || "";

    // Truncamiento: la causa exacta del fallo que arregla este cambio. Si el
    // modelo se queda sin presupuesto, la API responde 200 con
    // `finish_reason: "length"` y `content` vacío. Antes eso caía en el
    // genérico "No se pudo extraer JSON válido", que no decía nada y obligaba
    // a diagnosticar a ciegas una llamada ya pagada. Ahora se nombra.
    if (choice?.finish_reason === "length") {
      const razonamiento = data.usage?.completion_tokens_details?.reasoning_tokens;
      console.error(
        `[procesar-dibujo-perimetro] Respuesta truncada: se agotaron los ${MAX_COMPLETION_TOKENS} tokens` +
          (razonamiento ? ` (${razonamiento} en razonamiento interno)` : ""),
      );
      return json({
        error:
          "El modelo agotó el presupuesto de tokens antes de responder. Prueba con un dibujo más sencillo o avisa al administrador.",
      });
    }

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

    // Paredes en metros, tal y como las devuelve el modelo. `lengthMeters` se
    // RECALCULA a partir de los propios extremos del segmento en lugar de
    // confiar en el campo `length`: es la misma cuenta, pero hecha por
    // nosotros, y así no puede quedar descuadrado respecto a las coordenadas.
    // deno-lint-ignore no-explicit-any
    const wallsInMeters = result.walls.map((wall: any) => {
      const x1 = parseFloat(wall.x1);
      const y1 = parseFloat(wall.y1);
      const x2 = parseFloat(wall.x2);
      const y2 = parseFloat(wall.y2);
      return { x1, y1, x2, y2, lengthMeters: longitudSegmento(x1, y1, x2, y2) };
    });

    // deno-lint-ignore no-explicit-any
    const cornersInMeters = result.corners.map((corner: any) => ({
      x: parseFloat(corner.x),
      y: parseFloat(corner.y),
    }));

    // Perímetro y área los calculamos nosotros (ver geometria.ts y su test:
    // el modelo clava la forma pero falla el área de una planta no convexa).
    // Si por lo que sea no se pueden calcular, se cae a lo que dijo el modelo
    // para no romper el contrato de salida.
    const perimetroCalculado = perimetroDeParedes(wallsInMeters);
    const areaCalculada = areaPoligono(cornersInMeters);

    // Convertir metros de vuelta a píxeles — idéntico a la versión anterior.
    const wallsInPixels = wallsInMeters.map(
      (wall: { x1: number; y1: number; x2: number; y2: number; lengthMeters: number }) => ({
        x1: wall.x1 * pixelsPerMeter,
        y1: wall.y1 * pixelsPerMeter,
        x2: wall.x2 * pixelsPerMeter,
        y2: wall.y2 * pixelsPerMeter,
        lengthMeters: redondear(wall.lengthMeters),
      }),
    );

    const cornersInPixels = cornersInMeters.map(
      (corner: { x: number; y: number }) => ({
        x: corner.x * pixelsPerMeter,
        y: corner.y * pixelsPerMeter,
      }),
    );

    return json({
      walls: wallsInPixels,
      corners: cornersInPixels,
      perimeter: perimetroCalculado !== null
        ? redondear(perimetroCalculado)
        : result.perimeter,
      area: areaCalculada !== null ? redondear(areaCalculada) : result.area,
    });
  } catch (error) {
    console.error("[procesar-dibujo-perimetro] Error:", error);
    return json({
      error: error instanceof Error ? error.message : "Error processing drawing",
    });
  }
});
