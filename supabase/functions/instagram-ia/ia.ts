/**
 * Edge Function instagram-ia — IA de textos de Marketing › Instagram (fase 1).
 * Propone textos para una pieza; NUNCA publica ni programa nada: la persona
 * elige, retoca y sigue el camino de siempre (aprobación humana).
 *
 *   POST `${SUPABASE_URL}/functions/v1/instagram-ia`
 *   Authorization: Bearer <JWT del panel> (usuario con Marketing en edición)
 *
 *   Cuerpo común:
 *     { accion: "sugerir_texto" | "sugerir_rotulos",
 *       marca: "casa-tomas" | "touza", formato: "post" | "story", plantilla: "<id>",
 *       tono?: "cercano" | "elegante" | "retranca"      (por defecto cercano),
 *       indicaciones?: string (≤ 500; se quitan correos y teléfonos),
 *       foto?: "carta:<id>" | …, platoId?: "<id de Platos>",
 *       textos?: { antetitulo?, titular?, cita?, cta?, pie? }   (lo que ya lleva la pieza),
 *       piezaId?: uuid, incluirPrecio?: boolean (solo sugerir_texto) }
 *
 *   200 sugerir_texto:   { ok, accion, sugerenciaId, modelo, versionGuia, plato,
 *                          variantes: [{ gancho, caption, hashtags[], altText, platosCitados[], avisos[] }],
 *                          descartadas: [{ motivos[] }], avisos[] }
 *   200 sugerir_rotulos: { …, variantes: [{ antetitulo?, titular?, cita?, cta?, pie?, avisos[] }] }
 *   400 entrada mal · 401 sin sesión · 403 sin Marketing (edición) · 405 · 413
 *   422 ninguna variante pasó los validadores (con descartadas) · 429 cupo diario
 *   502 OpenAI o la base de datos fallaron · 503 falta la clave o la migración
 *
 * Contexto que recibe el modelo (sin datos personales nunca): la guía de la
 * marca (instagram_guias_marca), el plato de la foto si es de la carta
 * (nombre, categoría, descripción y alérgenos oficiales; el precio NO), los
 * nombres de la carta de la marca, la plantilla, los textos de la pieza, el
 * tono y las indicaciones. Todo como datos en un bloque JSON delimitado.
 *
 * Después del modelo, ANTES de devolver, cada variante pasa por los
 * validadores de _shared/instagram/validar-ia.ts: se corrige o se descarta.
 * Si las 3 se descartan se pide una vez más al modelo con los motivos.
 *
 * Patrones copiados de chat-web / chat-facturas: clave con claveOpenAI()
 * (proceso «otros» → secreto OPENAI_API_KEY, el general), coste con
 * AcumuladorUso + registrarUso() en el finally (ENGANCHE-REGISTRO-IA.md) y
 * errores de OpenAI con motivoErrorOpenAI(). Modelo gpt-5.6-luna (el de
 * chat-web), configurable con INSTAGRAM_IA_MODEL.
 *
 * Todo con el JWT del usuario y la clave pública (RLS de marketing), como el
 * resto de funciones de Instagram; nunca service_role (solo registrarUso,
 * que lo crea él, para escribir en ia_uso).
 */
import { claveOpenAI } from "../_shared/clave-openai.ts";
import { motivoErrorOpenAI } from "../_shared/error-openai.ts";
import { AcumuladorUso, registrarUso, type OpcionesRegistro } from "../_shared/registrar-uso-ia.ts";
import { json, jsonAuth, leerJson, opciones } from "../_shared/instagram/http.ts";
import { registrarSecreto, registro, sanear } from "../_shared/instagram/secretos.ts";
import { autorizarMarketing, type Sesion } from "../_shared/instagram/supabase.ts";
import { esUuid, validarCaption } from "../_shared/instagram/validacion.ts";
import {
  anonimizar,
  CAMPOS_ROTULO,
  CUENTAS_PROPIAS,
  formatearPrecio,
  parseAlergenosOficiales,
  revisarRotulos,
  revisarVarianteTexto,
  type CampoRotulo,
  type ContextoValidacion,
  type MarcaIA,
  type PlatoContexto,
  type Revision,
} from "../_shared/instagram/validar-ia.ts";
import { plantillaIA } from "./plantillas.ts";
import {
  ESQUEMA_ROTULOS,
  ESQUEMA_TEXTO,
  mensajeReintento,
  mensajeUsuario,
  promptSistemaRotulos,
  promptSistemaTexto,
  TONOS,
  type DatosPrompt,
  type Tono,
} from "./prompts.ts";

