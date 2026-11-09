/**
 * RRSS · el plan de edición: lo que PROPONE la IA y lo que el motor EJECUTA.
 *
 *   IA (Edge Function rrss-ia)  ──►  PlanEdicion (este contrato)  ──►  motor (api/rrss-foto, api/rrss-video)
 *        propone                        normalizarPlan()                 transforma los archivos de verdad
 *
 * La IA nunca toca un archivo: devuelve números y textos (encuadre, corrección
 * de luz y color, qué fragmentos usar y en qué orden, rótulos, transición…).
 * `normalizarPlan` lo limita a lo que el motor sabe hacer, quita lo que no
 * cuadra con los archivos subidos y aplica las reglas de fidelidad:
 *
 *  · la corrección es suave (luz, contraste, color y encuadre): nunca cambia
 *    el contenido;
 *  · lo que modifica la escena (desenfocar o cambiar el fondo) solo pasa si el
 *    usuario marcó «Permitir transformaciones creativas»;
 *  · los fragmentos de vídeo tienen que existir en el clip (dentro de su
 *    duración) y el total cabe en el formato.
 *
 * El usuario puede ajustar después cada pieza a mano: el panel guarda el plan
 * ajustado y el motor solo vuelve a hacer las piezas que cambian.
 *
 * Isomórfico y sin dependencias. Copia literal en
 * supabase/functions/_shared/rrss/plan.ts (la Edge Function no puede importar
 * de src/); src/lib/rrss/__tests__/copias.test.ts comprueba que son iguales.
 */
import { esEstilo, limitarTratamiento, TRANSICIONES, type EstiloId, type Transicion, type Tratamiento } from "./estilos.js";
import type { FormatoSalida, Medio } from "./formatos";

export const VERSION_PLAN = 1;

export interface Encuadre {
  /** Centro del recorte, de 0 (izquierda/arriba) a 1 (derecha/abajo). */
  x: number;
  y: number;
  /** 1 = el recorte más grande que cabe; hasta 3 = acercar. */
  zoom: number;
}

export type PosicionRotulos = "auto" | "arriba" | "centro" | "abajo";
export const POSICIONES: readonly PosicionRotulos[] = ["auto", "arriba", "centro", "abajo"];

export interface Rotulos {
  antetitulo?: string;
  titulo?: string;
  subtitulo?: string;
  cta?: string;
  posicion: PosicionRotulos;
}

/** Transformaciones que cambian la escena: solo con permiso explícito. */
export type Creativo = "ninguno" | "desenfocar-fondo" | "fondo-marca";
export const CREATIVOS: readonly Creativo[] = ["ninguno", "desenfocar-fondo", "fondo-marca"];

/** Corrección de la foto (la IA la propone; el estilo suma su tratamiento encima). */
export type Correccion = Pick<Tratamiento, "exposicion" | "contraste" | "saturacion" | "temperatura" | "nitidez">;

export const CORRECCION_NEUTRA: Correccion = { exposicion: 0, contraste: 0, saturacion: 0, temperatura: 0, nitidez: 0 };

export interface PiezaFoto {
  tipo: "foto";
  /** id de rrss_archivos. */
  archivo: string;
  correccion: Correccion;
  /** Estira los niveles (negro y blanco) antes de corregir: fotos apagadas o con velo. */
  autoNiveles: boolean;
  encuadre: Encuadre;
  rotulos: Rotulos | null;
  logo: boolean;
  creativo: Creativo;
  /** Texto alternativo literal de lo que se ve. */
  altText: string;
  /** Por qué esta edición (la explicación de la IA, para la persona). */
  nota: string;
}

export type Movimiento = "ninguno" | "acercar" | "alejar" | "izquierda" | "derecha";
export const MOVIMIENTOS: readonly Movimiento[] = ["ninguno", "acercar", "alejar", "izquierda", "derecha"];

export interface Toma {
  archivo: string;
  medio: Medio;
  /** Segundos dentro del clip (en una foto: 0 y la duración del plano). */
  inicio: number;
  fin: number;
  encuadre: Encuadre;
  movimiento: Movimiento;
  motivo: string;
}

export interface TituloVideo {
  texto: string;
  /** Segundos en el vídeo final. */
  inicio: number;
  fin: number;
  posicion: "arriba" | "centro" | "abajo";
}

export interface PiezaVideo {
  tipo: "video";
  tomas: Toma[];
  titulos: TituloVideo[];
  /** Subtítulos de la voz (si hay transcripción de los clips). */
  subtitulos: boolean;
  transicion: Transicion;
  duracionTransicion: number;
  audio: "original" | "silencio";
  correccion: Correccion;
  cierre: { mostrar: boolean; titulo?: string; cta?: string };
  logo: boolean;
  nota: string;
}

