// recortar-fondo-vino
// ---------------------------------------------------------------------------
// Quita el fondo de la foto de una botella con Replicate y devuelve un PNG con
// transparencia. RESPALDO OPCIONAL: el camino principal (gratis) es el script
// local scripts/fotos-vino/ (rembg isnet-general-use). Si no hay token, el
// panel cae al recorte rectangular de siempre (recorteFoto.ts) y avisa.
//
// - Modelo: men1scus/birefnet (BiRefNet, licencia MIT), versión fijada en
//   REPLICATE_VERSION (env REPLICATE_FONDO_VERSION para cambiarla).
//   ~0,0033 $ por foto (A100, ~3 s) según la ficha de Replicate.
// - La llamada usa `Prefer: wait=60` (respuesta síncrona) y, si aún no ha
//   acabado, sondea `urls.get` hasta TIMEOUT_MS en total.
// - Nunca escribe en BD ni en Storage: devuelve el PNG en base64 y el panel
//   compone la foto de carta (composicionVino.ts) y la sube al guardar.
// - Auth: verify_jwt (config.toml) + permiso de ESCRITURA en `gestor_carta`
//   (mismo patrón que extraer-vino-foto).
// - Uso en ia_uso: pseudo-modelo «replicate:men1scus/birefnet», 1.000 tokens
//   ficticios por foto (tarifa en ia_precios, migración 20261026120000).
//
// Body: { imagen: "<base64 JPEG/PNG/WebP, con o sin prefijo data:>" }
// Respuesta: { ok: true, png: "data:image/png;base64,..." } | { ok: false, codigo, error }
//   Todo error lleva `codigo` (el panel lo traduce a un aviso claro) y deja una
//   línea en los registros de la función:
//   503 sin_token (falta el secreto REPLICATE_API_TOKEN), token_invalido,
//   sin_saldo · 413 demasiado_grande · 400 imagen_invalida · 504 timeout ·
//   502 fallo_replicate · 500 error_interno.
// ---------------------------------------------------------------------------
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { comprobarPermisoSeccion, type ClientePermiso } from "../_shared/permiso-marketing.ts";
import { AcumuladorUso, registrarUso } from "../_shared/registrar-uso-ia.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FUNCION = "recortar-fondo-vino";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const REPLICATE_TOKEN = (Deno.env.get("REPLICATE_API_TOKEN") ?? "").trim();
const MODELO = "men1scus/birefnet";
const REPLICATE_VERSION =
  (Deno.env.get("REPLICATE_FONDO_VERSION") ?? "").trim() ||
  "f74986db0355b58403ed20963af156525e2891ea3c2d499bfbfb2a28cd87c5d7";
const MODELO_USO = `replicate:${MODELO}`;
const TOKENS_POR_FOTO = 1000;
const TIMEOUT_MS = 60_000;
const SONDEO_MS = 1_500;
const MAX_BASE64 = 6_000_000;
const MAX_PNG_BYTES = 12_000_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Prediccion = {
  id?: string;
  status?: string;
  output?: unknown;
  error?: unknown;
  urls?: { get?: string };
};

function urlSalida(output: unknown): string | null {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    const u = output.find((x) => typeof x === "string");
    return typeof u === "string" ? u : null;
  }
  return null;
}

async function pedirJson(url: string, init: RequestInit, restanteMs: number): Promise<{ status: number; data: Prediccion | null }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), Math.max(1000, restanteMs));
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    let data: Prediccion | null = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, data };
  } finally {
    clearTimeout(t);
  }
}

