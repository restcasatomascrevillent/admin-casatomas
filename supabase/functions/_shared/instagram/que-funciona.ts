/**
 * «Qué funciona» para la IA (instagram-ia: sugerir_texto, proponer_campana e
 * ideas_semana). Lee la RPC instagram_que_funciona (migración
 * 20261110000000_instagram_aprender) con el JWT del usuario y la resume para
 * el modelo: solo conclusiones con muestra suficiente, con sus cifras reales.
 * Lógica pura salvo `leerQueFuncionaIA`, que nunca lanza (sin la migración o
 * con un fallo, la IA sigue sin este bloque).
 *
 * Además, `quitarCifrasInventadas` quita de los textos libres de la IA
 * (razonamiento y «por qué» de una campaña, idea de la semana) las frases
 * con un porcentaje que no sale de «Qué funciona»: la IA puede citar
 * «los martes, 9 % de interacción» solo si ese 9 está en los datos.
 */

export const MIGRACION_QUE_FUNCIONA = "20261110000000_instagram_aprender";
const MS_SUPABASE = 15_000;
const MAX_GRUPOS_IA = 5;

export type EstadoConclusion = "mejor" | "parecido" | "faltan_datos";

export interface GrupoQF {
  clave: string;
  publicaciones: number;
  alcance_medio: number | null;
  tasa: number | null;
  guardados_por_alcance: number | null;
  suficiente: boolean;
  orden: number;
}

export interface ConclusionQF {
  eje: string;
  estado: EstadoConclusion;
  clave?: string;
  publicaciones?: number;
  tasa?: number;
  tasa_media?: number;
  texto: string;
}

export interface PublicacionQF {
  media_id: string;
  fecha?: string;
  formato?: string;
  plantilla?: string;
  gancho?: string;
  alcance?: number;
  tasa?: number;
}

/** Respuesta de la RPC instagram_que_funciona. */
export interface QueFuncionaBD {
  periodo_dias: number;
  desde?: string;
  minimo: number;
  publicaciones: number;
  con_pieza?: number;
  tasa_media: number | null;
  guardados_media?: number | null;
  suficiente: boolean;
  aviso: string | null;
  por: Record<string, GrupoQF[]>;
  conclusiones: ConclusionQF[];
  mejores: PublicacionQF[];
  peores: PublicacionQF[];
}

/** La cuenta de Instagram de la marca: IG_USER_ID_<MARCA> o, si no, IG_USER_ID (solo dígitos). */
export function igUserIdDeMarca(env: Record<string, string | undefined>, marca: "casa-tomas" | "touza"): string | null {
  const propio = env[marca === "touza" ? "IG_USER_ID_TOUZA" : "IG_USER_ID_CASA_TOMAS"]?.trim();
  const id = propio || env.IG_USER_ID?.trim() || "";
  return /^\d{1,30}$/.test(id) ? id : null;
}

export function esQueFunciona(v: unknown): v is QueFuncionaBD {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return typeof o.publicaciones === "number" && Array.isArray(o.conclusiones) && typeof o.por === "object" && o.por !== null;
}

/**
 * POST /rest/v1/rpc/instagram_que_funciona con el JWT del usuario. Nunca
 * lanza: devuelve null si falta la migración, si la RPC falla o si la
 * respuesta no tiene la forma esperada.
 */
export async function leerQueFuncionaIA(
  f: typeof fetch,
  urlSupabase: string,
  cabeceras: Record<string, string>,
  marca: "casa-tomas" | "touza",
  igUserId: string | null,
): Promise<QueFuncionaBD | null> {
  try {
    const r = await f(`${urlSupabase}/rest/v1/rpc/instagram_que_funciona`, {
      method: "POST",
      headers: { ...cabeceras, "Content-Type": "application/json" },
      body: JSON.stringify({ p_marca: marca, p_ig_user_id: igUserId, p_dias: 90 }),
      signal: AbortSignal.timeout(MS_SUPABASE),
    });
    if (!r.ok) return null;
    const v = await r.json().catch(() => null);
    return esQueFunciona(v) ? v : null;
  } catch {
    return null;
  }
}

/** Lo que ve el modelo: cifras reales y solo de grupos con muestra suficiente. */
export interface ResumenQueFuncionaIA {
  periodo_dias: number;
  publicaciones: number;
  suficiente: boolean;
  aviso: string | null;
  tasa_media: number | null;
  /** Frases con datos reales: las únicas conclusiones que se pueden citar. */
  conclusiones: string[];
  /** Ejes sin conclusión (sin diferencias claras o con pocos datos). */
  sin_conclusion: string[];
  /** Grupos con muestra suficiente (tasa = interacciones / alcance, %). */
  por: Record<string, Array<{ clave: string; publicaciones: number; tasa: number | null; guardados_por_alcance: number | null }>>;
  mejores: Array<Omit<PublicacionQF, "media_id" | "alcance">>;
  peores: Array<Omit<PublicacionQF, "media_id" | "alcance">>;
}

