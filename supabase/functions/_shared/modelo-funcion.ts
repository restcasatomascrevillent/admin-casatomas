// ============================================================================
//  Modelo de IA por función, centralizado (07-nov-2026)
// ----------------------------------------------------------------------------
//  Tabla `ia_modelo_funcion` (migración 20261107500000_ia_modelos_centro):
//  funcion → modelo elegido (NULL = el del código) y modelo de respaldo. La
//  edita un super admin en Super Admin › Servicios › Modelos.
//
//    const modelo = await modeloDeFuncion("chat-facturas", modeloDelSecretoODefecto, { cliente });
//
//  Reglas:
//    · La tabla MANDA sobre el secreto. Si no hay fila, o el modelo es NULL, se
//      usa `porDefecto` (lo que la función ya hacía: secreto o valor fijo), así
//      que con la tabla vacía nada cambia.
//    · Caché en memoria de 60 s por función (cada instancia de la Edge
//      Function), para no leer la base de datos en cada petición.
//    · NUNCA rompe la función: cualquier error (sin cliente, tabla que no
//      existe, red, timeout de 1,5 s) devuelve `porDefecto`. Un fallo no se
//      cachea más de 10 s, para recuperarse pronto.
//    · Sin Deno ni imports remotos: el cliente se inyecta (tests con vitest).
// ============================================================================

export interface ModeloElegido {
  modelo: string;
  respaldo: string | null;
  /** "tabla" = viene de ia_modelo_funcion; "defecto" = el del código/secreto. */
  origen: "tabla" | "defecto";
}

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ClienteSupabase = { from: (tabla: string) => any };

export interface OpcionesModelo {
  cliente?: ClienteSupabase | null;
  /** Milisegundos de caché de una lectura buena (60 s por defecto). */
  ttlMs?: number;
  /** Reloj inyectable (tests). */
  ahora?: () => number;
  timeoutMs?: number;
}

const NOMBRE_MODELO = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/;
const TTL_POR_DEFECTO = 60_000;
const TTL_FALLO = 10_000;

type Entrada = { hasta: number; modelo: string | null; respaldo: string | null };
const cache = new Map<string, Entrada>();

/** Solo para tests. */
export function vaciarCacheModelos(): void {
  cache.clear();
}

export function esNombreDeModelo(v: unknown): v is string {
  return typeof v === "string" && NOMBRE_MODELO.test(v.trim());
}

async function leerFila(cliente: ClienteSupabase, funcion: string, timeoutMs: number) {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new Error("timeout leyendo ia_modelo_funcion")), timeoutMs);
  });
  try {
    const consulta = cliente.from("ia_modelo_funcion").select("modelo, modelo_respaldo").eq("funcion", funcion).maybeSingle();
    const { data, error } = await Promise.race([consulta, limite]);
    if (error) throw new Error(error.message ?? "error leyendo ia_modelo_funcion");
    return data as { modelo?: string | null; modelo_respaldo?: string | null } | null;
  } finally {
    if (temporizador) clearTimeout(temporizador);
  }
}

/** Modelo y respaldo de una función (ver cabecera). Nunca lanza. */
export async function configModeloFuncion(funcion: string, porDefecto: string, opciones: OpcionesModelo = {}): Promise<ModeloElegido> {
  const ahora = (opciones.ahora ?? Date.now)();
  const deDefecto: ModeloElegido = { modelo: porDefecto, respaldo: null, origen: "defecto" };
  const aplicar = (e: Entrada): ModeloElegido =>
    e.modelo ? { modelo: e.modelo, respaldo: e.respaldo, origen: "tabla" } : { ...deDefecto, respaldo: e.respaldo };

  const enCache = cache.get(funcion);
  if (enCache && enCache.hasta > ahora) return aplicar(enCache);

  if (!opciones.cliente) return deDefecto;
  try {
    const fila = await leerFila(opciones.cliente, funcion, opciones.timeoutMs ?? 1500);
    const modelo = esNombreDeModelo(fila?.modelo) ? fila!.modelo!.trim() : null;
    const respaldo = esNombreDeModelo(fila?.modelo_respaldo) ? fila!.modelo_respaldo!.trim() : null;
    const entrada = { hasta: ahora + (opciones.ttlMs ?? TTL_POR_DEFECTO), modelo, respaldo };
    cache.set(funcion, entrada);
    return aplicar(entrada);
  } catch (e) {
    console.error(`[modelo-funcion] ${funcion}: no se pudo leer ia_modelo_funcion, se usa ${porDefecto}:`, (e as Error)?.message ?? e);
    // Si había una lectura buena (caducada), se sigue usando; si no, el defecto.
    const previa = enCache ?? { modelo: null, respaldo: null, hasta: 0 };
    cache.set(funcion, { ...previa, hasta: ahora + TTL_FALLO });
    return aplicar(previa);
  }
}

/** Atajo: solo el nombre del modelo. */
export async function modeloDeFuncion(funcion: string, porDefecto: string, opciones: OpcionesModelo = {}): Promise<string> {
  return (await configModeloFuncion(funcion, porDefecto, opciones)).modelo;
}

// ─── Parámetros según la familia del modelo ─────────────────────────────────

/** Modelos de razonamiento (gpt-5*, gpt-6*, o1/o3/o4…): sin temperature ni max_tokens. */
export function esModeloRazonamiento(modelo: string): boolean {
  return /^(gpt-5|gpt-6|o\d)/i.test(modelo.trim());
}

/**
 * Parámetros de chat/completions: los de razonamiento llevan
 * max_completion_tokens (que incluye el razonamiento, por eso más margen) y
 * NO temperature; el resto, temperature + max_tokens.
 */
export function parametrosChat(modelo: string, maxTokens: number, temperatura = 0.2): Record<string, unknown> {
  // GPT-6: las herramientas por Chat Completions exigen reasoning_effort "none".
  if (/^gpt-6/i.test(modelo.trim())) return { reasoning_effort: "none", max_completion_tokens: Math.max(maxTokens * 5, 4000) };
  if (esModeloRazonamiento(modelo)) return { max_completion_tokens: Math.max(maxTokens * 5, 4000) };
  return { temperature: temperatura, max_tokens: maxTokens };
}

/**
 * ¿El error de OpenAI es por el MODELO (no existe, retirado, sin acceso)? Solo
 * entonces tiene sentido reintentar con el modelo de respaldo.
 */
export function esErrorDeModelo(status: number, cuerpo: unknown): boolean {
  if (status !== 400 && status !== 403 && status !== 404) return false;
  const texto = typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo ?? "");
  return /model_not_found|does not exist|do not have access to (the )?model|invalid model|unsupported model|model .*deprecated/i.test(texto);
}
