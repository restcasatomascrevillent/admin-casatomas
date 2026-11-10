/**
 * Edge Function newsletter-ia — «Crear con IA» de la newsletter. La IA
 * REDACTA el correo y PROPONE su presentación (bloques de las plantillas).
 * Nunca envía nada ni guarda nada: devuelve la propuesta al panel, donde el
 * personal la revisa, la edita y decide si la guarda como plantilla o la usa
 * (y enviar sigue pidiendo confirmación).
 *
 *   POST `${SUPABASE_URL}/functions/v1/newsletter-ia`   Authorization: Bearer <JWT> (Marketing con «Editar»)
 *
 *   { descripcion, tipo?, tono?, imagenes?: string[], base?: { titulo, insignia?, preheader?, bloques } }
 *     → { ok: true, propuesta: { tipo, insignia, titulo, preheader, bloques }, avisos, modelo }
 *
 *   400 entrada · 401/403 sesión o permiso · 429 tope diario (40 por usuario)
 *   502 OpenAI o propuesta no válida · 503 falta la clave o la migración
 *
 * Igual que el resto de IA del panel: clave del servidor (claveOpenAI("otros"),
 * OPENAI_API_KEY, nunca en el navegador), modelo elegible en Super Admin ›
 * Servicios › Modelos (ia_modelo_funcion; por defecto NEWSLETTER_IA_MODEL o
 * gpt-5.6-luna) y gasto registrado en «Gasto IA» (AcumuladorUso + registrarUso
 * en el finally, ver _shared/ENGANCHE-REGISTRO-IA.md). El tope diario lo
 * cuenta la tabla newsletter_ia_peticiones (migración 20261122153700).
 */
import { claveOpenAI } from "../_shared/clave-openai.ts";
import { motivoErrorOpenAI } from "../_shared/error-openai.ts";
import { modeloDeFuncion, type ClienteSupabase } from "../_shared/modelo-funcion.ts";
import { AcumuladorUso, registrarUso, type OpcionesRegistro } from "../_shared/registrar-uso-ia.ts";
import { json, jsonAuth, leerJson, opciones } from "../_shared/instagram/http.ts";
import { registrarSecreto, sanear } from "../_shared/instagram/secretos.ts";
import { autorizarMarketing, type Sesion } from "../_shared/instagram/supabase.ts";
import { esTipoNewsletter, textoPlanoDeBloques, urlHttpsSegura, validarBloques, type TipoNewsletter } from "../_shared/newsletter/bloques.ts";
import { ESQUEMA, SISTEMA, TONOS, mensajeUsuario, type Tono } from "./prompts.ts";
import { ErrorPropuesta, normalizarPropuesta } from "./normalizar.ts";

export const FUNCION = "newsletter-ia";
export const MODELO_POR_DEFECTO = "gpt-5.6-luna";
const OPENAI = "https://api.openai.com/v1";
const MS = 15_000;
const MS_OPENAI = 60_000;
export const LIMITE_DESCRIPCION = 1500;
export const MAX_IMAGENES = 24;
const MAX_INTENTOS = 2;

export interface DependenciasNewsletterIA {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  registrar?: (uso: AcumuladorUso, opciones: OpcionesRegistro) => Promise<void>;
  /** Cliente con service role para leer ia_modelo_funcion (lo crea index.ts). */
  clienteModelos?: ClienteSupabase | null;
}

const NOMBRES_ENTORNO = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "OPENAI_API_KEY", "NEWSLETTER_IA_MODEL"] as const;

export function entornoNewsletterIA(): Record<string, string | undefined> {
  const deno = (globalThis as unknown as { Deno?: { env: { get(n: string): string | undefined } } }).Deno;
  const salida: Record<string, string | undefined> = {};
  for (const n of NOMBRES_ENTORNO) salida[n] = deno?.env.get(n);
  return salida;
}

export class ErrorNewsletterIA extends Error {
  readonly estado: number;
  constructor(mensaje: string, estado = 400) {
    super(mensaje);
    this.estado = estado;
  }
}

// ── Entrada ─────────────────────────────────────────────────────────────────

export interface EntradaIA {
  descripcion: string;
  tipo: TipoNewsletter | null;
  tono: Tono;
  imagenes: string[];
  base: { titulo: string; insignia: string; preheader: string; bloques: unknown[] } | null;
}

