// ===========================================================================
// Contabilidad de consumo de IA — modulo comun a todas las Edge Functions
// ===========================================================================
//
// Escrito 2026-09-28. Va con la migracion 20260928193000_costes_sistema.sql
// (tabla `ia_uso` + RPC `ia_registrar_uso`), que TODAVIA NO ESTA APLICADA. Si
// se despliega una funcion que use esto antes de aplicar la migracion, la RPC
// no existe, el registro falla y —por diseño— NO PASA NADA: la funcion sigue
// respondiendo igual y solo queda un console.error. Ver "La regla" abajo.
//
// ---------------------------------------------------------------------------
// LA REGLA, QUE ES LA UNICA COSA IMPORTANTE DE ESTE FICHERO
// ---------------------------------------------------------------------------
//
//   REGISTRAR NUNCA PUEDE ROMPER LA FUNCION.
//
//   Contabilizar un gasto es infinitamente menos importante que leer la
//   factura del proveedor o contestar al cliente. Por eso:
//
//     * `AcumuladorUso.sumar()` no puede lanzar: lee el `usage` a la
//       defensiva y lo que no entienda lo cuenta como 0.
//     * `registrarUso()` envuelve TODO en try/catch, incluido el createClient
//       (que lanza si faltan las variables de entorno) y el JSON.
//     * `registrarUso()` NO devuelve promesa rechazada nunca. Su firma es
//       `Promise<void>` y siempre resuelve.
//     * Aun asi, la llamada va en un `finally`, no en el camino feliz: asi
//       tambien se registra el gasto de una peticion que acabo en error. Una
//       llamada que fallo DESPUES de que OpenAI haya facturado los tokens se
//       paga igual, y esa es justo la que hay que ver en la pantalla.
//
//   Esto es lo contrario de lo que hace chat-web con `chat_web_reservar_cupo`,
//   que es FAIL-CLOSED (si no puede reservar, devuelve 503 y no llama a
//   OpenAI). Ahi la fila defiende un tope de abuso, asi que perderla es un
//   agujero. Aqui la fila solo cuenta dinero: perderla es perder un dato.
//
// ---------------------------------------------------------------------------
// EL DETALLE QUE SE PRESTA A DOBLE CONTEO
// ---------------------------------------------------------------------------
//
//   `completion_tokens_details.reasoning_tokens` es un SUBCONJUNTO de
//   `completion_tokens`, no un tercer cubo. completion = texto util + razon.
//   Este modulo los guarda SEPARADOS para poder ver el reparto, pero el coste
//   lo calcula `ia_registrar_uso` cobrando SOLO `completion_tokens` a tarifa
//   de output. Si algun dia alguien suma el razonamiento aparte, el coste se
//   infla en silencio. La tabla tiene un CHECK que lo impide.
//
//   Por que importa: medido el 2026-09-28, gpt-5-mini gasta 3.060 tokens de
//   salida leyendo una factura y gpt-5.4-mini gasta 598, con la misma tarifa.
//   Sin el desglose, la fila solo dice "3.060" y no se ve de donde sale el
//   dinero.
//
// ---------------------------------------------------------------------------
// COMO SE USA (patron de chat-web: acumular en el loop, volcar en el finally)
// ---------------------------------------------------------------------------
//
//   import { AcumuladorUso, registrarUso } from "../_shared/registrar-uso-ia.ts";
//
//   const uso = new AcumuladorUso("procesar-factura", "gpt-5-mini", "vision");
//   const t0 = Date.now();
//   try {
//     const res  = await fetch(`${OPENAI}/chat/completions`, { ... });
//     const json = await res.json();
//     uso.sumar(json.usage);             // <- una vez por llamada
//     ...
//     return json({ success: true, ... });
//   } catch (e) {
//     uso.marcarError();
//     throw e;
//   } finally {
//     await registrarUso(uso, { disparador: `factura:${id}`, duracionMs: Date.now() - t0 });
//   }
//
//   Si la funcion usa DOS modelos (chat + embeddings), se hacen DOS
//   acumuladores y se registran los dos: el coste por modelo es justamente lo
//   que la pantalla desglosa.
//
// ---------------------------------------------------------------------------
// QUE NO GUARDA
// ---------------------------------------------------------------------------
//
//   Ni el prompt, ni la respuesta, ni el contenido de la factura, ni la IP, ni
//   el email. Solo recuentos. `disparador` es texto corto para poder rastrear
//   un pico hasta su origen (`factura:<uuid>`, `usuario:<uuid>`, `cron`) y se
//   recorta a 200 caracteres en la propia RPC. NO METER AHI datos personales
//   ni texto del usuario.
//
// ===========================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

