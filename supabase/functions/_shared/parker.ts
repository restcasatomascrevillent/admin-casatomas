// ---------------------------------------------------------------------------
// Puntuación Robert Parker / The Wine Advocate: reglas comunes (08/11/2026).
//
// Lo usan buscar-puntuacion-parker (búsqueda web) y extraer-vino-foto
// (puntuaciones impresas en la etiqueta). Sin dependencias de Deno: se prueba
// con vitest (supabase/functions/_shared/__tests__/parker.test.ts).
//
// Reglas del dueño que se aplican aquí:
//   · Solo RP/WA: ni Peñín, ni Suckling, ni Decanter, ni Vivino…
//   · Vino y añada EXACTOS. Una puntuación de otra añada no vale.
//   · Intervalos sin convertir en una cifra; provisionales marcadas.
//   · Sin poder verificar → sin puntuación y con motivo.
//   · Fuentes contradictorias → revisión, nunca se elige una en silencio.
// ---------------------------------------------------------------------------

export type EstadoParker = "verificada" | "revision" | "no_localizada" | "pendiente" | "fallida";
export type MotivoParker =
  | "anada_desconocida"
  | "referencia_ambigua"
  | "fuente_inaccesible"
  | "no_localizada"
  | "fuentes_contradictorias"
  | "busqueda_fallida";

export interface DiscrepanciaParker {
  fuente_nombre: string;
  fuente_url: string | null;
  puntos_texto: string | null;
  nota: string | null;
}

/** Resultado normalizado, con las mismas columnas que vinos_puntuacion_parker. */
export interface ResultadoParker {
  estado: EstadoParker;
  motivo: MotivoParker | null;
  anada: number | null;
  sin_anada: boolean;
  puntos_texto: string | null;
  puntos_min: number | null;
  puntos_max: number | null;
  provisional: boolean;
  vino_evaluado: string | null;
  entidad: string;
  critico: string | null;
  fecha_valoracion: string | null;
  fuente_nombre: string | null;
  fuente_url: string | null;
  fuente_tipo: "original" | "secundaria" | null;
  cita: string | null;
  fecha_consulta: string;
  discrepancias: DiscrepanciaParker[];
  notas: string | null;
  /** true si el servidor abrió la página de la fuente y vio la nota, la atribución y la añada. */
  comprobado_en_pagina: boolean;
}

export interface SolicitudParker {
  nombre: string;
  bodega?: string | null;
  anada: number | null;
  sin_anada: boolean;
}

export const ENTIDAD_PARKER = "Robert Parker Wine Advocate";
const RE_PARKER = /(robert\s*parker|wine\s*advocate|\bparker\b|\brp\b|\bwa\b|\brwa\b)/i;
const RE_OTRAS =
  /(pe[ñn]in|suckling|\bjs\b|decanter|vivino|spectator|\bws\b|vinous|galloni|atkin|jancis|enthusiast|falstaff|proensa|bettane|gilbert|gaillard|repsol|gourmets|concours|mundus|iwc|iwsc|medal|medalla|gold|silver|oro|plata)/i;

/** ¿La entidad es Robert Parker / The Wine Advocate? */
export function esEntidadParker(entidad: string | null | undefined): boolean {
  const e = (entidad ?? "").trim();
  if (!e) return false;
  return RE_PARKER.test(e) && !RE_OTRAS.test(e);
}

/** Tipo de entidad de una puntuación impresa en la etiqueta (sin entidad legible → «desconocida»). */
export function clasificarEntidad(entidad: string | null | undefined): "parker" | "otra" | "desconocida" {
  const e = (entidad ?? "").trim();
  if (!e) return "desconocida";
  if (esEntidadParker(e)) return "parker";
  return "otra";
}

