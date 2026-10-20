// ============================================================================
//  Llamadas a OpenAI de procesar-factura / ocr-trabajo
// ----------------------------------------------------------------------------
//  Movido desde index.ts (04b, tarea B1) y parametrizado: NO lee Deno.env al
//  cargarse. Recibe { apiKey, config, fetch } para que el banco local de Node
//  y los tests usen el mismo código que se despliega.
//
//  Cada cliente lleva un acumulador de uso (tokens, coste estimado, llamadas)
//  que ocr-trabajo guarda por página.
// ============================================================================

import {
  DOCUMENTO_JSON_SCHEMA,
  RECUENTO_FILAS_SCHEMA,
  type RecuentoFilas,
  VERIFICACION_PIE_SCHEMA,
  type VerificacionPie,
} from "./esquema.ts";
import { type ConfigModelo, costeUsd } from "./modelo.ts";
import {
  CONTADOR_SYSTEM_PROMPT,
  PIE_SYSTEM_PROMPT,
  TEXTO_CONTADOR,
  TEXTO_PIE,
} from "./prompts.ts";

const OPENAI = "https://api.openai.com/v1";
const MODELO_EMBEDDINGS = "text-embedding-3-small";
/** USD por millón de tokens de entrada de text-embedding-3-small (misma tarifa que ia_precios). */
const PRECIO_EMBEDDINGS_USD_M = 0.02;

export interface UsoAcumulado {
  /** Llamadas de visión/texto (extracción, relectura, pie, contador). */
  llamadas: number;
  tokensEntrada: number;
  tokensSalida: number;
  /** Coste de las llamadas de visión/texto: es lo que se guarda por pieza en ocr_trabajos. */
  costeUsd: number;
  /** Embeddings, aparte para no cambiar lo que ya se guardaba por pieza (10-oct-2026). */
  llamadasEmbeddings: number;
  tokensEmbeddings: number;
  costeEmbeddingsUsd: number;
}

/** Coste y llamadas TOTALES de un cliente: visión/texto + embeddings (coste de leer un documento). */
export function totalesUso(uso: UsoAcumulado): { usd: number; llamadas: number } {
  return {
    usd: Math.round((uso.costeUsd + uso.costeEmbeddingsUsd) * 1e6) / 1e6,
    llamadas: uso.llamadas + uso.llamadasEmbeddings,
  };
}

/** Paso del OCR al que pertenece una llamada (va al `disparador` de ia_uso). */
export type EtapaOcr = "lectura" | "relectura" | "pie" | "contador" | "embeddings";

/** Una llamada a OpenAI ya facturada, tal cual llega a `alUsar`. */
export interface UsoLlamada {
  etapa: EtapaOcr;
  operacion: "vision" | "embedding";
  modelo: string;
  // deno-lint-ignore no-explicit-any
  usage: any;
  duracionMs: number;
}

export interface DependenciasOpenAI {
  apiKey: string;
  config: ConfigModelo;
  fetch?: typeof fetch;
  /**
   * Se llama UNA vez por cada llamada a OpenAI que ha devuelto 200 (visión,
   * texto y embeddings), para contabilizarla en `ia_uso` (registroUso.ts).
   * Opcional: los tests y el banco local de Node no lo pasan. No puede
   * romper la lectura: va envuelto en try/catch y no se espera.
   */
  alUsar?: (u: UsoLlamada) => void;
}

// deno-lint-ignore no-explicit-any
export type BloqueContenido = any;

export interface ClienteOpenAI {
  readonly config: ConfigModelo;
  readonly uso: UsoAcumulado;
  // deno-lint-ignore no-explicit-any
  llamarVision(mensajes: any[], esquema?: unknown, maxTokens?: number, etapa?: EtapaOcr): Promise<unknown>;
  verificarPie(bloque: BloqueContenido): Promise<VerificacionPie | null>;
  contarFilas(bloque: BloqueContenido, texto?: string): Promise<RecuentoFilas | null>;
  embed(input: string | string[]): Promise<number[][]>;
}

/** Bloque de contenido para Vision a partir del fichero en base64. */
export function bloqueContenido(
  b64: string,
  mime: string,
  nombre: string,
  detalle: ConfigModelo["detalle"],
): BloqueContenido {
  return mime.includes("pdf")
    ? { type: "file", file: { filename: nombre || "document.pdf", file_data: `data:application/pdf;base64,${b64}` } }
    : { type: "image_url", image_url: { url: `data:${mime};base64,${b64}`, detail: detalle } };
}

export const vec = (arr: number[]) => "[" + arr.join(",") + "]";