export function resumenQueFuncionaIA(qf: QueFuncionaBD | null): ResumenQueFuncionaIA | null {
  if (!qf) return null;
  const pub = (p: PublicacionQF) => ({ fecha: p.fecha, formato: p.formato, plantilla: p.plantilla, gancho: p.gancho, tasa: p.tasa });
  const por: ResumenQueFuncionaIA["por"] = {};
  if (qf.suficiente) {
    for (const [eje, grupos] of Object.entries(qf.por ?? {})) {
      const buenos = (Array.isArray(grupos) ? grupos : [])
        .filter((g) => g?.suficiente)
        .slice(0, MAX_GRUPOS_IA)
        .map((g) => ({ clave: g.clave, publicaciones: g.publicaciones, tasa: g.tasa, guardados_por_alcance: g.guardados_por_alcance }));
      if (buenos.length) por[eje] = buenos;
    }
  }
  return {
    periodo_dias: qf.periodo_dias,
    publicaciones: qf.publicaciones,
    suficiente: qf.suficiente === true,
    aviso: qf.aviso ?? null,
    tasa_media: qf.tasa_media ?? null,
    conclusiones: qf.suficiente ? qf.conclusiones.filter((c) => c.estado === "mejor").map((c) => c.texto) : [],
    sin_conclusion: qf.conclusiones.filter((c) => c.estado !== "mejor").map((c) => c.texto),
    por,
    mejores: qf.suficiente ? (qf.mejores ?? []).map(pub) : [],
    peores: qf.suficiente ? (qf.peores ?? []).map(pub) : [],
  };
}

/** «6.8» → ["6.8", "6,8"]; «9» → ["9", "9.0", "9,0"]. */
function formas(n: number): string[] {
  const r = Math.round(n * 100) / 100;
  const s = String(r);
  const salida = new Set([s, s.replace(".", ",")]);
  if (Number.isInteger(r)) {
    salida.add(`${r}.0`);
    salida.add(`${r},0`);
  }
  const uno = (Math.round(n * 10) / 10).toString();
  salida.add(uno);
  salida.add(uno.replace(".", ","));
  return [...salida];
}

/**
 * Porcentajes que la IA puede citar: los de «Qué funciona» con muestra
 * suficiente. Sin muestra (o sin datos), ninguno.
 */
export function cifrasPermitidas(qf: QueFuncionaBD | ResumenQueFuncionaIA | null): Set<string> {
  const salida = new Set<string>();
  if (!qf || qf.suficiente !== true) return salida;
  const meter = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) for (const x of formas(v)) salida.add(x);
  };
  meter(qf.tasa_media);
  if ("guardados_media" in qf) meter(qf.guardados_media);
  for (const grupos of Object.values(qf.por ?? {})) {
    for (const g of grupos ?? []) {
      meter(g.tasa);
      meter(g.guardados_por_alcance);
    }
  }
  for (const c of qf.conclusiones ?? []) {
    if (typeof c === "string") {
      for (const m of c.matchAll(/(\d+(?:[.,]\d+)?)\s?%/g)) salida.add(m[1]);
    } else {
      meter(c.tasa);
      meter(c.tasa_media);
    }
  }
  for (const p of [...(qf.mejores ?? []), ...(qf.peores ?? [])]) meter(p.tasa);
  return salida;
}

const PORCENTAJE = /(\d+(?:[.,]\d+)?)\s?(?:%|por ciento)/gi;

/**
 * Quita las frases con un porcentaje que no está en `permitidas`. Devuelve
 * el texto limpio y cuántas frases se han quitado.
 */
export function quitarCifrasInventadas(texto: string, permitidas: Set<string>): { texto: string; quitadas: number } {
  if (!texto || !/\d\s?(?:%|por ciento)/i.test(texto)) return { texto, quitadas: 0 };
  const frases = texto.match(/[^.!?\n]+[.!?]*\s*|\n+/g) ?? [texto];
  let quitadas = 0;
  const buenas = frases.filter((f) => {
    const malas = [...f.matchAll(PORCENTAJE)].filter((m) => !permitidas.has(m[1]));
    if (malas.length) quitadas++;
    return malas.length === 0;
  });
  return { texto: buenas.join("").replace(/[ \t]{2,}/g, " ").trim(), quitadas };
}