/** Tipo de llamada. Debe coincidir con el CHECK de `ia_uso.operacion`. */
export type OperacionIa = "chat" | "embedding" | "vision" | "otro";

/**
 * Forma del `usage` que devuelven las APIs. Se aceptan los tres dialectos
 * porque el proyecto mezcla los tres y nadie se acuerda de cual es cual:
 *
 *   Chat Completions : prompt_tokens / completion_tokens
 *                      prompt_tokens_details.cached_tokens
 *                      completion_tokens_details.reasoning_tokens
 *   Responses        : input_tokens / output_tokens
 *                      input_tokens_details.cached_tokens / .cache_write_tokens
 *                      output_tokens_details.reasoning_tokens
 *   Embeddings       : prompt_tokens / total_tokens (sin completion)
 *
 * Todo opcional: si viene algo que no encaja, se cuenta 0 y se sigue.
 */
export interface UsageBruto {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  input_tokens?: unknown;
  output_tokens?: unknown;
  prompt_tokens_details?: { cached_tokens?: unknown; cache_write_tokens?: unknown } | null;
  input_tokens_details?: { cached_tokens?: unknown; cache_write_tokens?: unknown } | null;
  completion_tokens_details?: { reasoning_tokens?: unknown } | null;
  output_tokens_details?: { reasoning_tokens?: unknown } | null;
}

/** Entero >= 0 a partir de cualquier cosa. Nunca lanza, nunca NaN. */
const ent = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/**
 * Acumula el consumo de una o varias llamadas al MISMO modelo dentro de una
 * misma peticion. Un acumulador por (funcion, modelo, operacion).
 *
 * Todos los metodos son a prueba de basura: ninguno lanza.
 */
export class AcumuladorUso {
  readonly funcion: string;
  readonly modelo: string;
  readonly operacion: OperacionIa;

  prompt = 0;
  cached = 0;
  cacheWrite = 0;
  completion = 0;
  razonamiento = 0;
  llamadas = 0;
  estado: "ok" | "error" = "ok";

  constructor(funcion: string, modelo: string, operacion: OperacionIa = "chat") {
    this.funcion = funcion;
    this.modelo = modelo;
    this.operacion = operacion;
  }

  /**
   * Suma el `usage` de UNA llamada. Llamar siempre, incluso si `usage` viene
   * undefined: el contador de llamadas tiene que subir igual, porque la
   * llamada se ha hecho y OpenAI la ha facturado aunque no nos diga cuanto.
   */
  sumar(usage: UsageBruto | null | undefined): void {
    try {
      this.llamadas++;
      if (!usage || typeof usage !== "object") return;

      // Chat Completions usa prompt_/completion_; Responses usa input_/output_.
      const prompt = ent(usage.prompt_tokens) || ent(usage.input_tokens);
      const completion = ent(usage.completion_tokens) || ent(usage.output_tokens);

      const detPrompt = usage.prompt_tokens_details ?? usage.input_tokens_details ?? null;
      const detOut = usage.completion_tokens_details ?? usage.output_tokens_details ?? null;

      let cached = ent(detPrompt?.cached_tokens);
      let cacheWrite = ent(detPrompt?.cache_write_tokens);
      // El cache sale de dentro del prompt: si la suma se pasa (dialecto raro,
      // o un proxy que rellena mal), se recorta. Si no, la RPC lo recortaria
      // igual y el CHECK de la tabla saltaria: mejor no llegar ahi.
      if (cached + cacheWrite > prompt) {
        cached = Math.min(cached, prompt);
        cacheWrite = Math.min(cacheWrite, prompt - cached);
      }

      // Idem: el razonamiento sale de dentro de completion_tokens.
      const razon = Math.min(ent(detOut?.reasoning_tokens), completion);

      this.prompt += prompt;
      this.completion += completion;
      this.cached += cached;
      this.cacheWrite += cacheWrite;
      this.razonamiento += razon;
    } catch (_e) {
      // Contabilizar no puede romper nada. Ni un console.error: esto se llama
      // dentro del camino feliz y ensuciaria los logs de produccion por un
      // dato de coste.
    }
  }

