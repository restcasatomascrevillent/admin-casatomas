/**
 * Google Drive para Marketing › Instagram: el archivo de verdad de las fotos y
 * de las piezas publicadas (decisión del dueño, 05/11/2026). El bucket
 * «instagram» de Supabase es solo una escala temporal (Meta y el render
 * necesitan una URL JPEG pública directa, y Drive no la da).
 *
 * Estructura, bajo la carpeta del secreto GOOGLE_DRIVE_MARKETING_FOLDER_ID
 * (carpeta «marketing», creada a mano por el dueño). La app crea lo que falte:
 *
 *   marketing/instagram/fotos/casa-tomas     biblioteca de Casa Tomás
 *   marketing/instagram/fotos/touza          biblioteca de Touza
 *   marketing/instagram/publicadas/AAAA-MM   JPEG de cada pieza publicada
 *   marketing/carta/<marca>(/videos)         originales de la carta (ANTIGUO, se sigue leyendo)
 *
 * Árbol nuevo de la carta de Casa Tomás (mudanza del 15/11/2026; la app NO
 * crea «Platos» ni «Vinos» al leer, solo al guardar un original):
 *
 *   marketing/Platos/<NN Categoría>/<plato>/ORIGINAL - <plato>.jpg
 *   marketing/Platos/<NN Categoría>/<plato>/Vídeos/<id>.<ext>
 *   marketing/Vinos/<Tipo>/<vino>/ORIGINAL - <vino>.jpg
 *
 * Secretos (los mismos de las facturas + la carpeta): GOOGLE_CLIENT_ID,
 * GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN y GOOGLE_DRIVE_MARKETING_FOLDER_ID.
 * Se registran para taparlos en cualquier salida; nunca se devuelven.
 *
 * TRAMPA del alcance `drive.file`: con él la app solo ve lo que ella misma ha
 * creado. Ni la carpeta «marketing» (creada a mano) ni las fotos arrastradas a
 * mano a Drive. Ver comprobarDrive().
 */
import { ALCANCE_DRIVE, ALCANCE_DRIVE_FILE, ClienteDrive, ErrorDrive, esIdDrive, nombreAlcance, TIPO_CARPETA, type FicheroDrive } from "../google-drive.ts";
import { dondeSecreto, type Entorno } from "./entorno.ts";
import { registrarSecreto, sanear } from "./secretos.ts";

export const MARCAS_DRIVE = ["casa-tomas", "touza"] as const;
export type MarcaDrive = (typeof MARCAS_DRIVE)[number];

export const VARIABLES_DRIVE = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "GOOGLE_DRIVE_MARKETING_FOLDER_ID"] as const;

export function esMarcaDrive(v: unknown): v is MarcaDrive {
  return typeof v === "string" && (MARCAS_DRIVE as readonly string[]).includes(v);
}

function valor(env: Entorno, nombre: string): string {
  const v = env[nombre];
  return typeof v === "string" ? v.trim() : "";
}

export interface ConfigDriveInstagram {
  cliente: ClienteDrive;
  carpetaMarketing: string;
}

/** Secretos que faltan (nombres, nunca valores). */
export function faltanVariablesDrive(env: Entorno): string[] {
  return VARIABLES_DRIVE.filter((n) => !valor(env, n));
}

