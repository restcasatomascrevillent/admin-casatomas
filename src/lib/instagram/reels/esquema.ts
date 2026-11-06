/**
 * Esquema ReelPieza (zod 4, como src/lib/instagram/esquema.ts) y validación.
 *
 * Un reel = marca + base + escenas (foto, encuadre, transición y rótulo) +
 * cierre (foto, frase, CTA y datos). validarReel es SÍNCRONA y no lanza:
 *   { ok: true, reel, avisos } | { ok: false, problemas, avisos }
 * - problemas: impiden usar el reel (forma, duración total fuera de 5–90 s,
 *   textos que no caben a lo ancho o en las líneas del estilo, emojis…);
 * - avisos: se puede seguir (escena sin foto, foto de muestra, foto pequeña
 *   para el zoom, rótulo que no termina de entrar antes de irse…).
 *
 * «Textos que se salen»: el lienzo es fijo (1080 px), así que se ESTIMA el
 * ancho de cada línea con un ancho medio por carácter de cada fuente
 * (conservador, unos puntos por encima de lo medido) y se reparte en líneas
 * como el navegador (por palabras). Es una regla rápida para el editor; la
 * medición exacta en el DOM queda para el render (fase 6).
 */
import { z } from "zod/v4";
import { contarPalabras, emojisEn } from "../esquema.js";
import { calcularTiempos, ANCHO_REEL, ZONA_SEGURA_REEL, SALIDA_ROTULO_POR_DEFECTO } from "./motor.js";
import { CTAS_REEL } from "./marca.js";
import { MUESTRAS_REEL, esMuestra, nombreMuestra } from "./fotos.js";

// ── Catálogos ────────────────────────────────────────────────────────────────

export const BASES_REEL = ["bienvenido", "del-mar", "bodega", "brasa", "touza", "libre"] as const;
export type BaseReel = (typeof BASES_REEL)[number];

/** Las que ofrece el editor por defecto: «sin transiciones llamativas» (readme). */
export const TRANSICIONES_BASICAS = ["dissolve", "zoom", "rise", "blur"] as const;
/** Las del reel-kit que chocan con esa regla: solo como «avanzadas». */
export const TRANSICIONES_AVANZADAS = ["wipe", "push", "iris", "flash", "glass"] as const;
export const TRANSICIONES_REEL = [...TRANSICIONES_BASICAS, ...TRANSICIONES_AVANZADAS] as const;
export type TransicionReel = (typeof TRANSICIONES_REEL)[number];

export const ESTILOS_ROTULO = ["intro", "hook", "label", "mask", "box", "letters", "pill", "number"] as const;
export type EstiloRotulo = (typeof ESTILOS_ROTULO)[number];

// ── Límites ──────────────────────────────────────────────────────────────────

export const LIMITES_REEL = {
  totalMin: 5,
  totalMax: 90,
  escenaMin: 1.5,
  escenaMax: 10,
  cierreMin: 3,
  cierreMax: 8,
  escenasMin: 1,
  escenasMax: 15,
  /** Palabras del título de un rótulo (propuesta 5.2). */
  palabrasTitulo: 5,
  /** Lado corto mínimo recomendado de una foto (zooms de hasta ×1,75). */
  ladoCortoFoto: 2000,
} as const;

// ── Esquema ──────────────────────────────────────────────────────────────────

const texto = z.string().trim();
const posicion = texto.regex(/^-?\d+(\.\d+)?% -?\d+(\.\d+)?%$/, "debe ser «X% Y%», p. ej. «50% 50%»");
const par = (min: number, max: number) => z.tuple([z.number().min(min).max(max), z.number().min(min).max(max)]);

export const EsquemaEncuadre = z.strictObject({
  /** object-position de la foto («50% 55%»). */
  pos: posicion,
  /** transform-origin del zoom. */
  origen: posicion.optional(),
  /** Zoom al empezar y al acabar (Ken Burns). */
  zoom: par(0.8, 2.5),
  /** Desplazamiento horizontal/vertical en px del lienzo, de principio a fin. */
  desplazamientoX: par(-400, 400).optional(),
  desplazamientoY: par(-400, 400).optional(),
  /** Paneo horizontal: object-position X de principio a fin (%), para fotos apaisadas. */
  paneo: par(0, 100).optional(),
});

