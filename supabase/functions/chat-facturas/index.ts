import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { AcumuladorUso, registrarUso } from "../_shared/registrar-uso-ia.ts";
import {
  esErrorCorregible,
  marcarResultado,
  necesitaRespaldoSemantico,
  prepararLlamada,
  recortar,
  systemPrompt,
  TOOLS,
} from "./herramientas.ts";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
const createClient = clienteConAuditoria(createClientBase, "chat-facturas");

// ============================================================================
//  chat-facturas  ·  Asistente de gestion de compras del restaurante
// ----------------------------------------------------------------------------
//  Bucle de function-calling de OpenAI sobre las RPC de Postgres.
//  Mantiene el MISMO contrato que espera useChatFacturas.ts:
//    IN : { mensaje, session_id }
//    OUT: { success, respuesta }
//
//  Historial: se lee de chat_facturas_conversaciones / chat_facturas_mensajes
//  (vistas sobre `conversaciones` / `mensajes_chat`). Hasta el arreglo de
//  `useChatFacturas.guardarMensaje` esas tablas estaban vacias desde marzo de
//  2026, asi que el modelo nunca tuvo memoria real pese a este codigo.
//
//  DEPENDENCIA DE DESPLIEGUE: las herramientas (prompt, TOOLS y su traduccion
//  a RPC) viven en herramientas.ts y llaman a ranking_agente,
//  filtrar_documentos_agente, detalle_documento_agente,
//  buscar_productos_texto_agente y consulta_flexible_agente. Requiere la
//  migracion 20261005100000_chatbot_facturas_ranking_sin_total APLICADA
//  (ademas de 20260919100000 y 20260920000000). Desplegarla antes deja el
//  chat roto.
//
//  Todas las salvaguardas de cifras de este fichero comparten una misma idea:
//  ante la duda, el modelo tiene que recibir un aviso explicito, no un silencio.
//  Un silencio se rellena con una cifra inventada que parece correcta.
//   · Fechas malformadas -> error visible, nunca un periodo distinto (B-9).
//   · Resultados al tope  -> marca de truncado, para que 8 facturas no se
//     presenten como "el total" (A-4).
//   · Cero documentos     -> "no hay datos", nunca "no se gasto nada" (A-5).
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;
const OPENAI = "https://api.openai.com/v1";
const MODELO = "gpt-4.1-mini";
const MAX_HISTORIAL = 10;   // mismo valor que el contextWindowLength de n8n
const MAX_PASOS = 6;
const TIMEOUT_OPENAI_MS = 45_000;

// ── Techo de coste y de tiempo por peticion ──
//  Sin esto, un solo mensaje podia disparar 6 chat completions + una llamada de
//  embeddings por cada busqueda semantica de cada ronda (~21 llamadas de pago),
//  y 6 x 45 s de timeout POR LLAMADA superan el limite de la Edge Function: el
//  navegador se quedaba colgado en `functions.invoke` sin respuesta ni error.
const PRESUPUESTO_MS = 110_000;        // deadline global de la peticion entera
const MAX_TOOL_CALLS_POR_RONDA = 4;    // corta el fan-out que el prompt fomenta
const MAX_TOKENS_RESPUESTA = 800;      // el prompt pide 6 lineas; 800 sobra

/** Estado por peticion: deadline compartido y memo de embeddings. */
interface Ctx {
  deadline: number;
  embeddings: Map<string, string>;
  /**
   * Contabilidad de consumo (migracion 20260928193000). Dos acumuladores
   * porque son DOS modelos con tarifas muy distintas y la pantalla de costes
   * los desglosa por separado: el chat es ~20x mas caro por token que el
   * embedding. Van en el Ctx porque `embedConsulta` se llama desde dentro de
   * `ejecutarTool`, muy lejos del handler, y pasarlos por parametro obligaria
   * a cambiar la firma de media docena de funciones.
   *
   * Que esto no este aqui NO puede romper el chat: ver la cabecera de
   * _shared/registrar-uso-ia.ts.
   */
  usoChat: AcumuladorUso;
  usoEmbed: AcumuladorUso;
}

// ─── Utilidades ──────────────────────────────────────────────────────────────

