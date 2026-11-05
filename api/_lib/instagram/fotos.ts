/**
 * Fotos de las piezas para el render del servidor:
 *
 *  - Fotos de Google Drive («drive:<id>»): el panel las ha copiado antes al
 *    bucket (instagram-drive → preparar → tmp/<uuid>.jpg) y manda en
 *    `fotoPreparada` su URL pública, medidas y tipo. La URL SOLO se acepta si
 *    es del bucket «instagram» de NUESTRO Supabase y de tmp/ (rutaTmpDeUrl):
 *    el render nunca carga una URL que venga del cliente (sin SSRF).
 *  - Fotos de la carta («carta:<id del plato>»): igual que las de Drive
 *    (instagram-drive → preparar con origen «carta» → tmp/<uuid>.webp); su
 *    tipo es siempre «plato».
 *  - Fotos subidas al bucket antes de Drive (tabla public.instagram_fotos):
 *    fetch a PostgREST con la clave pública + el JWT del usuario, así que
 *    decide la RLS (can_read_section('marketing')). Nunca service_role.
 *  - Catálogo estático FOTOS: respaldo para piezas antiguas.
 */
import {
  FOTOS,
  TIPOS_FOTO,
  esAptaPara,
  fotoPreparable,
  fotoDesdeFila,
  rutaTmpDeUrl,
  type FilaFotoSubida,
  type Foto,
  type TipoFoto,
} from "../../../src/lib/instagram/fotos.js";
import { MARCAS, type MarcaId } from "../../../src/lib/instagram/tokens.js";
import { ErrorSupabase, type Sesion } from "./supabase.js";
import { esUuid } from "./validacion.js";

const MS_TIEMPO = 15_000;
const COLUMNAS_FOTO = "id,marca,ruta,ancho,alto,tipo,descripcion";

/** Foto subida por id (null si no existe, la RLS la oculta o la fila no es válida). Lanza ErrorSupabase si PostgREST falla. */
export async function buscarFotoSubida(s: Sesion, id: string): Promise<Foto | null> {
  if (!esUuid(id)) return null;
  const r = await s.fetch(`${s.sb.url}/rest/v1/instagram_fotos?id=eq.${encodeURIComponent(id)}&select=${COLUMNAS_FOTO}`, {
    headers: { apikey: s.sb.clave, Authorization: `Bearer ${s.token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(MS_TIEMPO),
  });
  if (!r.ok) throw new ErrorSupabase(`No se pudo leer la foto subida (${r.status})`, r.status);
  const filas = (await r.json().catch(() => [])) as FilaFotoSubida[];
  return Array.isArray(filas) && filas[0] ? fotoDesdeFila(filas[0]) : null;
}

/** Error de `fotoPreparada` (la función responde 400). */
export class ErrorFotoPreparada extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorFotoPreparada";
  }
}

const LADO_MAXIMO_FOTO = 20_000;

/**
 * `fotoPreparada` del cuerpo → Foto del catálogo, validada:
 *   { id: "drive:<id>" | "carta:<id>" (= pieza.foto), url: <URL pública de tmp/ en NUESTRO bucket>,
 *     ancho, alto (enteros), tipo: TipoFoto | null, marca }
 * Lanza ErrorFotoPreparada si algo no cuadra. La ruta sale de la URL y la URL
 * final se vuelve a construir con la base de nuestro Supabase.
 */
export function fotoDesdePreparada(entrada: unknown, idPieza: string, supabaseUrl: string): Foto {
  if (!entrada || typeof entrada !== "object") throw new ErrorFotoPreparada("«fotoPreparada» tiene que ser un objeto");
  const e = entrada as Record<string, unknown>;
  const origen = fotoPreparable(e.id);
  if (!origen || e.id !== idPieza) throw new ErrorFotoPreparada("«fotoPreparada.id» no es la foto (de Drive o de la carta) de la pieza");
  const ruta = rutaTmpDeUrl(e.url, supabaseUrl);
  if (!ruta) throw new ErrorFotoPreparada("«fotoPreparada.url» tiene que ser una copia tmp/ del bucket «instagram» de este Supabase");
  if (typeof e.marca !== "string" || !(e.marca in MARCAS)) throw new ErrorFotoPreparada("«fotoPreparada.marca» no es válida");
  const medida = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 && (v as number) <= LADO_MAXIMO_FOTO ? (v as number) : null);
  const ancho = medida(e.ancho);
  const alto = medida(e.alto);
  if (!ancho || !alto) throw new ErrorFotoPreparada("«fotoPreparada» necesita ancho y alto (enteros positivos)");
  if (e.tipo !== null && e.tipo !== undefined && !(TIPOS_FOTO as readonly string[]).includes(e.tipo as string)) {
    throw new ErrorFotoPreparada("«fotoPreparada.tipo» no es válido");
  }
  const medidas = { ancho, alto };
  return {
    id: e.id as string,
    marca: e.marca as MarcaId,
    ruta,
    ancho,
    alto,
    // Las de la carta son siempre platos (no se fía del tipo que llega).
    tipo: origen.origen === "carta" ? "plato" : ((e.tipo as TipoFoto | null | undefined) ?? null),
    aptaPost: esAptaPara(medidas, "post"),
    aptaStory: esAptaPara(medidas, "story"),
    descripcion: "",
    subida: true,
    ...(origen.origen === "drive" ? { driveId: origen.id } : { platoId: origen.id }),
  };
}

/**
 * Catálogo para validar y construir una pieza: el estático y, si la pieza
 * pide una foto que no está en él, la foto de Drive o de la carta preparada (`fotoPreparada`)
 * o esa foto de instagram_fotos (si existe). Lanza ErrorFotoPreparada si
 * `fotoPreparada` no es válida.
 */
export async function catalogoParaPieza(s: Sesion, pieza: unknown, fotoPreparada?: unknown): Promise<readonly Foto[]> {
  const idFoto = pieza && typeof pieza === "object" ? (pieza as { foto?: unknown }).foto : undefined;
  if (typeof idFoto !== "string") return FOTOS;
  const id = idFoto.trim();
  if (!id || FOTOS.some((f) => f.id === id)) return FOTOS;
  if (fotoPreparable(id)) {
    // Sin fotoPreparada la validación dirá que la foto no está en el catálogo.
    if (fotoPreparada === undefined || fotoPreparada === null) return FOTOS;
    return [...FOTOS, fotoDesdePreparada(fotoPreparada, id, s.sb.url)];
  }
  const subida = await buscarFotoSubida(s, id);
  return subida ? [...FOTOS, subida] : FOTOS;
}