export const EsquemaRotulo = z.strictObject({
  estilo: z.enum(ESTILOS_ROTULO),
  antetitulo: texto.min(1).max(60).optional(),
  titulo: texto.min(1).max(60).optional(),
  sub: texto.min(1).max(60).optional(),
  /** Solo «pill»: por defecto, a la derecha. */
  alinear: z.enum(["izquierda", "derecha"]).optional(),
  /** Escala del título (size de reel-kit). */
  tamano: z.number().min(0.5).max(1.3).optional(),
});

const idFoto = texto.min(1).max(200).regex(/^\S+$/, "no puede llevar espacios");

export const EsquemaEscena = z.strictObject({
  /** Clave estable (para reordenar y para React). */
  id: texto.min(1).max(40),
  nombre: texto.min(1).max(40),
  /** Qué foto pide la escena (ayuda para elegirla). */
  nota: texto.max(160).optional(),
  duracion_s: z.number().min(LIMITES_REEL.escenaMin).max(LIMITES_REEL.escenaMax),
  foto: idFoto.optional(),
  encuadre: EsquemaEncuadre,
  /** Cómo ENTRA esta escena (en la primera no se usa). */
  transicion: z.enum(TRANSICIONES_REEL).optional(),
  rotulo: EsquemaRotulo.optional(),
});

export const EsquemaCierre = z.strictObject({
  duracion_s: z.number().min(LIMITES_REEL.cierreMin).max(LIMITES_REEL.cierreMax),
  foto: idFoto.optional(),
  encuadre: EsquemaEncuadre,
  transicion: z.enum(TRANSICIONES_REEL).optional(),
  frase: texto.min(1).max(120),
  /** px de la frase (lineSize de reel-kit; por defecto 52). */
  tamanoFrase: z.number().min(36).max(60).optional(),
  cta: z.enum(CTAS_REEL),
  /** Línea de datos; si falta, la de la marca (DATOS_MARCA_REEL). */
  datos: texto.min(1).max(60).optional(),
});

export const EsquemaReelPieza = z.strictObject({
  marca: z.enum(["casa-tomas", "touza"]),
  base: z.enum(BASES_REEL),
  escenas: z.array(EsquemaEscena).min(LIMITES_REEL.escenasMin).max(LIMITES_REEL.escenasMax),
  cierre: EsquemaCierre,
  /** Solape de las transiciones en s (tr de REEL_CONFIG; por defecto 0,75 / 0,95). */
  transicion_s: z.strictObject({ entrada: z.number().min(0.2).max(2), salida: z.number().min(0.2).max(2) }).optional(),
  /** Lo que tarda en irse cada rótulo (textOut; por defecto 0,6 s). */
  salidaRotulo_s: z.number().min(0.2).max(1.5).optional(),
});

export type EncuadreReel = z.infer<typeof EsquemaEncuadre>;
export type RotuloReel = z.infer<typeof EsquemaRotulo>;
export type EscenaReel = z.infer<typeof EsquemaEscena>;
export type CierreReel = z.infer<typeof EsquemaCierre>;
export type ReelPieza = z.infer<typeof EsquemaReelPieza>;

export type ResultadoValidacionReel =
  | { ok: true; reel: ReelPieza; avisos: string[]; problemas?: undefined }
  | { ok: false; problemas: string[]; avisos: string[]; reel?: undefined };

// ── Estimación de ancho de texto ─────────────────────────────────────────────

type Fuente = "titular-bold" | "titular-italica" | "texto" | "texto-mayus";

/**
 * Ancho medio de un carácter en em, por marca y fuente. Medido a ojo sobre
 * frases en español con las fuentes del panel y redondeado hacia arriba.
 */