/** Quita tildes, pasa a minúsculas y junta espacios. */
export function plegar(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Nombre de vino comparable: sin formato, sin año, sin signos («Aalto 2021 (Magnum)» → «aalto»). */
export function nombreComparable(nombre: string): string {
  return plegar(nombre)
    .replace(/\((magnum|jeroboam|doble magnum|75 ?cl|150 ?cl|1[,.]5 ?l)\)/g, " ")
    .replace(/\b(magnum|75 ?cl)\b/g, " ")
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface PuntosLeidos {
  puntos_texto: string;
  puntos_min: number;
  puntos_max: number;
  provisional: boolean;
}

/** «94», «94+», «(93-95)», «93–95» → puntos; null si no es una puntuación válida (50–100). */
export function leerPuntos(texto: unknown, min?: unknown, max?: unknown, provisional?: unknown): PuntosLeidos | null {
  const t = typeof texto === "string" ? texto.trim().replace(/\s+/g, "").replace(/[–—]/g, "-") : "";
  const m = /^(\()?(\d{2,3})(\+)?(?:-(\d{2,3})(\+)?)?(\))?$/.exec(t);
  let a: number | null = null;
  let b: number | null = null;
  let parentesis = false;
  let texto2 = t;
  if (m) {
    a = Number(m[2]);
    b = m[4] ? Number(m[4]) : a;
    parentesis = Boolean(m[1] && m[6]);
  } else if (typeof min === "number" && Number.isFinite(min)) {
    a = Math.round(min);
    b = typeof max === "number" && Number.isFinite(max) ? Math.round(max) : a;
    texto2 = b > a ? `${a}-${b}` : String(a);
  }
  if (a === null || b === null) return null;
  if (a < 50 || a > 100 || b < a || b > 100) return null;
  return {
    puntos_texto: texto2.slice(0, 16),
    puntos_min: a,
    puntos_max: b,
    // WA publica las de barrica entre paréntesis; un intervalo también lo es salvo que la fuente diga lo contrario.
    provisional: provisional === true || parentesis,
  };
}

/** URL http(s) de un host público (sin IPs ni nombres internos), o null. */
export function urlPublica(v: unknown): URL | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const h = u.hostname.toLowerCase();
    if (!h.includes(".") || h.endsWith(".local") || h.endsWith(".internal") || h === "localhost") return null;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":")) return null;
    if (u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}

export function hostDe(url: string): string | null {
  const u = urlPublica(url);
  return u ? u.hostname.replace(/^www\./, "").toLowerCase() : null;
}

const texto = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

/** Fecha de la valoración: solo «AAAA», «AAAA-MM» o «AAAA-MM-DD». */
export function fechaValoracion(v: unknown): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  return /^(19|20)\d{2}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/.test(t) ? t : null;
}

function motivoDe(v: unknown, porDefecto: MotivoParker): MotivoParker {
  const permitidos: MotivoParker[] = [
    "anada_desconocida", "referencia_ambigua", "fuente_inaccesible", "no_localizada", "fuentes_contradictorias", "busqueda_fallida",
  ];
  return permitidos.includes(v as MotivoParker) ? (v as MotivoParker) : porDefecto;
}

/** Resultado vacío con un estado y un motivo (no localizada, fallida, añada desconocida…). */
export function resultadoSinPuntos(
  solicitud: Pick<SolicitudParker, "anada" | "sin_anada">,
  estado: EstadoParker,
  motivo: MotivoParker | null,
  hoy: string,
  notas: string | null = null,
): ResultadoParker {
  return {
    estado,
    motivo,
    anada: solicitud.anada,
    sin_anada: solicitud.sin_anada,
    puntos_texto: null,
    puntos_min: null,
    puntos_max: null,
    provisional: false,
    vino_evaluado: null,
    entidad: ENTIDAD_PARKER,
    critico: null,
    fecha_valoracion: null,
    fuente_nombre: null,
    fuente_url: null,
    fuente_tipo: null,
    cita: null,
    fecha_consulta: hoy,
    discrepancias: [],
    notas,
    comprobado_en_pagina: false,
  };
}

function discrepancias(v: unknown, puntosElegidos: string | null): DiscrepanciaParker[] {
  if (!Array.isArray(v)) return [];
  const out: DiscrepanciaParker[] = [];
  for (const d of v.slice(0, 6) as Array<Record<string, unknown>>) {
    const nombre = texto(d?.fuente_nombre, 200);
    if (!nombre) continue;
    const url = urlPublica(d?.fuente_url)?.toString() ?? null;
    out.push({ fuente_nombre: nombre, fuente_url: url, puntos_texto: texto(d?.puntos_texto, 16), nota: texto(d?.nota, 300) });
  }
  // Solo cuentan como contradicción las que dan OTRA puntuación.
  return out.filter((d) => !puntosElegidos || !d.puntos_texto || leerPuntos(d.puntos_texto)?.puntos_texto !== leerPuntos(puntosElegidos)?.puntos_texto);
}

/**
 * Valida lo que devuelve la búsqueda con IA y lo convierte en un resultado
 * guardable. Nunca da por buena una puntuación que no sea de RP/WA, de otra
 * añada, sin URL de un sitio realmente consultado o con fuentes que se
 * contradicen. `hostsConsultados` vacío = no se sabe qué consultó (se exige
 * entonces la comprobación en la página para verificar).
 */
