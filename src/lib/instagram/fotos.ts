/**
 * Catálogo estático de fotos de las piezas de Instagram y criterios de aptitud.
 *
 * Las fotos viven en el bucket «instagram» (fotos/<marca>/<nombre>.jpg, JPEG
 * sRGB, lado mayor ≤ 2560 px). El bloque <catalogo> lo regenera
 * scripts/instagram/subir-recursos.mjs con las medidas REALES de lo subido;
 * los textos (tipo, descripción) salen de instagram-studio/assets/fotos/fotos.json.
 *
 * Desde el 05/11/2026 la biblioteca VISIBLE del panel sale de Google Drive
 * (marketing/instagram/fotos/<marca>, Edge Function instagram-drive; ver
 * docs/instagram-fotos.md). Su id en las piezas es «drive:<id de Drive>» y su
 * `ruta` es la copia temporal tmp/<uuid>.<ext> del bucket que hace «preparar»
 * (vacía hasta entonces). Este catálogo estático ya no se enseña (sus rutas no
 * existen en la demo): queda como respaldo del render para piezas antiguas.
 *
 * También quedan, por compatibilidad, las fotos subidas al bucket antes de Drive
 * (tabla public.instagram_fotos con ruta fotos/<marca>/subidas/<uuid>.jpg).
 * Las funciones que reciben `fotos` aceptan cualquier catálogo (combinarCatalogo).
 */
import { FORMATOS, MARCAS, type FormatoId, type MarcaId } from "./tokens.js";
import { encajeDe, type EncajeFoto, type Plantilla } from "./tipos.js";

export const TIPOS_FOTO = ["plato", "sala", "bebida", "ambiente", "barra", "coctel", "interior"] as const;
export type TipoFoto = (typeof TIPOS_FOTO)[number];

