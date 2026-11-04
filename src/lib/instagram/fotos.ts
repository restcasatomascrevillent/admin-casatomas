/**
 * Catálogo estático de fotos de las piezas de Instagram y criterios de aptitud.
 *
 * Las fotos viven en el bucket «instagram» (fotos/<marca>/<nombre>.jpg, JPEG
 * sRGB, lado mayor ≤ 2560 px). El bloque <catalogo> lo regenera
 * scripts/instagram/subir-recursos.mjs con las medidas REALES de lo subido;
 * los textos (tipo, descripción) salen de instagram-studio/assets/fotos/fotos.json.
 *
 * Además del catálogo estático están las fotos que suben los usuarios desde el
 * panel (tabla public.instagram_fotos, fichero fotos/<marca>/subidas/<uuid>.jpg;
 * ver docs/instagram-fotos.md). Su id es el uuid de la fila. Las funciones
 * que reciben `fotos` aceptan el catálogo combinado (combinarCatalogo).
 */
import { FORMATOS, MARCAS, type FormatoId, type MarcaId } from "./tokens.js";

export const TIPOS_FOTO = ["plato", "sala", "bebida", "ambiente", "barra", "coctel", "interior"] as const;
export type TipoFoto = (typeof TIPOS_FOTO)[number];

export interface Foto {
  id: string;
  marca: MarcaId;
  /** Ruta dentro del bucket «instagram» (p. ej. "fotos/casa-tomas/salon-1.jpg"). */
  ruta: string;
  ancho: number;
  alto: number;
  tipo: TipoFoto;
  /** Criterio del prototipo: vertical con lado corto ≥ 1080, o cubre 1080×1350 ampliando ≤ 5 %. */
  aptaPost: boolean;
  /** Cubre 1080×1920 ampliando ≤ 5 %. */
  aptaStory: boolean;
  descripcion: string;
  /** true si la subió un usuario desde el panel (tabla instagram_fotos). */
  subida?: boolean;
}

