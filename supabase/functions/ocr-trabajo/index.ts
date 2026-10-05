import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsonResponse, verificarSecreto } from "../procesar-factura/auth.ts";
import { configModelo } from "../procesar-factura/modelo.ts";
import { crearClienteOpenAI } from "../procesar-factura/openai.ts";
import { procesarConsolidacion, procesarPagina } from "../procesar-factura/trabajos.ts";

// ============================================================================
//  ocr-trabajo  ·  OCR en segundo plano de documentos largos (04b)
// ----------------------------------------------------------------------------
//  La llama SOLO Postgres (pg_net, desde ocr_despachar / el cron
//  reanudar-trabajos-ocr), nunca el panel. verify_jwt = false (pg_net no tiene
//  JWT) y autenticación propia: cabecera x-ocr-secret == OCR_TRABAJOS_SECRET,
//  comparación en tiempo constante, FALLA CERRADO (sin secreto → 500).
//  El mismo valor vive en Vault como «ocr_trabajos_secret».
//
//  No acepta rutas ni datos del cuerpo: solo un id, y todo lo demás lo lee de
//  la base de datos. Conocer el secreto solo permite reprocesar piezas que ya
//  existen.
//
//   POST { modo: "pagina", pagina_id }       → 202 {aceptada:true} | 200 {aceptada:false, motivo}
//   POST { modo: "consolidar", trabajo_id }  → 202 {aceptada:true} | 200 {aceptada:false, motivo}
//
//  Responde en cuanto reclama (lease de 180 s) y sigue en segundo plano con
//  EdgeRuntime.waitUntil (mismo patrón que reservas-web: si no existe, espera).
// ============================================================================

const SECRETO = Deno.env.get("OCR_TRABAJOS_SECRET");
const URL_SB = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cfgModelo = configModelo(
  { OCR_MODELO: Deno.env.get("OCR_MODELO"), OCR_MODELO_PIEZAS: Deno.env.get("OCR_MODELO_PIEZAS"), OCR_DETALLE: Deno.env.get("OCR_DETALLE") },
  "piezas",
);
const drive = {
  clientId: Deno.env.get("GOOGLE_CLIENT_ID") ?? "",
  clientSecret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "",
  refreshToken: Deno.env.get("GOOGLE_REFRESH_TOKEN") ?? "",
  parentFolder: Deno.env.get("GOOGLE_DRIVE_PARENT_FOLDER_ID") ?? "",
};

declare const EdgeRuntime: { waitUntil?: (p: Promise<unknown>) => void } | undefined;

async function enSegundoPlano(tarea: Promise<unknown>, etiqueta: string): Promise<void> {
  const protegida = tarea.catch((err) => {
    console.error(`[SEGUNDO_PLANO] ${etiqueta}:`, (err as Error)?.message || err);
  });
  const runtime = typeof EdgeRuntime !== "undefined" ? EdgeRuntime : undefined;
  if (runtime && typeof runtime.waitUntil === "function") {
    runtime.waitUntil(protegida);
    return;
  }
  await protegida;
}

serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  const denegado = verificarSecreto(req, SECRETO);
  if (denegado) return denegado;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "json_invalido" }, 400);
  }
  const supabase = createClient(URL_SB, SERVICE);
  const openai = crearClienteOpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY")!, config: cfgModelo });

  if (body.modo === "pagina") {
    const id = Number(body.pagina_id);
    if (!Number.isInteger(id) || id <= 0) return jsonResponse({ ok: false, error: "pagina_id" }, 400);
    const { data, error } = await supabase.rpc("ocr_reclamar_pagina", { p_pagina_id: id, p_lease_seg: 180 });
    if (error) return jsonResponse({ ok: false, error: error.message }, 500);
    const pagina = Array.isArray(data) ? data[0] : data;
    if (!pagina?.id) return jsonResponse({ aceptada: false, motivo: "ya_reclamada_o_no_toca" });
    await enSegundoPlano(procesarPagina(supabase, openai, pagina), `pieza ${id}`);
    return jsonResponse({ aceptada: true }, 202);
  }

  if (body.modo === "consolidar") {
    const id = String(body.trabajo_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonResponse({ ok: false, error: "trabajo_id" }, 400);
    const { data, error } = await supabase.rpc("ocr_reclamar_consolidacion", { p_trabajo_id: id, p_lease_seg: 180 });
    if (error) return jsonResponse({ ok: false, error: error.message }, 500);
    const trabajo = Array.isArray(data) ? data[0] : data;
    if (!trabajo?.id) return jsonResponse({ aceptada: false, motivo: "no_lista_o_ya_reclamada" });
    await enSegundoPlano(procesarConsolidacion({ supabase, openai, drive }, trabajo), `consolidar ${id}`);
    return jsonResponse({ aceptada: true }, 202);
  }

  return jsonResponse({ ok: false, error: "modo_desconocido" }, 400);
});