export type Pieza = PiezaFoto | PiezaVideo;

export interface TextosPublicacion {
  /** Texto de la publicación (Instagram: caption; Facebook: texto del post). */
  caption: string;
  hashtags: string[];
  /** Titular corto para la pieza o el borrador. */
  titular: string;
}

export interface PlanEdicion {
  version: number;
  estilo: EstiloId;
  /** Lo que la IA ha entendido (una o dos frases). */
  resumen: string;
  /** Datos imprescindibles que faltan: si hay, conviene contestarlos antes de generar. */
  preguntas: string[];
  piezas: Pieza[];
  textos: TextosPublicacion;
  avisos: string[];
}

export interface ArchivoPlan {
  id: string;
  tipo: Medio;
  /** Solo vídeo. */
  duracion_s?: number | null;
}

export interface ContextoPlan {
  archivos: ArchivoPlan[];
  formato: FormatoSalida;
  estilo: EstiloId;
  permitirCreativo: boolean;
  /** Clips con transcripción (para saber si tiene sentido pedir subtítulos). */
  conVoz?: string[];
}

// ── Límites ─────────────────────────────────────────────────────────────────
export const LIMITES_TEXTO = { antetitulo: 40, titulo: 60, subtitulo: 90, cta: 32, altText: 1000, caption: 2200, nota: 400, resumen: 500, titular: 80 } as const;
export const MAX_PALABRAS_TITULO = 7;
export const MAX_HASHTAGS = { instagram: 5, facebook: 3 } as const;
export const DURACION_PLANO = { min: 0.8, max: 12 } as const;
/** Lo que dura el cierre del vídeo (logo y llamada a la acción), el mismo que monta el motor. */
export const DURACION_CIERRE = 2.6;
export const MAX_TOMAS = 20;
export const MAX_TITULOS = 6;

const num = (v: unknown, def = 0) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : def;
};
const lim = (v: unknown, min: number, max: number, def = 0) => Math.min(max, Math.max(min, num(v, def)));
const redondear = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

/** Quita emoji, controles y espacios de más; recorta a `max` sin cortar palabras si puede. */
export function limpiarTexto(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  let s = v
    // eslint-disable-next-line no-control-regex -- quitar caracteres de control es justo lo que se quiere
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\p{Extended_Pictographic}️‍]/gu, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (s.length > max) {
    const corte = s.slice(0, max);
    const espacio = corte.lastIndexOf(" ");
    s = (espacio > max * 0.6 ? corte.slice(0, espacio) : corte).trim();
  }
  return s;
}

export function normalizarEncuadre(v: unknown): Encuadre {
  const e = (v ?? {}) as Partial<Encuadre>;
  return { x: redondear(lim(e.x, 0, 1, 0.5)), y: redondear(lim(e.y, 0, 1, 0.5)), zoom: redondear(lim(e.zoom, 1, 3, 1)) };
}

export function normalizarCorreccion(v: unknown): Correccion {
  const t = limitarTratamiento((v ?? {}) as Partial<Tratamiento>);
  // La corrección es suave: la IA no puede pasarse (el estilo ya pone su carácter).
  const suave = (x: number) => redondear(Math.max(-0.6, Math.min(0.6, x)));
  return { exposicion: suave(t.exposicion), contraste: suave(t.contraste), saturacion: suave(t.saturacion), temperatura: suave(t.temperatura), nitidez: redondear(Math.min(0.8, t.nitidez)) };
}

function normalizarRotulos(v: unknown): Rotulos | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  let titulo = limpiarTexto(r.titulo, LIMITES_TEXTO.titulo);
  const palabras = titulo.split(/\s+/).filter(Boolean);
  if (palabras.length > MAX_PALABRAS_TITULO) titulo = palabras.slice(0, MAX_PALABRAS_TITULO).join(" ");
  const out: Rotulos = {
    posicion: POSICIONES.includes(r.posicion as PosicionRotulos) ? (r.posicion as PosicionRotulos) : "auto",
  };
  const ante = limpiarTexto(r.antetitulo, LIMITES_TEXTO.antetitulo);
  const sub = limpiarTexto(r.subtitulo, LIMITES_TEXTO.subtitulo);
  const cta = limpiarTexto(r.cta, LIMITES_TEXTO.cta);
  if (ante) out.antetitulo = ante;
  if (titulo) out.titulo = titulo;
  if (sub) out.subtitulo = sub;
  if (cta) out.cta = cta;
  return out.antetitulo || out.titulo || out.subtitulo || out.cta ? out : null;
}

