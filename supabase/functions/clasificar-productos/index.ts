import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { autenticar, corsHeaders, jsonResponse, verificarSecreto } from "../procesar-factura/auth.ts";
import { AcumuladorUso, registrarUso } from "../_shared/registrar-uso-ia.ts";
import { clasificarPendientes, FUNCION, MODELO_POR_DEFECTO } from "./clasificacion.ts";

// ============================================================================
//  clasificar-productos · catálogo y categoría de las líneas nuevas
// ----------------------------------------------------------------------------
//  Las líneas cuyo texto ya está en productos_alias se asignan solas en la
//  base de datos (trigger). Esta función se encarga del resto: una llamada
//  barata al modelo por tanda (ver clasificacion.ts).
//
//  Quién la llama (verify_jwt = false en config.toml, autenticación propia):
//    · El cron «clasificar-productos» (pg_net, cada 5 min y solo si hay líneas
//      recientes sin producto): cabecera x-ocr-secret == OCR_TRABAJOS_SECRET
//      (el MISMO secreto que ocr-trabajo; en Vault, «ocr_trabajos_secret»).
//      Tiempo constante y FALLA CERRADO.
//    · El botón «Clasificar con IA» de Facturas › Productos: JWT de un usuario
//      con permiso de EDICIÓN en facturas.
//  No acepta datos del cuerpo: todo lo lee de la base de datos.
//
//  Secretos: OPENAI_API_KEY, OCR_TRABAJOS_SECRET (ya existen) y, opcional,
//  CLASIFICAR_PRODUCTOS_MODELO (por defecto gpt-5.6-luna).
//  Respuesta: { ok, pendientes, textos, propuestas, aplicado:{productos_creados, alias_creados, lineas_asignadas} }
// ============================================================================

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const pedido = (Deno.env.get("CLASIFICAR_PRODUCTOS_MODELO") ?? "").trim();
const MODELO = /^[a-z0-9][a-z0-9.\-]{2,60}$/i.test(pedido) ? pedido : MODELO_POR_DEFECTO;

const cfgAuth = {
  supabaseUrl: URL_SB,
  anonKey: Deno.env.get("SUPABASE_ANON_KEY")!,
  serviceKey: SERVICE,
  crearCliente: createClient,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);

  let disparador: string;
  if (req.headers.has("x-ocr-secret")) {
    const denegado = verificarSecreto(req, Deno.env.get("OCR_TRABAJOS_SECRET"));
    if (denegado) return denegado;
    disparador = "cron";
  } else {
    const a = await autenticar(req, cfgAuth, "edit");
    if (!a.ok) return a.response;
    disparador = `usuario:${a.userId}`;
  }

  const supabase = createClient(URL_SB, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
  const uso = new AcumuladorUso(FUNCION, MODELO, "chat");
  const t0 = Date.now();
  try {
    const r = await clasificarPendientes({
      supabase,
      llamarModelo: async (mensajes, esquema) => {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
          body: JSON.stringify({
            model: MODELO,
            max_completion_tokens: 16000,
            response_format: { type: "json_schema", json_schema: esquema },
            messages: mensajes,
          }),
        });
        const json = await res.json().catch(() => null);
        uso.sumar(json?.usage);
        if (!res.ok) throw new Error(`OpenAI ${res.status}: ${JSON.stringify(json)?.slice(0, 300)}`);
        const choice = json?.choices?.[0];
        if (choice?.message?.refusal) throw new Error(`El modelo rechazó clasificar: ${choice.message.refusal}`);
        if (choice?.finish_reason === "length") throw new Error("La respuesta del modelo se cortó por el límite de tokens");
        return JSON.parse(choice?.message?.content ?? "null");
      },
    });
    console.log(`[${FUNCION}] ${disparador} · ${JSON.stringify(r)}`);
    return jsonResponse({ ok: true, ...r });
  } catch (e) {
    uso.marcarError();
    console.error(`[${FUNCION}] ${disparador} · error:`, (e as Error)?.message ?? e);
    return jsonResponse({ ok: false, error: (e as Error)?.message ?? String(e) }, 500);
  } finally {
    await registrarUso(uso, { disparador, duracionMs: Date.now() - t0, cliente: supabase });
  }
});