/** Cliente de Drive con los secretos del entorno, o lo que falta. */
export function leerConfigDrive(
  env: Entorno,
  deps: { fetch?: typeof fetch; ahora?: () => number } = {},
): { ok: true; config: ConfigDriveInstagram } | { ok: false; faltan: string[]; problema: string } {
  for (const n of ["GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"]) registrarSecreto(valor(env, n));
  const faltan = faltanVariablesDrive(env);
  if (faltan.length) return { ok: false, faltan, problema: `Faltan secretos de Google Drive en Supabase: ${faltan.join(", ")}` };
  const carpeta = valor(env, "GOOGLE_DRIVE_MARKETING_FOLDER_ID");
  if (!esIdDrive(carpeta)) {
    return { ok: false, faltan: ["GOOGLE_DRIVE_MARKETING_FOLDER_ID"], problema: "GOOGLE_DRIVE_MARKETING_FOLDER_ID no parece un id de carpeta de Drive (solo letras, números, «-» y «_»)" };
  }
  const cliente = new ClienteDrive({
    config: { clientId: valor(env, "GOOGLE_CLIENT_ID"), clientSecret: valor(env, "GOOGLE_CLIENT_SECRET"), refreshToken: valor(env, "GOOGLE_REFRESH_TOKEN") },
    fetch: deps.fetch,
    ahora: deps.ahora,
    registrarSecreto,
  });
  return { ok: true, config: { cliente, carpetaMarketing: carpeta } };
}

// Ids de carpeta ya resueltos (por instancia de la función): «raíz|tramo/tramo» → id.
const carpetas = new Map<string, string>();

/** Solo para pruebas. */
export function olvidarCarpetasDrive(): void {
  carpetas.clear();
  raicesArbol.clear();
}

async function carpeta(c: ConfigDriveInstagram, tramos: readonly string[]): Promise<string> {
  const clave = `${c.carpetaMarketing}|${tramos.join("/")}`;
  const hecha = carpetas.get(clave);
  if (hecha) return hecha;
  const id = await c.cliente.asegurarRuta(c.carpetaMarketing, tramos);
  carpetas.set(clave, id);
  return id;
}

/** marketing/instagram/fotos/<marca> (la crea si falta). */
export function carpetaFotos(c: ConfigDriveInstagram, marca: MarcaDrive): Promise<string> {
  return carpeta(c, ["instagram", "fotos", marca]);
}

/** marketing/carta/<marca>: originales de las fotos de la carta (la crea si falta). */
export function carpetaCarta(c: ConfigDriveInstagram, marca: MarcaDrive): Promise<string> {
  return carpeta(c, ["carta", marca]);
}

/** marketing/carta/<marca>/videos: vídeos ORIGINALES (en bruto) de los platos (la crea si falta). */
export function carpetaVideosCarta(c: ConfigDriveInstagram, marca: MarcaDrive): Promise<string> {
  return carpeta(c, ["carta", marca, "videos"]);
}

// ---------------------------------------------------------------------------
// Árbol nuevo: Platos/<NN Categoría>/<plato>/ y Vinos/<Tipo>/<vino>/
// ---------------------------------------------------------------------------

export type ArbolCarta = "Platos" | "Vinos";
export const ARBOLES_CARTA: readonly ArbolCarta[] = ["Platos", "Vinos"];
export const CARPETA_VIDEOS = "Vídeos";
/** Cuántos niveles se suben, como máximo, al comprobar si un fichero cuelga de un árbol. */
export const TOPE_ANCESTROS = 6;