export function validarEntrada(raw: unknown): EntradaIA {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const descripcion = typeof c.descripcion === "string" ? c.descripcion.trim() : "";
  if (descripcion.length < 10) throw new ErrorNewsletterIA("Cuéntale a la IA qué quieres comunicar (al menos una frase).");
  if (descripcion.length > LIMITE_DESCRIPCION) throw new ErrorNewsletterIA(`La descripción no puede superar ${LIMITE_DESCRIPCION} caracteres.`);
  const tipo = esTipoNewsletter(c.tipo) ? c.tipo : null;
  const tono: Tono = (TONOS as readonly string[]).includes(c.tono as string) ? (c.tono as Tono) : "cercano";
  const imagenes = (Array.isArray(c.imagenes) ? c.imagenes : [])
    .map((u) => urlHttpsSegura(typeof u === "string" ? u : null))
    .filter((u): u is string => !!u)
    .slice(0, MAX_IMAGENES);
  let base: EntradaIA["base"] = null;
  if (c.base && typeof c.base === "object") {
    const b = c.base as Record<string, unknown>;
    const v = validarBloques(b.bloques);
    if (v.ok) {
      base = {
        titulo: typeof b.titulo === "string" ? b.titulo.slice(0, 150) : "",
        insignia: typeof b.insignia === "string" ? b.insignia.slice(0, 40) : "",
        preheader: typeof b.preheader === "string" ? b.preheader.slice(0, 150) : "",
        bloques: v.bloques,
      };
    }
  }
  return { descripcion, tipo, tono, imagenes, base };
}

// ── Base de datos (como el usuario) ─────────────────────────────────────────

const cab = (s: Sesion, extra: Record<string, string> = {}) => ({ apikey: s.sb.clave, Authorization: `Bearer ${s.token}`, ...extra });
const faltaTabla = (estado: number, t: string) => estado === 404 || /relation .* does not exist|Could not find the table|PGRST205/i.test(t);