export function normalizarHashtags(v: unknown, max: number): string[] {
  const lista = Array.isArray(v) ? v : typeof v === "string" ? v.split(/\s+/) : [];
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const h of lista) {
    if (typeof h !== "string") continue;
    const limpio = h.trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
    if (!limpio || limpio.length > 40) continue;
    const clave = limpio.toLocaleLowerCase("es");
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    out.push(`#${limpio}`);
    if (out.length >= max) break;
  }
  return out;
}

/** Duración de cada toma en el montaje (fin − inicio). */
export const duracionToma = (t: Pick<Toma, "inicio" | "fin">) => Math.max(0, t.fin - t.inicio);

/** Duración total del vídeo: tomas (y el cierre, si lo lleva) menos los solapes de las transiciones. */
export function duracionMontaje(p: Pick<PiezaVideo, "tomas" | "transicion" | "duracionTransicion"> & { cierre?: { mostrar: boolean } }): number {
  const tramos = p.tomas.map(duracionToma);
  if (p.cierre?.mostrar) tramos.push(DURACION_CIERRE);
  const suma = tramos.reduce((s, d) => s + d, 0);
  const solape = p.transicion === "corte" ? 0 : Math.max(0, tramos.length - 1) * p.duracionTransicion;
  return redondear(Math.max(0, suma - solape), 2);
}

function normalizarToma(v: unknown, archivos: Map<string, ArchivoPlan>, avisos: string[]): Toma | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const a = archivos.get(String(r.archivo ?? ""));
  if (!a) {
    avisos.push("Se ha quitado una toma de un archivo que no está en el trabajo");
    return null;
  }
  let inicio = redondear(Math.max(0, num(r.inicio, 0)), 2);
  let fin = redondear(num(r.fin, inicio + 3), 2);
  if (a.tipo === "video") {
    const dur = num(a.duracion_s, 0);
    if (dur > 0) {
      if (inicio >= dur - 0.3) inicio = Math.max(0, dur - DURACION_PLANO.min - 0.1);
      if (fin > dur) {
        fin = dur;
        avisos.push("Se ha ajustado una toma que pasaba del final del clip");
      }
    }
  } else {
    // Una foto en un vídeo: el plano dura lo que diga la IA, desde 0.
    const d = fin - inicio;
    inicio = 0;
    fin = redondear(lim(d, DURACION_PLANO.min, DURACION_PLANO.max, 2.5), 2);
  }
  if (fin - inicio < DURACION_PLANO.min) fin = redondear(inicio + DURACION_PLANO.min, 2);
  if (fin - inicio > DURACION_PLANO.max) fin = redondear(inicio + DURACION_PLANO.max, 2);
  if (a.tipo === "video" && num(a.duracion_s, 0) > 0 && fin > num(a.duracion_s, 0)) {
    // Clip más corto que el plano mínimo: se usa entero.
    inicio = 0;
    fin = redondear(num(a.duracion_s, 0), 2);
  }
  return {
    archivo: a.id,
    medio: a.tipo,
    inicio,
    fin,
    encuadre: normalizarEncuadre(r.encuadre),
    movimiento: MOVIMIENTOS.includes(r.movimiento as Movimiento) ? (r.movimiento as Movimiento) : a.tipo === "foto" ? "acercar" : "ninguno",
    motivo: limpiarTexto(r.motivo, 200),
  };
}

function normalizarPiezaFoto(v: Record<string, unknown>, ctx: ContextoPlan, archivos: Map<string, ArchivoPlan>, avisos: string[]): PiezaFoto | null {
  const a = archivos.get(String(v.archivo ?? ""));
  if (!a || a.tipo !== "foto") {
    avisos.push("Se ha quitado una pieza de una foto que no está en el trabajo");
    return null;
  }
  let creativo: Creativo = CREATIVOS.includes(v.creativo as Creativo) ? (v.creativo as Creativo) : "ninguno";
  if (creativo !== "ninguno" && !ctx.permitirCreativo) {
    avisos.push("La IA propuso cambiar el fondo de una foto; no se aplica porque no están permitidas las transformaciones creativas");
    creativo = "ninguno";
  }
  return {
    tipo: "foto",
    archivo: a.id,
    correccion: normalizarCorreccion(v.correccion),
    autoNiveles: v.autoNiveles === true,
    encuadre: normalizarEncuadre(v.encuadre),
    rotulos: normalizarRotulos(v.rotulos),
    logo: v.logo === true,
    creativo,
    altText: limpiarTexto(v.altText, LIMITES_TEXTO.altText),
    nota: limpiarTexto(v.nota, LIMITES_TEXTO.nota),
  };
}