  /** La peticion acabo mal. El gasto ya hecho se registra igual. */
  marcarError(): void {
    this.estado = "error";
  }

  /** true si no hubo ni una llamada: no hay nada que registrar. */
  get vacio(): boolean {
    return this.llamadas === 0;
  }
}

export interface OpcionesRegistro {
  /**
   * Que disparo la llamada. Texto CORTO y SIN datos personales:
   * `factura:<uuid>`, `usuario:<uuid>`, `plato:<id>`, `cron`, `bulk:carta`.
   */
  disparador?: string | null;
  duracionMs?: number | null;
  /**
   * Cliente ya creado, si la funcion tiene uno de service role a mano
   * (chat-facturas y chat-web lo tienen; format-novedad y
   * procesar-dibujo-perimetro no). Si no se pasa, se crea uno aqui.
   */
  cliente?: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: unknown }> } | null;
}

/**
 * Vuelca uno o varios acumuladores en `ia_uso`.
 *
 * NUNCA LANZA y NUNCA devuelve una promesa rechazada. Si algo va mal, escribe
 * un console.error con los tokens que se han perdido —para que el dato siga
 * estando en los logs de Supabase aunque no este en la tabla— y sale.
 *
 * Va en un `finally`. Ojo con una cosa: en Deno Deploy, un `await` dentro de
 * un finally SI se espera antes de cerrar la respuesta, asi que esto añade su
 * latencia (un INSERT, milisegundos) al tiempo de respuesta. Se acepta a
 * cambio de no perder filas. La alternativa (no esperar) pierde el registro
 * cuando el runtime congela el aislamiento al devolver la respuesta.
 */
export async function registrarUso(
  acumuladores: AcumuladorUso | AcumuladorUso[],
  opciones: OpcionesRegistro = {},
): Promise<void> {
  const lista = (Array.isArray(acumuladores) ? acumuladores : [acumuladores]).filter((a) => a && !a.vacio);
  if (lista.length === 0) return;

  try {
    let cliente = opciones.cliente ?? null;
    if (!cliente) {
      const url = Deno.env.get("SUPABASE_URL");
      const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!url || !key) {
        // Sin service role no se puede escribir: `ia_registrar_uso` solo tiene
        // EXECUTE para service_role, a proposito (que el navegador no pueda
        // inventarse gasto). Se loguea y se sale.
        console.error("[ia-uso] sin SUPABASE_URL / SERVICE_ROLE_KEY: no se registra el consumo", resumir(lista));
        return;
      }
      cliente = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }) as never;
    }

    for (const a of lista) {
      try {
        const { error } = await cliente!.rpc("ia_registrar_uso", {
          p_funcion: a.funcion,
          p_modelo: a.modelo,
          p_prompt_tokens: a.prompt,
          p_completion_tokens: a.completion,
          p_razonamiento_tokens: a.razonamiento,
          p_cached_tokens: a.cached,
          p_cache_write_tokens: a.cacheWrite,
          p_llamadas: a.llamadas,
          p_operacion: a.operacion,
          p_estado: a.estado,
          p_disparador: opciones.disparador ?? null,
          p_duracion_ms: opciones.duracionMs ?? null,
        });
        if (error) throw error;
      } catch (e) {
        // Un acumulador que falla no impide registrar los demas (una funcion
        // con chat + embeddings no debe perder los dos por culpa de uno).
        console.error("[ia-uso] no se pudo registrar", a.funcion, a.modelo, "·", resumirUno(a), ":", e);
      }
    }
  } catch (e) {
    console.error("[ia-uso] fallo al registrar el consumo:", e, resumir(lista));
  }
}

const resumirUno = (a: AcumuladorUso): string =>
  `llamadas:${a.llamadas} prompt:${a.prompt} completion:${a.completion} razonamiento:${a.razonamiento} estado:${a.estado}`;

const resumir = (lista: AcumuladorUso[]): string =>
  lista.map((a) => `${a.funcion}/${a.modelo}[${resumirUno(a)}]`).join(" ");
