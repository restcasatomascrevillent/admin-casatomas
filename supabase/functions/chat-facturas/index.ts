import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { claveOpenAI } from "../_shared/clave-openai.ts";
import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { AcumuladorUso, registrarUso } from "../_shared/registrar-uso-ia.ts";
import { configModeloFuncion } from "../_shared/modelo-funcion.ts";
import { modeloChat, sinDuplicar } from "./herramientas.ts";
import { ejecutarConversacion, MAX_MENSAJES_HISTORIAL, type Traza, type TurnoHistorial } from "./bucle.ts";
import { contextoDeAdjuntos, trazaParaPanel } from "./hilo.ts";
import { clienteConAuditoria, conAuditoriaDePeticion, registrarHerramientaChat } from "../_shared/audit-client.ts";
const createClient = clienteConAuditoria(createClientBase, "chat-facturas");

// ============================================================================
//  chat-facturas  ·  Asistente de gestion de compras del restaurante
// ----------------------------------------------------------------------------
//  Bucle de function-calling de OpenAI sobre las RPC de Postgres.
//  Mantiene el MISMO contrato que espera useChatFacturas.ts:
//    IN : { mensaje, session_id }
//    OUT: { success, respuesta, adjuntos?, modelo, traza }
//  traza (11/11/2026): { herramientas: [{ nombre, argumentos, resultado,
//  error?, resumen? }] }. El panel la guarda con la respuesta (adjunto
//  "contexto", para el hilo) y con el 👍/👎 (tabla chat_feedback).
//  adjuntos (20261008120000, contrato con la UI): [{ tipo: 'serie_precio',
//  datos: <serie_precios_agente> }] cuando el modelo llama a grafico_precio;
//  se omite si no hay. El modelo solo ve el resumen (separarAdjunto).
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

/** La IA de Facturas: «Editar» en Facturas (06/11/2026). Exportado para los tests. */
export const SECCION_IA_FACTURAS = { seccion: "facturas", permiso: "edit" } as const;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const OPENAI_KEY = claveOpenAI("chat");
// Modelo configurable con el secreto CHAT_FACTURAS_MODELO (07/11/2026; por
// defecto gpt-4.1-mini). Los de razonamiento (gpt-5*) llevan otros parametros:
// parametrosModelo en herramientas.ts. Desde el 07/11/2026 manda la tabla
// ia_modelo_funcion (Super Admin › Servicios › Modelos, _shared/modelo-funcion.ts):
// si su fila no tiene modelo, se usa este (secreto o por defecto), como antes.
const MODELO = modeloChat(Deno.env.get("CHAT_FACTURAS_MODELO"));
// Historial: los ultimos MAX_MENSAJES_HISTORIAL mensajes (bucle.ts los recorta
// tambien por tamaño). Antes 10 aqui, mismo valor que el contextWindowLength de n8n.
// Bucle, topes de coste/tiempo y ejecucion de herramientas: bucle.ts
// (compartido con la evaluacion de modelos de ia-modelos-openai, 07/11/2026).

