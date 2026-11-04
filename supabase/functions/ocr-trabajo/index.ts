import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { claveOpenAI } from "../_shared/clave-openai.ts";
import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { jsonResponse, verificarSecreto } from "../procesar-factura/auth.ts";
import { configModelo } from "../procesar-factura/modelo.ts";
import { crearClienteOpenAI } from "../procesar-factura/openai.ts";
import { cargarIndicaciones, conIndicaciones } from "../procesar-factura/indicaciones.ts";
import { crearRegistroUso } from "../procesar-factura/registroUso.ts";
import { procesarConsolidacion, procesarPagina } from "../procesar-factura/trabajos.ts";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
const createClient = clienteConAuditoria(createClientBase, "ocr-trabajo");

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
//
//  Trabajos de UNA pieza (05-oct-2026: documentos de una página leídos en
//  segundo plano): la pieza se lee con el código y el modelo (OCR_MODELO) del
//  camino síncrono y la «consolidación» solo guarda (procesar-factura/unico.ts
//  y trabajos.ts). Lectura ≤ 4 llamadas a OpenAI en serie (extracción,
//  relectura por cuadre, pie, contador): cabe de sobra en los 150 s; guardar
//  va en otra invocación (consolidar).
// ============================================================================

const SECRETO = Deno.env.get("OCR_TRABAJOS_SECRET");
const URL_SB = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const envModelo = {
  OCR_MODELO: Deno.env.get("OCR_MODELO"),
  OCR_MODELO_PIEZAS: Deno.env.get("OCR_MODELO_PIEZAS"),
  OCR_DETALLE: Deno.env.get("OCR_DETALLE"),
};
const cfgModelo = configModelo(envModelo, "piezas");
// Trabajos de UNA pieza (documento de una página): el modelo y la
// configuración del camino síncrono (OCR_MODELO), no los de las piezas.
const cfgModeloUnico = configModelo(envModelo, "unico");
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

serve(conAuditoriaDePeticion("ocr-trabajo", createClientBase, async (req) => {
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
  // Cada llamada a OpenAI deja su fila en ia_uso (funcion 'ocr-trabajo',
  // disparador `trabajo:<uuid>#<etapa>`). El INSERT no bloquea la lectura; se
  // espera al final de la tarea en segundo plano.
  const clientes = (trabajoId: string) => {
    const registro = crearRegistroUso({ funcion: "ocr-trabajo", disparador: `trabajo:${trabajoId}`, cliente: supabase });
    // Indicaciones por proveedor (proveedores.notas_ia) en el prompt de extracción,
    // igual que en procesar-factura. Se leen una vez por trabajo y solo si se usan.
    let notas: ReturnType<typeof cargarIndicaciones> | null = null;
    const obtenerNotas = () => (notas ??= cargarIndicaciones(supabase));
    const crear = (config: typeof cfgModelo) =>
      conIndicaciones(crearClienteOpenAI({ apiKey: claveOpenAI("ocr"), config, alUsar: registro.alUsar }), obtenerNotas);
    return { registro, openai: crear(cfgModelo), openaiUnico: crear(cfgModeloUnico) };
  };

  if (body.modo === "pagina") {
    const id = Number(body.pagina_id);
    if (!Number.isInteger(id) || id <= 0) return jsonResponse({ ok: false, error: "pagina_id" }, 400);
    const { data, error } = await supabase.rpc("ocr_reclamar_pagina", { p_pagina_id: id, p_lease_seg: 180 });
    if (error) return jsonResponse({ ok: false, error: error.message }, 500);
    const pagina = Array.isArray(data) ? data[0] : data;
    if (!pagina?.id) return jsonResponse({ aceptada: false, motivo: "ya_reclamada_o_no_toca" });
    const { registro, openai, openaiUnico } = clientes(String(pagina.trabajo_id ?? ""));
    await enSegundoPlano(
      procesarPagina(supabase, openai, pagina, openaiUnico).finally(registro.esperar),
      `pieza ${id}`,
    );
    return jsonResponse({ aceptada: true }, 202);
  }

  if (body.modo === "consolidar") {
    const id = String(body.trabajo_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonResponse({ ok: false, error: "trabajo_id" }, 400);
    const { data, error } = await supabase.rpc("ocr_reclamar_consolidacion", { p_trabajo_id: id, p_lease_seg: 180 });
    if (error) return jsonResponse({ ok: false, error: error.message }, 500);
    const trabajo = Array.isArray(data) ? data[0] : data;
    if (!trabajo?.id) return jsonResponse({ aceptada: false, motivo: "no_lista_o_ya_reclamada" });
    const { registro, openai } = clientes(String(trabajo.id));
    await enSegundoPlano(
      procesarConsolidacion({ supabase, openai, drive }, trabajo).finally(registro.esperar),
      `consolidar ${id}`,
    );
    return jsonResponse({ aceptada: true }, 202);
  }

  return jsonResponse({ ok: false, error: "modo_desconocido" }, 400);
}));
