// buscar-puntuacion-parker
// ---------------------------------------------------------------------------
// Busca en internet la puntuación Robert Parker / The Wine Advocate de UN vino
// y UNA añada (08/11/2026, petición del dueño: «que la foto de la etiqueta
// también busque la puntuación Parker»). Lo llama el panel en segundo plano,
// después de leer la etiqueta (extraer-vino-foto) o con «Buscar de nuevo».
//
// - Nunca escribe en la base de datos: devuelve el resultado y el panel lo
//   enseña; se guarda en vinos_puntuacion_parker solo cuando el usuario guarda.
// - Reglas (ver _shared/parker.ts): solo RP/WA; vino y añada exactos; los
//   intervalos se quedan como intervalo; provisionales marcadas; fuentes
//   contradictorias → revisión. Sin añada (y sin ser NV) no busca: devuelve
//   «añada desconocida» para que el panel la pida.
// - «verificada» solo si la URL es de un sitio que la búsqueda consultó de
//   verdad y, al abrir esa página desde aquí, se ve la nota junto a «Parker» /
//   «Wine Advocate», la añada y el nombre. Si la página no se puede abrir o no
//   lo muestra, «revision» con la fuente para que el dueño la confirme.
// - Caché: si ya hay una fila VERIFICADA del mismo vino (mismo id, o el mismo
//   nombre sin formato ni año) y añada, la devuelve sin buscar. `forzar: true`
//   («Buscar de nuevo») busca igualmente.
// - Modelo: env PARKER_BUSQUEDA_MODELO (por defecto gpt-4.1), Responses API con
//   la herramienta web_search. Tope 45 s; la comprobación de la página, 8 s.
// - Auth: verify_jwt (config.toml) + «Editar» en gestor_carta, como
//   extraer-vino-foto (con solo «Ver» no se gasta IA).
// - Clave del proceso «vinos»: OPENAI_API_KEY_VINOS (si falta, OPENAI_API_KEY).
//
// Body: { vino_id?, nombre, bodega?, cuvee?, denominacion_origen?, anada: number|null,
//         sin_anada?: boolean, forzar?: boolean, puntuacion_etiqueta?: {puntos, entidad, anada} }
// Respuesta: { ok: true, resultado: ResultadoParker, desde_cache: boolean } | { ok: false, error, resultado? }
// ---------------------------------------------------------------------------
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { claveOpenAI } from "../_shared/clave-openai.ts";
import { conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { comprobarPermisoSeccion, type ClientePermiso } from "../_shared/permiso-marketing.ts";
import { AcumuladorUso, registrarUso } from "../_shared/registrar-uso-ia.ts";
import { motivoErrorOpenAI } from "../_shared/error-openai.ts";
import {
  confirmaEnTexto,
  ENTIDAD_PARKER,
  hostDe,
  nombreComparable,
  resultadoSinPuntos,
  textoDeHtml,
  trasComprobar,
  urlPublica,
  validarResultado,
  type ResultadoParker,
  type SolicitudParker,
} from "../_shared/parker.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FUNCION = "buscar-puntuacion-parker";
const OPENAI_KEY = claveOpenAI("vinos");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MODELO = (Deno.env.get("PARKER_BUSQUEDA_MODELO") ?? "").trim() || "gpt-4.1";
const BUSQUEDA_MS = 45_000;
const PAGINA_MS = 8_000;
const PAGINA_MAX_BYTES = 1_500_000;
// Como extraer-vino-foto: la tarifa por llamada de búsqueda va como «modelo» aparte.
const MODELO_LLAMADA_BUSQUEDA = "openai-web-search-call";
const TOKENS_POR_LLAMADA_BUSQUEDA = 1000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const textoCorto = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

/** Hoy en Madrid, AAAA-MM-DD (fecha de consulta). */
export function hoyMadrid(ahora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
}

const SCHEMA = {
  type: "json_schema",
  name: "puntuacion_parker",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "encontrada", "motivo", "vino_evaluado", "anada_evaluada", "sin_anada", "puntos_texto", "puntos_min", "puntos_max",
      "provisional", "entidad", "critico", "fecha_valoracion", "fuente_nombre", "fuente_url", "cita", "discrepancias", "notas",
    ],
    properties: {
      encontrada: { type: "boolean" },
      motivo: { type: ["string", "null"], enum: ["referencia_ambigua", "fuente_inaccesible", "no_localizada", null] },
      vino_evaluado: { type: ["string", "null"] },
      anada_evaluada: { type: ["integer", "null"] },
      sin_anada: { type: "boolean" },
      puntos_texto: { type: ["string", "null"] },
      puntos_min: { type: ["integer", "null"] },
      puntos_max: { type: ["integer", "null"] },
      provisional: { type: "boolean" },
      entidad: { type: ["string", "null"] },
      critico: { type: ["string", "null"] },
      fecha_valoracion: { type: ["string", "null"] },
      fuente_nombre: { type: ["string", "null"] },
      fuente_url: { type: ["string", "null"] },
      cita: { type: ["string", "null"] },
      discrepancias: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["fuente_nombre", "fuente_url", "puntos_texto", "nota"],
          properties: {
            fuente_nombre: { type: "string" },
            fuente_url: { type: ["string", "null"] },
            puntos_texto: { type: ["string", "null"] },
            nota: { type: ["string", "null"] },
          },
        },
      },
      notas: { type: ["string", "null"] },
    },
  },
};