function normalizarPiezaVideo(v: Record<string, unknown>, ctx: ContextoPlan, archivos: Map<string, ArchivoPlan>, avisos: string[]): PiezaVideo | null {
  const tomasEntrada = Array.isArray(v.tomas) ? v.tomas.slice(0, MAX_TOMAS) : [];
  const tomas = tomasEntrada.map((t) => normalizarToma(t, archivos, avisos)).filter((t): t is Toma => t !== null);
  if (tomas.length === 0) {
    avisos.push("La propuesta de vídeo no tenía ninguna toma válida");
    return null;
  }
  const transicion: Transicion = TRANSICIONES.includes(v.transicion as Transicion) ? (v.transicion as Transicion) : "fundido";
  const minToma = Math.min(...tomas.map(duracionToma));
  const duracionTransicion = transicion === "corte" ? 0 : redondear(lim(v.duracionTransicion, 0.2, Math.min(1.2, minToma / 2), 0.5), 2);
  const pieza: PiezaVideo = {
    tipo: "video",
    tomas,
    titulos: [],
    subtitulos: v.subtitulos === true && (ctx.conVoz?.length ?? 0) > 0,
    transicion,
    duracionTransicion,
    audio: v.audio === "silencio" ? "silencio" : "original",
    correccion: normalizarCorreccion(v.correccion),
    cierre: { mostrar: false },
    logo: v.logo === true,
    nota: limpiarTexto(v.nota, LIMITES_TEXTO.nota),
  };
  if (v.subtitulos === true && !pieza.subtitulos) avisos.push("No hay voz transcrita en los clips: el vídeo va sin subtítulos");

  // La duración tiene que caber en el formato: si se pasa, se recortan las últimas tomas.
  const max = ctx.formato.duracion?.max ?? 90;
  const min = ctx.formato.duracion?.min ?? 3;
  while (duracionMontaje(pieza) > max && pieza.tomas.length > 1) pieza.tomas.pop();
  if (duracionMontaje(pieza) > max) {
    const t = pieza.tomas[0];
    t.fin = redondear(t.inicio + max, 2);
  }
  if (duracionMontaje(pieza) < min) avisos.push(`El vídeo dura menos de ${min} s, el mínimo del formato: añade más tomas o alarga alguna`);

  const total = duracionMontaje(pieza);
  const titulos = Array.isArray(v.titulos) ? v.titulos.slice(0, MAX_TITULOS) : [];
  for (const tt of titulos) {
    if (!tt || typeof tt !== "object") continue;
    const r = tt as Record<string, unknown>;
    const texto = limpiarTexto(r.texto, LIMITES_TEXTO.subtitulo);
    if (!texto) continue;
    const inicio = redondear(lim(r.inicio, 0, Math.max(0, total - 0.5), 0), 2);
    const fin = redondear(lim(r.fin, inicio + 0.8, total, Math.min(total, inicio + 2.5)), 2);
    pieza.titulos.push({ texto, inicio, fin, posicion: r.posicion === "arriba" || r.posicion === "centro" ? r.posicion : "abajo" });
  }
  const cierre = (v.cierre ?? {}) as Record<string, unknown>;
  if (cierre.mostrar === true) {
    pieza.cierre = { mostrar: true };
    const ti = limpiarTexto(cierre.titulo, LIMITES_TEXTO.titulo);
    const cta = limpiarTexto(cierre.cta, LIMITES_TEXTO.cta);
    if (ti) pieza.cierre.titulo = ti;
    if (cta) pieza.cierre.cta = cta;
  }
  return pieza;
}

/**
 * Deja el plan dentro de lo que sabe hacer el motor y de las reglas de
 * fidelidad. Nunca lanza: lo que no vale se quita y se anota en `avisos`.
 */
