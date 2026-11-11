// ============================================================================
//  chat-facturas · bucle de function-calling (07/11/2026)
// ----------------------------------------------------------------------------
//  Sacado de index.ts SIN cambiar su comportamiento para que lo usen dos
//  sitios con el MISMO código:
//    · chat-facturas/index.ts  (el copiloto del panel)
//    · ia-modelos-openai, acción «evaluar» (batería de preguntas por modelo,
//      docs/facturas/EVAL-MODELOS.md): lo que se evalúa es lo real.
//
//  Sin Deno ni imports remotos (los acumuladores de uso y el fetch se
//  inyectan), así que los tests de vitest lo ejecutan con un OpenAI de mentira.
//  Lo que hace cada pieza está explicado en los comentarios originales, que se
//  conservan aquí.
// ============================================================================
import type { AcumuladorUso, UsageBruto } from "../_shared/registrar-uso-ia.ts";
import { esErrorDeModelo } from "../_shared/modelo-funcion.ts";
import {
  type Adjunto,
  type DocRef,
  anotarRuta,
  idsDeFilas,
  unirReferencias,
  esErrorCorregible,
  hoyMadrid,
  marcarResultado,
  mesesIncompletosRecientes,
  parametrosModelo,
  pistaPregunta,
  textoAsociable,
  type Asociacion,
  type PalabraAsociada,
  necesitaRespaldoSemantico,
  prepararLlamada,
  recortar,
  separarAdjunto,
  systemPrompt,
  TOOLS,
} from "./herramientas.ts";

const OPENAI = "https://api.openai.com/v1";
export const MAX_PASOS = 6;
export const TIMEOUT_OPENAI_MS = 45_000;

// ── Techo de coste y de tiempo por peticion ──
//  Sin esto, un solo mensaje podia disparar 6 chat completions + una llamada de
//  embeddings por cada busqueda semantica de cada ronda (~21 llamadas de pago),
//  y 6 x 45 s de timeout POR LLAMADA superan el limite de la Edge Function: el
//  navegador se quedaba colgado en `functions.invoke` sin respuesta ni error.
export const PRESUPUESTO_MS = 110_000;        // deadline global de la peticion entera
export const MAX_TOOL_CALLS_POR_RONDA = 4;    // corta el fan-out que el prompt fomenta
export const MAX_TOKENS_RESPUESTA = 800;      // el prompt pide 6 lineas; 800 sobra

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any;
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mensaje = any;

/** Lo que se apunta de cada herramienta (auditoría del copiloto y traza de la evaluación). */
export interface HerramientaEjecutada {
  nombre: string;
  argumentos: unknown;
  resultado: "completada" | "fallida" | "no_ejecutada";
  duracion_ms: number;
}

/** Proveedores y productos que salieron en el resultado de una herramienta (para el hilo). */
export interface ResumenResultado { proveedores: string[]; productos: string[] }

/**
 * En la traza, además, el error que vio el modelo (recortado) y el resumen del
 * resultado. chat-facturas la devuelve al panel, que la guarda con la respuesta
 * (adjunto `contexto`) y con el 👍/👎 (chat_feedback.herramientas).
 */
export type HerramientaTrazada = HerramientaEjecutada & { error?: string; resumen?: ResumenResultado };

/** Traza opcional para la evaluación: cada llamada a chat/completions y cada herramienta. */
export interface Traza {
  llamadas: { modelo: string; usage: UsageBruto | null; ms: number }[];
  herramientas: HerramientaTrazada[];
}

/**
 * Acumuladores de consumo. Los crea quien llama (y los registra en ia_uso en su
 * `finally`): el bucle los rellena aunque acabe lanzando, porque OpenAI ya
 * facturó esos tokens. `usosChat` crece si se cambia al modelo de respaldo.
 */
export interface EstadoUso {
  usosChat: AcumuladorUso[];
  usoEmbed: AcumuladorUso;
  nuevoAcumuladorChat: (modelo: string) => AcumuladorUso;
}