export interface Foto {
  id: string;
  marca: MarcaId;
  /** Ruta dentro del bucket «instagram» (p. ej. "fotos/casa-tomas/salon-1.jpg"). */
  ruta: string;
  ancho: number;
  alto: number;
  /** null = foto de Drive sin clasificar (sin fila en instagram_fotos): vale para cualquier plantilla. */
  tipo: TipoFoto | null;
  /** Criterio del prototipo: vertical con lado corto ≥ 1080, o cubre 1080×1350 ampliando ≤ 5 %. */
  aptaPost: boolean;
  /** Cubre 1080×1920 ampliando ≤ 5 %. */
  aptaStory: boolean;
  descripcion: string;
  /** true si la subió un usuario desde el panel (tabla instagram_fotos). */
  subida?: boolean;
  /** Id del fichero en Google Drive (fotos de la biblioteca de Drive). */
  driveId?: string;
  /** Por qué no se puede usar aunque las medidas valgan (formato HEIC, más de 8 MB…). */
  problema?: string | null;
  /** Id del plato (fotos de la carta, «carta:<id>»). */
  platoId?: string;
  /** Id del vino (fotos de la carta de vinos, «vino:<id>»). */
  vinoId?: string;
  /** URL pública de la foto en la carta (bucket «platos» o «vinos»): solo para la miniatura. */
  urlCarta?: string;
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
 * Lado largo mínimo de una foto para la plantilla enmarcada (encaje «marco»):
 * la foto va entera y sin ampliar dentro de unos 900 px de ancho, así que con
 * 800 px se ve nítida (las de la carta miden 1200×900).
 */
export const LADO_MINIMO_MARCO = 800;

/** ¿La foto CUBRE el formato ampliando como mucho un 5 %? (regla de las plantillas a sangre). */
export function cubreFormato(foto: Pick<Foto, "ancho" | "alto">, formato: FormatoId): boolean {
  const f = FORMATOS[formato];
  return escalaParaCubrir(foto.ancho, foto.alto, f.ancho, f.alto) <= AMPLIACION_MAXIMA;
}

/** ¿Vale la foto para una plantilla enmarcada? (lado largo ≥ LADO_MINIMO_MARCO; no hace falta que cubra). */
export function valeParaMarco(foto: Pick<Foto, "ancho" | "alto">): boolean {
  return Math.max(foto.ancho, foto.alto) >= LADO_MINIMO_MARCO;
}

/**
 * ¿Se puede usar la foto en ese formato con esa plantilla? Es la MISMA regla
 * que aplica validarPieza, para que lo que ofrece el selector de la UI nunca
 * lo rechace luego la validación:
 * - plantilla a sangre (o sin plantilla): cubrir el lienzo ampliando ≤ 5 %;
 * - plantilla enmarcada (encaje «marco»): lado largo ≥ 800 px.
 */
export function esAptaPara(
  foto: Pick<Foto, "ancho" | "alto">,
  formato: FormatoId,
  plantilla?: Pick<Plantilla, "encaje"> | EncajeFoto | null,
): boolean {
  return encajeDe(plantilla) === "marco" ? valeParaMarco(foto) : cubreFormato(foto, formato);
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

// ── Fotos de Google Drive (Edge Function instagram-drive) ────────────────────

/** Prefijo del id de las fotos de Drive en las piezas: «drive:<id de Drive>». */
export const PREFIJO_FOTO_DRIVE = "drive:";
const RE_ID_DRIVE = /^[A-Za-z0-9_-]{10,200}$/;

export function esIdDriveValido(v: unknown): v is string {
  return typeof v === "string" && RE_ID_DRIVE.test(v);
}

/** «drive:<id>» a partir del id de Drive. */
export function idFotoDrive(driveId: string): string {
  return `${PREFIJO_FOTO_DRIVE}${driveId}`;
}

/** Id de Drive de un id de foto «drive:<id>» (null si no es de Drive o no es válido). */
export function driveIdDeFoto(id: unknown): string | null {
  if (typeof id !== "string" || !id.startsWith(PREFIJO_FOTO_DRIVE)) return null;
  const d = id.slice(PREFIJO_FOTO_DRIVE.length);
  return esIdDriveValido(d) ? d : null;
}

/** Lo que devuelve instagram-drive (listar) por cada foto. */
export interface FotoDrive {
  driveId: string;
  nombre: string;
  ancho: number | null;
  alto: number | null;
  tipo: string | null;
  descripcion: string;
  filaId: string | null;
  creada: string | null;
  problema: string | null;
}

/**
 * Foto de Drive → Foto del catálogo. Sin medidas (Drive aún no las sabe) sale
 * con 0×0 y no es apta. Sin tipo (no tiene fila) → tipo null. `ruta` es la
 * copia temporal del bucket si ya se ha preparado («» si no).
 */
export function fotoDesdeDrive(f: FotoDrive, marca: MarcaId, ruta = ""): Foto | null {
  if (!f || !esIdDriveValido(f.driveId)) return null;
  const ancho = Number.isInteger(f.ancho) && (f.ancho as number) > 0 ? (f.ancho as number) : 0;
  const alto = Number.isInteger(f.alto) && (f.alto as number) > 0 ? (f.alto as number) : 0;
  const tipo = (TIPOS_FOTO as readonly string[]).includes(f.tipo ?? "") ? (f.tipo as TipoFoto) : null;
  const medidas = { ancho, alto };
  const apta = (formato: FormatoId) => ancho > 0 && alto > 0 && !f.problema && esAptaPara(medidas, formato);
  return {
    id: idFotoDrive(f.driveId),
    marca,
    ruta,
    ancho,
    alto,
    tipo,
    aptaPost: apta("post"),
    aptaStory: apta("story"),
    descripcion: (f.descripcion ?? "").trim(),
    subida: true,
    driveId: f.driveId,
    problema: f.problema ?? null,
  };
}

/** Copias temporales del bucket que hace «preparar»: tmp/<uuid>.<jpg|png|webp>. */
export const RE_RUTA_TMP = /^tmp\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/;

/**
 * Ruta tmp/<uuid>.<ext> de una URL pública del bucket «instagram» de NUESTRO
 * Supabase (`supabaseUrl`), o null si la URL apunta a cualquier otro sitio
 * (otro host, otro puerto, otro bucket, otra carpeta, credenciales, rutas con
 * «..» o caracteres codificados). Es lo que impide que el render (Chromium en
 * el servidor) descargue URLs arbitrarias (SSRF): el render construye la URL de
 * nuevo a partir de esta ruta, nunca usa la que llega.
 */
export function rutaTmpDeUrl(url: unknown, supabaseUrl: string): string | null {
  if (typeof url !== "string" || url.length > 500 || !supabaseUrl) return null;
  let u: URL;
  let base: URL;
  try {
    u = new URL(url);
    base = new URL(supabaseUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && base.protocol === "http:")) return null;
  if (u.origin !== base.origin || u.username || u.password) return null;
  const prefijo = "/storage/v1/object/public/instagram/";
  if (!u.pathname.startsWith(prefijo)) return null;
  const ruta = u.pathname.slice(prefijo.length);
  return RE_RUTA_TMP.test(ruta) ? ruta : null;
}

// ── Fotos de la carta (tabla "Platos", bucket público «platos») ──────────────

/** Prefijo del id de las fotos de la carta en las piezas: «carta:<id del plato>». */
export const PREFIJO_FOTO_CARTA = "carta:";
const RE_ID_PLATO = /^[A-Za-z0-9_-]{1,100}$/;

export function esIdPlatoValido(v: unknown): v is string {
  return typeof v === "string" && RE_ID_PLATO.test(v);
}

/** «carta:<id>» a partir del id del plato. */
export function idFotoCarta(platoId: string): string {
  return `${PREFIJO_FOTO_CARTA}${platoId}`;
}

/** Id del plato de un id de foto «carta:<id>» (null si no es de la carta o no es válido). */
export function platoIdDeFoto(id: unknown): string | null {
  if (typeof id !== "string" || !id.startsWith(PREFIJO_FOTO_CARTA)) return null;
  const p = id.slice(PREFIJO_FOTO_CARTA.length);
  return esIdPlatoValido(p) ? p : null;
}

/** Prefijo del id de las fotos de la carta de vinos en las piezas: «vino:<id del vino>». */
export const PREFIJO_FOTO_VINO = "vino:";

/** «vino:<id>» a partir del id del vino. */
export function idFotoVino(vinoId: string): string {
  return `${PREFIJO_FOTO_VINO}${vinoId}`;
}

/** Id del vino de un id de foto «vino:<id>» (null si no es un vino o no es válido). */
export function vinoIdDeFoto(id: unknown): string | null {
  if (typeof id !== "string" || !id.startsWith(PREFIJO_FOTO_VINO)) return null;
  const v = id.slice(PREFIJO_FOTO_VINO.length);
  return esIdPlatoValido(v) ? v : null;
}

/** Origen de una foto que hay que «preparar» (copiar a tmp/) antes de pintarla. */
export type FotoPreparable = { origen: "drive"; id: string } | { origen: "carta"; id: string } | { origen: "vino"; id: string };

/** Drive («drive:<id>»), carta («carta:<id>») o vino («vino:<id>»); null para el resto (catálogo estático, subidas antiguas). */
export function fotoPreparable(id: unknown): FotoPreparable | null {
  const d = driveIdDeFoto(id);
  if (d) return { origen: "drive", id: d };
  const p = platoIdDeFoto(id);
  if (p) return { origen: "carta", id: p };
  const v = vinoIdDeFoto(id);
  return v ? { origen: "vino", id: v } : null;
}

/** Ruta dentro del bucket público «platos» de una URL de NUESTRO Supabase (null si es de otro sitio). */
export function rutaPlatoDeUrl(url: unknown, supabaseUrl: string): string | null {
  if (typeof url !== "string" || url.length > 1000 || !supabaseUrl) return null;
  let u: URL;
  let base: URL;
  try {
    u = new URL(url);
    base = new URL(supabaseUrl);
  } catch {
    return null;
  }
  if (u.origin !== base.origin || u.username || u.password) return null;
  const prefijo = "/storage/v1/object/public/platos/";
  if (!u.pathname.startsWith(prefijo)) return null;
  const ruta = u.pathname.slice(prefijo.length);
  if (!ruta || ruta.includes("..") || ruta.includes("%") || ruta.includes("//") || !/^[A-Za-z0-9_./ -]+$/.test(ruta)) return null;
  return ruta;
}

/** Lo que hace falta de una fila de "Platos". */
export interface FilaPlatoFoto {
  id: string;
  nombre: string | null;
  categoria: string | null;
  imagen_url: string | null;
  activado?: boolean | null;
  restaurante?: boolean | null;
  touza?: boolean | null;
}

/** ¿El plato es de la marca? restaurante=true → Casa Tomás; touza=true → Touza. */
export function platoEsDeMarca(fila: Pick<FilaPlatoFoto, "restaurante" | "touza">, marca: MarcaId): boolean {
  return marca === "touza" ? fila.touza === true : fila.restaurante === true;
}

/**
 * Plato → Foto del catálogo (tipo «plato», descripción = nombre · categoría).
 * `medidas` son las reales de la imagen (naturalWidth/naturalHeight al cargar
 * la miniatura); sin ellas sale 0×0 y NO se bloquea en el selector: las
 * medidas buenas llegan al cargar o al preparar. `url` es la pública de la
 * carta (miniatura); `ruta`, la copia tmp/ del bucket «instagram» una vez preparada.
 */
export function fotoDesdePlato(fila: FilaPlatoFoto, marca: MarcaId, medidas?: { ancho: number; alto: number } | null, ruta = ""): Foto | null {
  if (!fila || !esIdPlatoValido(fila.id) || typeof fila.imagen_url !== "string" || !fila.imagen_url.trim()) return null;
  const ancho = medidas && Number.isInteger(medidas.ancho) && medidas.ancho > 0 ? medidas.ancho : 0;
  const alto = medidas && Number.isInteger(medidas.alto) && medidas.alto > 0 ? medidas.alto : 0;
  const nombre = (fila.nombre ?? "").trim();
  const categoria = (fila.categoria ?? "").trim();
  const apta = (formato: FormatoId) => ancho > 0 && alto > 0 && esAptaPara({ ancho, alto }, formato);
  return {
    id: idFotoCarta(fila.id),
    marca,
    ruta,
    ancho,
    alto,
    tipo: "plato",
    aptaPost: apta("post"),
    aptaStory: apta("story"),
    descripcion: [nombre, categoria].filter(Boolean).join(" · ") || "Plato de la carta",
    platoId: fila.id,
    urlCarta: fila.imagen_url.trim(),
  };
}

/**
 * Platos de la carta de una marca → fotos: solo activos, con foto y de la
 * marca (restaurante/touza). `medidas` por id de plato (las que ya se sepan).
 */
export function fotosDesdePlatos(filas: readonly FilaPlatoFoto[], marca: MarcaId, medidas: Readonly<Record<string, { ancho: number; alto: number }>> = {}): Foto[] {
  const vistos = new Set<string>();
  const fotos: Foto[] = [];
  for (const fila of filas ?? []) {
    if (!fila || fila.activado !== true || !platoEsDeMarca(fila, marca) || vistos.has(fila.id)) continue;
    const foto = fotoDesdePlato(fila, marca, medidas[fila.id]);
    if (!foto) continue;
    vistos.add(fila.id);
    fotos.push(foto);
  }
  return fotos;
}

// ── Fotos de la carta de vinos (tabla "Vinos", bucket público «vinos») ───────

/** Lo que hace falta de una fila de "Vinos". */
export interface FilaVinoFoto {
  id: string;
  nombre: string | null;
  denominacion_origen?: string | null;
  imagen_url: string | null;
  activado?: boolean | null;
  restaurante?: boolean | null;
  touza?: boolean | null;
}

/**
 * Vino → Foto del catálogo (tipo «bebida», descripción = nombre · D.O.). Las
 * medidas, igual que las de los platos (al cargar la miniatura o al preparar).
 */
export function fotoDesdeVino(fila: FilaVinoFoto, marca: MarcaId, medidas?: { ancho: number; alto: number } | null, ruta = ""): Foto | null {
  if (!fila || !esIdPlatoValido(fila.id) || typeof fila.imagen_url !== "string" || !fila.imagen_url.trim()) return null;
  const ancho = medidas && Number.isInteger(medidas.ancho) && medidas.ancho > 0 ? medidas.ancho : 0;
  const alto = medidas && Number.isInteger(medidas.alto) && medidas.alto > 0 ? medidas.alto : 0;
  const apta = (formato: FormatoId) => ancho > 0 && alto > 0 && esAptaPara({ ancho, alto }, formato);
  const descripcion = [(fila.nombre ?? "").trim(), (fila.denominacion_origen ?? "").trim()].filter(Boolean).join(" · ");
  return {
    id: idFotoVino(fila.id),
    marca,
    ruta,
    ancho,
    alto,
    tipo: "bebida",
    aptaPost: apta("post"),
    aptaStory: apta("story"),
    descripcion: descripcion || "Vino de la carta",
    vinoId: fila.id,
    urlCarta: fila.imagen_url.trim(),
  };
}

/** Vinos de la carta de una marca → fotos (activos, con foto y de la marca). `medidas` por id de foto («vino:<id>»). */
export function fotosDesdeVinos(filas: readonly FilaVinoFoto[], marca: MarcaId, medidas: Readonly<Record<string, { ancho: number; alto: number }>> = {}): Foto[] {
  const vistos = new Set<string>();
  const fotos: Foto[] = [];
  for (const fila of filas ?? []) {
    if (!fila || fila.activado !== true || !platoEsDeMarca(fila, marca) || vistos.has(fila.id)) continue;
    const foto = fotoDesdeVino(fila, marca, medidas[idFotoVino(fila.id)]);
    if (!foto) continue;
    vistos.add(fila.id);
    fotos.push(foto);
  }
  return fotos;
}