export function promptBusqueda(): string {
  return [
    "Eres un sumiller que comprueba puntuaciones de Robert Parker / The Wine Advocate (WA) para la carta de un restaurante.",
    "Busca en internet la puntuación de WA del vino y la añada EXACTOS que se indican.",
    "",
    "REGLAS ESTRICTAS:",
    "- Solo Robert Parker / The Wine Advocate (robertparker.com, «RP», «WA», «Wine Advocate»). NO valen Peñín, James Suckling, Decanter, Vinous/Galloni, Wine Spectator, Tim Atkin, Jancis Robinson, Wine Enthusiast, Falstaff, Vivino ni medallas.",
    "- Vino y añada exactos. No uses la nota de otra añada ni la de otro vino de la misma bodega (p. ej. «Pago de Carraovejas» ≠ «El Anejón»; «Aalto» ≠ «Aalto PS»). Si te piden un vino sin añada (NV), solo vale la edición o saca indicada en el nombre.",
    "- Las tiendas dejan a menudo la nota de una añada anterior en la ficha: solo vale si la página liga expresamente la nota a la añada pedida.",
    "- Fuentes por orden: robertparker.com; web de la bodega o su importador; Wine-Searcher (críticas por añada); tiendas especializadas.",
    "- No uses tu memoria: solo lo que veas en las páginas. fuente_url = la URL EXACTA donde lo viste; cita = el texto literal donde se ve la nota atribuida a WA (máx. 300 caracteres).",
    "- Intervalos: no los conviertas en una cifra («93-95» → puntos_texto \"93-95\", puntos_min 93, puntos_max 95). «94+» → puntos_texto \"94+\", 94 y 94.",
    "- provisional = true si la fuente dice muestra de barrica / en primeur o la nota va entre paréntesis.",
    "- Si dos fuentes atribuyen a WA notas distintas para el mismo vino y añada, pon una como principal y las demás en discrepancias.",
    "- Si no la encuentras: encontrada = false y motivo = «no_localizada»; si la reseña existe pero la nota no se ve (muro de pago): «fuente_inaccesible»; si no sabes qué vino es: «referencia_ambigua». Explica en notas qué buscaste.",
    "- entidad: «Robert Parker Wine Advocate». critico: nombre del catador si se ve. fecha_valoracion: AAAA-MM-DD, AAAA-MM o AAAA si se ve; si no, null.",
    "Responde únicamente con el JSON pedido.",
  ].join("\n");
}

function fichaSolicitud(p: SolicitudParker & { cuvee?: string | null; denominacion_origen?: string | null }, etiqueta: string | null): string {
  return [
    `Vino: ${p.nombre}`,
    `Bodega: ${p.bodega ?? "?"}`,
    `Cuvée / variedad: ${p.cuvee ?? "?"}`,
    `D.O.: ${p.denominacion_origen ?? "?"}`,
    p.sin_anada ? "Añada: sin añada (NV); vale solo la edición/saca del nombre" : `Añada: ${p.anada}`,
    ...(etiqueta ? [`En la etiqueta se lee: ${etiqueta} (compruébalo: puede ser de otra entidad o de otra añada)`] : []),
  ].join("\n");
}

/** JSON de la respuesta de la Responses API + hosts realmente consultados o citados. */
export function leerRespuesta(data: Record<string, unknown>): { json: Record<string, unknown> | null; hosts: Set<string>; llamadas: number } {
  const hosts = new Set<string>();
  let llamadas = 0;
  let texto = "";
  const output = Array.isArray(data.output) ? (data.output as Array<Record<string, unknown>>) : [];
  for (const item of output) {
    if (item?.type === "web_search_call") {
      llamadas++;
      const fuentes = (item.action as Record<string, unknown> | undefined)?.sources;
      if (Array.isArray(fuentes)) {
        for (const f of fuentes) {
          const h = typeof f?.url === "string" ? hostDe(f.url) : null;
          if (h) hosts.add(h);
        }
      }
    } else if (item?.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content as Array<Record<string, unknown>>) {
        if (c?.type !== "output_text" || typeof c.text !== "string") continue;
        texto += c.text;
        for (const a of Array.isArray(c.annotations) ? (c.annotations as Array<Record<string, unknown>>) : []) {
          const h = typeof a?.url === "string" ? hostDe(a.url) : null;
          if (h) hosts.add(h);
        }
      }
    }
  }
  const limpio = texto.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const ini = limpio.indexOf("{");
  const fin = limpio.lastIndexOf("}");
  let json: Record<string, unknown> | null = null;
  if (ini >= 0 && fin > ini) {
    try {
      json = JSON.parse(limpio.slice(ini, fin + 1));
    } catch {
      json = null;
    }
  }
  return { json, hosts, llamadas };
}