export interface OpcionesBucle {
  supabase: Cliente;
  claveOpenAI: string;
  mensaje: string;
  /**
   * Turnos anteriores ya ordenados (antiguo → reciente). Las respuestas pueden
   * traer las herramientas que usaron (con su resumen): se reconstruyen como
   * tool_calls para que el seguimiento («Y de vaca») sepa de qué se hablaba.
   * Se recorta con recortarHistorial.
   */
  historial?: TurnoHistorial[];
  /**
   * prompt_cache_key de OpenAI: agrupa las peticiones que comparten prefijo
   * (las rondas de una misma conversación). Por defecto, "chat-facturas".
   */
  claveCache?: string;
  modelo: string;
  respaldo?: string | null;
  uso: EstadoUso;
  alEjecutarHerramienta?: (h: HerramientaEjecutada) => void;
  traza?: Traza;
  fetchImpl?: typeof fetch;
  /** Fecha de hoy del prompt (tests). */
  hoy?: string;
  presupuestoMs?: number;
  /**
   * SOLO la evaluación: parámetros que pisan los de parametrosModelo (p. ej.
   * reasoning_effort "low" para gpt-6.1-sol, que no admite "none"). El
   * copiloto no lo usa nunca.
   */
  parametrosExtra?: Record<string, unknown>;
}

export interface ResultadoBucle {
  respuesta: string;
  adjuntos: Adjunto[];
  modelo: string;
  huboFalloDeHerramienta: boolean;
}

/** Estado por peticion: deadline compartido y memo de embeddings. */
interface Ctx {
  deadline: number;
  embeddings: Map<string, string>;
  /**
   * Contabilidad de consumo (migracion 20260928193000). Dos acumuladores
   * porque son DOS modelos con tarifas muy distintas y la pantalla de costes
   * los desglosa por separado.
   */
  usoChat: AcumuladorUso;
  usoEmbed: AcumuladorUso;
  /** Mensaje del usuario: un conteo o «la ultima factura» no lleva avisos de importe (marcarResultado). */
  pregunta: string;
  clave: string;
  fetchImpl: typeof fetch;
}

// ─── Hilo de la conversación (11/11/2026) ────────────────────────────────────
//  Antes solo llegaba el TEXTO de los turnos anteriores: si la respuesta no
//  repetía el proveedor («la ternera te sale a 12,40 €/kg»), el seguimiento
//  «Y de vaca» perdía «de Embajadores». Ahora cada respuesta guarda qué
//  herramientas usó (nombre, argumentos y proveedores/productos del resultado)
//  y aquí se reconstruyen como tool_calls + resultado resumido.

/** Herramienta usada en un turno anterior (lo que guarda el panel en el adjunto `contexto`). */
export interface ContextoHerramienta {
  nombre: string;
  argumentos?: unknown;
  error?: string;
  resumen?: ResumenResultado;
}

export interface TurnoHistorial {
  role: "user" | "assistant";
  content: string;
  herramientas?: ContextoHerramienta[];
}

/** Últimos mensajes que llegan al modelo (5 preguntas con su respuesta). */
export const MAX_MENSAJES_HISTORIAL = 10;
/** Tope por turno: una tabla larga de hace tres preguntas no aporta al seguimiento. */
export const MAX_CHARS_TURNO = 2_000;
/** Tope del historial entero (se quitan los turnos más antiguos). */
export const MAX_CHARS_HISTORIAL = 10_000;
const MAX_HERRAMIENTAS_TURNO = 4;
const MAX_NOMBRES_RESUMEN = 6;

/** Fecha fuera del prefijo cacheable: el prompt de sistema dice dónde está. */
const FECHA_EN_AVISO = "la fecha del aviso FECHA, justo antes de la pregunta";
export const CLAVE_CACHE_POR_DEFECTO = "chat-facturas";

/**
 * Lo que queda del historial: los MAX_MENSAJES_HISTORIAL más recientes, cada
 * uno recortado a MAX_CHARS_TURNO, y sin pasar de MAX_CHARS_HISTORIAL en total
 * (se quitan los más antiguos). Empieza siempre por una pregunta del usuario.
 */