// ─── Handler ─────────────────────────────────────────────────────────────────
serve(conAuditoriaDePeticion("chat-facturas", createClientBase, async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // ── Auth: usuario real CON permiso de EDICION en la seccion `facturas` ──
  // La anon key es un JWT valido y viaja en el bundle publico del panel, asi
  // que `verify_jwt` no basta. Mismo patron que `procesar-factura`.
  // Desde el 06/11/2026 (dueño) la IA de Facturas es solo para quien tiene
  // «Editar»: con solo «Ver» se consulta Analisis y Compras, sin IA.
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
    _section: SECCION_IA_FACTURAS.seccion,
    _permission: SECCION_IA_FACTURAS.permiso,
  });
  if (permError) {
    console.error("[chat-facturas] Error comprobando permisos:", permError.message);
    return json({ success: false, respuesta: "No se han podido verificar tus permisos.", error: permError.message }, 500);
  }
  if (!permitido) {
    return json({ success: false, respuesta: "La IA de Facturas exige el permiso «Editar» en Facturas.", error: "forbidden" }, 403);
  }

  // Dos peticiones identicas pegadas (usuario+sesion+mensaje) comparten UNA
  // ejecucion y UN registro en ia_uso (ver sinDuplicar en herramientas.ts).
  const ejecutar = async (): Promise<Response> => {
    // ── Contabilidad de consumo (migracion 20260928193000) ──
    // Se declaran ANTES del try para que el `finally` los vea. Una peticion que
    // acaba en error tambien ha gastado tokens: OpenAI ya los facturo.
    const elegido = await configModeloFuncion("chat-facturas", MODELO, { cliente: supabase });
    const modelo = elegido.modelo;
    const usoChat = new AcumuladorUso("chat-facturas", modelo, "chat");
    // Si el modelo elegido falla por ser el modelo (retirado, sin acceso), se
    // reintenta UNA vez con el de respaldo; su gasto va en otro acumulador.
    const usosChat: AcumuladorUso[] = [usoChat];
    const usoEmbed = new AcumuladorUso("chat-facturas", "text-embedding-3-small", "embedding");
    const inicioMs = Date.now();

    try {
      const { mensaje, session_id } = await req.json();
      if (!mensaje || !String(mensaje).trim()) {
        return json({ success: false, respuesta: "No he recibido ninguna pregunta." }, 200);
      }
      if (typeof mensaje !== "string" || mensaje.length > 16000) return json({ success: false, respuesta: "La pregunta debe tener como máximo 16000 caracteres." }, 400);
      // El contenido de la consulta queda en auditoría, no en logs técnicos.

      // ── Historial de la conversacion ──
      // Las respuestas traen en `adjuntos` el contexto de herramientas que
      // guardo el panel (tipo "contexto": nombre, argumentos y proveedores/
      // productos del resultado): bucle.ts lo reconstruye como tool_calls para
      // que un seguimiento («Y de vaca») sepa de que proveedor se hablaba.
      const historial: TurnoHistorial[] = [];
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
            .select("rol, contenido, adjuntos, created_at")
            .eq("conversacion_id", conv.id)
            .order("created_at", { ascending: false })
            .limit(MAX_MENSAJES_HISTORIAL + 1); // +1: la pregunta actual ya esta guardada
          if (msgErr) console.error("[chat-facturas] Error leyendo historial:", msgErr.message);

          for (const m of (previos ?? []).reverse()) {
            if (!m.contenido) continue;
            const herramientas = m.rol === "user" ? [] : contextoDeAdjuntos(m.adjuntos);
            historial.push({
              role: m.rol === "user" ? "user" : "assistant",
              content: m.contenido,
              ...(herramientas.length > 0 ? { herramientas } : {}),
            });
          }
        }
      }

      // Pista de la pregunta + bucle de function-calling (bucle.ts).
      // Traza de las herramientas: vuelve al panel para guardarla con la
      // respuesta (hilo) y con el 👍/👎 (chat_feedback).
      const traza: Traza = { llamadas: [], herramientas: [] };
      const { respuesta, adjuntos, modelo: modeloUsado } = await ejecutarConversacion({
        supabase,
        claveOpenAI: OPENAI_KEY,
        mensaje,
        historial,
        modelo,
        respaldo: elegido.respaldo,
        uso: {
          usosChat,
          usoEmbed,
          nuevoAcumuladorChat: (m) => new AcumuladorUso("chat-facturas", m, "chat"),
        },
        alEjecutarHerramienta: registrarHerramientaChat,
        traza,
        // Una clave por conversacion: sus rondas y preguntas comparten prefijo.
        claveCache: typeof session_id === "string" && session_id ? `chat-facturas:${session_id}`.slice(0, 64) : undefined,
      });

      return json({
        success: true,
        respuesta,
        ...(adjuntos.length > 0 ? { adjuntos } : {}),
        modelo: modeloUsado,
        traza: trazaParaPanel(traza),
      }, 200);
    } catch (error) {
      console.error("[chat-facturas] Error:", error);
      usosChat[usosChat.length - 1].marcarError();
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
      await registrarUso([...usosChat, usoEmbed], {
        disparador: `usuario:${user.id}`,
        duracionMs: Date.now() - inicioMs,
        cliente: supabase,
      });
    }
  };

  const peticion = await req.clone().json().catch(() => null);
  const texto = String(peticion?.mensaje ?? "").trim();
  if (!texto) return await ejecutar();
  const guardada = await sinDuplicar(`${user.id}|${peticion?.session_id ?? ""}|${peticion?.tipo_interaccion ?? "consulta"}|${texto}`, async () => {
    const r = await ejecutar();
    return { status: r.status, cuerpo: await r.text() };
  });
  return new Response(guardada.cuerpo, {
    status: guardada.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}));

