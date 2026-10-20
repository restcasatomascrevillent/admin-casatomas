// ============================================================================
// sync-trafico-web / vercel.ts — adaptador de Vercel Web Analytics
// ============================================================================
// Aísla el contrato de la API para que index.ts/sync.ts no dependan de él.
// Sin imports remotos (esm.sh/deno.land) a propósito: así los tests lo
// cargan con vitest igual que los de emails-reserva.
//
// CONTRATO VERIFICADO EN VIVO (2026-09-23, engram sdd/trafico-web/api-contract):
//   GET https://api.vercel.com/v1/query/web-analytics/visits/aggregate
//     ?teamId&projectId&since=YYYY-MM-DD&until=YYYY-MM-DD   (until INCLUSIVO)
//     &by=day&by=<dim>   dim ∈ requestPath|deviceType|country|referrerHostname
//     &limit=100         (por defecto 10: pasarlo SIEMPRE)
//   Respuesta: {version, query:{...}, data:[{timestamp:"YYYY-MM-DDT00:00:00.000Z",
//               visitors, pageviews, <dim>: valor}]}
//   - timestamp = medianoche UTC -> fecha = timestamp.slice(0,10).
//   - Días sin tráfico vienen RELLENOS con 0 -> se guardan como 0 real.
//   - Hobby: solo los últimos 31 días (400 "hobby plan only grants access to
//     the latest 31 days"). El backfill usa 30 días (margen).
//   - El token del conector MCP de Vercel da 404 aquí; hace falta un token
//     personal (VERCEL_ANALYTICS_TOKEN).
//
// NO VERIFICADO: qué devuelve `by=day` SOLO (sin segunda dimensión). Se usa
// para el total diario (ruta '*'); si la API lo rechaza, sync.ts cae a sumar
// las filas por requestPath (cota inferior: solo el top 100 de rutas).
// ============================================================================

export const VERCEL_API_BASE = "https://api.vercel.com";
export const VERCEL_TEAM_ID = "team_wUrFe4kT5oMBrGSl6b3Gvl9Z";
export const LIMITE_FILAS_API = 100;

/** Dimensiones de la API -> dimensión guardada en trafico_web_desglose. */
export type DimensionApi = "requestPath" | "deviceType" | "country" | "referrerHostname";
export type DimensionDesglose = "device" | "country" | "referrer";

export const DIMENSION_DESGLOSE: Record<Exclude<DimensionApi, "requestPath">, DimensionDesglose> = {
  deviceType: "device",
  country: "country",
  referrerHostname: "referrer",
};

/** Literales para valores vacíos: `valor` está en la PK y no admite NULL. */
export const VALOR_VACIO: Record<DimensionApi, string> = {
  requestPath: "(desconocida)",
  deviceType: "(desconocido)",
  country: "(desconocido)",
  referrerHostname: "(directo)",
};

const LONGITUD_MAX_VALOR = 2048; // CHECK length(...) between 1 and 2048

/** Fila normalizada de la API: una por día (y por valor de dimensión). */
export interface FilaVercel {
  fecha: string; // YYYY-MM-DD (UTC)
  valor: string | null; // null solo cuando la consulta es by=day sin dimensión
  visitas: number; // pageviews
  visitantes: number | null; // visitors; null si la API no lo trae
}

export interface ResultadoNormalizacion {
  filas: FilaVercel[];
  descartadas: number; // filas sin fecha o sin pageviews válido
}

export class ErrorVercel extends Error {
  constructor(
    message: string,
    readonly status: number | null, // null = error de red / timeout
    readonly reintentable: boolean,
  ) {
    super(message);
    this.name = "ErrorVercel";
  }
}

export function construirUrlAggregate(opts: {
  projectId: string;
  desde: string;
  hasta: string;
  dimension: DimensionApi | null;
  teamId?: string;
  base?: string;
}): string {
  const u = new URL(`${opts.base ?? VERCEL_API_BASE}/v1/query/web-analytics/visits/aggregate`);
  u.searchParams.set("teamId", opts.teamId ?? VERCEL_TEAM_ID);
  u.searchParams.set("projectId", opts.projectId);
  u.searchParams.set("since", opts.desde);
  u.searchParams.set("until", opts.hasta);
  u.searchParams.append("by", "day");
  if (opts.dimension) u.searchParams.append("by", opts.dimension);
  u.searchParams.set("limit", String(LIMITE_FILAS_API));
  return u.toString();
}

function aEnteroNoNegativo(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.round(v);
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0) {
    return Math.round(Number(v));
  }
  return null;
}

function aFecha(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return m ? m[1] : null;
}