const ANCHO_EM: Record<"casa-tomas" | "touza", Record<Fuente, number>> = {
  "casa-tomas": { "titular-bold": 0.64, "titular-italica": 0.54, texto: 0.6, "texto-mayus": 0.78 },
  touza: { "titular-bold": 0.5, "titular-italica": 0.42, texto: 0.6, "texto-mayus": 0.78 },
};

function anchoTexto(t: string, px: number, fuente: Fuente, marca: "casa-tomas" | "touza", tracking = 0): number {
  const base = ANCHO_EM[marca][fuente];
  let em = 0;
  for (const c of t) {
    let f = base;
    if (c === " ") f = base * 0.5;
    else if (/[iljI.,:;'’·!|]/u.test(c)) f = base * 0.55;
    else if (/[mwMW]/u.test(c)) f = base * 1.45;
    else if (fuente !== "texto-mayus" && /\p{Lu}/u.test(c)) f = base * 1.3;
    em += f + tracking;
  }
  return em * px;
}

interface PiezaTexto {
  campo: string;
  texto: string;
  px: number;
  fuente: Fuente;
  tracking?: number;
  /** Ancho disponible (px del lienzo). */
  ancho: number;
  maxLineas: number;
}

/** Reparte por palabras (como el navegador). null si una palabra sola no cabe. */
function lineasDe(p: PiezaTexto, marca: "casa-tomas" | "touza"): { lineas: number; palabraLarga?: string } {
  const palabras = p.texto.split(/\s+/u).filter(Boolean);
  const espacio = anchoTexto(" ", p.px, p.fuente, marca, p.tracking);
  let lineas = 1;
  let actual = 0;
  for (const w of palabras) {
    const a = anchoTexto(w, p.px, p.fuente, marca, p.tracking);
    if (a > p.ancho) return { lineas, palabraLarga: w };
    if (actual === 0) actual = a;
    else if (actual + espacio + a <= p.ancho) actual += espacio + a;
    else {
      lineas++;
      actual = a;
    }
  }
  return { lineas };
}

/** Ancho útil de un rótulo: left/right 80 de reel-kit (dentro de los 64 de la zona segura). */
const ANCHO_ROTULO = ANCHO_REEL - 160;

/** Las piezas de texto de un rótulo con su fuente, tamaño y caja (copiado de ShotText). */
function piezasDeRotulo(r: RotuloReel): PiezaTexto[] {
  const fs = r.tamano ?? 1;
  const out: PiezaTexto[] = [];
  const eb = (ancho: number, tracking = 0.35, px = 28) =>
    r.antetitulo && out.push({ campo: "antetítulo", texto: r.antetitulo, px, fuente: "texto-mayus", tracking, ancho, maxLineas: 1 });
  const ti = (px: number, fuente: Fuente, ancho: number, maxLineas: number) =>
    r.titulo && out.push({ campo: "título", texto: r.titulo, px: px * fs, fuente, ancho, maxLineas });
  const su = (px: number, fuente: Fuente, ancho: number, maxLineas: number, tracking = 0) =>
    r.sub && out.push({ campo: "subtítulo", texto: r.sub, px, fuente, tracking, ancho, maxLineas });
  switch (r.estilo) {
    case "intro":
      eb(ANCHO_ROTULO, 0.3, 30);
      break;
    case "hook":
      eb(ANCHO_ROTULO);
      ti(140, "titular-bold", ANCHO_ROTULO, 3);
      su(56, "titular-italica", ANCHO_ROTULO, 2);
      break;
    case "mask":
      ti(150, "titular-italica", ANCHO_ROTULO, 2);
      su(58, "titular-bold", ANCHO_ROTULO - 168, 2);
      break;
    case "box": {
      const interior = ANCHO_ROTULO - 64;
      eb(interior - 2 * (90 + 24));
      ti(120, "titular-bold", interior, 2);
      su(68, "titular-italica", interior, 2);
      break;
    }
    case "letters":
      eb(ANCHO_ROTULO);
      ti(78, "titular-italica", ANCHO_ROTULO, 3);
      break;
    case "pill":
      eb(ANCHO_ROTULO - 68, 0.18);
      ti(112, "titular-bold", ANCHO_ROTULO, 2);
      su(112 * fs, "titular-italica", ANCHO_ROTULO, 2);
      break;
    case "number":
      eb(ANCHO_ROTULO, 0.5);
      ti(280, "titular-bold", ANCHO_ROTULO, 1);
      su(60, "titular-italica", ANCHO_ROTULO, 2);
      break;
    case "label":
      eb(ANCHO_ROTULO - 35);
      ti(100, "titular-bold", ANCHO_ROTULO - 35, 2);
      su(36, "texto", ANCHO_ROTULO - 35, 2, 0.08);
      break;
  }
  return out;
}

/** Problemas de textos que se salen (a lo ancho o por número de líneas). */
export function problemasDeTexto(piezas: PiezaTexto[], marca: "casa-tomas" | "touza", donde: string): string[] {
  const p: string[] = [];
  for (const pz of piezas) {
    const { lineas, palabraLarga } = lineasDe(pz, marca);
    if (palabraLarga) {
      p.push(`${donde}: en el ${pz.campo}, «${palabraLarga}» no cabe a lo ancho del vídeo; acórtalo${pz.campo === "título" ? " o baja el tamaño" : ""}`);
    } else if (lineas > pz.maxLineas) {
      p.push(
        `${donde}: el ${pz.campo} «${pz.texto}» se sale (ocuparía ${lineas} líneas y caben ${pz.maxLineas}); acórtalo${pz.campo === "título" ? " o baja el tamaño" : ""}`,
      );
    }
  }
  return p;
}

// ── Tiempos de entrada de los rótulos (copiados de ShotText y Closing) ───────

/** Segundos desde el inicio de la escena hasta que el rótulo queda entero. */
export function entradaRotulo_s(r: RotuloReel): number {
  const n = (s?: string) => (s ? [...s].length : 0);
  switch (r.estilo) {
    case "intro":
      return 2.4;
    case "hook": {
      const palabras = r.titulo ? r.titulo.split(" ").length : 1;
      return Math.max(0.35 + (palabras - 1) * 0.14 + 0.7, r.sub ? 2.0 : 0);
    }
    case "mask":
      return 2.0;
    case "box":
      return 1.9;
    case "letters":
      return 0.5 + Math.max(0, n(r.titulo) - 1) * 0.035 + 0.6;
    case "pill":
      return 1.95;
    case "number":
      return Math.max(0.6 + Math.max(0, n(r.titulo) - 1) * 0.12 + 0.9, r.sub ? 2.3 : 0);
    case "label":
      return 2.0;
  }
}

/** Segundos desde el inicio del cierre hasta que todo está quieto (frase, CTA y datos). */
export function entradaCierre_s(c: Pick<CierreReel, "frase">): number {
  const palabras = c.frase.split(" ").length;
  return Math.max(1.1 + (palabras - 1) * 0.08 + 0.7, 2.2 + 0.7, 2.6 + 0.8);
}

// ── Validación ───────────────────────────────────────────────────────────────

function ruta(p: readonly PropertyKey[]): string {
  return p.map((x, i) => (typeof x === "number" ? `[${x}]` : i === 0 ? String(x) : `.${String(x)}`)).join("");
}

function problemaZod(issue: z.core.$ZodIssue, entrada: unknown): string {
  const campo = ruta(issue.path);
  switch (issue.code) {
    case "unrecognized_keys":
      return issue.keys.map((k) => `Campo desconocido «${campo ? `${campo}.` : ""}${k}»`).join("\n");
    case "invalid_type": {
      let valor: unknown = entrada;
      for (const k of issue.path) valor = valor && typeof valor === "object" ? (valor as Record<PropertyKey, unknown>)[k] : undefined;
      if (valor === undefined) return campo ? `Falta el campo obligatorio «${campo}»` : "El reel debe ser un objeto JSON";
      const tipo =
        issue.expected === "string" ? "un texto" : issue.expected === "number" ? "un número" : issue.expected === "array" ? "una lista" : issue.expected === "object" ? "un objeto" : issue.expected;
      return `«${campo}» debe ser ${tipo}`;
    }
    case "invalid_value":
      return `«${campo}» debe ser uno de: ${issue.values.map(String).join(", ")}`;
    case "too_small":
      if (issue.origin === "array") return `«${campo}» necesita al menos ${String(issue.minimum)} elemento(s)`;
      if (issue.origin === "string") return `«${campo}» está vacío`;
      return `«${campo}» debe ser como mínimo ${String(issue.minimum)}`;
    case "too_big":
      if (issue.origin === "array") return `«${campo}» admite como máximo ${String(issue.maximum)} elementos`;
      if (issue.origin === "string") return `«${campo}» tiene más de ${String(issue.maximum)} caracteres`;
      return `«${campo}» debe ser como máximo ${String(issue.maximum)}`;
    case "invalid_format":
      return `«${campo}»: ${issue.message}`;
    default:
      return `«${campo || "reel"}»: ${issue.message}`;
  }
}

export interface OpcionesValidacionReel {
  /** Medidas de las fotos ya conocidas (para avisar si son pequeñas para el zoom). */
  medidasFoto?: (id: string) => { ancho: number; alto: number } | undefined;
}

const nombreEscena = (e: Pick<EscenaReel, "nombre">, i: number) => `Escena ${i + 1} «${e.nombre}»`;

function revisarFoto(
  id: string | undefined,
  donde: string,
  marca: ReelPieza["marca"],
  opciones: OpcionesValidacionReel,
  problemas: string[],
  avisos: string[],
  muestras: string[],
) {
  if (!id) {
    avisos.push(`${donde}: no tiene foto (se verá el fondo negro)`);
    return;
  }
  if (esMuestra(id)) {
    const m = MUESTRAS_REEL[nombreMuestra(id)];
    if (!m) problemas.push(`${donde}: la foto de muestra «${nombreMuestra(id)}» no existe`);
    else if (m !== marca) problemas.push(`${donde}: la foto de muestra «${nombreMuestra(id)}» es de la otra marca`);
    else muestras.push(donde);
    return;
  }
  const medidas = opciones.medidasFoto?.(id);
  if (medidas && Math.min(medidas.ancho, medidas.alto) < LIMITES_REEL.ladoCortoFoto) {
    avisos.push(
      `${donde}: la foto mide ${medidas.ancho}×${medidas.alto}; con el zoom puede verse blanda (mejor ≥ ${LIMITES_REEL.ladoCortoFoto} px de lado corto)`,
    );
  }
}

/** Problemas y avisos de un reel ya con la forma correcta. */
export function revisarReel(reel: ReelPieza, opciones: OpcionesValidacionReel = {}): { problemas: string[]; avisos: string[] } {
  const problemas: string[] = [];
  const avisos: string[] = [];
  const muestras: string[] = [];
  const { total } = calcularTiempos(reel);
  if (total < LIMITES_REEL.totalMin || total > LIMITES_REEL.totalMax) {
    problemas.push(
      `El reel dura ${formatearSegundos(total)} y tiene que durar entre ${LIMITES_REEL.totalMin} y ${LIMITES_REEL.totalMax} s`,
    );
  }
  const salida = reel.salidaRotulo_s ?? SALIDA_ROTULO_POR_DEFECTO;
  const ids = new Set<string>();

  reel.escenas.forEach((e, i) => {
    const donde = nombreEscena(e, i);
    if (ids.has(e.id)) problemas.push(`${donde}: el id «${e.id}» está repetido`);
    ids.add(e.id);
    revisarFoto(e.foto, donde, reel.marca, opciones, problemas, avisos, muestras);
    if (i > 0 && !e.transicion) avisos.push(`${donde}: sin transición entra de golpe`);
    const r = e.rotulo;
    if (!r) return;
    if (r.estilo === "intro") {
      if (r.titulo || r.sub) problemas.push(`${donde}: el rótulo «intro» solo lleva el logo y el antetítulo (quita título y subtítulo)`);
    } else if (!r.titulo) {
      problemas.push(`${donde}: el rótulo «${r.estilo}» necesita título`);
    }
    if ((r.estilo === "pill" || r.estilo === "box") && !r.antetitulo) problemas.push(`${donde}: el rótulo «${r.estilo}» necesita antetítulo`);
    if (r.alinear && r.estilo !== "pill") problemas.push(`${donde}: «alinear» solo se usa en el rótulo «pill»`);
    if (r.titulo && contarPalabras(r.titulo) > LIMITES_REEL.palabrasTitulo) {
      problemas.push(`${donde}: el título tiene ${contarPalabras(r.titulo)} palabras; máximo ${LIMITES_REEL.palabrasTitulo}`);
    }
    if (r.estilo === "number" && r.titulo && [...r.titulo].length > 6) problemas.push(`${donde}: el rótulo «number» es para cifras cortas (máximo 6 caracteres)`);
    for (const [campo, v] of [
      ["antetítulo", r.antetitulo],
      ["título", r.titulo],
      ["subtítulo", r.sub],
    ] as const) {
      if (v && emojisEn(v).length) problemas.push(`${donde}: el ${campo} lleva emojis (${emojisEn(v).join(" ")}): no se admiten`);
    }
    problemas.push(...problemasDeTexto(piezasDeRotulo(r), reel.marca, donde));
    const visible = e.duracion_s - salida;
    const entra = entradaRotulo_s(r);
    if (entra > visible) {
      avisos.push(`${donde}: el rótulo no termina de entrar antes de irse; alarga la escena a ${formatearSegundos(Math.ceil((entra + salida) * 2) / 2)} o acorta el texto`);
    }
  });

  const c = reel.cierre;
  revisarFoto(c.foto, "Cierre", reel.marca, opciones, problemas, avisos, muestras);
  if (muestras.length) {
    avisos.push(
      `${muestras.length === reel.escenas.length + 1 ? "Todas las fotos son" : `${muestras.length} fotos son`} de MUESTRA (baja resolución): cámbialas por fotos de la biblioteca antes de generar el vídeo`,
    );
  }
  for (const [campo, v] of [
    ["frase", c.frase],
    ["datos", c.datos],
  ] as const) {
    if (v && emojisEn(v).length) problemas.push(`Cierre: la ${campo} lleva emojis (${emojisEn(v).join(" ")}): no se admiten`);
  }
  problemas.push(
    ...problemasDeTexto(
      [
        { campo: "frase", texto: c.frase, px: c.tamanoFrase ?? 52, fuente: "titular-italica", ancho: 860, maxLineas: 4 },
        ...(c.datos ? [{ campo: "datos", texto: c.datos, px: 32, fuente: "texto" as const, ancho: ANCHO_REEL - 2 * ZONA_SEGURA_REEL.lados - 60, maxLineas: 1 }] : []),
      ],
      reel.marca,
      "Cierre",
    ),
  );
  const quieto = entradaCierre_s(c) + 0.6;
  if (quieto > c.duracion_s) avisos.push(`Cierre: con ${formatearSegundos(c.duracion_s)} no da tiempo a leer el CTA y los datos; mejor ${formatearSegundos(Math.ceil(quieto * 2) / 2)}`);
  return { problemas, avisos };
}

/** Valida el JSON de un reel. Devuelve el reel limpio (trim) o TODOS los problemas. No lanza. */
export function validarReel(json: unknown, opciones: OpcionesValidacionReel = {}): ResultadoValidacionReel {
  const r = EsquemaReelPieza.safeParse(json);
  if (!r.success) {
    return { ok: false, problemas: r.error.issues.flatMap((i) => problemaZod(i, json).split("\n")), avisos: [] };
  }
  const { problemas, avisos } = revisarReel(r.data, opciones);
  if (problemas.length) return { ok: false, problemas, avisos };
  return { ok: true, reel: r.data, avisos };
}

/** «20,5 s» */
export function formatearSegundos(s: number): string {
  return `${(Math.round(s * 10) / 10).toLocaleString("es-ES", { maximumFractionDigits: 1 })} s`;
}
