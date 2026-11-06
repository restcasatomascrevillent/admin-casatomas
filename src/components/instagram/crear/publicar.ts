/**
 * «Publicar ahora» y «Programar» desde Crear, SIN paso de prueba: el panel
 * genera las imágenes (render) y luego pide publicar o programar.
 *
 * ── Contrato de prepararYPublicar ─────────────────────────────────────────
 *
 *  Entrada (PeticionPublicacion):
 *    marca, formato ("post" | "story" | "carrusel"),
 *    diapositivas: 1 (post/story) o 2–10 (carrusel), cada una con
 *      pieza          JSON de la pieza (piezaDesdeBorrador) en formato post o story,
 *      fotoPreparada  copia de la foto en el bucket (la necesita el render),
 *      altText        texto alternativo de ESA imagen (la IA lo pone),
 *      piezaId        id de instagram_piezas si ya existe (borrador abierto): se actualiza;
 *    caption          texto final (con hashtags; vacío en stories),
 *    fotosTmp         copias tmp/ de las fotos (el servidor las borra al publicar),
 *    programarPara    null = ahora; Date = programar a esa hora.
 *
 *  Pasos y progreso (onProgreso):
 *    1. { fase: "imagenes", hechas, total }  render de cada imagen, en orden y de una en una
 *       (api.renderizar → POST /api/instagram-render, una pieza por imagen; devuelve su id).
 *    2a. { fase: "publicando" }   api.publicarAhora({ piezaIds, caption, altTexts, fotosTmp })
 *    2b. { fase: "programando" }  api.programar({ piezaIds, caption, altTexts, instante })
 *
 *  Salida (ResultadoPublicacion), estado:
 *    "publicada"   con permalink;
 *    "en_proceso"  Instagram aún procesa: reintentar con continuarPublicacion (mismo contenedor, sin volver a generar);
 *    "programada"  con programadaPara (ISO);
 *    "conflicto"   hay otra de la misma marca a ±30 min: continuarPublicacion con confirmarConflicto.
 *  Errores: lanza ErrorInstagram (render, sesión, servidor) con su mensaje en llano.
 *
 * ── Lo que tiene que hacer el servidor (otro encargo) ─────────────────────
 *  instagram-publicar, cuerpo { directo: true, ids: [uuid…], caption, altTexts: [..], fotosTmp: [..],
 *  contenedorId? } → publicar sin exigir «prueba_ok»: 1 id = imagen o story; 2–10 = carrusel
 *  (contenedores hijos is_carousel_item + contenedor CAROUSEL). Respuesta como hoy
 *  ({ estado: "publicada" | "en_proceso", contenedor, permalink, avisos }).
 *  Con { accion: "programar", ids, caption, altTexts, programarPara, confirmarConflicto } guarda
 *  texto y alt en las piezas y programa (instagram_programar) → { ok, programacion: { id, programada_para } }
 *  o { requiereConfirmacion: true, conflictos }.
 *  La implementación de abajo (API_SERVIDOR) ya llama así; si el servidor cambia el
 *  contrato, basta con cambiar API_SERVIDOR: la pantalla solo usa prepararYPublicar.
 */
import { ErrorInstagram, generarImagen, programarDirecto, publicarDirecto, type FotoPreparada } from "@/components/marketing/instagram/api";
import type { MarcaId } from "@/lib/instagram";
import { MAX_FOTOS_CARRUSEL, type FormatoMontado } from "@/lib/instagram/montar";

export interface DiapositivaParaPublicar {
  pieza: Record<string, unknown>;
  fotoPreparada: FotoPreparada | null;
  altText: string;
  piezaId?: string | null;
}

export interface PeticionPublicacion {
  marca: MarcaId;
  formato: FormatoMontado;
  diapositivas: DiapositivaParaPublicar[];
  caption: string;
  fotosTmp: string[];
  programarPara: Date | null;
}

export type Progreso = { fase: "imagenes"; hechas: number; total: number } | { fase: "publicando" } | { fase: "programando" };