export function recortarHistorial(historial: TurnoHistorial[] | undefined): TurnoHistorial[] {
  const limpios = (historial ?? [])
    .filter((m) => m && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_MENSAJES_HISTORIAL)
    .map((m) => ({
      ...m,
      role: m.role === "user" ? "user" as const : "assistant" as const,
      content: m.content.length > MAX_CHARS_TURNO ? m.content.slice(0, MAX_CHARS_TURNO) + " […]" : m.content,
    }));
  const salida: TurnoHistorial[] = [];
  let total = 0;
  for (let i = limpios.length - 1; i >= 0; i--) {
    total += limpios[i].content.length;
    if (total > MAX_CHARS_HISTORIAL && salida.length > 0) break;
    salida.unshift(limpios[i]);
  }
  while (salida.length > 0 && salida[0].role !== "user") salida.shift();
  return salida;
}

const CLAVES_RESUMEN = /"(proveedor(?:_txt|_nombre)?|producto(?:_nombre)?|nombre_producto)"\s*:\s*"((?:[^"\\]|\\.){1,120})"/g;

/** Proveedores y productos que aparecen en el resultado (JSON, quizá recortado) de una herramienta. */
export function resumenDeResultado(contenido: string): ResumenResultado {
  const proveedores = new Set<string>();
  const productos = new Set<string>();
  for (const m of contenido.matchAll(CLAVES_RESUMEN)) {
    let valor = m[2];
    try { valor = JSON.parse(`"${m[2]}"`); } catch { /* se queda tal cual */ }
    valor = valor.trim();
    if (!valor) continue;
    const destino = m[1].startsWith("proveedor") ? proveedores : productos;
    if (destino.size < MAX_NOMBRES_RESUMEN) destino.add(valor);
  }
  return { proveedores: [...proveedores], productos: [...productos] };
}

/** Argumentos sin los null (strict los manda todos), para que el resumen sea corto. */
function argumentosUtiles(a: unknown): Record<string, unknown> {
  if (!a || typeof a !== "object" || Array.isArray(a)) return {};
  const salida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a as Record<string, unknown>)) {
    if (v === null || v === undefined || v === "") continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const dentro = argumentosUtiles(v);
      if (Object.keys(dentro).length > 0) salida[k] = dentro;
    } else salida[k] = v;
  }
  return salida;
}

/**
 * Mensajes de Chat Completions para el historial. Una respuesta con
 * herramientas se reconstruye como: assistant con tool_calls → un mensaje tool
 * por llamada con el resumen (proveedores/productos, nunca cifras: para cifras
 * hay que volver a consultar) → assistant con el texto de la respuesta.
 */
export function mensajesDeHistorial(historial: TurnoHistorial[]): Mensaje[] {
  const salida: Mensaje[] = [];
  historial.forEach((m, i) => {
    const hs = m.role === "assistant" ? (m.herramientas ?? []).filter((h) => h && typeof h.nombre === "string" && h.nombre).slice(0, MAX_HERRAMIENTAS_TURNO) : [];
    if (hs.length > 0) {
      const ids = hs.map((_, j) => `hist_${i}_${j}`);
      salida.push({
        role: "assistant",
        content: null,
        tool_calls: hs.map((h, j) => ({
          id: ids[j], type: "function",
          function: { name: h.nombre, arguments: JSON.stringify(argumentosUtiles(h.argumentos)) },
        })),
      });
      hs.forEach((h, j) => {
        salida.push({
          role: "tool",
          tool_call_id: ids[j],
          content: JSON.stringify({
            turno_anterior: true,
            ...(h.error ? { error: String(h.error).slice(0, 200) } : {}),
            ...(h.resumen?.proveedores?.length ? { proveedores: h.resumen.proveedores } : {}),
            ...(h.resumen?.productos?.length ? { productos: h.resumen.productos } : {}),
            nota: "Resumen de un turno anterior (sin cifras). Para dar cifras, vuelve a consultar.",
          }),
        });
      });
    }
    salida.push({ role: m.role, content: m.content });
  });
  return salida;
}

/** «Y de vaca», «¿y en cerveza?», «lo mismo de octubre»: la pregunta se apoya en la anterior. */
export function esSeguimiento(mensaje: string): boolean {
  const t = mensaje.trim().toLowerCase().replace(/^[¿¡]\s*/, "");
  if (/^(y|e|tambi[eé]n|lo mismo|igual|otra vez|compáralo|comparalo|hazme la comparativa)(\s|[?.!,]|$)/.test(t)) return true;
  return t.split(/\s+/).filter(Boolean).length <= 2;
}