export const FUNCION = "instagram-ia";
export const MODELO_POR_DEFECTO = "gpt-5.6-luna";
export const CUPO_DIARIO_POR_DEFECTO = 100;
export const OPENAI = "https://api.openai.com/v1";
const MAX_INTENTOS = 2;
const VARIANTES = 3;
const MS_OPENAI = 45_000;
const MS_SUPABASE = 15_000;
const MAX_INDICACIONES = 500;
const MAX_TEXTO_PIEZA = 300;
const RE_ID_PLATO = /^[A-Za-z0-9_-]{1,100}$/;
const PREFIJO_FOTO_CARTA = "carta:";

export type Accion = "sugerir_texto" | "sugerir_rotulos";

export interface EntradaIA {
  accion: Accion;
  marca: MarcaIA;
  formato: "post" | "story";
  plantilla: string;
  tono: Tono;
  indicaciones: string;
  platoId: string | null;
  piezaId: string | null;
  textos: Partial<Record<CampoRotulo, string>>;
  incluirPrecio: boolean;
}

export interface DependenciasIA {
  env?: Record<string, string | undefined>;
  /** fetch para Supabase y OpenAI (en los tests, uno falso). */
  fetch?: typeof fetch;
  registrar?: (uso: AcumuladorUso, opciones: OpcionesRegistro) => Promise<void>;
  ahora?: () => Date;
}

const NOMBRES_ENTORNO = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "OPENAI_API_KEY",
  "INSTAGRAM_IA_MODEL",
  "INSTAGRAM_IA_CUPO_DIARIO",
] as const;

/** Entorno de la función: solo los nombres que hacen falta (nunca Deno.env entero). */
export function entornoIA(): Record<string, string | undefined> {
  const deno = (globalThis as unknown as { Deno?: { env: { get(n: string): string | undefined } } }).Deno;
  const salida: Record<string, string | undefined> = {};
  for (const n of NOMBRES_ENTORNO) salida[n] = deno?.env.get(n);
  return salida;
}

// ── Entrada ─────────────────────────────────────────────────────────────────

const cadena = (v: unknown, max: number): string | null => (typeof v === "string" ? v.trim().slice(0, max) : null);

export function validarEntrada(valor: unknown): { ok: true; entrada: EntradaIA } | { ok: false; error: string } {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return { ok: false, error: "El cuerpo debe ser un objeto JSON" };
  const o = valor as Record<string, unknown>;
  if (o.accion !== "sugerir_texto" && o.accion !== "sugerir_rotulos") {
    return { ok: false, error: "accion debe ser «sugerir_texto» o «sugerir_rotulos»" };
  }
  if (o.marca !== "casa-tomas" && o.marca !== "touza") return { ok: false, error: "marca debe ser «casa-tomas» o «touza»" };
  const formato = o.formato ?? "post";
  if (formato !== "post" && formato !== "story") return { ok: false, error: "formato debe ser «post» o «story»" };
  const plantilla = plantillaIA(o.plantilla);
  if (!plantilla) return { ok: false, error: "plantilla desconocida" };
  if (plantilla.marca !== o.marca) return { ok: false, error: "la plantilla no es de esa marca" };
  const tono = o.tono ?? "cercano";
  if (!TONOS.includes(tono as Tono)) return { ok: false, error: "tono debe ser «cercano», «elegante» o «retranca»" };
  if (o.indicaciones !== undefined && o.indicaciones !== null && typeof o.indicaciones !== "string") {
    return { ok: false, error: "indicaciones debe ser texto" };
  }
  if (typeof o.indicaciones === "string" && [...o.indicaciones].length > MAX_INDICACIONES) {
    return { ok: false, error: `indicaciones: máximo ${MAX_INDICACIONES} caracteres` };
  }
  let platoId: string | null = null;
  if (o.platoId !== undefined && o.platoId !== null) {
    if (typeof o.platoId !== "string" || !RE_ID_PLATO.test(o.platoId)) return { ok: false, error: "platoId no válido" };
    platoId = o.platoId;
  } else if (typeof o.foto === "string" && o.foto.startsWith(PREFIJO_FOTO_CARTA)) {
    const p = o.foto.slice(PREFIJO_FOTO_CARTA.length);
    if (RE_ID_PLATO.test(p)) platoId = p;
  }
  if (o.piezaId !== undefined && o.piezaId !== null && !esUuid(o.piezaId)) return { ok: false, error: "piezaId no válido" };
  const textos: Partial<Record<CampoRotulo, string>> = {};
  if (o.textos !== undefined && o.textos !== null) {
    if (typeof o.textos !== "object" || Array.isArray(o.textos)) return { ok: false, error: "textos debe ser un objeto" };
    for (const c of CAMPOS_ROTULO) {
      const t = cadena((o.textos as Record<string, unknown>)[c], MAX_TEXTO_PIEZA);
      if (t) textos[c] = anonimizar(t);
    }
  }
  return {
    ok: true,
    entrada: {
      accion: o.accion,
      marca: o.marca,
      formato,
      plantilla: plantilla.id,
      tono: tono as Tono,
      indicaciones: anonimizar(cadena(o.indicaciones, MAX_INDICACIONES) ?? ""),
      platoId,
      piezaId: (o.piezaId as string | undefined) ?? null,
      textos,
      incluirPrecio: o.incluirPrecio === true && o.accion === "sugerir_texto",
    },
  };
}