// <catalogo> — generado por scripts/instagram/subir-recursos.mjs: no editar a mano.
export const FOTOS: readonly Foto[] = [
  { "id": "ct-champan", "marca": "casa-tomas", "ruta": "fotos/casa-tomas/champan.jpg", "ancho": 1281, "alto": 1920, "tipo": "bebida", "aptaPost": true, "aptaStory": true, "descripcion": "Tres botellas de champán Laurent-Perrier y una copa servida sobre mármol, con la cubitera detrás." },
  { "id": "ct-lampara", "marca": "casa-tomas", "ruta": "fotos/casa-tomas/lampara.jpg", "ancho": 1500, "alto": 2000, "tipo": "ambiente", "aptaPost": true, "aptaStory": true, "descripcion": "Lámpara colgante dorada con bombilla vista sobre la sala, con paredes oscuras al fondo." },
  { "id": "ct-carne-plato", "marca": "casa-tomas", "ruta": "fotos/casa-tomas/carne-plato.jpg", "ancho": 1920, "alto": 1080, "tipo": "plato", "aptaPost": false, "aptaStory": false, "descripcion": "Chuleta de vaca trinchada, roja por dentro, con patatas y romero sobre plato oscuro. Apaisada." },
  { "id": "ct-pulpo-plato", "marca": "casa-tomas", "ruta": "fotos/casa-tomas/pulpo-plato.jpg", "ancho": 500, "alto": 500, "tipo": "plato", "aptaPost": false, "aptaStory": false, "descripcion": "Pulpo a la brasa sobre crema de patata, en primer plano. Cuadrada y pequeña (500 px)." },
  { "id": "ct-salon-1", "marca": "casa-tomas", "ruta": "fotos/casa-tomas/salon-1.jpg", "ancho": 1050, "alto": 1400, "tipo": "sala", "aptaPost": true, "aptaStory": false, "descripcion": "Salón a lo largo: mesas con mantel blanco, sillas azules y lámparas doradas." },
  { "id": "ct-salon-2", "marca": "casa-tomas", "ruta": "fotos/casa-tomas/salon-2.jpg", "ancho": 1400, "alto": 739, "tipo": "ambiente", "aptaPost": false, "aptaStory": false, "descripcion": "Seis platos de cerámica decorativos colgados en una pared azul pizarra. Apaisada." },
  { "id": "ct-salon-3", "marca": "casa-tomas", "ruta": "fotos/casa-tomas/salon-3.jpg", "ancho": 1050, "alto": 1400, "tipo": "sala", "aptaPost": true, "aptaStory": false, "descripcion": "Rincón del salón con mesas montadas, pared oscura y un cuadro iluminado." },
  { "id": "ct-salon-4", "marca": "casa-tomas", "ruta": "fotos/casa-tomas/salon-4.jpg", "ancho": 1049, "alto": 1400, "tipo": "sala", "aptaPost": true, "aptaStory": false, "descripcion": "Mesa redonda montada delante de las vinotecas acristaladas." },
  { "id": "ct-salon-5", "marca": "casa-tomas", "ruta": "fotos/casa-tomas/salon-5.jpg", "ancho": 1050, "alto": 1400, "tipo": "sala", "aptaPost": true, "aptaStory": false, "descripcion": "Vista general del salón con lámparas doradas, mesas blancas y la barra al fondo." },
  { "id": "ct-comedor-1", "marca": "casa-tomas", "ruta": "fotos/casa-tomas/comedor-1.jpg", "ancho": 1050, "alto": 1400, "tipo": "sala", "aptaPost": true, "aptaStory": false, "descripcion": "Comedor con mesas de mantel blanco, sillas azules y vitrinas al fondo." },
  { "id": "ct-comedor-2", "marca": "casa-tomas", "ruta": "fotos/casa-tomas/comedor-2.jpg", "ancho": 1050, "alto": 1400, "tipo": "interior", "aptaPost": true, "aptaStory": false, "descripcion": "Vinotecas negras y cámara de maduración con piezas de vaca a la vista." },
  { "id": "ct-comedor-3", "marca": "casa-tomas", "ruta": "fotos/casa-tomas/comedor-3.jpg", "ancho": 1050, "alto": 1400, "tipo": "barra", "aptaPost": true, "aptaStory": false, "descripcion": "Barra con grifos de cerveza, botellas de vino y jamones al fondo." },
  { "id": "touza-2", "marca": "touza", "ruta": "fotos/touza/touza-2.jpg", "ancho": 2560, "alto": 1708, "tipo": "interior", "aptaPost": true, "aptaStory": false, "descripcion": "Sala principal (sofá mostaza, mesas de mármol), apaisada." },
  { "id": "touza-5", "marca": "touza", "ruta": "fotos/touza/touza-5.jpg", "ancho": 1708, "alto": 2560, "tipo": "barra", "aptaPost": true, "aptaStory": true, "descripcion": "Bartender colando un cóctel en la barra, vertical." },
  { "id": "touza-7", "marca": "touza", "ruta": "fotos/touza/touza-7.jpg", "ancho": 1708, "alto": 2560, "tipo": "coctel", "aptaPost": true, "aptaStory": true, "descripcion": "Mojito con pajita en la barra, con el bartender desenfocado detrás. Vertical." },
  { "id": "touza-8-1", "marca": "touza", "ruta": "fotos/touza/touza-8-1.jpg", "ancho": 1708, "alto": 2560, "tipo": "bebida", "aptaPost": true, "aptaStory": true, "descripcion": "Tres botellas de champán Laurent-Perrier y una copa sobre mármol, vertical." },
  { "id": "touza-10", "marca": "touza", "ruta": "fotos/touza/touza-10.jpg", "ancho": 1708, "alto": 2560, "tipo": "bebida", "aptaPost": true, "aptaStory": true, "descripcion": "Botellas de aperitivo (Select), ron (Kraken) y licores junto a un spritz, vertical." },
];
// </catalogo>

/** Ampliación máxima tolerada para rellenar un formato (5 %). */
export const AMPLIACION_MAXIMA = 1.05;

/** Escala necesaria para que la foto CUBRA un lienzo (object-fit: cover). */
export function escalaParaCubrir(ancho: number, alto: number, lienzoAncho: number, lienzoAlto: number): number {
  return Math.max(lienzoAncho / ancho, lienzoAlto / alto);
}