serve(conAuditoriaDePeticion(FUNCION, createClientBase, async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
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

  if (!REPLICATE_TOKEN) {
    console.warn(`[${FUNCION}] sin_token: falta el secreto REPLICATE_API_TOKEN en este proyecto`);
    return json(
      { ok: false, codigo: "sin_token", error: "Quitar fondo no está configurado (falta el secreto REPLICATE_API_TOKEN)" },
      503,
    );
  }

  // ---- Body ---------------------------------------------------------------
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, codigo: "imagen_invalida", error: "La petición no trae una imagen válida" }, 400);
  }
  let imagen = typeof payload.imagen === "string" ? payload.imagen.trim() : "";
  if (!imagen) return json({ ok: false, codigo: "imagen_invalida", error: "Falta la imagen" }, 400);
  if (imagen.length > MAX_BASE64) {
    return json({ ok: false, codigo: "demasiado_grande", error: "La imagen es demasiado grande" }, 413);
  }
  if (!imagen.startsWith("data:")) imagen = `data:image/jpeg;base64,${imagen}`;
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(imagen)) {
    return json({ ok: false, codigo: "imagen_invalida", error: "Formato de imagen no soportado (usa JPEG, PNG o WebP)" }, 400);
  }

  const uso = new AcumuladorUso(FUNCION, MODELO_USO, "vision");
  const inicio = Date.now();
  const restante = () => TIMEOUT_MS - (Date.now() - inicio);
  const cabeceras = { Authorization: `Bearer ${REPLICATE_TOKEN}`, "Content-Type": "application/json" };
  try {
    // ---- Crear predicción (espera síncrona hasta 60 s) ---------------------
    const creada = await pedirJson(
      "https://api.replicate.com/v1/predictions",
      {
        method: "POST",
        headers: { ...cabeceras, Prefer: "wait=60" },
        body: JSON.stringify({ version: REPLICATE_VERSION, input: { image: imagen } }),
      },
      restante(),
    );
    if (creada.status === 401 || creada.status === 403) {
      uso.marcarError();
      console.warn(`[${FUNCION}] token_invalido: Replicate respondió ${creada.status}`);
      return json({ ok: false, codigo: "token_invalido", error: "El token de Replicate no es válido" }, 503);
    }
    if (creada.status === 402) {
      uso.marcarError();
      console.warn(`[${FUNCION}] sin_saldo: Replicate respondió 402`);
      return json({ ok: false, codigo: "sin_saldo", error: "La cuenta de Replicate no tiene saldo o método de pago" }, 503);
    }
    let pred = creada.data;
    if (!pred || creada.status >= 400) {
      uso.marcarError();
      console.error(`[${FUNCION}] crear`, creada.status, JSON.stringify(pred)?.slice(0, 500));
      return json({ ok: false, codigo: "fallo_replicate", error: `Replicate respondió ${creada.status}` }, 502);
    }
    // Cada predicción lanzada se paga aunque luego falle.
    uso.sumar({ prompt_tokens: TOKENS_POR_FOTO });

    // ---- Sondeo si aún no ha acabado ---------------------------------------
    while (pred && !["succeeded", "failed", "canceled"].includes(pred.status ?? "")) {
      if (restante() <= SONDEO_MS || !pred.urls?.get) break;
      await new Promise((r) => setTimeout(r, SONDEO_MS));
      const r = await pedirJson(pred.urls.get, { headers: cabeceras }, restante());
      if (r.data) pred = r.data;
    }
    if (pred?.status !== "succeeded") {
      uso.marcarError();
      if (pred?.status && !["failed", "canceled"].includes(pred.status) && pred.id) {
        // Se cancela para no seguir gastando GPU.
        fetch(`https://api.replicate.com/v1/predictions/${pred.id}/cancel`, { method: "POST", headers: cabeceras }).catch(() => {});
        console.warn(`[${FUNCION}] timeout: predicción ${pred.id} en estado ${pred.status}`);
        return json({ ok: false, codigo: "timeout", error: "Quitar el fondo ha tardado demasiado" }, 504);
      }
      console.error(`[${FUNCION}] fallo`, pred?.status, String(pred?.error ?? "").slice(0, 300));
      return json({ ok: false, codigo: "fallo_replicate", error: "Replicate no pudo quitar el fondo de esta foto" }, 502);
    }

    // ---- Descargar el PNG y devolverlo en base64 ---------------------------
    const url = urlSalida(pred.output);
    if (!url) {
      uso.marcarError();
      console.error(`[${FUNCION}] salida sin URL`, JSON.stringify(pred.output)?.slice(0, 300));
      return json({ ok: false, codigo: "fallo_replicate", error: "Replicate no devolvió imagen" }, 502);
    }
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), Math.max(3000, restante()));
    let bytes: Uint8Array;
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`descarga ${res.status}`);
      bytes = new Uint8Array(await res.arrayBuffer());
    } finally {
      clearTimeout(t);
    }
    if (!bytes.length || bytes.length > MAX_PNG_BYTES) {
      uso.marcarError();
      console.error(`[${FUNCION}] PNG no válido: ${bytes.length} bytes`);
      return json({ ok: false, codigo: "fallo_replicate", error: "La imagen sin fondo no es válida" }, 502);
    }
    return json({ ok: true, png: `data:image/png;base64,${base64Encode(bytes)}`, modelo: MODELO });
  } catch (e) {
    uso.marcarError();
    const abortado = e instanceof DOMException && e.name === "AbortError";
    console.error(`[${FUNCION}]`, e);
    return abortado
      ? json({ ok: false, codigo: "timeout", error: "Quitar el fondo ha tardado demasiado" }, 504)
      : json({ ok: false, codigo: "error_interno", error: "Error al quitar el fondo" }, 500);
  } finally {
    await registrarUso([uso], { disparador: `usuario:${permiso.userId}`, duracionMs: Date.now() - inicio });
  }
}));
