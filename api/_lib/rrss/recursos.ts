/**
 * RRSS · recursos del motor en disco: fuentes TTF de marca y logos.
 *
 * Las fuentes son las de la marca (OFL) convertidas de los woff2 del panel a
 * TTF (Pango, el que usa sharp para rotular, no lee woff2): Libre Baskerville
 * para Casa Tomás y Cormorant Garamond + Montserrat para Touza. Cada fichero
 * tiene un nombre de familia propio («RRSS …») para que Pango y libass elijan
 * exactamente ese y nunca una fuente de reserva. Los logos son los mismos de
 * las piezas de Instagram (public/instagram/logos).
 *
 * En Vercel van dentro del bundle de la función (vercel.json → includeFiles).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import type { FamiliaMotor } from "../../../src/lib/rrss/estilos.js";

const RAICES = [process.cwd(), path.resolve(process.cwd(), ".."), "/var/task"];

function buscar(relativa: string): string {
  for (const r of RAICES) {
    const p = path.join(r, relativa);
    if (existsSync(p)) return p;
  }
  return path.join(process.cwd(), relativa);
}

export const DIR_FUENTES_REL = "api/_lib/rrss/fuentes";
export const DIR_LOGOS_REL = "public/instagram/logos";

export function dirFuentes(): string {
  return process.env.RRSS_DIR_FUENTES || buscar(DIR_FUENTES_REL);
}

export function dirLogos(): string {
  return process.env.RRSS_DIR_LOGOS || buscar(DIR_LOGOS_REL);
}

/** Fichero y nombre de familia (el del TTF) de cada familia del motor. */
export const FUENTES_MOTOR: Record<FamiliaMotor, { fichero: string; familia: string }> = {
  baskerville: { fichero: "LibreBaskerville-Regular.ttf", familia: "RRSS Baskerville" },
  "baskerville-seminegrita": { fichero: "LibreBaskerville-SemiBold.ttf", familia: "RRSS Baskerville Seminegrita" },
  "baskerville-cursiva": { fichero: "LibreBaskerville-Italic.ttf", familia: "RRSS Baskerville Cursiva" },
  "cormorant-titular": { fichero: "CormorantGaramond-SemiBold.ttf", familia: "RRSS Cormorant Titular" },
  "cormorant-cursiva": { fichero: "CormorantGaramond-Italic.ttf", familia: "RRSS Cormorant Cursiva" },
  "montserrat-medio": { fichero: "Montserrat-Medium.ttf", familia: "RRSS Montserrat Medio" },
  "montserrat-seminegrita": { fichero: "Montserrat-SemiBold.ttf", familia: "RRSS Montserrat Seminegrita" },
};

export function ficheroFuente(f: FamiliaMotor): string {
  return path.join(dirFuentes(), FUENTES_MOTOR[f].fichero);
}

export function ficheroLogo(nombre: string): string {
  // Solo nombres de fichero de la carpeta de logos (sin rutas).
  if (!/^[a-z0-9-]+\.png$/.test(nombre)) throw new Error(`Logo no válido: ${nombre}`);
  return path.join(dirLogos(), nombre);
}