/** Normaliza el valor de una dimensión a algo que cabe en la PK. */
export function normalizarValor(dimension: DimensionApi, v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v).trim();
  if (s === "") return VALOR_VACIO[dimension];
  // '*' es el centinela de totales en trafico_web_diario.ruta.
  if (dimension === "requestPath" && s === "*") s = "/*";
  return s.length > LONGITUD_MAX_VALOR ? s.slice(0, LONGITUD_MAX_VALOR) : s;
}

/**
 * Convierte el JSON de /visits/aggregate en filas. Tolerante: un cuerpo sin
 * `data` da 0 filas; una fila sin fecha o sin `pageviews` numérico se descarta
 * (visitas es NOT NULL); `visitors` ausente -> visitantes NULL.
 */
export function normalizarRespuesta(cuerpo: unknown, dimension: DimensionApi | null): ResultadoNormalizacion {
  const data = (cuerpo as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return { filas: [], descartadas: 0 };
  const filas: FilaVercel[] = [];
  let descartadas = 0;
  for (const bruta of data) {
    if (!bruta || typeof bruta !== "object") {
      descartadas++;
      continue;
    }
    const r = bruta as Record<string, unknown>;
    const fecha = aFecha(r.timestamp);
    const visitas = aEnteroNoNegativo(r.pageviews);
    if (!fecha || visitas === null) {
      descartadas++;
      continue;
    }
    filas.push({
      fecha,
      valor: dimension ? normalizarValor(dimension, r[dimension]) : null,
      visitas,
      visitantes: aEnteroNoNegativo(r.visitors),
    });
  }
  return { filas, descartadas };
}

// ---------------------------------------------------------------------------
// Cliente HTTP con reintento limitado (429 / 5xx / red)
// ---------------------------------------------------------------------------

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface OpcionesCliente {
  token: string;
  fetchFn?: FetchLike;
  esperar?: (ms: number) => Promise<void>;
  intentos?: number; // total, incluido el primero
  timeoutMs?: number;
  teamId?: string;
  base?: string;
}

export interface ClienteVercel {
  aggregate(projectId: string, desde: string, hasta: string, dimension: DimensionApi | null): Promise<ResultadoNormalizacion>;
}

const esperarReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function esEstadoReintentable(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Espera antes del reintento n (1-based). Respeta Retry-After (máx. 10 s). */
export function calcularEspera(intento: number, retryAfter: string | null): number {
  const s = retryAfter !== null ? Number(retryAfter) : NaN;
  if (Number.isFinite(s) && s >= 0) return Math.min(s * 1000, 10_000);
  return Math.min(1000 * 2 ** (intento - 1), 8_000);
}

async function leerMensajeError(res: Response): Promise<string> {
  try {
    const txt = await res.text();
    try {
      const j = JSON.parse(txt) as { error?: { message?: string; code?: string } | string; message?: string };
      if (typeof j.error === "string") return j.error;
      return j.error?.message ?? j.message ?? txt.slice(0, 300);
    } catch {
      return txt.slice(0, 300);
    }
  } catch {
    return "";
  }
}

export function crearClienteVercel(opts: OpcionesCliente): ClienteVercel {
  const fetchFn = opts.fetchFn ?? ((u, i) => fetch(u, i));
  const esperar = opts.esperar ?? esperarReal;
  const intentos = Math.max(1, opts.intentos ?? 3);
  const timeoutMs = opts.timeoutMs ?? 15_000;

  return {
    async aggregate(projectId, desde, hasta, dimension) {
      const url = construirUrlAggregate({ projectId, desde, hasta, dimension, teamId: opts.teamId, base: opts.base });
      let ultimo: ErrorVercel | null = null;
      for (let n = 1; n <= intentos; n++) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        let res: Response;
        try {
          res = await fetchFn(url, {
            method: "GET",
            headers: { Authorization: `Bearer ${opts.token}`, Accept: "application/json" },
            signal: ctrl.signal,
          });
        } catch (e) {
          clearTimeout(t);
          ultimo = new ErrorVercel(`Error de red con Vercel: ${(e as Error)?.message ?? e}`, null, true);
          if (n < intentos) await esperar(calcularEspera(n, null));
          continue;
        }
        clearTimeout(t);
        if (res.ok) {
          let cuerpo: unknown;
          try {
            cuerpo = await res.json();
          } catch {
            throw new ErrorVercel("Respuesta de Vercel no es JSON", res.status, false);
          }
          return normalizarRespuesta(cuerpo, dimension);
        }
        const msg = await leerMensajeError(res);
        const reintentable = esEstadoReintentable(res.status);
        ultimo = new ErrorVercel(`Vercel ${res.status}${dimension ? ` (by=${dimension})` : " (by=day)"}: ${msg}`, res.status, reintentable);
        if (!reintentable) throw ultimo;
        if (n < intentos) await esperar(calcularEspera(n, res.headers.get("retry-after")));
      }
      throw ultimo ?? new ErrorVercel("Vercel: error desconocido", null, true);
    },
  };
}