/**
 * ¿Se puede usar la foto en ese formato? Es la MISMA regla que aplica
 * validarPieza (cubrir el lienzo ampliando como mucho un 5 %), para que lo que
 * ofrece el selector de la UI nunca lo rechace luego la validación.
 */
export function esAptaPara(foto: Pick<Foto, "ancho" | "alto">, formato: FormatoId): boolean {
  const f = FORMATOS[formato];
  return escalaParaCubrir(foto.ancho, foto.alto, f.ancho, f.alto) <= AMPLIACION_MAXIMA;
}

/** Foto por id (en el catálogo dado; por defecto, el estático), o undefined. */
export function buscarFoto(id: string, fotos: readonly Foto[] = FOTOS): Foto | undefined {
  return fotos.find((f) => f.id === id);
}

/** Fotos de una marca (y, si se pide, aptas para un formato). */
export function fotosDe(marca: MarcaId, formato?: FormatoId, fotos: readonly Foto[] = FOTOS): Foto[] {
  return fotos.filter((f) => f.marca === marca && (!formato || esAptaPara(f, formato)));
}

// ── Fotos subidas desde el panel (tabla instagram_fotos) ─────────────────────

/** Nombre en español de cada tipo de foto (para la UI). */
export const NOMBRE_TIPO_FOTO: Record<TipoFoto, string> = {
  plato: "Plato",
  sala: "Sala",
  bebida: "Bebida",
  ambiente: "Ambiente",
  barra: "Barra",
  coctel: "Cóctel",
  interior: "Interior",
};

/** Lado mayor de las fotos subidas (igual que las del catálogo). */
export const LADO_MAXIMO_FOTO = 2560;
/** Peso máximo del JPEG subido (límite del bucket y de Instagram). */
export const MAX_BYTES_FOTO = 8 * 1024 * 1024;
/** Longitud máxima de la descripción de una foto subida (CHECK de la tabla). */
export const MAX_DESCRIPCION_FOTO = 140;

/** Ruta en el bucket de una foto subida: fotos/<marca>/subidas/<id>.jpg (la exige el CHECK de la tabla). */
export function rutaFotoSubida(marca: MarcaId, id: string): string {
  return `fotos/${marca}/subidas/${id}.jpg`;
}

/** Fila de public.instagram_fotos (lo que hace falta para el catálogo). */
export interface FilaFotoSubida {
  id: string;
  marca: string;
  ruta: string;
  ancho: number;
  alto: number;
  tipo: string;
  descripcion: string | null;
}

/**
 * Fila de instagram_fotos → Foto (con aptaPost/aptaStory calculadas con la
 * misma regla que esAptaPara). null si la fila no tiene una forma válida
 * (marca o tipo desconocidos, medidas raras o ruta fuera de fotos/<marca>/subidas/).
 */
export function fotoDesdeFila(fila: FilaFotoSubida): Foto | null {
  if (!fila || typeof fila.id !== "string" || !fila.id) return null;
  if (!(fila.marca in MARCAS)) return null;
  if (!(TIPOS_FOTO as readonly string[]).includes(fila.tipo)) return null;
  if (!Number.isInteger(fila.ancho) || !Number.isInteger(fila.alto) || fila.ancho <= 0 || fila.alto <= 0) return null;
  const marca = fila.marca as MarcaId;
  if (typeof fila.ruta !== "string" || !fila.ruta.startsWith(`fotos/${marca}/subidas/`) || fila.ruta.includes("..")) return null;
  const medidas = { ancho: fila.ancho, alto: fila.alto };
  return {
    id: fila.id,
    marca,
    ruta: fila.ruta,
    ancho: fila.ancho,
    alto: fila.alto,
    tipo: fila.tipo as TipoFoto,
    aptaPost: esAptaPara(medidas, "post"),
    aptaStory: esAptaPara(medidas, "story"),
    descripcion: fila.descripcion?.trim() ?? "",
    subida: true,
  };
}

/** Catálogo combinado: el estático y, detrás, las subidas (sin repetir ids). */
export function combinarCatalogo(subidas: readonly Foto[]): Foto[] {
  const ids = new Set(FOTOS.map((f) => f.id));
  return [...FOTOS, ...subidas.filter((f) => !ids.has(f.id) && (ids.add(f.id), true))];
}
