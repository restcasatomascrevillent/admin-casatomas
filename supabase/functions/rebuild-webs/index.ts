// rebuild-webs
// ---------------------------------------------------------------------------
// casa-tomas-story y touza-restaurant-website prerenderizan la carta (Platos,
// Vinos, Bebidas, Cocteles) en tiempo de build: un cambio de precio en el
// panel no se ve en la web hasta el siguiente deploy. Esta función dispara un
// Vercel Deploy Hook por cada guardado relevante de la carta — con antirrebote
// para no agotar los minutos de build de Vercel cuando se edita en ráfaga.
//
// Los hooks de Vercel viven SOLO en secrets de la función
// (VERCEL_DEPLOY_HOOK_CASA_TOMAS, VERCEL_DEPLOY_HOOK_TOUZA) — si esa URL
// llegara al cliente, cualquiera podría lanzar builds contra la cuenta de
// Vercel del dueño. Los crea y los guarda el dueño (Vercel → Settings → Git →
// Deploy Hooks); esta función solo lee sus nombres de entorno.
//
// Auth: mismo patrón que procesar-factura/index.ts — JWT del llamante para
// resolver quién es, service role para comprobar has_section_permission.
// Se exige la sección 'gestor_carta' (la misma que ya protege
// historial_ajustes_precios en 20260918120000_rls_por_permisos_de_seccion.sql).
//
// Antirrebote: ver supabase/migrations/20260919120000_rebuild_webs_state.sql
// (tabla web_rebuild_state, NO aplicada) para el diseño completo y su porqué.
// Resumen: flanco de subida + cooldown de COOLDOWN_MINUTES, con autolimpieza
// de sitios que quedaron "pendientes" aprovechando cualquier llamada
// posterior — sin pg_cron ni piezas de infraestructura adicionales.
// ---------------------------------------------------------------------------
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const COOLDOWN_MINUTES = 10;

type Sitio = "casa-tomas-story" | "touza";

// Verificado por grep de `.from(` en touza-restaurant-website/src y
// casa-tomas-story/src (no supuesto): touza lee Platos+Vinos+Bebidas+Cocteles;
// casa-tomas-story lee Platos+Vinos+Bebidas+menus_diarios+tapas, pero NO
// Cocteles. De ahí el reparto — coctel solo toca touza, menu/tapas solo
// casa-tomas-story, el resto toca a las dos.
const SITIOS_POR_ORIGEN: Record<string, Sitio[]> = {
  plato: ["casa-tomas-story", "touza"],
  bebida: ["casa-tomas-story", "touza"],
  vino: ["casa-tomas-story", "touza"],
  coctel: ["touza"],
  menu: ["casa-tomas-story"],
  tapas: ["casa-tomas-story"],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function deployHookFor(sitio: Sitio): string | undefined {
  if (sitio === "casa-tomas-story") return Deno.env.get("VERCEL_DEPLOY_HOOK_CASA_TOMAS");
  if (sitio === "touza") return Deno.env.get("VERCEL_DEPLOY_HOOK_TOUZA");
  return undefined;
}

async function autenticar(req: Request): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return { ok: false, response: json({ error: "No autorizado" }, 401) };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
  if (userError || !user) {
    return { ok: false, response: json({ error: "Usuario no autenticado" }, 401) };
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: permitido, error: permError } = await supabaseAdmin.rpc("has_section_permission", {
    _user_id: user.id,
    _section: "gestor_carta",
    _permission: "view",
  });

  if (permError) {
    console.error("[rebuild-webs] Error comprobando permisos:", permError.message);
    return { ok: false, response: json({ error: "Error verificando permisos" }, 500) };
  }
  if (!permitido) {
    return { ok: false, response: json({ error: "Sin permisos sobre la sección de carta" }, 403) };
  }

  return { ok: true, userId: user.id };
}

async function dispararHook(sitio: Sitio): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const hookUrl = deployHookFor(sitio);
  if (!hookUrl) {
    console.error(`[rebuild-webs] Falta el secret del deploy hook para ${sitio}`);
    return { ok: false, motivo: "sin_hook_configurado" };
  }
  try {
    const res = await fetch(hookUrl, { method: "POST" });
    if (!res.ok) throw new Error(`Vercel respondió ${res.status}`);
    return { ok: true };
  } catch (err) {
    console.error(`[rebuild-webs] Error disparando build de ${sitio}:`, err);
    return { ok: false, motivo: "error_hook" };
  }
}