export function validarResultado(
  raw: Record<string, unknown> | null,
  solicitud: SolicitudParker,
  hostsConsultados: Set<string>,
  hoy: string,
): ResultadoParker {
  if (!raw) return resultadoSinPuntos(solicitud, "fallida", "busqueda_fallida", hoy, "La búsqueda no devolvió datos legibles.");
  const notas = texto(raw.notas, 1500);
  if (raw.encontrada !== true) {
    return resultadoSinPuntos(solicitud, "no_localizada", motivoDe(raw.motivo, "no_localizada"), hoy, notas);
  }
  const puntos = leerPuntos(raw.puntos_texto, raw.puntos_min, raw.puntos_max, raw.provisional);
  const entidad = texto(raw.entidad, 120) ?? "";
  const url = urlPublica(raw.fuente_url);
  const host = url ? url.hostname.replace(/^www\./, "").toLowerCase() : null;
  const anadaEvaluada = typeof raw.anada_evaluada === "number" ? Math.round(raw.anada_evaluada) : null;
  const nvEvaluado = raw.sin_anada === true;
  const problemas: string[] = [];

  if (!puntos) problemas.push("la puntuación no es válida (50–100)");
  if (!esEntidadParker(entidad)) problemas.push(`la entidad no es Robert Parker / The Wine Advocate («${entidad || "sin entidad"}»)`);
  if (!url) problemas.push("no hay URL de la fuente");
  else if (hostsConsultados.size > 0 && host && !hostsConsultados.has(host)) problemas.push("la URL no es de un sitio consultado en la búsqueda");
  if (solicitud.sin_anada) {
    if (!nvEvaluado || anadaEvaluada !== null) problemas.push("la puntuación es de un vino con añada, no del NV pedido");
  } else if (anadaEvaluada !== solicitud.anada) {
    problemas.push(`la puntuación es de la añada ${anadaEvaluada ?? "desconocida"}, no de la ${solicitud.anada}`);
  }

  const base: ResultadoParker = {
    ...resultadoSinPuntos(solicitud, "revision", null, hoy, notas),
    vino_evaluado: texto(raw.vino_evaluado, 300),
    critico: texto(raw.critico, 120),
    fecha_valoracion: fechaValoracion(raw.fecha_valoracion),
    fuente_nombre: texto(raw.fuente_nombre, 200) ?? host,
    fuente_url: url ? url.toString().slice(0, 1000) : null,
    fuente_tipo: host && /(^|\.)robertparker\.com$/.test(host) ? "original" : url ? "secundaria" : null,
    cita: texto(raw.cita, 600),
  };

  // Otra entidad u otra añada: no es la puntuación pedida. No se guarda la cifra.
  const descartada = problemas.some((p) => p.startsWith("la entidad") || p.startsWith("la puntuación es de"));
  if (descartada || !puntos) {
    return {
      ...base,
      estado: "no_localizada",
      motivo: "no_localizada",
      notas: [notas, `Descartada: ${problemas.join("; ")}.`].filter(Boolean).join(" "),
    };
  }

  const resultado: ResultadoParker = {
    ...base,
    puntos_texto: puntos.puntos_texto,
    puntos_min: puntos.puntos_min,
    puntos_max: puntos.puntos_max,
    provisional: puntos.provisional,
    discrepancias: discrepancias(raw.discrepancias, puntos.puntos_texto),
  };
  if (resultado.discrepancias.length > 0) {
    return { ...resultado, estado: "revision", motivo: "fuentes_contradictorias" };
  }
  if (problemas.length > 0) {
    return { ...resultado, estado: "revision", notas: [notas, `Revisar: ${problemas.join("; ")}.`].filter(Boolean).join(" ") };
  }
  // Aún sin comprobar en la página: queda en revisión hasta comprobarAhora().
  return resultado;
}

const RE_OTROS_CRITICOS =
  /(suckling|\bjs\b|pe[nñ]in|decanter|spectator|\bws\b|vinous|galloni|atkin|\bta\b|jancis|\bjr\b|enthusiast|\bwe\b|falstaff|dunnuck|\bjd\b|vivino|proensa)/g;

/** Texto plano de un HTML (sin scripts ni estilos), para buscar la nota. */
export function textoDeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ");
}

const PALABRAS_VACIAS = new Set([
  "de", "del", "la", "el", "los", "las", "y", "e", "vino", "vinos", "bodega", "bodegas", "tinto", "blanco", "rosado",
  "brut", "the", "le", "les", "du", "des", "domaine", "chateau", "magnum", "reserva", "crianza", "gran",
]);