export interface ResultadoPublicacion {
  estado: "publicada" | "en_proceso" | "programada" | "conflicto";
  piezaIds: string[];
  permalink: string | null;
  programadaPara: string | null;
  contenedorId: string | null;
  avisos: string[];
}

export interface EntradaPublicarAhora {
  marca: MarcaId;
  formato: FormatoMontado;
  piezaIds: string[];
  caption: string;
  altTexts: string[];
  fotosTmp: string[];
  contenedorId?: string | null;
}

export interface EntradaProgramar {
  marca: MarcaId;
  formato: FormatoMontado;
  piezaIds: string[];
  caption: string;
  altTexts: string[];
  instante: Date;
  confirmarConflicto?: boolean;
}

/** Lo que necesita prepararYPublicar del servidor (la real o una simulada en las pruebas). */
export interface ApiPublicacion {
  renderizar(d: DiapositivaParaPublicar): Promise<{ id: string; avisos?: string[] }>;
  publicarAhora(e: EntradaPublicarAhora): Promise<{ estado: string; permalink: string | null; contenedorId: string | null; avisos: string[] }>;
  programar(e: EntradaProgramar): Promise<{ ok: true; programadaPara: string } | { ok: false; requiereConfirmacion: true }>;
}

export const API_SERVIDOR: ApiPublicacion = {
  renderizar: (d) => generarImagen(d.pieza, d.piezaId ?? null, undefined, d.fotoPreparada),
  publicarAhora: (e) =>
    publicarDirecto({ ids: e.piezaIds, caption: e.caption, altTexts: e.altTexts, fotosTmp: e.fotosTmp, contenedorId: e.contenedorId }),
  programar: async (e) => {
    const r = await programarDirecto({ ids: e.piezaIds, caption: e.caption, altTexts: e.altTexts, instante: e.instante, confirmarConflicto: e.confirmarConflicto });
    return r.ok ? { ok: true as const, programadaPara: r.programadaPara } : { ok: false as const, requiereConfirmacion: true as const };
  },
};

/** Comprueba la petición antes de gastar nada. Lanza ErrorInstagram «validacion». */
export function comprobarPeticion(p: PeticionPublicacion): void {
  const n = p.diapositivas.length;
  if (n === 0) throw new ErrorInstagram("Elige al menos una foto.", "validacion");
  if (n > MAX_FOTOS_CARRUSEL) throw new ErrorInstagram(`Un carrusel lleva como mucho ${MAX_FOTOS_CARRUSEL} imágenes.`, "validacion");
  if (p.formato === "carrusel" && n < 2) throw new ErrorInstagram("Un carrusel necesita al menos 2 imágenes.", "validacion");
  if (p.formato !== "carrusel" && n !== 1) throw new ErrorInstagram("Con varias imágenes solo se puede publicar un carrusel.", "validacion");
}

function altTexts(p: PeticionPublicacion): string[] {
  return p.formato === "story" ? p.diapositivas.map(() => "") : p.diapositivas.map((d) => d.altText.trim());
}

/** Genera las imágenes y publica o programa. Ver el contrato arriba. */
export async function prepararYPublicar(
  p: PeticionPublicacion,
  opciones: { api?: ApiPublicacion; onProgreso?: (pr: Progreso) => void } = {},
): Promise<ResultadoPublicacion> {
  comprobarPeticion(p);
  const api = opciones.api ?? API_SERVIDOR;
  const avisar = opciones.onProgreso ?? (() => {});
  const total = p.diapositivas.length;
  const piezaIds: string[] = [];
  const avisos: string[] = [];
  avisar({ fase: "imagenes", hechas: 0, total });
  // De una en una: cada render abre un Chromium en Vercel.
  for (const d of p.diapositivas) {
    const r = await api.renderizar(d);
    piezaIds.push(r.id);
    avisos.push(...(r.avisos ?? []));
    avisar({ fase: "imagenes", hechas: piezaIds.length, total });
  }
  return continuarPublicacion(p, piezaIds, { api, onProgreso: avisar, avisos });
}

/**
 * Segunda mitad (publicar o programar) con las imágenes ya generadas: para
 * reintentar un «en_proceso» (con su contenedor) o confirmar un conflicto.
 */