/** Abre la página de la fuente (solo hosts públicos) y devuelve su texto, o null. */
async function textoPagina(url: string): Promise<string | null> {
  const u = urlPublica(url);
  if (!u) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAGINA_MS);
  try {
    const res = await fetch(u.toString(), {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CasaTomasCarta/1.0)", Accept: "text/html,application/xhtml+xml" },
    });
    if (!res.ok) return null;
    const tipo = res.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|xhtml/i.test(tipo)) return null;
    const html = (await res.text()).slice(0, PAGINA_MAX_BYTES);
    return textoDeHtml(html);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

type Cliente = ReturnType<typeof createClientBase>;

/** Fila verificada ya guardada del mismo vino (id o nombre comparable) y añada, o null. */
async function buscarEnCache(cliente: Cliente, vinoId: string | null, s: SolicitudParker): Promise<ResultadoParker | null> {
  try {
    let consulta = cliente
      .from("vinos_puntuacion_parker")
      .select("vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, Vinos(nombre)")
      .eq("estado", "verificada");
    consulta = s.sin_anada ? consulta.eq("sin_anada", true).is("anada", null) : consulta.eq("anada", s.anada as number);
    const { data, error } = await consulta.limit(50);
    if (error || !Array.isArray(data)) return null;
    const buscado = nombreComparable(s.nombre);
    const fila = (data as Array<Record<string, unknown>>).find((f) => {
      if (vinoId && f.vino_id === vinoId) return true;
      const nombre = (f.Vinos as { nombre?: string } | null)?.nombre;
      return Boolean(buscado) && typeof nombre === "string" && nombreComparable(nombre) === buscado;
    });
    if (!fila) return null;
    return {
      estado: "verificada",
      motivo: null,
      anada: (fila.anada as number | null) ?? null,
      sin_anada: fila.sin_anada === true,
      puntos_texto: (fila.puntos_texto as string | null) ?? null,
      puntos_min: (fila.puntos_min as number | null) ?? null,
      puntos_max: (fila.puntos_max as number | null) ?? null,
      provisional: fila.provisional === true,
      vino_evaluado: (fila.vino_evaluado as string | null) ?? null,
      entidad: (fila.entidad as string) || ENTIDAD_PARKER,
      critico: (fila.critico as string | null) ?? null,
      fecha_valoracion: (fila.fecha_valoracion as string | null) ?? null,
      fuente_nombre: (fila.fuente_nombre as string | null) ?? null,
      fuente_url: (fila.fuente_url as string | null) ?? null,
      fuente_tipo: (fila.fuente_tipo as "original" | "secundaria" | null) ?? null,
      cita: (fila.cita as string | null) ?? null,
      fecha_consulta: String(fila.fecha_consulta ?? ""),
      discrepancias: Array.isArray(fila.discrepancias) ? (fila.discrepancias as ResultadoParker["discrepancias"]) : [],
      notas: (fila.notas as string | null) ?? null,
      comprobado_en_pagina: false,
    };
  } catch {
    return null;
  }
}