export function normalizarPlan(entrada: unknown, ctx: ContextoPlan): PlanEdicion {
  const e = (entrada && typeof entrada === "object" ? entrada : {}) as Record<string, unknown>;
  const avisos: string[] = Array.isArray(e.avisos) ? e.avisos.map((a) => limpiarTexto(a, 300)).filter(Boolean).slice(0, 10) : [];
  const archivos = new Map(ctx.archivos.map((a) => [a.id, a]));
  const piezasEntrada = Array.isArray(e.piezas) ? e.piezas : [];
  let piezas: Pieza[] = [];

  if (ctx.formato.medio === "foto") {
    for (const p of piezasEntrada) {
      if (!p || typeof p !== "object") continue;
      const r = p as Record<string, unknown>;
      if (r.tipo === "video") continue;
      const pf = normalizarPiezaFoto(r, ctx, archivos, avisos);
      if (pf && !piezas.some((x) => x.tipo === "foto" && x.archivo === pf.archivo)) piezas.push(pf);
    }
    const max = ctx.formato.tipo === "carrusel" ? ctx.formato.maxArchivos : 1;
    if (piezas.length > max) {
      avisos.push(`${ctx.formato.etiqueta}: se usan ${max} ${max === 1 ? "foto" : "fotos"}`);
      piezas = piezas.slice(0, max);
    }
    // Fotos que la IA no ha usado en un carrusel: se añaden con la corrección neutra (no se pierde ninguna sin avisar).
    if (ctx.formato.tipo === "carrusel") {
      for (const a of ctx.archivos) {
        if (a.tipo !== "foto" || piezas.length >= max || piezas.some((x) => x.tipo === "foto" && x.archivo === a.id)) continue;
        piezas.push(piezaFotoNeutra(a.id));
        avisos.push("Una foto no tenía propuesta y se ha añadido con la corrección neutra");
      }
    }
  } else {
    const pv = piezasEntrada.find((p) => p && typeof p === "object" && (p as Record<string, unknown>).tipo === "video") as Record<string, unknown> | undefined;
    const v = pv ? normalizarPiezaVideo(pv, ctx, archivos, avisos) : null;
    if (v) piezas = [v];
  }

  const textos = (e.textos ?? {}) as Record<string, unknown>;
  const preguntas = Array.isArray(e.preguntas) ? e.preguntas.map((p) => limpiarTexto(p, 200)).filter(Boolean).slice(0, 3) : [];
  return {
    version: VERSION_PLAN,
    estilo: esEstilo(e.estilo) ? e.estilo : ctx.estilo,
    resumen: limpiarTexto(e.resumen, LIMITES_TEXTO.resumen),
    preguntas,
    piezas,
    textos: {
      caption: limpiarTexto(textos.caption, LIMITES_TEXTO.caption),
      hashtags: normalizarHashtags(textos.hashtags, MAX_HASHTAGS[ctx.formato.canal]),
      titular: limpiarTexto(textos.titular, LIMITES_TEXTO.titular),
    },
    avisos: [...new Set(avisos)],
  };
}

export function piezaFotoNeutra(archivo: string): PiezaFoto {
  return { tipo: "foto", archivo, correccion: { ...CORRECCION_NEUTRA }, autoNiveles: false, encuadre: { x: 0.5, y: 0.5, zoom: 1 }, rotulos: null, logo: false, creativo: "ninguno", altText: "", nota: "" };
}

/**
 * Plan mínimo sin IA (con la IA no disponible, el usuario puede seguir: el
 * motor aplica el estilo y el encuadre centrado). Vídeo: los clips en orden,
 * con planos del ritmo del estilo.
 */
export function planBasico(ctx: ContextoPlan, segundosPorPlano = 2.5): PlanEdicion {
  const fotos = ctx.archivos.filter((a) => a.tipo === "foto");
  const piezas: Pieza[] = [];
  if (ctx.formato.medio === "foto") {
    const n = ctx.formato.tipo === "carrusel" ? ctx.formato.maxArchivos : 1;
    for (const a of fotos.slice(0, n)) piezas.push(piezaFotoNeutra(a.id));
  } else {
    const objetivo = ctx.formato.duracion?.objetivo ?? 15;
    const tomas: Toma[] = [];
    for (const a of ctx.archivos) {
      const d = a.tipo === "video" ? Math.min(num(a.duracion_s, segundosPorPlano), Math.max(segundosPorPlano, objetivo / Math.max(1, ctx.archivos.length))) : segundosPorPlano;
      tomas.push({ archivo: a.id, medio: a.tipo, inicio: 0, fin: redondear(Math.max(DURACION_PLANO.min, d), 2), encuadre: { x: 0.5, y: 0.5, zoom: 1 }, movimiento: a.tipo === "foto" ? "acercar" : "ninguno", motivo: "" });
    }
    piezas.push({ tipo: "video", tomas, titulos: [], subtitulos: false, transicion: "fundido", duracionTransicion: 0.5, audio: "original", correccion: { ...CORRECCION_NEUTRA }, cierre: { mostrar: false }, logo: true, nota: "" });
  }
  return normalizarPlan({ piezas, estilo: ctx.estilo, resumen: "Edición básica sin IA: estilo y encuadre centrado." }, ctx);
}