/**
 * ¿La página muestra la puntuación atribuida a RP/WA, para ese vino y añada?
 * Exige: la nota cerca (≤ 160 caracteres) de «Parker»/«Wine Advocate»/«RP»/«WA»,
 * la añada en la página (salvo NV) y la mayoría de las palabras del nombre.
 */
export function confirmaEnTexto(
  textoPagina: string,
  r: Pick<ResultadoParker, "puntos_min" | "puntos_max" | "anada" | "sin_anada" | "vino_evaluado">,
  nombreBuscado: string,
): { ok: boolean; faltan: string[] } {
  const t = plegar(textoPagina);
  const faltan: string[] = [];
  if (r.puntos_min === null) return { ok: false, faltan: ["puntuación"] };
  const numeros = r.puntos_max !== null && r.puntos_max > r.puntos_min ? [r.puntos_min, r.puntos_max] : [r.puntos_min];
  const atribuciones = [...t.matchAll(/(robert parker|wine advocate|parker|\brp\b|\bwa\b|\brwa\b)/g)].map((m) => m.index ?? 0);
  // Otros críticos: si la nota está más cerca de uno de ellos que de Parker, no cuenta.
  const otros = [...t.matchAll(RE_OTROS_CRITICOS)].map((m) => m.index ?? 0);
  const distancia = (pos: number, lista: number[]) => Math.min(Infinity, ...lista.map((a) => Math.abs(pos - a)));
  const cerca = numeros.every((n) =>
    [...t.matchAll(new RegExp(`(?<![\\d.,])${n}(?![\\d.,])`, "g"))].some((m) => {
      const pos = m.index ?? 0;
      const aParker = distancia(pos, atribuciones);
      return aParker <= 160 && aParker < distancia(pos, otros);
    }),
  );
  if (!atribuciones.length) faltan.push("atribución a Parker / Wine Advocate");
  else if (!cerca) faltan.push("la puntuación junto a Parker / Wine Advocate");
  if (!r.sin_anada && r.anada !== null && !new RegExp(`\\b${r.anada}\\b`).test(t)) faltan.push(`la añada ${r.anada}`);
  const palabras = [...new Set(nombreComparable(r.vino_evaluado || nombreBuscado).split(" "))].filter(
    (p) => p.length >= 3 && !PALABRAS_VACIAS.has(p),
  );
  if (palabras.length) {
    const vistas = palabras.filter((p) => t.includes(p)).length;
    if (vistas < Math.ceil(palabras.length / 2)) faltan.push("el nombre del vino");
  }
  return { ok: faltan.length === 0, faltan };
}

/** Aplica la comprobación en la página: verificada si se vio, revisión si no. */
export function trasComprobar(r: ResultadoParker, comprobacion: { ok: boolean; faltan: string[] } | null): ResultadoParker {
  if (r.estado !== "revision" || r.motivo !== null || r.puntos_min === null) return r;
  if (r.notas && /Revisar:/.test(r.notas)) return r;
  if (comprobacion?.ok) return { ...r, estado: "verificada", comprobado_en_pagina: true };
  const porque = comprobacion === null
    ? "No se pudo abrir la página de la fuente para comprobarlo"
    : `En la página no se ve ${comprobacion.faltan.join(", ")}`;
  return { ...r, estado: "revision", comprobado_en_pagina: false, notas: [r.notas, `${porque}: revisa la fuente antes de confirmarla.`].filter(Boolean).join(" ") };
}

export interface PuntuacionEtiqueta {
  texto: string;
  puntos: number | null;
  entidad: string | null;
  entidad_tipo: "parker" | "otra" | "desconocida";
  anada: number | null;
}

/** Puntuaciones impresas en la etiqueta, limpias y clasificadas por entidad (nunca se dan por Parker). */
export function limpiarPuntuacionesEtiqueta(v: unknown): PuntuacionEtiqueta[] {
  if (!Array.isArray(v)) return [];
  const out: PuntuacionEtiqueta[] = [];
  for (const p of v.slice(0, 6) as Array<Record<string, unknown>>) {
    const t = texto(p?.texto, 120);
    if (!t) continue;
    const puntos = typeof p?.puntos === "number" && p.puntos >= 50 && p.puntos <= 100 ? Math.round(p.puntos) : null;
    const entidad = texto(p?.entidad, 80);
    const anada = typeof p?.anada === "number" && p.anada >= 1900 && p.anada <= 2100 ? Math.round(p.anada) : null;
    out.push({ texto: t, puntos, entidad, entidad_tipo: clasificarEntidad(entidad), anada });
  }
  return out;
}