export async function continuarPublicacion(
  p: PeticionPublicacion,
  piezaIds: string[],
  opciones: { api?: ApiPublicacion; onProgreso?: (pr: Progreso) => void; contenedorId?: string | null; confirmarConflicto?: boolean; avisos?: string[] } = {},
): Promise<ResultadoPublicacion> {
  const api = opciones.api ?? API_SERVIDOR;
  const avisar = opciones.onProgreso ?? (() => {});
  const avisos = [...(opciones.avisos ?? [])];
  const base = { marca: p.marca, formato: p.formato, piezaIds, caption: p.caption, altTexts: altTexts(p) };
  if (p.programarPara) {
    avisar({ fase: "programando" });
    const r = await api.programar({ ...base, instante: p.programarPara, confirmarConflicto: opciones.confirmarConflicto });
    if (!r.ok) return { estado: "conflicto", piezaIds, permalink: null, programadaPara: null, contenedorId: null, avisos };
    return { estado: "programada", piezaIds, permalink: null, programadaPara: r.programadaPara, contenedorId: null, avisos };
  }
  avisar({ fase: "publicando" });
  const r = await api.publicarAhora({ ...base, fotosTmp: p.fotosTmp, contenedorId: opciones.contenedorId ?? null });
  avisos.push(...r.avisos);
  if (r.estado === "en_proceso") return { estado: "en_proceso", piezaIds, permalink: null, programadaPara: null, contenedorId: r.contenedorId, avisos };
  if (r.estado !== "publicada") throw new ErrorInstagram(`Instagram no ha confirmado la publicación (estado «${r.estado || "desconocido"}»).`, "servidor");
  return { estado: "publicada", piezaIds, permalink: r.permalink, programadaPara: null, contenedorId: r.contenedorId, avisos };
}

// ─── Simulada (pruebas y maqueta local) ────────────────────────────────────

export interface OpcionesApiSimulada {
  retraso?: number;
  /** «render» o «publicar»: falla en ese paso. */
  fallaEn?: "render" | "publicar" | "programar";
  /** La primera llamada a publicar devuelve «en_proceso». */
  primeroEnProceso?: boolean;
  /** La primera llamada a programar pide confirmar un conflicto. */
  primeroConflicto?: boolean;
}

/** API falsa que registra las llamadas. */
export function crearApiSimulada(o: OpcionesApiSimulada = {}) {
  const llamadas = { renderizar: [] as DiapositivaParaPublicar[], publicarAhora: [] as EntradaPublicarAhora[], programar: [] as EntradaProgramar[] };
  const esperar = () => (o.retraso ? new Promise((r) => setTimeout(r, o.retraso)) : Promise.resolve());
  const api: ApiPublicacion = {
    async renderizar(d) {
      llamadas.renderizar.push(d);
      await esperar();
      if (o.fallaEn === "render") throw new ErrorInstagram("No se pudo generar la imagen.", "servidor", 500);
      return { id: `pieza-${llamadas.renderizar.length}`, avisos: [] };
    },
    async publicarAhora(e) {
      llamadas.publicarAhora.push(e);
      await esperar();
      if (o.fallaEn === "publicar") throw new ErrorInstagram("Instagram ha rechazado la publicación.", "servidor", 502);
      if (o.primeroEnProceso && llamadas.publicarAhora.length === 1) return { estado: "en_proceso", permalink: null, contenedorId: "C-1", avisos: [] };
      return { estado: "publicada", permalink: "https://www.instagram.com/p/simulada/", contenedorId: e.contenedorId ?? "C-1", avisos: [] };
    },
    async programar(e) {
      llamadas.programar.push(e);
      await esperar();
      if (o.fallaEn === "programar") throw new ErrorInstagram("No se pudo programar.", "servidor", 500);
      if (o.primeroConflicto && !e.confirmarConflicto) return { ok: false, requiereConfirmacion: true };
      return { ok: true, programadaPara: e.instante.toISOString() };
    },
  };
  return { api, llamadas };
}
