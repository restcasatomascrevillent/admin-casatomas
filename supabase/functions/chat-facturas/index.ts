import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================================
//  chat-facturas  ·  Chatbot contable SIN n8n
// ----------------------------------------------------------------------------
//  Reemplaza el antiguo proxy al webhook de n8n. Implementa el "AI Agent" con
//  un loop de function-calling de OpenAI sobre 3 RPCs que YA existen en Postgres.
//  Mantiene el MISMO contrato que esperaba useChatFacturas.ts:
//    IN : { mensaje, session_id }
//    OUT: { success, respuesta }
//  El historial se carga desde chat_facturas_conversaciones/mensajes (la propia
//  UI ya persiste los mensajes), dando contexto conversacional al modelo.
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;
const OPENAI = "https://api.openai.com/v1";
const MAX_HISTORIAL = 10;

// System prompt — COPIADO VERBATIM del workflow n8n "ChatBot Facturas".
const SYSTEM_PROMPT = `Eres un asistente contable experto en analizar facturas y albaranes de un negocio español.

Tienes acceso a tres herramientas:
- buscar_facturas: busca facturas y albaranes por similitud semántica
- buscar_productos: busca productos individuales de facturas
- estadisticas_globales: devuelve totales y resúmenes globales del negocio

CUÁNDO USAR CADA HERRAMIENTA:
- Preguntas sobre documentos completos, proveedores, fechas, totales de factura → buscar_facturas
- Preguntas sobre artículos, productos, qué se compró → buscar_productos
- Preguntas generales como cuánto he gastado en total, cuántas facturas tengo, top proveedores → estadisticas_globales
- Si no estás seguro usa buscar_facturas y buscar_productos a la vez

REGLAS:
1. Usa el campo "resumen" de cada factura para entender su contenido
2. NUNCA inventes datos que no estén en los resultados de las herramientas
3. NUNCA pidas más información al usuario
4. Importes en formato español: 1.234,56€
5. Fechas en español: 15 de enero de 2025
6. Respuestas concisas, máximo 6 líneas salvo que pidan un listado
7. Si hay facturas y albaranes mezclados, distínguelos claramente
8. Recuerda el contexto de mensajes anteriores de la conversación`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "buscar_facturas",
      description:
        "Busca facturas y albaranes por similitud semántica. Úsala para preguntas sobre proveedores, fechas, importes y documentos completos.",
      parameters: {
        type: "object",
        properties: { consulta: { type: "string", description: "Consulta en lenguaje natural" } },
        required: ["consulta"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "buscar_productos",
      description:
        "Busca productos individuales de facturas por similitud semántica. Úsala para artículos específicos, qué se compró, precios de productos.",
      parameters: {
        type: "object",
        properties: { consulta: { type: "string", description: "Consulta en lenguaje natural" } },
        required: ["consulta"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "estadisticas_globales",
      description:
        "Devuelve estadísticas globales: total facturas, total albaranes, gasto total, top proveedores, productos más comprados y gastos mensuales. Úsala para preguntas generales de resumen.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

async function embedConsulta(consulta: string): Promise<string> {
  const res = await fetch(`${OPENAI}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input: consulta }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}`);
  const json = await res.json();
  return "[" + json.data[0].embedding.join(",") + "]";
}

// deno-lint-ignore no-explicit-any
async function ejecutarTool(nombre: string, args: any, supabase: any): Promise<string> {
  try {
    if (nombre === "estadisticas_globales") {
      const { data, error } = await supabase.rpc("estadisticas_globales_agente");
      if (error) throw error;
      return JSON.stringify(data);
    }
    const embedding_query = await embedConsulta(args?.consulta ?? "");
    const rpc = nombre === "buscar_facturas" ? "buscar_facturas_agente" : "buscar_productos_agente";
    const { data, error } = await supabase.rpc(rpc, { embedding_query });
    if (error) throw error;
    return JSON.stringify(data);
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : "error en herramienta" });
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // ── Auth: validar JWT del usuario (mismo patrón que la versión anterior) ──
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { mensaje, session_id } = await req.json();
    console.log("[chat-facturas] mensaje:", mensaje, "· session:", session_id);

    // ── Cargar historial de la conversación para dar contexto ──
    // deno-lint-ignore no-explicit-any
    const messages: any[] = [{ role: "system", content: SYSTEM_PROMPT }];
    if (session_id) {
      const { data: conv } = await supabase
        .from("chat_facturas_conversaciones")
        .select("id")
        .eq("session_id", session_id)
        .maybeSingle();
      if (conv?.id) {
        const { data: previos } = await supabase
          .from("chat_facturas_mensajes")
          .select("rol, contenido, created_at")
          .eq("conversacion_id", conv.id)
          .order("created_at", { ascending: false })
          .limit(MAX_HISTORIAL);
        const historial = (previos ?? []).reverse();
        for (const m of historial) {
          if (!m.contenido) continue;
          messages.push({ role: m.rol === "user" ? "user" : "assistant", content: m.contenido });
        }
      }
    }
    // Garantizar que el último turno es el mensaje actual del usuario
    const last = messages[messages.length - 1];
    if (!last || last.role !== "user" || last.content !== mensaje) {
      messages.push({ role: "user", content: mensaje });
    }

    // ── Loop de function-calling ──
    let respuesta = "No pude obtener una respuesta. Por favor, intenta de nuevo.";
    for (let paso = 0; paso < 5; paso++) {
      const res = await fetch(`${OPENAI}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({ model: "gpt-4.1-mini", messages, tools: TOOLS, temperature: 0.2 }),
      });
      if (!res.ok) throw new Error(`OpenAI chat ${res.status}: ${await res.text()}`);
      const choice = (await res.json()).choices[0];
      const msg = choice.message;
      messages.push(msg);

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          let args = {};
          try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* noop */ }
          const resultado = await ejecutarTool(tc.function.name, args, supabase);
          messages.push({ role: "tool", tool_call_id: tc.id, content: resultado });
        }
        continue; // volver a llamar al modelo con los resultados
      }

      respuesta = msg.content || respuesta;
      break;
    }

    return new Response(JSON.stringify({ success: true, respuesta }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
    });
  } catch (error) {
    console.error("[chat-facturas] Error:", error);
    const msg = error instanceof Error ? error.message : "Error desconocido";
    return new Response(
      JSON.stringify({ success: false, respuesta: "Lo siento, hubo un error al procesar tu consulta.", error: msg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  }
});
