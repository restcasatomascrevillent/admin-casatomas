/**
 * `prepararYPublicar(pieza, opciones)`: convierte una publicación montada
 * (post o carrusel de 1–10 imágenes) en JPEG definitivos y la publica YA o la
 * deja programada. Es la ÚNICA puerta del asistente móvil al render y a la
 * publicación; la versión de escritorio tendrá una equivalente y se unificarán.
 *
 * ── Contrato ────────────────────────────────────────────────────────────────
 *
 *   prepararYPublicar(pieza: PiezaMovil, {
 *     cuando: { tipo: "ahora" } | { tipo: "programar", instante: Date },
 *     api?: ApiPublicacionMovil,          // por defecto, la real (apiReal.ts)
 *     onProgreso?: (p: ProgresoPublicar) => void,
 *     cache?: CacheRender,                // imágenes ya generadas (reintentos)
 *     signal?: AbortSignal,
 *   }): Promise<ResultadoPublicar>
 *
 *  1. Valida la pieza (1–10 diapositivas; post = 1; cada diapositiva usa una
 *     foto de `pieza.fotos`; texto ≤ 2200 y ≤ 30 hashtags) y, si se programa,
 *     la hora (≥ ahora + 10 min y ≤ 75 días, como las RPC de programar).
 *     Si no vale, lanza ErrorPublicarMovil («validacion») SIN llamar a nada.
 *  2. Genera una imagen por diapositiva, en orden, con
 *     `api.renderizarImagen(...)` → `{ piezaId, urlJpeg }`, avisando
 *     `{ fase: "preparando", hechas, total }` antes y después de cada una. Los
 *     fallos de red/servidor se reintentan (conReintentos, esperando a la
 *     cobertura); los de validación (422) no. Las ya generadas se guardan en
 *     `cache` (clave = firma de la diapositiva) y no se repiten al reintentar.
 *  3. `{ fase: "publicando" }` → `api.publicar(...)` → `{ permalink }`, o
 *     `{ fase: "programando" }` → `api.programar(...)` → `{ programadaPara }`.
 *     Publicar NO se reintenta solo (podría salir dos veces): el error sube y
 *     el usuario decide; al reintentar, las imágenes salen de la caché.
 *  4. Devuelve `{ estado: "publicada" | "programada", piezaIds, permalink,
 *     programadaPara, avisos }`.
 */
import { utcAMadrid, validarProgramacion } from "@/components/instagram/programar/logica";
import { MAX_FOTOS_CARRUSEL, type DiapositivaMontada, type FormatoMontado, type FotoParaMontar } from "@/lib/instagram/montar";
import type { MarcaId } from "@/lib/instagram";
import { conReintentos, type OpcionesReintento } from "./reintentos";

/** Límites de Instagram. */
export const MAX_CAPTION = 2200;
export const MAX_HASHTAGS = 30;

export interface PiezaMovil {
  marca: MarcaId;
  formato: FormatoMontado;
  /** Fotos ya preparadas en el servidor (las que se mandaron a montar). */
  fotos: FotoParaMontar[];
  /** En el orden de publicación; la primera es la portada. */
  diapositivas: DiapositivaMontada[];
  /** Texto final tal cual se publica (con los hashtags). */
  caption: string;
}

export type CuandoPublicar = { tipo: "ahora" } | { tipo: "programar"; instante: Date };

export type ProgresoPublicar =
  | { fase: "preparando"; hechas: number; total: number }
  | { fase: "reintentando"; sinConexion: boolean }
  | { fase: "publicando" }
  | { fase: "programando" };

export interface ResultadoPublicar {
  estado: "publicada" | "programada";
  /** Filas de instagram_piezas generadas (una por imagen). */
  piezaIds: string[];
  permalink: string | null;
  /** ISO, si se programó. */
  programadaPara: string | null;
  avisos: string[];
}

export interface ImagenGenerada {
  piezaId: string;
  urlJpeg: string;
}

export interface ArgsRender {
  marca: MarcaId;
  formato: FormatoMontado;
  diapositiva: DiapositivaMontada;
  foto: FotoParaMontar;
  /** 0-based. */
  indice: number;
  total: number;
  /** Id del grupo (mismo para todas las imágenes de un carrusel). */
  grupo: string;
  caption: string;
}