/** fetch con timeout: evita que una llamada colgada agote el limite de la función. */
async function fetchConTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Milisegundos que quedan de presupuesto, acotados al timeout por llamada.
 * Lanza si ya no queda margen, para cortar antes de que la Edge Function muera
 * sin devolver nada (el `catch` del handler traduce "timeout" a un mensaje util).
 */
function msRestantes(ctx: Ctx): number {
  const queda = ctx.deadline - Date.now();
  if (queda <= 1_000) throw new Error("timeout: presupuesto de tiempo agotado");
  return Math.min(TIMEOUT_OPENAI_MS, queda);
}

// ─── Ejecucion de herramientas ───────────────────────────────────────────────

/**
 * Embedding de la consulta, memoizado por peticion: el prompt fomenta el
 * fan-out (buscar_facturas + buscar_productos a la vez, resumen_periodo dos
 * veces) y era facil acabar pagando dos veces el mismo `embed("tomate")`.
 */
async function embedConsulta(consulta: string, ctx: Ctx): Promise<string> {
  const clave = consulta.toLowerCase().trim();
  const memo = ctx.embeddings.get(clave);
  if (memo) return memo;

  const res = await fetchConTimeout(`${OPENAI}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input: consulta }),
  }, msRestantes(ctx));
  if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}`);
  const json = await res.json();
  // Se contabiliza AQUI y no en el memo: una consulta repetida no vuelve a
  // pagar (sale por el `return memo` de arriba), asi que registrar aqui cuenta
  // exactamente las llamadas facturadas.
  ctx.usoEmbed.sumar(json.usage);
  const vector = "[" + json.data[0].embedding.join(",") + "]";
  ctx.embeddings.set(clave, vector);
  return vector;
}

interface ResultadoTool { contenido: string; fallo: boolean }

/**
 * Ejecuta una herramienta. La traduccion a RPC y la validacion de argumentos
 * estan en herramientas.ts (TS puro, con tests); aqui solo va la red.
 *
 * buscar_productos prueba primero la busqueda EXACTA por palabras
 * (buscar_productos_texto_agente): si encuentra algo, no se paga la llamada
 * de embeddings. La semantica queda como respaldo.
 */
