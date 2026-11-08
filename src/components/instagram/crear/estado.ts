/**
 * Estado de la pantalla «Crear» (rediseño a dos columnas, 05/11/2026) y la
 * lógica pura que lo transforma: fotos elegidas en orden, el montaje de cada
 * imagen (plantilla, rótulos y texto alternativo), el texto de la publicación
 * y por qué no se puede publicar todavía. Sin React: se prueba aparte.
 *
 * La fuente de verdad del orden es `fotos` (ids del catálogo, 1–10). Cada foto
 * tiene su «ajuste» en `ajustes` (por id): si se reordena o se quita una foto,
 * su ajuste la acompaña y no hay que reconciliar listas.
 */
import { obtenerPlantilla, plantillaPara, plantillasVisibles, type FormatoId, type MarcaId, type Plantilla } from "@/lib/instagram";
import { MAX_FOTOS_CARRUSEL, type FormatoMontado, type RespuestaMontar } from "@/lib/instagram/montar";
import { borradorDesdeDatos, borradorVacio, piezaDesdeBorrador } from "@/components/marketing/instagram/pieza";
import type { TonoIA } from "@/components/instagram/ia/api";

/** Rótulos que se pueden retocar a mano (los de las plantillas con foto). */
export const CAMPOS_ROTULO = ["antetitulo", "titular", "cita", "cta", "pie", "numeral"] as const;
export type CampoRotulo = (typeof CAMPOS_ROTULO)[number];

/** Cómo queda una imagen: plantilla, rótulos y texto alternativo. */
export interface AjusteImagen {
  plantilla: string;
  datos: Partial<Record<CampoRotulo, string>>;
  altText: string;
}

export interface EstadoCrear {
  marca: MarcaId;
  /** Ids de las fotos elegidas («drive:…», «carta:…»), en el orden en que se publican. */
  fotos: string[];
  ajustes: Record<string, AjusteImagen>;
  /** Solo con una foto: post o story. Con 2–10 siempre es carrusel. */
  formatoUnaFoto: "post" | "story";
  indicacion: string;
  tono: TonoIA;
  caption: string;
  hashtags: string[];
  /** «He entendido: …» de la IA. */
  resumen: string | null;
  avisos: string[];
  /** ISO de la hora que propone la IA (o null). */
  horaSugerida: string | null;
  /**
   * true cuando ya hay algo que enseñar montado: lo ha montado la IA o se ha
   * retocado a mano. Antes, la vista previa solo enseña las fotos tal cual.
   */
  montado: boolean;
  /** Id de instagram_piezas de la primera imagen si se abrió un borrador (se actualiza en vez de crear otra). */
  piezaId: string | null;
}

export function estadoInicial(marca: MarcaId = "casa-tomas"): EstadoCrear {
  return {
    marca,
    fotos: [],
    ajustes: {},
    formatoUnaFoto: "post",
    indicacion: "",
    tono: "cercano",
    caption: "",
    hashtags: [],
    resumen: null,
    avisos: [],
    horaSugerida: null,
    montado: false,
    piezaId: null,
  };
}

/** Formato que se publica según cuántas fotos hay. */
export function formatoEfectivo(e: Pick<EstadoCrear, "fotos" | "formatoUnaFoto">): FormatoMontado {
  return e.fotos.length > 1 ? "carrusel" : e.formatoUnaFoto;
}

/** Formato del motor de plantillas para cada imagen (un carrusel son posts 4:5). */
export function formatoImagen(formato: FormatoMontado): FormatoId {
  return formato === "story" ? "story" : "post";
}

export const NOMBRE_FORMATO_MONTADO: Record<FormatoMontado, string> = {
  post: "Post",
  carrusel: "Carrusel",
  story: "Story",
};

/**
 * Plantillas de la marca que llevan foto y valen para ese formato, por papel
 * (portada, plato, cierre). Sin las clásicas, salvo `actual` si la pieza ya la
 * lleva (una pieza guardada con una clásica se sigue viendo en el selector).
 */
export function plantillasConFoto(marca: MarcaId, formato: FormatoId, actual?: string): Plantilla[] {
  return plantillasVisibles(marca, formato, actual).filter((p) => p.admitidos.includes("foto"));
}

/** La plantilla vale para esa marca y formato y lleva foto. */
export function plantillaValida(id: string, marca: MarcaId, formato: FormatoId): boolean {
  const p = obtenerPlantilla(id);
  return !!p && p.marca === marca && p.formatos.includes(formato) && p.admitidos.includes("foto");
}

/** Ajuste por defecto: la portada a sangre de la marca. */
export function ajusteBase(marca: MarcaId, formato: FormatoId): AjusteImagen {
  const portada = plantillaPara(marca, formato, "portada", "sangre") ?? plantillasConFoto(marca, formato)[0];
  return { plantilla: portada?.id ?? "", datos: {}, altText: "" };
}