async function upsertEstado(
  supabase: SupabaseClient,
  sitio: Sitio,
  campos: Record<string, unknown>,
) {
  const { error } = await supabase.from("web_rebuild_state").upsert({ sitio, ...campos }, { onConflict: "sitio" });
  if (error) console.error(`[rebuild-webs] No se pudo actualizar el estado de ${sitio}:`, error.message);
}

/** Procesa un sitio afectado por ESTA solicitud: dispara si el cooldown ya
 * pasó, o lo marca "pendiente" para que una llamada posterior lo recoja. */
async function procesarSitio(supabase: SupabaseClient, sitio: Sitio, origen: string) {
  const ahora = new Date();

  const { data: estado, error: selectError } = await supabase
    .from("web_rebuild_state")
    .select("ultimo_disparo")
    .eq("sitio", sitio)
    .maybeSingle();

  if (selectError) {
    console.error(`[rebuild-webs] No se pudo leer el estado de ${sitio}:`, selectError.message);
  }

  const ultimoDisparo = estado?.ultimo_disparo ? new Date(estado.ultimo_disparo as string) : null;
  const cooldownPasado = !ultimoDisparo || ahora.getTime() - ultimoDisparo.getTime() >= COOLDOWN_MINUTES * 60_000;

  if (!cooldownPasado) {
    await upsertEstado(supabase, sitio, {
      ultima_solicitud: ahora.toISOString(),
      pendiente: true,
      ultimo_origen: origen,
    });
    return { sitio, disparado: false, motivo: "en_cooldown" };
  }

  const resultado = await dispararHook(sitio);
  if (resultado.ok) {
    await upsertEstado(supabase, sitio, {
      ultima_solicitud: ahora.toISOString(),
      ultimo_disparo: ahora.toISOString(),
      pendiente: false,
      ultimo_origen: origen,
    });
    return { sitio, disparado: true };
  }

  await upsertEstado(supabase, sitio, {
    ultima_solicitud: ahora.toISOString(),
    pendiente: true,
    ultimo_origen: origen,
  });
  return { sitio, disparado: false, motivo: resultado.motivo };
}

/** Autolimpieza: cualquier llamada a rebuild-webs revisa de paso si hay
 * OTRO sitio marcado pendiente cuyo cooldown ya venció, y lo dispara. Evita
 * dejar un cambio sin publicar si nadie vuelve a guardar en ese sitio. */
async function flushPendientes(supabase: SupabaseClient) {
  const ahora = new Date();
  const { data: pendientes, error } = await supabase
    .from("web_rebuild_state")
    .select("sitio, ultimo_disparo")
    .eq("pendiente", true);

  if (error) {
    console.error("[rebuild-webs] No se pudo leer pendientes:", error.message);
    return [];
  }

  const resultados = [];
  for (const fila of pendientes ?? []) {
    const sitio = fila.sitio as Sitio;
    const ultimoDisparo = fila.ultimo_disparo ? new Date(fila.ultimo_disparo as string) : null;
    const cooldownPasado = !ultimoDisparo || ahora.getTime() - ultimoDisparo.getTime() >= COOLDOWN_MINUTES * 60_000;
    if (!cooldownPasado) continue;

    const resultado = await dispararHook(sitio);
    if (resultado.ok) {
      await upsertEstado(supabase, sitio, { ultimo_disparo: ahora.toISOString(), pendiente: false });
      resultados.push({ sitio, disparado: true, via: "flush" });
    }
  }
  return resultados;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await autenticar(req);
  if (!auth.ok) return auth.response;

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Body no es JSON válido" }, 400);
  }

  const origen = String(payload.origen ?? "");
  const sitios = SITIOS_POR_ORIGEN[origen];
  if (!sitios) {
    return json({ error: `origen inválido. Debe ser uno de: ${Object.keys(SITIOS_POR_ORIGEN).join(", ")}` }, 400);
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  try {
    const directos = [];
    for (const sitio of sitios) {
      directos.push(await procesarSitio(supabaseAdmin, sitio, origen));
    }
    const flush = await flushPendientes(supabaseAdmin);

    return json({ ok: true, origen, sitios, resultados: [...directos, ...flush] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    console.error("[rebuild-webs]", message);
    // 200 a propósito, igual que traducir-contenido: el guardado de la carta
    // ya ocurrió antes de llamar aquí, un fallo del rebuild no debe alarmar
    // al panel (lo dispara el propio hook con .catch() sin esperar).
    return json({ ok: false, error: message });
  }
});