export interface ArgsPublicar {
  marca: MarcaId;
  formato: FormatoMontado;
  grupo: string;
  piezaIds: string[];
  caption: string;
  /** Un texto alternativo por imagen, en orden. */
  altTexts: string[];
  /** Copias tmp/ de las fotos de origen (para borrarlas tras publicar). */
  fotosTmp: string[];
}

/** Lo que tiene que dar el servidor (real en apiReal.ts; simulada aquí abajo). */
export interface ApiPublicacionMovil {
  renderizarImagen(a: ArgsRender): Promise<ImagenGenerada>;
  publicar(a: ArgsPublicar): Promise<{ permalink: string | null; avisos?: string[] }>;
  programar(a: ArgsPublicar & { instante: Date }): Promise<{ programadaPara: string; avisos?: string[] }>;
}

export type CacheRender = Map<string, ImagenGenerada>;

export class ErrorPublicarMovil extends Error {
  constructor(
    mensaje: string,
    readonly tipo: "validacion" | "render" | "publicar" | "programar",
    readonly causa?: unknown,
  ) {
    super(mensaje);
    this.name = "ErrorPublicarMovil";
  }
}

export interface OpcionesPublicar {
  cuando: CuandoPublicar;
  api: ApiPublicacionMovil;
  onProgreso?: (p: ProgresoPublicar) => void;
  cache?: CacheRender;
  signal?: AbortSignal;
  /** Ajustes de reintento del render (las pruebas los ponen a 0 ms). */
  reintento?: Omit<OpcionesReintento, "signal" | "alReintentar">;
  ahora?: Date;
  /** Grupo fijo (pruebas); por defecto un uuid nuevo por pieza. */
  grupo?: string;
}

