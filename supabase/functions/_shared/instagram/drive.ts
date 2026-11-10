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
 *
 * Secretos (los mismos de las facturas + la carpeta): GOOGLE_CLIENT_ID,
 * GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN y GOOGLE_DRIVE_MARKETING_FOLDER_ID.
 * Se registran para taparlos en cualquier salida; nunca se devuelven.
 *
 * TRAMPA del alcance `drive.file`: con él la app solo ve lo que ella misma ha
 * creado. Ni la carpeta «marketing» (creada a mano) ni las fotos arrastradas a
 * mano a Drive. Ver comprobarDrive().
 */
import { ALCANCE_DRIVE, ALCANCE_DRIVE_FILE, ClienteDrive, ErrorDrive, esIdDrive, nombreAlcance, type FicheroDrive } from "../google-drive.ts";
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