/** Ajuste de una foto, o el de por defecto si aún no tiene (o si su plantilla ya no vale). */
export function ajusteDe(e: EstadoCrear, foto: string): AjusteImagen {
  const formato = formatoImagen(formatoEfectivo(e));
  const a = e.ajustes[foto];
  if (!a) return ajusteBase(e.marca, formato);
  if (!plantillaValida(a.plantilla, e.marca, formato)) return { ...a, plantilla: ajusteBase(e.marca, formato).plantilla };
  return a;
}

/** JSON de la pieza de una imagen (lo que entienden validarPieza, construirDocumento y el render). */
export function piezaDeImagen(e: EstadoCrear, foto: string): Record<string, unknown> {
  const formato = formatoImagen(formatoEfectivo(e));
  const a = ajusteDe(e, foto);
  const base = borradorVacio(e.marca, a.plantilla, formato);
  const b = borradorDesdeDatos({ ...a.datos, marca: e.marca, plantilla: a.plantilla, formato, foto } as never, base);
  return piezaDesdeBorrador(b, obtenerPlantilla(a.plantilla));
}

// ─── Fotos ────────────────────────────────────────────────────────────────

/**
 * Clave del ajuste que espera foto: un borrador abierto sin foto (p. ej. de
 * una campaña) guarda aquí sus rótulos y los hereda la primera foto que se elija.
 */
export const AJUSTE_SIN_FOTO = "__sin_foto__";

/** Añade o quita una foto (al final). No pasa de 10. */
export function alternarFoto(e: EstadoCrear, foto: string): EstadoCrear {
  if (e.fotos.includes(foto)) return quitarFoto(e, foto);
  if (e.fotos.length >= MAX_FOTOS_CARRUSEL) return e;
  const pendiente = e.fotos.length === 0 ? e.ajustes[AJUSTE_SIN_FOTO] : undefined;
  if (pendiente) {
    const { [AJUSTE_SIN_FOTO]: _, ...resto } = e.ajustes;
    return { ...e, fotos: [foto], ajustes: { ...resto, [foto]: pendiente }, montado: true };
  }
  return { ...e, fotos: [...e.fotos, foto] };
}

export function quitarFoto(e: EstadoCrear, foto: string): EstadoCrear {
  const fotos = e.fotos.filter((f) => f !== foto);
  return { ...e, fotos, montado: e.montado && fotos.length > 0 };
}

export function moverFoto(e: EstadoCrear, desde: number, hasta: number): EstadoCrear {
  if (desde === hasta || desde < 0 || hasta < 0 || desde >= e.fotos.length || hasta >= e.fotos.length) return e;
  const fotos = [...e.fotos];
  const [f] = fotos.splice(desde, 1);
  fotos.splice(hasta, 0, f);
  return { ...e, fotos };
}

/** Cambiar de marca vacía la selección: las fotos y las plantillas son de cada marca. */
export function cambiarMarca(e: EstadoCrear, marca: MarcaId): EstadoCrear {
  if (marca === e.marca) return e;
  return { ...estadoInicial(marca), indicacion: e.indicacion, tono: e.tono };
}

// ─── Ajustes a mano ───────────────────────────────────────────────────────

export function cambiarAjuste(e: EstadoCrear, foto: string, cambio: Partial<AjusteImagen>): EstadoCrear {
  const actual = ajusteDe(e, foto);
  const siguiente: AjusteImagen = { ...actual, ...cambio, datos: { ...actual.datos, ...(cambio.datos ?? {}) } };
  return { ...e, ajustes: { ...e.ajustes, [foto]: siguiente }, montado: true };
}

// ─── Montar con IA ────────────────────────────────────────────────────────

const texto = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Aplica la respuesta de «Montar con IA»: orden de la IA (las fotos que no
 * usó se quedan al final, con su aviso), plantilla y rótulos de cada imagen,
 * textos alternativos, texto, hashtags, hora sugerida y resumen. Lo que no
 * cuadra (plantilla de otra marca, foto que no se le mandó) se descarta.
 */
export function aplicarMontaje(e: EstadoCrear, r: RespuestaMontar): EstadoCrear {
  const enviadas = new Set(e.fotos);
  const usadas: string[] = [];
  for (const d of r.diapositivas) if (enviadas.has(d.foto) && !usadas.includes(d.foto)) usadas.push(d.foto);
  const sobrantes = e.fotos.filter((f) => !usadas.includes(f));
  const fotos = [...usadas, ...sobrantes];
  const formatoUnaFoto: EstadoCrear["formatoUnaFoto"] = fotos.length === 1 && r.formato === "story" ? "story" : "post";
  const formato = formatoImagen(fotos.length > 1 ? "carrusel" : formatoUnaFoto);

  const ajustes: Record<string, AjusteImagen> = { ...e.ajustes };
  for (const d of r.diapositivas) {
    if (!enviadas.has(d.foto)) continue;
    const datos: AjusteImagen["datos"] = {};
    for (const c of CAMPOS_ROTULO) {
      const v = texto(d.datos?.[c]).trim();
      if (v) datos[c] = v;
    }
    ajustes[d.foto] = {
      plantilla: plantillaValida(d.plantilla, e.marca, formato) ? d.plantilla : ajusteBase(e.marca, formato).plantilla,
      datos,
      altText: texto(d.altText).trim(),
    };
  }
  const avisos = [...r.avisos];
  if (sobrantes.length && usadas.length) {
    avisos.push(sobrantes.length === 1 ? "La IA no ha usado una foto: la he dejado al final." : `La IA no ha usado ${sobrantes.length} fotos: las he dejado al final.`);
  }
  return {
    ...e,
    fotos,
    ajustes,
    formatoUnaFoto,
    caption: r.caption,
    hashtags: normalizarHashtags(r.hashtags),
    resumen: r.resumen || null,
    avisos,
    horaSugerida: r.horaSugerida ?? null,
    montado: true,
  };
}