export function contarHashtags(caption: string): number {
  return (caption.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;
}

/** Problemas de la pieza (vacío = se puede publicar). */
export function problemasPieza(p: PiezaMovil): string[] {
  const problemas: string[] = [];
  const n = p.diapositivas.length;
  if (n < 1) problemas.push("No hay ninguna imagen.");
  if (n > MAX_FOTOS_CARRUSEL) problemas.push(`Como mucho ${MAX_FOTOS_CARRUSEL} imágenes.`);
  if ((p.formato === "post" || p.formato === "story") && n !== 1) problemas.push("Un post lleva una sola imagen.");
  if (p.formato === "carrusel" && n < 2) problemas.push("Un carrusel necesita al menos 2 imágenes.");
  const ids = new Set(p.fotos.map((f) => f.id));
  if (p.diapositivas.some((d) => !ids.has(d.foto))) problemas.push("Una imagen usa una foto que ya no está.");
  if (!p.caption.trim()) problemas.push("Falta el texto de la publicación.");
  if (p.caption.length > MAX_CAPTION) problemas.push(`El texto es demasiado largo (${p.caption.length} de ${MAX_CAPTION} caracteres).`);
  if (contarHashtags(p.caption) > MAX_HASHTAGS) problemas.push(`Instagram admite como mucho ${MAX_HASHTAGS} hashtags.`);
  return problemas;
}

/** Clave de caché de una imagen: cambia si cambia la foto, la plantilla o los rótulos. */
export function firmaDiapositiva(marca: MarcaId, formato: FormatoMontado, d: DiapositivaMontada, foto: FotoParaMontar): string {
  return JSON.stringify([marca, formato === "story" ? "story" : "post", d.plantilla, d.datos, foto.id, foto.url]);
}

function nuevoGrupo(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `grupo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function prepararYPublicar(pieza: PiezaMovil, o: OpcionesPublicar): Promise<ResultadoPublicar> {
  const problemas = problemasPieza(pieza);
  if (problemas.length) throw new ErrorPublicarMovil(problemas.join(" "), "validacion");
  if (o.cuando.tipo === "programar") {
    const ahora = o.ahora ?? new Date();
    const v = validarProgramacion(...fechaHoraMadrid(o.cuando.instante), ahora);
    if ("error" in v) throw new ErrorPublicarMovil(v.error, "validacion");
  }
  const cache = o.cache ?? new Map();
  const grupo = o.grupo ?? nuevoGrupo();
  const total = pieza.diapositivas.length;
  const fotos = new Map(pieza.fotos.map((f) => [f.id, f]));
  const imagenes: ImagenGenerada[] = [];
  o.onProgreso?.({ fase: "preparando", hechas: 0, total });
  for (let i = 0; i < total; i++) {
    const d = pieza.diapositivas[i];
    const foto = fotos.get(d.foto)!;
    const firma = firmaDiapositiva(pieza.marca, pieza.formato, d, foto);
    let img = cache.get(firma);
    if (!img) {
      try {
        img = await conReintentos(() => o.api.renderizarImagen({ marca: pieza.marca, formato: pieza.formato, diapositiva: d, foto, indice: i, total, grupo, caption: pieza.caption }), {
          intentos: 3,
          ...o.reintento,
          signal: o.signal,
          alReintentar: ({ sinConexion }) => o.onProgreso?.({ fase: "reintentando", sinConexion }),
        });
      } catch (e) {
        throw new ErrorPublicarMovil(`No se ha podido preparar la imagen ${i + 1} de ${total}: ${(e as Error)?.message ?? "error"}`, "render", e);
      }
      cache.set(firma, img);
    }
    imagenes.push(img);
    o.onProgreso?.({ fase: "preparando", hechas: i + 1, total });
  }
  const args: ArgsPublicar = {
    marca: pieza.marca,
    formato: pieza.formato,
    grupo,
    piezaIds: imagenes.map((x) => x.piezaId),
    caption: pieza.caption,
    altTexts: pieza.diapositivas.map((d) => d.altText),
    fotosTmp: pieza.diapositivas.map((d) => fotos.get(d.foto)!.url),
  };
  if (o.cuando.tipo === "ahora") {
    o.onProgreso?.({ fase: "publicando" });
    try {
      const r = await o.api.publicar(args);
      return { estado: "publicada", piezaIds: args.piezaIds, permalink: r.permalink ?? null, programadaPara: null, avisos: r.avisos ?? [] };
    } catch (e) {
      throw new ErrorPublicarMovil(`No se ha podido publicar: ${(e as Error)?.message ?? "error"}`, "publicar", e);
    }
  }
  o.onProgreso?.({ fase: "programando" });
  try {
    const r = await o.api.programar({ ...args, instante: o.cuando.instante });
    return { estado: "programada", piezaIds: args.piezaIds, permalink: null, programadaPara: r.programadaPara, avisos: r.avisos ?? [] };
  } catch (e) {
    throw new ErrorPublicarMovil(`No se ha podido programar: ${(e as Error)?.message ?? "error"}`, "programar", e);
  }
}

// La validación de programar trabaja con fecha y hora de Madrid.
function fechaHoraMadrid(d: Date): [string, string] {
  const { fecha, hora } = utcAMadrid(d);
  return [fecha, hora];
}

// ── API simulada (pruebas y demo) ────────────────────────────────────────────

export interface ApiSimulada extends ApiPublicacionMovil {
  renders: ArgsRender[];
  publicadas: ArgsPublicar[];
  programadas: Array<ArgsPublicar & { instante: Date }>;
}

/**
 * API de publicación simulada. `espera` en ms por llamada; `fallarRender(n)`
 * lanza en el render n-ésimo (para probar los reintentos).
 */
export function crearApiPublicacionSimulada(o: { espera?: number; fallarRender?: (n: number) => Error | null; fallarPublicar?: (n: number) => Error | null } = {}): ApiSimulada {
  const renders: ArgsRender[] = [];
  const publicadas: ArgsPublicar[] = [];
  const programadas: Array<ArgsPublicar & { instante: Date }> = [];
  let nRender = 0;
  let nPublicar = 0;
  const esperar = () => (o.espera ? new Promise((r) => setTimeout(r, o.espera)) : Promise.resolve());
  return {
    renders,
    publicadas,
    programadas,
    async renderizarImagen(a) {
      nRender++;
      await esperar();
      const e = o.fallarRender?.(nRender);
      if (e) throw e;
      renders.push(a);
      return { piezaId: `pieza-${a.grupo}-${a.indice}`, urlJpeg: a.foto.url };
    },
    async publicar(a) {
      nPublicar++;
      await esperar();
      const e = o.fallarPublicar?.(nPublicar);
      if (e) throw e;
      publicadas.push(a);
      return { permalink: `https://www.instagram.com/p/SIMULADA${publicadas.length}/` };
    },
    async programar(a) {
      await esperar();
      programadas.push(a);
      return { programadaPara: a.instante.toISOString() };
    },
  };
}