/** Sin tildes, en minúsculas y con los espacios colapsados: para comparar nombres. */
export function normalizarNombre(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** «03 Entrantes fríos» → «Entrantes fríos» (quita el prefijo numérico de las categorías). */
export function sinPrefijoNumero(t: string): string {
  return t.replace(/^\s*\d+\s+/, "").trim();
}

/** Nombre de carpeta de un plato o vino: el de la carta, sin barras ni saltos de línea. */
export function nombreCarpetaFicha(nombre: string | null | undefined, id: string): string {
  const limpio = (nombre ?? "").replace(/[\\/\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 150);
  return limpio || id;
}

/** Nombre de la foto principal: «ORIGINAL - <nombre>.jpg». */
export function nombreOriginalArbol(nombre: string | null | undefined, id: string): string {
  return `ORIGINAL - ${nombreCarpetaFicha(nombre, id)}.jpg`;
}

const raicesArbol = new Map<string, string>();

/** Id de marketing/Platos o marketing/Vinos. Sin `crear`, null si no existe (nunca la crea al leer). */
export async function carpetaArbol(c: ConfigDriveInstagram, arbol: ArbolCarta, crear = false): Promise<string | null> {
  const clave = `${c.carpetaMarketing}|${arbol}`;
  const hecha = raicesArbol.get(clave);
  if (hecha) return hecha;
  const id = crear ? await c.cliente.asegurarCarpeta(arbol, c.carpetaMarketing) : await c.cliente.buscarCarpeta(arbol, c.carpetaMarketing);
  if (id) raicesArbol.set(clave, id);
  return id;
}

/** Las raíces que existan de los dos árboles (sin crear nada). */
export async function carpetasArboles(c: ConfigDriveInstagram): Promise<string[]> {
  const ids = await Promise.all(ARBOLES_CARTA.map((a) => carpetaArbol(c, a)));
  return ids.filter((x): x is string => !!x);
}

/**
 * ¿Cuelga el fichero (o carpeta) de alguna de las raíces, a cualquier
 * profundidad? Mira `parents` y sube de padre en padre, con tope de niveles
 * (TOPE_ANCESTROS) y sin pasar de la carpeta «marketing». Sustituye a estaEn
 * donde la foto puede estar en una subcarpeta (Platos/<cat>/<plato>/…).
 */
export async function estaBajo(c: ConfigDriveInstagram, f: Pick<FicheroDrive, "parents">, raices: readonly string[], tope = TOPE_ANCESTROS): Promise<boolean> {
  if (!raices.length) return false;
  const vistos = new Set<string>();
  let actuales = Array.isArray(f.parents) ? f.parents : [];
  for (let nivel = 0; nivel <= tope && actuales.length; nivel++) {
    if (actuales.some((p) => raices.includes(p))) return true;
    if (nivel === tope) break;
    const siguientes: string[] = [];
    for (const p of actuales) {
      if (vistos.has(p) || p === c.carpetaMarketing) continue;
      vistos.add(p);
      const m = await c.cliente.metadatos(p, "id,parents,trashed");
      if (m && !m.trashed && Array.isArray(m.parents)) siguientes.push(...m.parents);
    }
    actuales = siguientes;
  }
  return false;
}

/**
 * ¿Es de la carpeta «antigua» (padre directo) o cuelga del árbol Platos/Vinos?
 * El árbol solo vale para Casa Tomás (Touza se queda como está).
 */
export async function estaEnOArbol(c: ConfigDriveInstagram, f: Pick<FicheroDrive, "parents">, antigua: string, marca: MarcaDrive): Promise<boolean> {
  if (estaEn(f, antigua)) return true;
  if (marca !== "casa-tomas") return false;
  return await estaBajo(c, f, await carpetasArboles(c));
}

export interface FichaDeCarpeta {
  id: string;
  nombre: string | null;
  categoria?: string | null;
  drive_folder_id?: string | null;
}

export interface CarpetaResuelta {
  id: string;
  /** De dónde sale: el id guardado en la ficha, una carpeta que ya existía con su nombre, o una nueva. */
  origen: "bd" | "nombre" | "creada";
}

/**
 * Carpeta de un plato o vino en Platos/ o Vinos/:
 *  1. `drive_folder_id` de la ficha, si sigue existiendo, no está en la papelera y cuelga del árbol.
 *  2. Si no, una carpeta con el nombre de la ficha (sin tildes ni mayúsculas) en cualquier categoría
 *     (a igualdad, la de su categoría y las que no empiezan por «_»).
 *  3. Si no existe, se crea en <NN Categoría>/<nombre>, reutilizando la categoría cuyo nombre sin
 *     el «NN » coincide (o creándola si no hay).
 * Con `crear: false` no se crea nada (devuelve null si falta el árbol o la carpeta).
 */
export async function resolverCarpetaFicha(c: ConfigDriveInstagram, arbol: ArbolCarta, ficha: FichaDeCarpeta, crear: true): Promise<CarpetaResuelta>;
export async function resolverCarpetaFicha(c: ConfigDriveInstagram, arbol: ArbolCarta, ficha: FichaDeCarpeta, crear: boolean): Promise<CarpetaResuelta | null>;
export async function resolverCarpetaFicha(c: ConfigDriveInstagram, arbol: ArbolCarta, ficha: FichaDeCarpeta, crear: boolean): Promise<CarpetaResuelta | null> {
  const raiz = await carpetaArbol(c, arbol, crear);
  if (!raiz) return null;
  if (esIdDrive(ficha.drive_folder_id)) {
    const m = await c.cliente.metadatos(ficha.drive_folder_id, "id,name,mimeType,trashed,parents");
    if (m && !m.trashed && m.mimeType === TIPO_CARPETA && (await estaBajo(c, m, [raiz]))) return { id: m.id, origen: "bd" };
  }
  const objetivo = normalizarNombre(nombreCarpetaFicha(ficha.nombre, ficha.id));
  const categorias = await c.cliente.listarCarpetas(raiz);
  const hijas = categorias.length ? await c.cliente.listarHijos(categorias.map((x) => x.id), "carpetas", 3000) : [];
  const categoriaNorm = normalizarNombre(sinPrefijoNumero(ficha.categoria ?? ""));
  const nombreDeCategoria = new Map(categorias.map((x) => [x.id, x.name]));
  const puntos = (h: FicheroDrive) => {
    const cat = nombreDeCategoria.get(h.parents?.[0] ?? "") ?? "";
    return (categoriaNorm && normalizarNombre(sinPrefijoNumero(cat)) === categoriaNorm ? 2 : 0) + (cat.startsWith("_") ? 0 : 1);
  };
  const iguales = hijas.filter((h) => normalizarNombre(h.name) === objetivo).sort((a, b) => puntos(b) - puntos(a));
  if (iguales[0]) return { id: iguales[0].id, origen: "nombre" };
  if (!crear) return null;
  const nombreCategoria = (ficha.categoria ?? "").trim();
  let categoria = categoriaNorm ? categorias.find((x) => normalizarNombre(sinPrefijoNumero(x.name)) === categoriaNorm)?.id : undefined;
  if (!categoria) categoria = await c.cliente.asegurarCarpeta(nombreCategoria || "Sin categoría", raiz);
  const id = await c.cliente.crearCarpeta(nombreCarpetaFicha(ficha.nombre, ficha.id), categoria);
  return { id, origen: "creada" };
}

/** Subcarpeta «Vídeos» de la carpeta de un plato (admite «Videos» sin tilde; la crea si `crear`). */
export async function carpetaVideosDe(c: ConfigDriveInstagram, carpetaPlato: string, crear: boolean): Promise<string | null> {
  const subs = await c.cliente.listarCarpetas(carpetaPlato);
  const hay = subs.find((x) => normalizarNombre(x.name) === normalizarNombre(CARPETA_VIDEOS));
  if (hay) return hay.id;
  return crear ? await c.cliente.crearCarpeta(CARPETA_VIDEOS, carpetaPlato) : null;
}

/** «AAAA-MM» de una fecha (UTC). */
export function mesDe(fecha: Date): string {
  return fecha.toISOString().slice(0, 7);
}

/** marketing/instagram/publicadas/AAAA-MM (la crea si falta). */
export function carpetaPublicadas(c: ConfigDriveInstagram, fecha: Date): Promise<string> {
  return carpeta(c, ["instagram", "publicadas", mesDe(fecha)]);
}

/** Tipos de imagen que admite el bucket «instagram» (y Chromium sin problemas). */
export const TIPOS_IMAGEN: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** ¿Está el fichero dentro de la carpeta? */
export function estaEn(f: Pick<FicheroDrive, "parents">, carpetaId: string): boolean {
  return Array.isArray(f.parents) && f.parents.includes(carpetaId);
}

/** Medidas ya giradas (Drive da ancho/alto del fichero y la rotación EXIF). null si Drive no las sabe aún. */
export function medidasDrive(f: Pick<FicheroDrive, "imageMediaMetadata">): { ancho: number; alto: number } | null {
  const m = f.imageMediaMetadata;
  if (!m || !m.width || !m.height) return null;
  const girada = m.rotation === 1 || m.rotation === 3;
  return girada ? { ancho: m.height, alto: m.width } : { ancho: m.width, alto: m.height };
}

/** Alcance del token en palabras del panel. */
export type AlcanceDrive = "completo" | "drive.file" | "otro";

export function clasificarAlcance(alcances: readonly string[]): AlcanceDrive {
  if (alcances.includes(ALCANCE_DRIVE)) return "completo";
  if (alcances.includes(ALCANCE_DRIVE_FILE)) return "drive.file";
  return "otro";
}

export const AVISO_DRIVE_FILE =
  "El token de Google tiene el permiso «drive.file»: el panel solo ve las fotos que se suben desde aquí («Subir foto»). Las que arrastres a mano a la carpeta de Drive no saldrán.";

export const ARREGLO_DRIVE_FILE =
  "Con el permiso «drive.file» la app de Google solo ve las carpetas y archivos que ha creado ella, y la carpeta «marketing» se creó a mano. Dos salidas: " +
  "(1) recomendada: volver a autorizar la app de Google con el permiso completo «https://www.googleapis.com/auth/drive» y guardar el refresh token nuevo en el secreto GOOGLE_REFRESH_TOKEN " +
  "(ojo: lo comparten las facturas, que seguirán funcionando con el permiso completo); " +
  "o (2) usar como «marketing» una carpeta creada por la propia app y poner su id en GOOGLE_DRIVE_MARKETING_FOLDER_ID.";

export interface ComprobacionDrive {
  nombre: string;
  estado: "ok" | "aviso" | "falla";
  detalle: string;
  comoArreglarlo?: string;
}

export interface EstadoDrive {
  ok: boolean;
  alcance: AlcanceDrive | null;
  /** Alcances del token en forma corta («drive», «drive.file»…). Nunca el token. */
  alcances: string[];
  carpeta: { nombre: string; escribible: boolean } | null;
  comprobaciones: ComprobacionDrive[];
  avisos: string[];
}

/**
 * «Comprobar conexión» de Drive: secretos (presentes o no, nunca su valor),
 * token y su alcance, y si la carpeta «marketing» existe, se ve y se puede
 * escribir en ella. No crea nada.
 */
export async function comprobarDrive(env: Entorno, deps: { fetch?: typeof fetch } = {}): Promise<EstadoDrive> {
  const comprobaciones: ComprobacionDrive[] = [];
  const avisos: string[] = [];
  const salida = (ok: boolean, extra: Partial<EstadoDrive> = {}): EstadoDrive => ({
    ok,
    alcance: null,
    alcances: [],
    carpeta: null,
    comprobaciones,
    avisos,
    ...extra,
  });

  for (const nombre of VARIABLES_DRIVE) {
    const presente = !!valor(env, nombre);
    comprobaciones.push({
      nombre: `Secreto ${nombre}`,
      estado: presente ? "ok" : "falla",
      detalle: presente ? "definido" : "no definido",
      ...(presente
        ? {}
        : {
            comoArreglarlo:
              nombre === "GOOGLE_DRIVE_MARKETING_FOLDER_ID"
                ? `Crea GOOGLE_DRIVE_MARKETING_FOLDER_ID en ${dondeSecreto(nombre, env)}. Es el id de la carpeta «marketing» (lo que va tras /folders/ en su enlace de Drive).`
                : `Crea ${nombre} en ${dondeSecreto(nombre, env)}. Es el mismo que usan las facturas.`,
          }),
    });
  }
  const cfg = leerConfigDrive(env, deps);
  if ("faltan" in cfg) {
    if (cfg.faltan.length === 1 && valor(env, cfg.faltan[0])) {
      comprobaciones.push({ nombre: "Id de la carpeta", estado: "falla", detalle: cfg.problema, comoArreglarlo: "Copia solo el id de la carpeta (lo que va tras /folders/ en el enlace), sin la URL entera." });
    }
    return salida(false);
  }
  const { cliente, carpetaMarketing } = cfg.config;

  let alcances: string[];
  try {
    alcances = (await cliente.token()).alcances;
  } catch (e) {
    comprobaciones.push({
      nombre: "Token de Google",
      estado: "falla",
      detalle: sanear((e as Error).message),
      comoArreglarlo: "Revisa GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y GOOGLE_REFRESH_TOKEN (sin espacios ni saltos de línea). Si Google dice «invalid_grant», el refresh token se ha revocado o caducado: genera uno nuevo.",
    });
    return salida(false);
  }
  const alcance = clasificarAlcance(alcances);
  const cortos = alcances.map(nombreAlcance);
  comprobaciones.push({
    nombre: "Permiso (alcance) del token",
    estado: alcance === "completo" ? "ok" : alcance === "drive.file" ? "aviso" : "falla",
    detalle: cortos.length ? cortos.join(", ") : "Google no dijo el alcance",
    ...(alcance === "drive.file" ? { comoArreglarlo: AVISO_DRIVE_FILE } : {}),
    ...(alcance === "otro" ? { comoArreglarlo: "El token no tiene permiso de Drive. Vuelve a autorizar la app de Google con el alcance «https://www.googleapis.com/auth/drive»." } : {}),
  });

  let meta: FicheroDrive | null;
  try {
    meta = await cliente.metadatos(carpetaMarketing, "id,name,mimeType,trashed,capabilities(canAddChildren)");
  } catch (e) {
    const err = e as ErrorDrive;
    comprobaciones.push({
      nombre: "Carpeta «marketing»",
      estado: "falla",
      detalle: sanear(err.message),
      comoArreglarlo: err.motivo === "permiso" && alcance === "drive.file" ? ARREGLO_DRIVE_FILE : "Comprueba que la carpeta existe y que la cuenta de Google del token puede editarla.",
    });
    return salida(false, { alcance, alcances: cortos });
  }
  if (!meta || meta.trashed) {
    comprobaciones.push({
      nombre: "Carpeta «marketing»",
      estado: "falla",
      detalle: meta?.trashed ? "está en la papelera" : "no existe o el token no la ve",
      comoArreglarlo:
        alcance === "drive.file"
          ? ARREGLO_DRIVE_FILE
          : "Comprueba GOOGLE_DRIVE_MARKETING_FOLDER_ID y que la carpeta está compartida (como editor) con la cuenta de Google del token.",
    });
    if (alcance === "drive.file") avisos.push(AVISO_DRIVE_FILE);
    return salida(false, { alcance, alcances: cortos });
  }
  if (meta.mimeType !== "application/vnd.google-apps.folder") {
    comprobaciones.push({ nombre: "Carpeta «marketing»", estado: "falla", detalle: `«${meta.name}» no es una carpeta`, comoArreglarlo: "GOOGLE_DRIVE_MARKETING_FOLDER_ID tiene que ser el id de una carpeta." });
    return salida(false, { alcance, alcances: cortos });
  }
  const escribible = meta.capabilities?.canAddChildren === true;
  comprobaciones.push({ nombre: "Carpeta «marketing»", estado: "ok", detalle: `se ve: «${meta.name}»` });
  comprobaciones.push({
    nombre: "Escribir en la carpeta",
    estado: escribible ? "ok" : "falla",
    detalle: escribible ? "se pueden crear carpetas y archivos dentro" : "solo lectura para la cuenta del token",
    ...(escribible ? {} : { comoArreglarlo: "Comparte la carpeta «marketing» como «Editor» con la cuenta de Google del token." }),
  });
  if (alcance === "drive.file") avisos.push(AVISO_DRIVE_FILE);
  return salida(escribible && alcance !== "otro", { alcance, alcances: cortos, carpeta: { nombre: meta.name, escribible } });
}