/** Reserva una petición del tope diario (el disparador cuenta). 429 si se ha llegado al tope. */
async function reservar(s: Sesion, modelo: string): Promise<number | null> {
  const r = await s.fetch(`${s.sb.url}/rest/v1/newsletter_ia_peticiones?select=id`, {
    method: "POST",
    headers: cab(s, { "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify({ modelo }),
    signal: AbortSignal.timeout(MS),
  });
  if (r.ok) {
    const filas = (await r.json().catch(() => [])) as Array<{ id?: number }>;
    return filas?.[0]?.id ?? null;
  }
  const t = sanear(await r.text().catch(() => "")).slice(0, 300);
  if (/newsletter_cupo_ia/.test(t)) throw new ErrorNewsletterIA("Has llegado al tope de 40 propuestas de la IA por hoy. Mañana se renueva.", 429);
  if (faltaTabla(r.status, t)) throw new ErrorNewsletterIA("Falta aplicar la migración 20261122153700_newsletter_plantillas en este Supabase.", 503);
  if (r.status === 401 || r.status === 403) throw new ErrorNewsletterIA("Hace falta «Editar» en Newsletter para usar la IA.", 403);
  throw new ErrorNewsletterIA(`No se pudo reservar la petición a la IA (${r.status}).`, 502);
}

async function marcar(s: Sesion, id: number | null, ok: boolean): Promise<void> {
  if (id === null) return;
  await s
    .fetch(`${s.sb.url}/rest/v1/newsletter_ia_peticiones?id=eq.${id}`, {
      method: "PATCH",
      headers: cab(s, { "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify({ ok }),
      signal: AbortSignal.timeout(MS),
    })
    .catch(() => undefined);
}

// ── OpenAI ──────────────────────────────────────────────────────────────────

export class ErrorOpenAI extends Error {}

type Mensaje = { role: "system" | "user" | "assistant"; content: string };

async function pedir(f: typeof fetch, clave: string, modelo: string, mensajes: Mensaje[], uso: AcumuladorUso): Promise<{ datos: unknown; bruto: string }> {
  let res: Response;
  try {
    res = await f(`${OPENAI}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${clave}` },
      body: JSON.stringify({
        model: modelo,
        messages: mensajes,
        response_format: { type: "json_schema", json_schema: ESQUEMA },
        // Como instagram-ia y rrss-ia (gpt-5.6-luna): sin razonamiento, con
        // temperatura y max_completion_tokens.
        reasoning_effort: "none",
        temperature: 0.7,
        max_completion_tokens: 3000,
        prompt_cache_key: FUNCION,
      }),
      signal: AbortSignal.timeout(MS_OPENAI),
    });
  } catch (e) {
    uso.sumar(undefined);
    throw new ErrorOpenAI(`No se pudo hablar con OpenAI: ${sanear((e as Error)?.message ?? e)}`);
  }
  if (!res.ok) {
    const cuerpo = await res.text().catch(() => "");
    uso.sumar(undefined);
    throw new ErrorOpenAI(motivoErrorOpenAI(res.status, cuerpo));
  }
  const j = (await res.json().catch(() => null)) as { usage?: unknown; choices?: Array<{ message?: { content?: unknown; refusal?: unknown } }> } | null;
  uso.sumar((j?.usage ?? undefined) as Parameters<AcumuladorUso["sumar"]>[0]);
  const msg = j?.choices?.[0]?.message;
  if (typeof msg?.refusal === "string" && msg.refusal) throw new ErrorOpenAI("La IA se ha negado a redactar este correo.");
  if (typeof msg?.content !== "string") throw new ErrorOpenAI("OpenAI respondió sin contenido.");
  try {
    return { datos: JSON.parse(msg.content), bruto: msg.content };
  } catch {
    throw new ErrorOpenAI("OpenAI respondió con un JSON que no se puede leer.");
  }
}

// ── Manejador ───────────────────────────────────────────────────────────────

export async function manejarNewsletterIA(request: Request, deps: DependenciasNewsletterIA = {}): Promise<Response> {
  if (request.method === "OPTIONS") return opciones();
  if (request.method !== "POST") return json(405, { ok: false, error: "Método no permitido" });
  const env = deps.env ?? entornoNewsletterIA();
  const f = deps.fetch ?? fetch;
  const auth = await autorizarMarketing(request.headers.get("authorization"), { env, fetch: f, permiso: "editar" });
  if (!auth.ok) return jsonAuth(auth.estado, auth.motivo);
  const s = auth.sesion;
  const leido = await leerJson(request, 64 * 1024);
  if (!leido.ok) return json(leido.estado, { ok: false, error: leido.error });

  let entrada: EntradaIA;
  try {
    entrada = validarEntrada(leido.valor);
  } catch (e) {
    return json((e as ErrorNewsletterIA).estado ?? 400, { ok: false, error: (e as Error).message });
  }

  const clave = claveOpenAI("otros", (n) => env[n]);
  if (!clave) return json(503, { ok: false, error: "Falta OPENAI_API_KEY en los secretos de Supabase", tipo: "ia_no_disponible" });
  registrarSecreto(clave);
  const porDefecto = (env.NEWSLETTER_IA_MODEL ?? "").trim() || MODELO_POR_DEFECTO;
  const modelo = await modeloDeFuncion(FUNCION, porDefecto, { cliente: deps.clienteModelos ?? null });

  const uso = new AcumuladorUso(FUNCION, modelo, "chat");
  const registrar = deps.registrar ?? registrarUso;
  const t0 = Date.now();
  let reserva: number | null = null;
  let ok = false;
  try {
    reserva = await reservar(s, modelo);
    const fuente = [entrada.descripcion, entrada.base ? `${entrada.base.titulo} ${textoPlanoDeBloques(entrada.base.bloques as never)}` : ""].join(" ");
    const mensajes: Mensaje[] = [
      { role: "system", content: SISTEMA },
      { role: "user", content: mensajeUsuario(entrada) },
    ];
    let ultimoError = "";
    for (let intento = 0; intento < MAX_INTENTOS; intento++) {
      const { datos, bruto } = await pedir(f, clave, modelo, mensajes, uso);
      try {
        const { propuesta, avisos } = normalizarPropuesta(datos, { fuente, imagenes: entrada.imagenes, tipoPedido: entrada.tipo });
        ok = true;
        return json(200, { ok: true, propuesta, avisos, modelo });
      } catch (e) {
        if (!(e instanceof ErrorPropuesta)) throw e;
        ultimoError = e.message;
        mensajes.push({ role: "assistant", content: bruto });
        mensajes.push({ role: "user", content: `La propuesta no vale: ${e.message}. Corrígela respetando el esquema y las reglas.` });
      }
    }
    return json(502, { ok: false, error: `${ultimoError}. Vuelve a intentarlo o cambia la descripción.`, tipo: "propuesta_no_valida" });
  } catch (e) {
    uso.marcarError();
    if (e instanceof ErrorNewsletterIA) return json(e.estado, { ok: false, error: e.message });
    if (e instanceof ErrorOpenAI) return json(502, { ok: false, error: e.message, tipo: "ia_no_disponible" });
    return json(502, { ok: false, error: sanear((e as Error)?.message ?? e) });
  } finally {
    await marcar(s, reserva, ok);
    await registrar(uso, { disparador: `usuario:${s.usuario}`, duracionMs: Date.now() - t0 });
  }
}