// ── Supabase (con el JWT del usuario) ───────────────────────────────────────

class ErrorBD extends Error {
  constructor(mensaje: string, readonly estado: 502 | 503) {
    super(mensaje);
  }
}

function cab(s: Sesion, extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: s.sb.clave, Authorization: `Bearer ${s.token}`, Accept: "application/json", ...extra };
}

async function textoError(r: Response): Promise<string> {
  return sanear(await r.text().catch(() => "")).slice(0, 300);
}

/** 404/42P01/PGRST205: la tabla no existe (migración sin aplicar). */
function faltaTabla(estado: number, texto: string): boolean {
  return estado === 404 || /42P01|PGRST20[0-9]|does not exist|Could not find the table/i.test(texto);
}

const MIGRACION = "20261108000000_instagram_ia.sql";

export async function contarHoy(s: Sesion, ahora: Date): Promise<number> {
  const inicio = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate())).toISOString();
  const url = `${s.sb.url}/rest/v1/instagram_sugerencias_ia?select=id&creado_por=eq.${encodeURIComponent(s.usuario)}&created_at=gte.${encodeURIComponent(inicio)}`;
  const r = await s.fetch(url, { method: "HEAD", headers: cab(s, { Prefer: "count=exact", Range: "0-0" }), signal: AbortSignal.timeout(MS_SUPABASE) });
  if (!r.ok && r.status !== 206) {
    const t = await textoError(r);
    if (faltaTabla(r.status, t)) throw new ErrorBD(`Falta aplicar la migración ${MIGRACION} en este Supabase.`, 503);
    throw new ErrorBD(`No se pudo comprobar el cupo diario (${r.status})`, 502);
  }
  const total = /\/(\d+)$/.exec(r.headers.get("content-range") ?? "")?.[1];
  return total ? Number(total) : 0;
}

interface Guia {
  version: number;
  guia: string;
  hashtags_base: string[];
  ctas: string[];
}

export async function leerGuia(s: Sesion, marca: MarcaIA): Promise<Guia> {
  const r = await s.fetch(
    `${s.sb.url}/rest/v1/instagram_guias_marca?marca=eq.${encodeURIComponent(marca)}&select=version,guia,hashtags_base,ctas`,
    { headers: cab(s), signal: AbortSignal.timeout(MS_SUPABASE) },
  );
  if (!r.ok) {
    const t = await textoError(r);
    if (faltaTabla(r.status, t)) throw new ErrorBD(`Falta aplicar la migración ${MIGRACION} en este Supabase.`, 503);
    throw new ErrorBD(`No se pudo leer la guía de la marca (${r.status})`, 502);
  }
  const filas = (await r.json().catch(() => [])) as Guia[];
  const g = Array.isArray(filas) ? filas[0] : null;
  if (!g?.guia) throw new ErrorBD(`No hay guía de tono para «${marca}» (instagram_guias_marca).`, 503);
  return {
    version: Number(g.version) || 1,
    guia: String(g.guia),
    hashtags_base: Array.isArray(g.hashtags_base) ? g.hashtags_base.map(String) : [],
    ctas: Array.isArray(g.ctas) ? g.ctas.map(String) : [],
  };
}

const COLUMNA_MARCA: Record<MarcaIA, string> = { "casa-tomas": "restaurante", touza: "touza" };

interface FilaPlato extends PlatoContexto {
  activado: boolean | null;
  restaurante: boolean | null;
  touza: boolean | null;
}