/** «#Marisco», «marisco», «# marisco» → «#marisco» sin repetidos. */
export function normalizarHashtags(lista: readonly string[]): string[] {
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const h of lista) {
    const limpio = String(h ?? "").trim().replace(/^#+/, "").replace(/\s+/g, "");
    if (!limpio) continue;
    const clave = limpio.toLowerCase();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push(`#${limpio}`);
  }
  return salida;
}

/** Texto que se publica: el escrito y, debajo, los hashtags. Las stories no llevan texto. */
export function captionFinal(e: Pick<EstadoCrear, "caption" | "hashtags">, formato: FormatoMontado): string {
  if (formato === "story") return "";
  const cuerpo = e.caption.trim();
  const tags = e.hashtags.join(" ");
  return [cuerpo, tags].filter(Boolean).join("\n\n");
}

// ─── Por qué no se puede todavía ──────────────────────────────────────────

export interface EntradaBloqueo {
  fotos: number;
  montado: boolean;
  /** Problemas de cada imagen (en orden), ya en lenguaje llano. */
  problemasPorImagen: string[][];
  problemasTexto: string[];
  preparando: boolean;
  ocupado: boolean;
}

/** Frase que explica por qué «Publicar» y «Programar» están apagados, o null si se puede. */
export function motivoNoPublicar(b: EntradaBloqueo): string | null {
  if (b.fotos === 0) return "Elige al menos una foto.";
  if (!b.montado) return "Pulsa «Montar con IA» (o ajústala a mano) para ver cómo quedará.";
  const conProblema = b.problemasPorImagen.findIndex((p) => p.length > 0);
  if (conProblema >= 0) {
    return b.problemasPorImagen.length > 1
      ? `Revisa la imagen ${conProblema + 1}: ${b.problemasPorImagen[conProblema][0]}`
      : `Revisa la imagen: ${b.problemasPorImagen[conProblema][0]}`;
  }
  if (b.problemasTexto.length) return b.problemasTexto[0];
  if (b.preparando) return "Preparando las fotos…";
  if (b.ocupado) return null;
  return null;
}

/** Frase que explica por qué «Montar con IA» está apagado, o null si se puede. */
export function motivoNoMontar(fotos: number): string | null {
  return fotos === 0 ? "Elige al menos una foto para que la IA monte la publicación." : null;
}

// ─── Abrir un borrador (campañas, calendario) ─────────────────────────────

/** Lo que hace falta de una fila de instagram_piezas para abrirla en Crear. */
export interface PiezaParaAbrir {
  id: string;
  marca: string;
  plantilla: string;
  formato: string;
  datos: Record<string, unknown> | null;
  caption?: string | null;
  alt_text?: string | null;
}

/**
 * Estado de Crear a partir de una pieza guardada (una sola imagen). Si no
 * tiene foto, sus rótulos esperan a la primera que se elija (AJUSTE_SIN_FOTO).
 */
export function estadoDesdePieza(p: PiezaParaAbrir): EstadoCrear {
  const marca: MarcaId = p.marca === "touza" ? "touza" : "casa-tomas";
  const datos: AjusteImagen["datos"] = {};
  for (const c of CAMPOS_ROTULO) {
    const v = texto(p.datos?.[c]).trim();
    if (v) datos[c] = v;
  }
  const foto = texto(p.datos?.foto).trim();
  const formatoUnaFoto: EstadoCrear["formatoUnaFoto"] = p.formato === "story" ? "story" : "post";
  const ajuste: AjusteImagen = { plantilla: p.plantilla, datos, altText: texto(p.alt_text).trim() };
  const caption = texto(p.caption);
  // Los hashtags del final del texto pasan a sus fichas.
  const m = /(?:\n\s*)?((?:#[\p{L}\p{N}_]+\s*)+)$/u.exec(caption.trim());
  return {
    ...estadoInicial(marca),
    fotos: foto ? [foto] : [],
    ajustes: { [foto || AJUSTE_SIN_FOTO]: ajuste },
    formatoUnaFoto,
    caption: m ? caption.trim().slice(0, m.index).trim() : caption,
    hashtags: m ? normalizarHashtags(m[1].split(/\s+/)) : [],
    montado: !!foto,
    piezaId: p.id,
  };
}