serve(conAuditoriaDePeticion(FUNCION, createClientBase, async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "No autorizado" }, 401);
  const supabaseUser = createClientBase(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const permiso = await comprobarPermisoSeccion(
    supabaseUser as unknown as ClientePermiso,
    "gestor_carta",
    "editar",
    "No tienes permiso para editar la carta (hace falta «Editar», no solo «Ver»)",
  );
  if (!permiso.ok) return json({ ok: false, error: permiso.error }, permiso.status);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "Body no es JSON válido" }, 400);
  }
  const nombre = textoCorto(payload.nombre, 200);
  if (!nombre) return json({ ok: false, error: "Falta el nombre del vino" }, 400);
  const sinAnada = payload.sin_anada === true;
  const anada = !sinAnada && typeof payload.anada === "number" && Number.isInteger(payload.anada) && payload.anada >= 1900 && payload.anada <= 2100
    ? payload.anada
    : null;
  const solicitud: SolicitudParker & { cuvee: string | null; denominacion_origen: string | null } = {
    nombre,
    bodega: textoCorto(payload.bodega, 120),
    cuvee: textoCorto(payload.cuvee, 120),
    denominacion_origen: textoCorto(payload.denominacion_origen, 120),
    anada,
    sin_anada: sinAnada,
  };
  const vinoId = textoCorto(payload.vino_id, 100);
  const hoy = hoyMadrid();

  // Sin añada no se puede asociar ninguna puntuación: el panel la pide.
  if (anada === null && !sinAnada) {
    return json({
      ok: true,
      desde_cache: false,
      resultado: resultadoSinPuntos(solicitud, "no_localizada", "anada_desconocida", hoy, "Confirma la añada para buscar la puntuación."),
    });
  }

  if (payload.forzar !== true) {
    const cache = await buscarEnCache(supabaseUser, vinoId, solicitud);
    if (cache) return json({ ok: true, desde_cache: true, resultado: cache });
  }

  if (!OPENAI_KEY) return json({ ok: false, error: "OPENAI_API_KEY no configurada" }, 500);

  const etiqueta = (() => {
    const e = payload.puntuacion_etiqueta as Record<string, unknown> | undefined;
    if (!e || typeof e.puntos !== "number") return null;
    return `${e.puntos} puntos${typeof e.entidad === "string" && e.entidad ? ` (${e.entidad.slice(0, 60)})` : " (entidad no legible)"}${typeof e.anada === "number" ? `, añada ${e.anada}` : ""}`;
  })();

  const uso = new AcumuladorUso(FUNCION, MODELO, "chat");
  const usoLlamadas = new AcumuladorUso(FUNCION, MODELO_LLAMADA_BUSQUEDA, "otro");
  const inicioMs = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BUSQUEDA_MS);
  const llamar = (conFormato: boolean) =>
    fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: MODELO,
        temperature: 0,
        max_output_tokens: 1200,
        tools: [{ type: "web_search", search_context_size: "high" }],
        include: ["web_search_call.action.sources"],
        ...(conFormato ? { text: { format: SCHEMA } } : {}),
        input: [
          { role: "system", content: promptBusqueda() },
          {
            role: "user",
            content: conFormato
              ? fichaSolicitud(solicitud, etiqueta)
              : `${fichaSolicitud(solicitud, etiqueta)}\n\nDevuelve SOLO un objeto JSON con las claves ${SCHEMA.schema.required.join(", ")}.`,
          },
        ],
      }),
      signal: controller.signal,
    });

  try {
    let res = await llamar(true);
    if (res.status === 400) {
      uso.sumar(null);
      console.error(`[${FUNCION}] 400 con formato: ${(await res.text()).slice(0, 300)}`);
      res = await llamar(false);
    }
    if (!res.ok) {
      uso.sumar(null);
      uso.marcarError();
      const err = await res.text();
      console.error(`[${FUNCION}] OpenAI ${res.status}: ${err.slice(0, 300)}`);
      const motivo = motivoErrorOpenAI(res.status, err);
      return json({ ok: false, error: motivo, resultado: resultadoSinPuntos(solicitud, "fallida", "busqueda_fallida", hoy, motivo) }, 502);
    }
    const data = await res.json();
    uso.sumar(data?.usage);
    const { json: raw, hosts, llamadas } = leerRespuesta(data);
    if (llamadas > 0) {
      usoLlamadas.sumar({ input_tokens: llamadas * TOKENS_POR_LLAMADA_BUSQUEDA, output_tokens: 0 });
      usoLlamadas.llamadas += llamadas - 1;
    }
    let resultado = validarResultado(raw, solicitud, hosts, hoy);
    if (resultado.estado === "revision" && resultado.motivo === null && resultado.fuente_url) {
      const pagina = await textoPagina(resultado.fuente_url);
      resultado = trasComprobar(resultado, pagina === null ? null : confirmaEnTexto(pagina, resultado, nombre));
    }
    return json({ ok: true, desde_cache: false, resultado });
  } catch (error) {
    uso.marcarError();
    const tardo = error instanceof Error && error.name === "AbortError";
    const motivo = tardo ? "La búsqueda ha tardado demasiado; prueba otra vez" : "No se pudo buscar la puntuación";
    console.error(`[${FUNCION}]`, error instanceof Error ? error.message : error);
    return json({ ok: false, error: motivo, resultado: resultadoSinPuntos(solicitud, "fallida", "busqueda_fallida", hoy, motivo) }, 500);
  } finally {
    clearTimeout(timeout);
    await registrarUso([uso, usoLlamadas], { disparador: `usuario:${permiso.userId}`, duracionMs: Date.now() - inicioMs });
  }
}));