export async function leerPlato(s: Sesion, id: string): Promise<FilaPlato | null> {
  const r = await s.fetch(
    `${s.sb.url}/rest/v1/Platos?id=eq.${encodeURIComponent(id)}&select=id,nombre,descripcion,categoria,precio_eur,unidad,alergenos_oficiales,sin_gluten_disponible,activado,restaurante,touza`,
    { headers: cab(s), signal: AbortSignal.timeout(MS_SUPABASE) },
  );
  if (!r.ok) throw new ErrorBD(`No se pudo leer el plato (${r.status})`, 502);
  const filas = (await r.json().catch(() => [])) as FilaPlato[];
  return Array.isArray(filas) && filas[0] ? filas[0] : null;
}

export async function leerNombresCarta(s: Sesion, marca: MarcaIA): Promise<string[]> {
  const r = await s.fetch(
    `${s.sb.url}/rest/v1/Platos?select=nombre&activado=is.true&${COLUMNA_MARCA[marca]}=is.true&order=nombre&limit=500`,
    { headers: cab(s), signal: AbortSignal.timeout(MS_SUPABASE) },
  );
  if (!r.ok) throw new ErrorBD(`No se pudo leer la carta para validar (${r.status})`, 502);
  const filas = (await r.json().catch(() => [])) as Array<{ nombre: string | null }>;
  return (Array.isArray(filas) ? filas : []).map((f) => (f.nombre ?? "").trim()).filter(Boolean);
}

/** Guarda la sugerencia (RLS de marketing). Nunca lanza: devuelve el id o null. */
export async function guardarSugerencia(s: Sesion, fila: Record<string, unknown>): Promise<string | null> {
  try {
    const r = await s.fetch(`${s.sb.url}/rest/v1/instagram_sugerencias_ia?select=id`, {
      method: "POST",
      headers: cab(s, { "Content-Type": "application/json", Prefer: "return=representation" }),
      body: JSON.stringify(fila),
      signal: AbortSignal.timeout(MS_SUPABASE),
    });
    if (!r.ok) {
      registro("error", FUNCION, `no se pudo guardar la sugerencia (${r.status}): ${await textoError(r)}`);
      return null;
    }
    const filas = (await r.json().catch(() => [])) as Array<{ id?: string }>;
    return filas?.[0]?.id ?? null;
  } catch (e) {
    registro("error", FUNCION, "no se pudo guardar la sugerencia", e);
    return null;
  }
}

// ── OpenAI ──────────────────────────────────────────────────────────────────

class ErrorOpenAI extends Error {}

type Mensaje = { role: "system" | "user" | "assistant"; content: string };