/**
 * Aviso de hilo para un seguimiento: la pregunta anterior y lo que se consultó
 * (herramienta, argumentos, proveedores). null si no es seguimiento o no hay
 * turno anterior.
 */
export function pistaDelHilo(historial: TurnoHistorial[], mensaje: string): string | null {
  if (!esSeguimiento(mensaje)) return null;
  const previa = [...historial].reverse().find((m) => m.role === "user");
  if (!previa) return null;
  const respuesta = [...historial].reverse().find((m) => m.role === "assistant" && (m.herramientas?.length ?? 0) > 0);
  const consultas = (respuesta?.herramientas ?? []).slice(0, MAX_HERRAMIENTAS_TURNO).map((h) => {
    const prov = h.resumen?.proveedores?.length ? ` → proveedores: ${h.resumen.proveedores.join(", ")}` : "";
    return `${h.nombre} ${JSON.stringify(argumentosUtiles(h.argumentos))}${prov}`;
  });
  const pregunta = previa.content.length > 300 ? previa.content.slice(0, 300) + "…" : previa.content;
  return `HILO: «${mensaje.trim().slice(0, 200)}» sigue a la pregunta anterior «${pregunta}»` +
    (consultas.length > 0 ? `, que consultó: ${consultas.join("; ")}` : "") +
    ". Completa la pregunta con lo que no cambia (proveedor, periodo, tipo de dato) y consulta de nuevo con las herramientas.";
}

// ─── Utilidades ──────────────────────────────────────────────────────────────