// deno-lint-ignore no-explicit-any
async function ejecutarTool(nombre: string, args: any, supabase: any, ctx: Ctx): Promise<ResultadoTool> {
  try {
    const ll = prepararLlamada(nombre, args);
    let data: unknown;

    if (ll.tipo === "rpc") {
      const r = await supabase.rpc(ll.rpc, ll.params);
      if (r.error) throw r.error;
      data = r.data;
      // compras_producto: si el texto no casa con nada, UNA segunda llamada
      // con el embedding (solo sugerencias). Se paga solo en ese caso.
      if (ll.respaldoSemantico && necesitaRespaldoSemantico(data)) {
        const embedding = await embedConsulta(ll.respaldoSemantico.consulta, ctx);
        const r2 = await supabase.rpc(ll.rpc, { ...ll.params, [ll.respaldoSemantico.param]: embedding });
        if (r2.error) throw r2.error;
        data = r2.data;
      }
    } else {
      if (ll.textoPrimero) {
        const t = await supabase.rpc(ll.textoPrimero.rpc, ll.textoPrimero.params);
        if (t.error) throw t.error;
        if (Array.isArray(t.data) && t.data.length > 0) data = t.data;
      }
      if (data === undefined) {
        const embedding_query = await embedConsulta(ll.consulta, ctx);
        const r = await supabase.rpc(ll.rpc, { embedding_query, ...ll.params });
        if (r.error) throw r.error;
        data = r.data;
      }
    }

    return { fallo: false, contenido: recortar(JSON.stringify(marcarResultado(nombre, data, ll.limite))) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? "error en herramienta";
    console.error(`[chat-facturas] tool ${nombre} fallo:`, msg);

    // Un error de argumentos (fecha mal formateada, rango invertido, falta un
    // parametro) lo puede arreglar el propio modelo reintentando; no es una
    // caida de la base de datos y no debe marcarse como tal.
    const corregible = esErrorCorregible(msg);

    return {
      fallo: !corregible,
      contenido: JSON.stringify({
        error: msg,
        aviso: corregible
          ? "LLAMADA INVALIDA: no se ha consultado nada. Corrige los argumentos y vuelve a llamar " +
            "a la herramienta. NO respondas con cifras de otro periodo ni con el historico completo."
          : "La consulta a la base de datos ha fallado. Dile al usuario que no has podido " +
            "consultar los datos; NO respondas con cifras.",
      }),
    };
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────
serve(conAuditoriaDePeticion("chat-facturas", createClientBase, async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // ── Auth: usuario real CON permiso de la seccion `facturas` ──
  // La anon key es un JWT valido y viaja en el bundle publico del panel, asi
  // que `verify_jwt` no basta. Mismo patron que `procesar-factura`.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (authError || !user) return json({ error: "Unauthorized" }, 401);

  const { data: permitido, error: permError } = await supabase.rpc("has_section_permission", {
    _user_id: user.id,
    _section: "facturas",
    _permission: "view",
  });
  if (permError) {
    console.error("[chat-facturas] Error comprobando permisos:", permError.message);
    return json({ success: false, respuesta: "No se han podido verificar tus permisos.", error: permError.message }, 500);
  }
  if (!permitido) {
    return json({ success: false, respuesta: "No tienes acceso a la seccion de facturas.", error: "forbidden" }, 403);
  }

  // ── Contabilidad de consumo (migracion 20260928193000) ──
  // Se declaran ANTES del try para que el `finally` los vea. Una peticion que
  // acaba en error tambien ha gastado tokens: OpenAI ya los facturo.
  const usoChat = new AcumuladorUso("chat-facturas", MODELO, "chat");
  const usoEmbed = new AcumuladorUso("chat-facturas", "text-embedding-3-small", "embedding");
  const inicioMs = Date.now();

  try {
    const { mensaje, session_id } = await req.json();
    if (!mensaje || !String(mensaje).trim()) {
      return json({ success: false, respuesta: "No he recibido ninguna pregunta." }, 200);
    }
    console.log("[chat-facturas] mensaje:", mensaje, "· session:", session_id);

    // ── Historial de la conversacion ──
    // deno-lint-ignore no-explicit-any
    const messages: any[] = [{ role: "system", content: systemPrompt() }];
    if (session_id) {
      const { data: conv, error: convErr } = await supabase
        .from("chat_facturas_conversaciones")
        .select("id")
        .eq("session_id", session_id)
        .maybeSingle();
      if (convErr) console.error("[chat-facturas] Error leyendo conversacion:", convErr.message);

      if (conv?.id) {
        const { data: previos, error: msgErr } = await supabase
          .from("chat_facturas_mensajes")
          .select("rol, contenido, created_at")
          .eq("conversacion_id", conv.id)
          .order("created_at", { ascending: false })
          .limit(MAX_HISTORIAL);
        if (msgErr) console.error("[chat-facturas] Error leyendo historial:", msgErr.message);

        for (const m of (previos ?? []).reverse()) {
          if (!m.contenido) continue;
          messages.push({ role: m.rol === "user" ? "user" : "assistant", content: m.contenido });
        }
      }
    }
    // Garantizar que el ultimo turno es el mensaje actual del usuario.
    const last = messages[messages.length - 1];
    if (!last || last.role !== "user" || last.content !== mensaje) {
      messages.push({ role: "user", content: mensaje });
    }

    // ── Bucle de function-calling ──
    //  Acotado por tres lados: MAX_PASOS rondas, MAX_TOOL_CALLS_POR_RONDA
    //  herramientas por ronda y un deadline global. Los dos ultimos son nuevos:
    //  el prompt fomenta el fan-out (llamar a dos herramientas a la vez, o a
    //  resumen_periodo dos veces) y nada impedia que un solo mensaje del usuario
    //  encadenase ~6 chat completions mas una decena de embeddings de pago.
    const ctx: Ctx = {
      deadline: Date.now() + PRESUPUESTO_MS,
      embeddings: new Map(),
      usoChat,
      usoEmbed,
    };
    let respuesta = "";
    let huboFalloDeHerramienta = false;

    for (let paso = 0; paso < MAX_PASOS; paso++) {
      // Se retiran las herramientas en el ultimo paso —o si ya no queda tiempo
      // para ejecutar otra ronda— para forzar que el modelo redacte la respuesta
      // con lo que ya tiene en vez de morir sin contestar.
      const sinTiempo = ctx.deadline - Date.now() < TIMEOUT_OPENAI_MS;
      const esUltimo = paso === MAX_PASOS - 1 || sinTiempo;

      const res = await fetchConTimeout(`${OPENAI}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({
          model: MODELO,
          messages,
          temperature: 0.2,
          max_tokens: MAX_TOKENS_RESPUESTA,
          ...(esUltimo ? {} : { tools: TOOLS }),
        }),
      }, msRestantes(ctx));

      if (!res.ok) throw new Error(`OpenAI chat ${res.status}: ${await res.text()}`);
      // Antes esto era `const msg = (await res.json()).choices[0].message;`. Se
      // parte en dos para poder leer `usage`, que en la version de una linea se
      // tiraba con el objeto temporal. El comportamiento es identico.
      const respuestaJson = await res.json();
      ctx.usoChat.sumar(respuestaJson.usage);
      const msg = respuestaJson.choices[0].message;
      messages.push(msg);

      if (!esUltimo && msg.tool_calls?.length > 0) {
        const atendidas = msg.tool_calls.slice(0, MAX_TOOL_CALLS_POR_RONDA);
        for (const tc of atendidas) {
          let args = {};
          try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* el modelo mando JSON invalido */ }
          const r = await ejecutarTool(tc.function.name, args, supabase, ctx);
          if (r.fallo) huboFalloDeHerramienta = true;
          messages.push({ role: "tool", tool_call_id: tc.id, content: r.contenido });
        }
        // La API exige una respuesta por cada tool_call emitida: las que se
        // descartan por el tope tienen que contestarse igualmente.
        for (const tc of msg.tool_calls.slice(MAX_TOOL_CALLS_POR_RONDA)) {
          console.warn(`[chat-facturas] tool_call descartada por tope de ronda: ${tc.function?.name}`);
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify({
              error: `Se ha superado el tope de ${MAX_TOOL_CALLS_POR_RONDA} herramientas por ronda.`,
              aviso: "Esta llamada NO se ha ejecutado. Si necesitas ese dato, pidelo en la " +
                     "siguiente ronda. No inventes su resultado.",
            }),
          });
        }
        continue;
      }

      respuesta = msg.content || "";
      break;
    }

    if (!respuesta.trim()) {
      // El modelo agoto los pasos sin redactar. Mejor decirlo que devolver vacio.
      respuesta = huboFalloDeHerramienta
        ? "No he podido consultar los datos de facturas en este momento. Vuelve a intentarlo en unos segundos."
        : "No he conseguido resolver la consulta. Prueba a preguntarlo de forma mas concreta, por ejemplo indicando un proveedor, un numero de documento o un mes.";
    }

    return json({ success: true, respuesta }, 200);
  } catch (error) {
    console.error("[chat-facturas] Error:", error);
    usoChat.marcarError();
    usoEmbed.marcarError();
    const msg = error instanceof Error ? error.message : "Error desconocido";

    // Mensaje util para el usuario segun el tipo de fallo, en vez de un
    // "hubo un error" generico que no dice si reintentar o avisar a alguien.
    let visible = "Ha habido un problema al procesar tu consulta. Intentalo de nuevo.";
    if (msg.includes("aborted") || msg.toLowerCase().includes("timeout")) {
      visible = "La consulta ha tardado demasiado y se ha cancelado. Prueba con una pregunta mas concreta.";
    } else if (msg.includes("OpenAI chat 429") || msg.includes("OpenAI embeddings 429")) {
      visible = "El servicio de IA esta saturado ahora mismo. Espera unos segundos y vuelve a intentarlo.";
    } else if (msg.includes("OpenAI chat 401") || msg.includes("OpenAI embeddings 401")) {
      visible = "El asistente no esta bien configurado (clave de OpenAI no valida). Avisa al administrador.";
    } else if (msg.startsWith("OpenAI")) {
      visible = "El servicio de IA no ha respondido. Intentalo de nuevo en un momento.";
    }

    return json({ success: false, respuesta: visible, error: msg }, 200);
  } finally {
    // Pasa por aqui TODO: exito, error y las salidas tempranas del try. Nunca
    // lanza (ver _shared/registrar-uso-ia.ts), asi que no puede convertir una
    // respuesta buena en un 500. Se reutiliza el cliente de service role que
    // ya existe en lugar de crear otro.
    await registrarUso([usoChat, usoEmbed], {
      disparador: `usuario:${user.id}`,
      duracionMs: Date.now() - inicioMs,
      cliente: supabase,
    });
  }
}));