async function pedirModelo(
  f: typeof fetch,
  clave: string,
  modelo: string,
  mensajes: Mensaje[],
  esquema: typeof ESQUEMA_TEXTO | typeof ESQUEMA_ROTULOS,
  uso: AcumuladorUso,
): Promise<{ variantes: unknown[]; bruto: string }> {
  let res: Response;
  try {
    res = await f(`${OPENAI}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${clave}` },
      body: JSON.stringify({
        model: modelo,
        messages: mensajes,
        response_format: { type: "json_schema", json_schema: esquema },
        // Igual que chat-web (gpt-5.6-luna): sin razonamiento, temperatura
        // permitida solo con "none" y max_completion_tokens (no max_tokens).
        reasoning_effort: "none",
        temperature: 0.8,
        max_completion_tokens: 2000,
        // Agrupa el caché del prefijo estático (prompt de sistema) por marca y acción.
        prompt_cache_key: `${FUNCION}-${esquema.name}`,
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
  const j = (await res.json().catch(() => null)) as
    | { usage?: unknown; choices?: Array<{ message?: { content?: unknown; refusal?: unknown } }> }
    | null;
  uso.sumar((j?.usage ?? undefined) as Parameters<AcumuladorUso["sumar"]>[0]);
  const msg = j?.choices?.[0]?.message;
  if (typeof msg?.refusal === "string" && msg.refusal) throw new ErrorOpenAI("El modelo se ha negado a proponer este texto.");
  if (typeof msg?.content !== "string") throw new ErrorOpenAI("OpenAI respondió sin contenido.");
  try {
    const datos = JSON.parse(msg.content) as { variantes?: unknown };
    return { variantes: Array.isArray(datos?.variantes) ? datos.variantes : [], bruto: msg.content };
  } catch {
    throw new ErrorOpenAI("OpenAI respondió con un JSON que no se puede leer.");
  }
}

// ── Manejador ───────────────────────────────────────────────────────────────

function platoParaModelo(p: PlatoContexto | null): Record<string, unknown> | null {
  if (!p) return null;
  return {
    nombre: p.nombre,
    categoria: p.categoria,
    descripcion: (p.descripcion ?? "").slice(0, 400) || null,
    alergenos_oficiales: parseAlergenosOficiales(p.alergenos_oficiales) ?? "sin dato oficial: no afirmes nada de alérgenos",
    sin_gluten_disponible: p.sin_gluten_disponible === true,
  };
}

export async function manejarIA(request: Request, deps: DependenciasIA = {}): Promise<Response> {
  if (request.method === "OPTIONS") return opciones();
  if (request.method !== "POST") return json(405, { ok: false, error: "Método no permitido" });
  const env = deps.env ?? entornoIA();
  const f = deps.fetch ?? fetch;
  const auth = await autorizarMarketing(request.headers.get("authorization"), { env, fetch: f });
  if (!auth.ok) return jsonAuth(auth.estado, auth.motivo);
  const s = auth.sesion;

  const cuerpo = await leerJson(request, 32 * 1024);
  if (!cuerpo.ok) return json(cuerpo.estado, { ok: false, error: cuerpo.error });
  const v = validarEntrada(cuerpo.valor);
  if (!v.ok) return json(400, { ok: false, error: v.error });
  const e = v.entrada;
  const plantilla = plantillaIA(e.plantilla)!;

  const clave = claveOpenAI("otros", (n) => env[n]);
  if (!clave) {
    return json(503, {
      ok: false,
      error: "Falta la clave de OpenAI en los secretos de Supabase (OPENAI_API_KEY), la misma que usan las otras funciones de IA.",
    });
  }
  registrarSecreto(clave);
  const modelo = (env.INSTAGRAM_IA_MODEL ?? "").trim() || MODELO_POR_DEFECTO;
  const cupo = Number(env.INSTAGRAM_IA_CUPO_DIARIO) > 0 ? Math.floor(Number(env.INSTAGRAM_IA_CUPO_DIARIO)) : CUPO_DIARIO_POR_DEFECTO;
  const ahora = deps.ahora?.() ?? new Date();

  // Contexto de la base de datos (antes de gastar nada en OpenAI).
  const avisos: string[] = [];
  let guia: Guia;
  let plato: PlatoContexto | null = null;
  let nombresCarta: string[];
  try {
    const usadas = await contarHoy(s, ahora);
    if (usadas >= cupo) {
      return json(429, { ok: false, error: `Has llegado al tope de ${cupo} sugerencias de IA por día. Vuelve a probar mañana.` });
    }
    const [g, fila, carta] = await Promise.all([
      leerGuia(s, e.marca),
      e.platoId ? leerPlato(s, e.platoId) : Promise.resolve(null),
      leerNombresCarta(s, e.marca),
    ]);
    guia = g;
    nombresCarta = carta;
    if (e.platoId) {
      if (!fila) avisos.push("El plato de la foto ya no está en la carta: el texto no lo nombra.");
      else if (fila.activado !== true) avisos.push(`«${fila.nombre}» no está activo en la carta: el texto no lo nombra.`);
      else if (fila[COLUMNA_MARCA[e.marca] as "restaurante" | "touza"] !== true) avisos.push(`«${fila.nombre}» no es de la carta de esta marca: el texto no lo nombra.`);
      else plato = fila;
    }
  } catch (err) {
    if (err instanceof ErrorBD) return json(err.estado, { ok: false, error: err.message });
    registro("error", FUNCION, "contexto", err);
    return json(502, { ok: false, error: "No se pudo leer el contexto de la base de datos" });
  }

  const ctx: ContextoValidacion = { marca: e.marca, plato, nombresCarta, ctas: guia.ctas, cuentasPropias: CUENTAS_PROPIAS };
  const datos: DatosPrompt = {
    marca: e.marca,
    formato: e.formato,
    plantilla: e.plantilla,
    tono: e.tono,
    guia: { version: guia.version, texto: guia.guia, hashtags_base: guia.hashtags_base, ctas: guia.ctas },
    plato: platoParaModelo(plato),
    carta: nombresCarta.slice(0, 300),
    textos_pieza: e.textos,
    indicaciones: e.indicaciones,
  };
  const esTexto = e.accion === "sugerir_texto";
  const mensajes: Mensaje[] = [
    { role: "system", content: esTexto ? promptSistemaTexto(e.marca) : promptSistemaRotulos(e.marca, plantilla) },
    { role: "user", content: mensajeUsuario(datos) },
  ];
  const esquema = esTexto ? ESQUEMA_TEXTO : ESQUEMA_ROTULOS;

  const uso = new AcumuladorUso(FUNCION, modelo, "chat");
  const inicioMs = Date.now();
  const registrar = deps.registrar ?? registrarUso;
  try {
    let buenas: Array<Revision<unknown>> = [];
    const descartadas: Array<{ motivos: string[] }> = [];
    for (let intento = 0; intento < MAX_INTENTOS && buenas.length === 0; intento++) {
      const { variantes, bruto } = await pedirModelo(f, clave, modelo, mensajes, esquema, uso);
      const revisadas = variantes
        .slice(0, VARIANTES)
        .map((x) => (esTexto ? revisarVarianteTexto(x, ctx) : revisarRotulos(x, plantilla, ctx)) as Revision<unknown>);
      buenas = revisadas.filter((r) => r.ok);
      const malas = revisadas.filter((r) => !r.ok);
      descartadas.push(...malas.map((r) => ({ motivos: r.errores })));
      if (!buenas.length && intento + 1 < MAX_INTENTOS) {
        mensajes.push({ role: "assistant", content: bruto });
        mensajes.push({ role: "user", content: mensajeReintento(malas.flatMap((r) => r.errores)) });
      }
    }

    let variantes = buenas.map((r) => ({ ...(r.valor as Record<string, unknown>), avisos: r.correcciones }));
    if (esTexto && e.incluirPrecio) {
      if (!plato || plato.precio_eur === null || plato.precio_eur === undefined) {
        avisos.push("No se ha añadido el precio: el plato no tiene precio en la carta.");
      } else {
        const linea = `${plato.nombre}: ${formatearPrecio(Number(plato.precio_eur))}${plato.unidad ? ` / ${plato.unidad}` : ""}`;
        variantes = variantes.map((x) => {
          const vt = x as unknown as { caption: string; hashtags: string[]; avisos: string[] };
          const caption = `${vt.caption}\n\n${linea}`;
          if (!validarCaption(`${caption}\n\n${vt.hashtags.join(" ")}`).ok) {
            return { ...x, avisos: [...vt.avisos, "No cabe el precio sin pasarse del límite de Instagram."] };
          }
          return { ...x, caption, avisos: [...vt.avisos, "Precio añadido desde la carta."] };
        });
      }
    }
    if (e.formato === "story" && esTexto) avisos.push("Las stories no llevan texto por la API: el texto sirve para el texto alternativo o para copiarlo a mano.");

    const entrada = {
      accion: e.accion,
      marca: e.marca,
      formato: e.formato,
      plantilla: e.plantilla,
      tono: e.tono,
      platoId: e.platoId,
      piezaId: e.piezaId,
      incluirPrecio: e.incluirPrecio,
      indicaciones: e.indicaciones,
      textos: e.textos,
    };
    const sugerenciaId = await guardarSugerencia(s, {
      tipo: e.accion,
      marca: e.marca,
      pieza_id: e.piezaId,
      entrada,
      salida: { variantes, descartadas, avisos },
      modelo,
      version_guia: guia.version,
      variantes: variantes.length,
      descartadas: Math.min(descartadas.length, 10),
      tokens_entrada: uso.prompt,
      tokens_salida: uso.completion,
    });

    const platoRespuesta = plato ? { id: plato.id, nombre: plato.nombre } : null;
    if (!variantes.length) {
      return json(422, {
        ok: false,
        error: "Ninguna propuesta ha pasado las comprobaciones (precios, alérgenos, platos, datos personales…). Prueba otra vez o cambia las indicaciones.",
        accion: e.accion,
        sugerenciaId,
        descartadas,
        avisos,
      });
    }
    return json(200, {
      ok: true,
      accion: e.accion,
      sugerenciaId,
      modelo,
      versionGuia: guia.version,
      plato: platoRespuesta,
      variantes,
      descartadas,
      avisos,
    });
  } catch (err) {
    uso.marcarError();
    if (err instanceof ErrorOpenAI) return json(502, { ok: false, error: err.message });
    registro("error", FUNCION, "fallo", err);
    return json(500, { ok: false, error: "No se pudo generar la propuesta" });
  } finally {
    await registrar(uso, {
      disparador: e.piezaId ? `pieza:${e.piezaId}` : `usuario:${s.usuario}`,
      duracionMs: Date.now() - inicioMs,
    });
  }
}