/** fetch con timeout: evita que una llamada colgada agote el limite de la función. */
async function fetchConTimeout(f: typeof fetch, url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await f(url, { ...init, signal: ctrl.signal });
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
 * fan-out y era facil acabar pagando dos veces el mismo `embed("tomate")`.
 */
async function embedConsulta(consulta: string, ctx: Ctx): Promise<string> {
  const clave = consulta.toLowerCase().trim();
  const memo = ctx.embeddings.get(clave);
  if (memo) return memo;

  const res = await fetchConTimeout(ctx.fetchImpl, `${OPENAI}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.clave}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input: consulta }),
  }, msRestantes(ctx));
  if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}`);
  const json = await res.json();
  // Se contabiliza AQUI y no en el memo: una consulta repetida no vuelve a pagar.
  ctx.usoEmbed.sumar(json.usage);
  const vector = "[" + json.data[0].embedding.join(",") + "]";
  ctx.embeddings.set(clave, vector);
  return vector;
}

interface ResultadoTool { contenido: string; fallo: boolean; adjunto?: Adjunto | null; referencias?: DocRef[] }

/** Documentos (con enlace al original) para los ids dados. Best-effort: si falla, sin referencias. */
async function cargarReferencias(ids: number[], supabase: Cliente): Promise<DocRef[]> {
  if (ids.length === 0) return [];
  try {
    const { data, error } = await supabase
      .from("facturas")
      .select("id, tipo, numero_documento, proveedor, fecha, drive_url, archivo_path")
      .in("id", ids);
    if (error) throw error;
    // deno-lint-ignore no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((f: any) => ({
      id: f.id, tipo: f.tipo ?? null, numero: f.numero_documento ?? null, proveedor: f.proveedor ?? null,
      fecha: f.fecha ?? null, drive_url: f.drive_url ?? null, archivo_path: f.archivo_path ?? null,
    }));
  } catch (e) {
    console.warn("[chat-facturas] referencias no disponibles:", e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * variacion_precios no devuelve el id del documento (sin migracion): se
 * localiza con la misma regla de la RPC (ultima compra = producto + unidad +
 * fecha, el mayor factura_id) y se anade `numero` a cada fila para el modelo.
 * Si algo no cuadra, la fila queda sin referencia (nunca una inventada).
 */
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function referenciasVariacion(data: any, supabase: Cliente): Promise<DocRef[]> {
  if (!data || !Array.isArray(data.productos)) return [];
  try {
    // deno-lint-ignore no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filas: any[] = data.productos.slice(0, 10);
    const ids = await Promise.all(filas.map(async (p) => {
      if (!p.producto || !p.fecha) return null;
      const { data: prods } = await supabase.from("productos_catalogo").select("id").eq("nombre", p.producto).limit(3);
      let mejor: number | null = null;
      for (const pr of prods ?? []) {
        const { data: ls } = await supabase
          .rpc("lineas_precio_agente", { p_producto_id: pr.id, p_base: true })
          .eq("fecha", p.fecha).eq("unidad", p.unidad ?? "ud")
          .order("factura_id", { ascending: false }).limit(1);
        const f = ls?.[0]?.factura_id;
        if (Number.isInteger(f) && (mejor === null || f > mejor)) mejor = f;
      }
      return mejor;
    }));
    const refs = await cargarReferencias([...new Set(ids.filter((i): i is number => i !== null))], supabase);
    const porId = new Map(refs.map((r) => [r.id, r]));
    filas.forEach((p, i) => {
      const r = ids[i] !== null ? porId.get(ids[i] as number) : undefined;
      if (r) { p.documento_id = r.id; if (r.numero) p.numero = r.numero; }
    });
    return refs;
  } catch (e) {
    console.warn("[chat-facturas] referencias de variacion_precios fallidas:", e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * Ejecuta una herramienta. La traduccion a RPC y la validacion de argumentos
 * estan en herramientas.ts (TS puro, con tests); aqui solo va la red.
 *
 * buscar_productos prueba primero la busqueda EXACTA por palabras
 * (buscar_productos_texto_agente): si encuentra algo, no se paga la llamada
 * de embeddings. La semantica queda como respaldo.
 */
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ejecutarTool(nombre: string, args: any, supabase: Cliente, ctx: Ctx): Promise<ResultadoTool> {
  try {
    // Asociacion del texto (familia, producto, formato: 20261107100000). Si la
    // RPC falla (BD sin migrar) se sigue sin ella (lista corta de bebidas).
    let asoc: Asociacion | null = null;
    const txt = textoAsociable(nombre, args);
    if (txt) {
      const a = await supabase.rpc("asociar_termino_agente", { p_texto: txt });
      if (!a.error && a.data && typeof a.data === "object") asoc = a.data as Asociacion;
    }
    const ll = prepararLlamada(nombre, args, ctx.pregunta, asoc);
    let data: unknown;

    if (ll.tipo === "rpc") {
      const r = await supabase.rpc(ll.rpc, ll.params);
      if (r.error) throw r.error;
      data = r.data;
      // compras_producto: si el texto no casa con nada, UNA segunda llamada
      // con el embedding (solo sugerencias). Se paga solo en ese caso.
      // Es SOLO un extra de sugerencias: si falla (OpenAI, red, RPC) se queda el resultado
      // textual (sin datos) en vez de tumbar la respuesta con «problema tecnico».
      if (ll.respaldoSemantico && necesitaRespaldoSemantico(data)) {
        try {
          const embedding = await embedConsulta(ll.respaldoSemantico.consulta, ctx);
          const r2 = await supabase.rpc(ll.rpc, { ...ll.params, [ll.respaldoSemantico.param]: embedding });
          if (r2.error) throw r2.error;
          data = r2.data;
        } catch (e) {
          console.warn("[chat-facturas] respaldo semantico fallido:", e instanceof Error ? e.message : (e as { message?: string })?.message);
        }
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

    let referencias: DocRef[] = [];
    if (nombre === "variacion_precios") referencias = await referenciasVariacion(data, supabase);
    else if (nombre === "filtrar_documentos") referencias = await cargarReferencias(idsDeFilas(data), supabase);
    // Va en el resultado y no en el prompt de sistema (que viaja en cada ronda y tiene tope de tamaño).
    if (referencias.length > 0 && data && typeof data === "object" && !Array.isArray(data)) {
      (data as Record<string, unknown>).nota_referencias =
        "Cita de cada dato proveedor, numero y fecha. La app muestra debajo los enlaces a la foto del original: no escribas URLs ni digas que no puedes enseñarla.";
    }

    const { data: paraModelo, adjunto } = separarAdjunto(nombre, anotarRuta(ll, data));
    return {
      fallo: false,
      adjunto,
      referencias,
      contenido: recortar(
        JSON.stringify(marcarResultado(nombre, paraModelo, ll.limite, ctx.pregunta)),
        ll.tipo === "rpc" ? ll.maxChars : undefined,
      ),
    };
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

// ─── Bucle ───────────────────────────────────────────────────────────────────

/**
 * Una pregunta completa: prompt de sistema + historial + pista + bucle de
 * function-calling. Lanza en errores de OpenAI (el handler los traduce a un
 * mensaje para el usuario); el consumo queda en `opciones.uso` igualmente.
 */
export async function ejecutarConversacion(o: OpcionesBucle): Promise<ResultadoBucle> {
  const supabase = o.supabase;
  const f = o.fetchImpl ?? fetch;
  let modelo = o.modelo;
  const mensaje = o.mensaje;

  // ── Prompt caching (11/11/2026) ──
  //  OpenAI cachea el prefijo idéntico: herramientas + prompt de sistema van
  //  primero y SIN fecha (la fecha va en el aviso FECHA, al final, junto a la
  //  pista). Después, el historial, que también se repite entre las rondas
  //  del bucle y entre preguntas de la misma conversación.
  const messages: Mensaje[] = [{ role: "system", content: systemPrompt(FECHA_EN_AVISO) }];
  let historial = recortarHistorial(o.historial);
  // El panel guarda la pregunta antes de llamar: si ya viene al final del historial, no se repite.
  const ultimo = historial[historial.length - 1];
  if (ultimo && ultimo.role === "user" && ultimo.content === mensaje) historial = historial.slice(0, -1);
  messages.push(...mensajesDeHistorial(historial));
  messages.push({ role: "user", content: mensaje });

  // Aviso final (sistema, justo antes de la pregunta): fecha, hilo y pista.
  const aviso: string[] = [`FECHA: hoy es ${o.hoy ?? hoyMadrid()}.`];
  const hilo = pistaDelHilo(historial, String(mensaje));
  if (hilo) aviso.push(hilo);

  // ── Pista de la pregunta (20261107100000) ──
  //  Que es cada palabra en el catalogo («vino» = familia Vinos), el tema del
  //  turno anterior si esta no trae ninguno («hazme la comparativa») y los
  //  meses recientes incompletos. Va como sistema justo antes de la pregunta.
  //  Si falla, se sigue sin pista.
  try {
    const [actualR, incR] = await Promise.all([
      supabase.rpc("asociar_pregunta_agente", { p_texto: String(mensaje) }),
      supabase.rpc("meses_compras_incompletos", { p_local: null }),
    ]);
    const actual = (actualR.error ? null : actualR.data) as PalabraAsociada[] | null;
    let anterior: PalabraAsociada[] | null = null;
    if (!actual || actual.length === 0) {
      const previa = messages.slice(0, -1).reverse().find((m: Mensaje) => m.role === "user");
      if (previa?.content) {
        const r = await supabase.rpc("asociar_pregunta_agente", { p_texto: String(previa.content) });
        if (!r.error) anterior = r.data as PalabraAsociada[];
      }
    }
    const pista = pistaPregunta(actual, anterior, incR.error ? [] : mesesIncompletosRecientes(incR.data));
    if (pista) aviso.push(pista);
  } catch (e) {
    console.warn("[chat-facturas] pista de la pregunta fallida:", e instanceof Error ? e.message : e);
  }
  messages.splice(messages.length - 1, 0, { role: "system", content: aviso.join("\n") });

  // ── Bucle de function-calling ──
  //  Acotado por tres lados: MAX_PASOS rondas, MAX_TOOL_CALLS_POR_RONDA
  //  herramientas por ronda y un deadline global.
  const ctx: Ctx = {
    deadline: Date.now() + (o.presupuestoMs ?? PRESUPUESTO_MS),
    embeddings: new Map(),
    usoChat: o.uso.usosChat[o.uso.usosChat.length - 1],
    usoEmbed: o.uso.usoEmbed,
    pregunta: String(mensaje),
    clave: o.claveOpenAI,
    fetchImpl: f,
  };
  let respuesta = "";
  let huboFalloDeHerramienta = false;
  const adjuntos: Adjunto[] = [];
  const referenciasAcum: DocRef[][] = [];
  const apuntar = (h: HerramientaEjecutada, error?: string, resumen?: ResumenResultado) => {
    o.alEjecutarHerramienta?.(h);
    o.traza?.herramientas.push({
      ...h,
      ...(error ? { error: error.slice(0, 300) } : {}),
      ...(resumen && (resumen.proveedores.length || resumen.productos.length) ? { resumen } : {}),
    });
  };

  for (let paso = 0; paso < MAX_PASOS; paso++) {
    // Se retiran las herramientas en el ultimo paso —o si ya no queda tiempo
    // para ejecutar otra ronda— para forzar que el modelo redacte la respuesta
    // con lo que ya tiene en vez de morir sin contestar.
    const sinTiempo = ctx.deadline - Date.now() < TIMEOUT_OPENAI_MS;
    const esUltimo = paso === MAX_PASOS - 1 || sinTiempo;

    const t0 = Date.now();
    const res = await fetchConTimeout(f, `${OPENAI}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.clave}` },
      body: JSON.stringify({
        model: modelo,
        messages,
        prompt_cache_key: o.claveCache ?? CLAVE_CACHE_POR_DEFECTO,
        ...parametrosModelo(modelo, MAX_TOKENS_RESPUESTA),
        ...(o.parametrosExtra ?? {}),
        ...(esUltimo ? {} : { tools: TOOLS }),
      }),
    }, msRestantes(ctx));

    if (!res.ok) {
      const cuerpo = await res.text();
      if (paso === 0 && o.respaldo && o.respaldo !== modelo && esErrorDeModelo(res.status, cuerpo)) {
        console.warn(`[chat-facturas] ${modelo} rechazado (${res.status}); se usa el respaldo ${o.respaldo}`);
        ctx.usoChat.sumar(undefined);
        o.traza?.llamadas.push({ modelo, usage: null, ms: Date.now() - t0 });
        modelo = o.respaldo;
        ctx.usoChat = o.uso.nuevoAcumuladorChat(modelo);
        o.uso.usosChat.push(ctx.usoChat);
        paso--;
        continue;
      }
      throw new Error(`OpenAI chat ${res.status}: ${cuerpo}`);
    }
    const respuestaJson = await res.json();
    ctx.usoChat.sumar(respuestaJson.usage);
    o.traza?.llamadas.push({ modelo, usage: respuestaJson.usage ?? null, ms: Date.now() - t0 });
    const msg = respuestaJson.choices[0].message;
    messages.push(msg);

    if (!esUltimo && msg.tool_calls?.length > 0) {
      const atendidas = msg.tool_calls.slice(0, MAX_TOOL_CALLS_POR_RONDA);
      for (const tc of atendidas) {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* el modelo mando JSON invalido */ }
        const inicioTool = Date.now();
        const r = await ejecutarTool(tc.function.name, args, supabase, ctx);
        const textoError = (() => { try { const e = JSON.parse(r.contenido).error; return e ? String(e) : ""; } catch { return ""; } })();
        apuntar(
          { nombre: tc.function.name, argumentos: args, resultado: r.fallo || textoError ? "fallida" : "completada", duracion_ms: Date.now() - inicioTool },
          textoError || undefined,
          textoError ? undefined : resumenDeResultado(r.contenido),
        );
        if (r.fallo) huboFalloDeHerramienta = true;
        if (r.adjunto) adjuntos.push(r.adjunto);
        if (r.referencias?.length) referenciasAcum.push(r.referencias);
        messages.push({ role: "tool", tool_call_id: tc.id, content: r.contenido });
      }
      // La API exige una respuesta por cada tool_call emitida: las que se
      // descartan por el tope tienen que contestarse igualmente.
      for (const tc of msg.tool_calls.slice(MAX_TOOL_CALLS_POR_RONDA)) {
        apuntar({ nombre: tc.function?.name ?? "consulta", argumentos: {}, resultado: "no_ejecutada", duracion_ms: 0 });
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

  const refs = unirReferencias(referenciasAcum);
  if (refs.length > 0 && respuesta.trim()) adjuntos.push({ tipo: "documentos", datos: refs });

  return { respuesta, adjuntos, modelo, huboFalloDeHerramienta };
}