export function crearClienteOpenAI(deps: DependenciasOpenAI): ClienteOpenAI {
  const f = deps.fetch ?? fetch;
  const cfg = deps.config;
  const uso: UsoAcumulado = {
    llamadas: 0,
    tokensEntrada: 0,
    tokensSalida: 0,
    costeUsd: 0,
    llamadasEmbeddings: 0,
    tokensEmbeddings: 0,
    costeEmbeddingsUsd: 0,
  };
  const cabeceras = { "Content-Type": "application/json", Authorization: `Bearer ${deps.apiKey}` };

  const avisar = (etapa: EtapaOcr, operacion: UsoLlamada["operacion"], modelo: string, usage: unknown, t0: number) => {
    if (!deps.alUsar) return;
    try {
      deps.alUsar({ etapa, operacion, modelo, usage, duracionMs: Date.now() - t0 });
    } catch (e) {
      console.error("[ia-uso] no se pudo anotar la llamada:", e);
    }
  };

  // deno-lint-ignore no-explicit-any
  const anotar = (json: any, etapa: EtapaOcr, t0: number) => {
    avisar(etapa, "vision", cfg.modelo, json?.usage, t0);
    uso.llamadas++;
    uso.tokensEntrada += Number(json?.usage?.prompt_tokens ?? 0);
    uso.tokensSalida += Number(json?.usage?.completion_tokens ?? 0);
    uso.costeUsd = Math.round((uso.costeUsd + costeUsd(cfg, json?.usage)) * 1e6) / 1e6;
  };

  /** POST con hasta 2 reintentos ante 429/500/502/503 (límite de tokens por
   *  minuto al leer varias páginas en paralelo). Espera lo que pida la API,
   *  con techo de 8 s: el reloj del worker es de 150 s. */
  async function postConReintento(url: string, body: string): Promise<Response> {
    for (let intento = 0; ; intento++) {
      const res = await f(url, { method: "POST", headers: cabeceras, body });
      if (intento >= 2 || ![429, 500, 502, 503].includes(res.status)) return res;
      const texto = await res.text();
      const pedido = Number(/try again in ([\d.]+)s/i.exec(texto)?.[1] ?? res.headers.get("retry-after") ?? 2);
      const ms = Math.min(8000, Math.max(500, Math.ceil((Number.isFinite(pedido) ? pedido : 2) * 1000) + 250));
      console.warn(`[openai] HTTP ${res.status}; reintento ${intento + 1} en ${ms} ms`);
      await new Promise((r) => setTimeout(r, ms));
    }
  }

  // deno-lint-ignore no-explicit-any
  async function llamarVision(mensajes: any[], esquema?: unknown, maxTokens?: number, etapa: EtapaOcr = "lectura"): Promise<unknown> {
    const t0 = Date.now();
    const res = await postConReintento(`${OPENAI}/chat/completions`, JSON.stringify({
        model: cfg.modelo,
        // 54 filas de concepto (la factura mensual ML/101511 de Luga Sabores)
        // mas el razonamiento no caben en 16k: la respuesta se cortaba por el
        // limite y el documento se perdia entero. El coste no sube por subir el
        // techo, solo por los tokens que de verdad se generen.
        max_completion_tokens: maxTokens ?? cfg.maxTokensExtraccion,
        response_format: { type: "json_schema", json_schema: esquema ?? DOCUMENTO_JSON_SCHEMA },
        messages: mensajes,
      }));
    if (!res.ok) throw new Error(`Vision ${res.status}: ${await res.text()}`);

    const json = await res.json();
    anotar(json, etapa, t0);
    const choice = json?.choices?.[0];

    // Con Structured Outputs una negativa del modelo llega en su propio campo,
    // no como JSON malformado. Distinguirla evita un "JSON inválido" engañoso.
    if (choice?.message?.refusal) {
      throw new Error(`El modelo rechazó procesar el documento: ${choice.message.refusal}`);
    }
    // Un JSON cortado por el límite de tokens parsea mal y el error no dice por qué.
    if (choice?.finish_reason === "length") {
      throw new Error(
        "La respuesta del modelo se cortó por el límite de tokens (documento con demasiadas líneas). " +
          "El JSON está incompleto y no se guarda nada.",
      );
    }

    const raw = choice?.message?.content;
    if (!raw) throw new Error("Vision no devolvió contenido");
    if (typeof raw !== "string") return raw;
    return JSON.parse(raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim());
  }

  /**
   * Segunda lectura, estrecha, del pie del documento. Devuelve null si algo
   * falla: verificar es una mejora, no un requisito, y no puede tumbar una
   * subida que por lo demas ha ido bien.
   */
  async function verificarPie(bloque: BloqueContenido): Promise<VerificacionPie | null> {
    const t0 = Date.now();
    try {
      const resp = await postConReintento(`${OPENAI}/chat/completions`, JSON.stringify({
        model: cfg.modelo,
        max_completion_tokens: cfg.maxTokensPie,
        response_format: { type: "json_schema", json_schema: VERIFICACION_PIE_SCHEMA },
        messages: [
          { role: "system", content: PIE_SYSTEM_PROMPT },
          { role: "user", content: [bloque, { type: "text", text: TEXTO_PIE }] },
        ],
      }));
      if (!resp.ok) {
        console.warn(`[verificador-pie] HTTP ${resp.status}: se sigue sin verificar.`);
        return null;
      }
      const json = await resp.json();
      anotar(json, "pie", t0);
      const choice = json?.choices?.[0];
      if (choice?.finish_reason === "length") {
        console.warn("[verificador-pie] respuesta cortada: se sigue sin verificar.");
        return null;
      }
      const v = JSON.parse(choice?.message?.content ?? "null") as VerificacionPie | null;
      if (!v || typeof v.fila_total_impresa !== "boolean") {
        console.warn("[verificador-pie] respuesta sin forma util: se sigue sin verificar.");
        return null;
      }
      console.log(
        `[verificador-pie] fila del total impresa: ${v.fila_total_impresa}. ` +
          `Ultimo texto visible: "${v.ultimo_texto_visible ?? ""}". ${v.motivo ?? ""}`,
      );
      return v;
    } catch (e) {
      console.warn("[verificador-pie] fallo, se sigue sin verificar:", e);
      return null;
    }
  }

  /**
   * Segunda lectura, estrecha, que SOLO cuenta las filas de la tabla. Devuelve
   * null si algo falla (ver el bloque 3d de esquema.ts).
   */
  async function contarFilas(bloque: BloqueContenido, texto?: string): Promise<RecuentoFilas | null> {
    const t0 = Date.now();
    try {
      const resp = await postConReintento(`${OPENAI}/chat/completions`, JSON.stringify({
        model: cfg.modelo,
        max_completion_tokens: cfg.maxTokensContador,
        response_format: { type: "json_schema", json_schema: RECUENTO_FILAS_SCHEMA },
        messages: [
          { role: "system", content: CONTADOR_SYSTEM_PROMPT },
          { role: "user", content: [bloque, { type: "text", text: texto ?? TEXTO_CONTADOR }] },
        ],
      }));
      if (!resp.ok) {
        console.warn(`[contador-filas] HTTP ${resp.status}: se sigue sin contar.`);
        return null;
      }
      const json = await resp.json();
      anotar(json, "contador", t0);
      const choice = json?.choices?.[0];
      if (choice?.finish_reason === "length") {
        console.warn("[contador-filas] respuesta cortada: se sigue sin contar.");
        return null;
      }
      const r = JSON.parse(choice?.message?.content ?? "null") as RecuentoFilas | null;
      if (!r || (r.filas_tabla !== null && typeof r.filas_tabla !== "number")) {
        console.warn("[contador-filas] respuesta sin forma util: se sigue sin contar.");
        return null;
      }
      console.log(
        `[contador-filas] filas impresas: ${r.filas_tabla} (bloques: ${JSON.stringify(r.filas_por_bloque ?? [])}). ` +
          `${r.motivo ?? ""}`,
      );
      return r;
    } catch (e) {
      console.warn("[contador-filas] fallo, se sigue sin contar:", e);
      return null;
    }
  }

  /** Embeddings en lotes de 100 (04b §1.9: 20 páginas x 40 filas no caben en una). */
  async function embed(input: string | string[]): Promise<number[][]> {
    const lista = Array.isArray(input) ? input : [input];
    const salida: number[][] = [];
    for (let i = 0; i < lista.length; i += 100) {
      const lote = lista.slice(i, i + 100);
      const t0 = Date.now();
      const res = await f(`${OPENAI}/embeddings`, {
        method: "POST",
        headers: cabeceras,
        body: JSON.stringify({ model: MODELO_EMBEDDINGS, input: Array.isArray(input) ? lote : lote[0] }),
      });
      if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${await res.text()}`);
      const json = await res.json();
      // No suma a `costeUsd` (el coste de la lectura que se guarda por página
      // en ocr_trabajos), pero sí a sus propios contadores y a ia_uso.
      const tokens = Number(json?.usage?.prompt_tokens ?? json?.usage?.total_tokens ?? 0);
      uso.llamadasEmbeddings++;
      uso.tokensEmbeddings += Number.isFinite(tokens) ? tokens : 0;
      uso.costeEmbeddingsUsd = Math.round(
        (uso.costeEmbeddingsUsd + (Number.isFinite(tokens) ? tokens : 0) * PRECIO_EMBEDDINGS_USD_M / 1_000_000) * 1e6,
      ) / 1e6;
      avisar("embeddings", "embedding", MODELO_EMBEDDINGS, json?.usage, t0);
      // deno-lint-ignore no-explicit-any
      for (const d of json.data) salida.push((d as any).embedding);
    }
    return salida;
  }

  return { config: cfg, uso, llamarVision, verificarPie, contarFilas, embed };
}
