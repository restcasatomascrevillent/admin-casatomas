/**
 * Fuentes de la carta impresa: Libre Baskerville, la de la web pública, en
 * TTF estático para poder incrustarla en el PDF (texto vectorial, no imagen).
 *
 * Los tres TTF de `src/assets/fuentes/carta-pdf/` salen de las fuentes
 * variables oficiales que guarda la web (web-casatomas/assets-src/fonts/
 * libre-baskerville, versión 2.005, SIL Open Font License 1.1: ver OFL.txt):
 * instancias de peso 400 (normal y cursiva) y 600 (seminegrita, la de los
 * títulos de las tarjetas de la web) hechas con fontTools y recortadas a
 * latín, latín-1, latín extendido A, puntuación y €, con el interletraje y
 * las ligaduras.
 *
 * Este módulo no importa los TTF: los recibe en bytes (en el navegador los
 * descarga `cargarFuentesNavegador`; en las pruebas se leen del disco).
 */
import type { Font } from "@pdf-lib/fontkit";
import type { FuenteCarta, Medidor } from "./maquetacion";

export type BytesFuentes = Record<FuenteCarta, Uint8Array>;
export type FuentesKit = Record<FuenteCarta, Font>;

/** Nombre de familia con el que se registran para la vista previa (FontFace). */
export const FAMILIA_VISTA: Record<FuenteCarta, string> = {
  regular: "CartaPdf LibreBaskerville",
  italica: "CartaPdf LibreBaskerville Italic",
  seminegrita: "CartaPdf LibreBaskerville SemiBold",
};

/** Sustitutos de caracteres que la fuente no tiene. */
const SUSTITUTOS: Record<string, string> = {
  "‐": "-",
  "‑": "-",
  "‒": "–",
  "―": "—",
  "−": "–",
  "­": "",
  "​": "",
  "‌": "",
  "‍": "",
  "﻿": "",
  "\t": " ",
  "\r": " ",
  "\n": " ",
};

/**
 * Deja un texto pintable con estas fuentes: forma compuesta (NFC), sin
 * controles ni emojis, y con sustitutos para guiones raros. Una letra con un
 * diacrítico que la fuente no tiene se queda en su letra base.
 */
export function limpiarTexto(texto: string, tieneGlifo: (codigo: number) => boolean): string {
  let resultado = "";
  for (const caracter of texto.normalize("NFC")) {
    if (caracter in SUSTITUTOS) {
      resultado += SUSTITUTOS[caracter];
      continue;
    }
    const codigo = caracter.codePointAt(0)!;
    if (codigo < 0x20 || (codigo >= 0x7f && codigo < 0xa0)) continue;
    if (tieneGlifo(codigo)) {
      resultado += caracter;
      continue;
    }
    const base = caracter.normalize("NFD")[0];
    if (base && base !== caracter && tieneGlifo(base.codePointAt(0)!)) resultado += base;
  }
  return resultado.replace(/ {2,}/g, " ").trim();
}

interface MedidaUnidad {
  /** Avance total en unidades de la fuente (con interletraje y ligaduras). */
  avance: number;
  glifos: number;
}

/** Medidor con las métricas reales (fontkit): las mismas que usa el PDF. */
export function crearMedidor(fuentes: FuentesKit): Medidor {
  const cache = new Map<string, MedidaUnidad>();
  const medir = (texto: string, fuente: FuenteCarta): MedidaUnidad => {
    const clave = `${fuente}\u0000${texto}`;
    let medida = cache.get(clave);
    if (!medida) {
      const run = fuentes[fuente].layout(texto);
      medida = { avance: run.positions.reduce((total, p) => total + p.xAdvance, 0), glifos: run.glyphs.length };
      cache.set(clave, medida);
    }
    return medida;
  };
  const regular = fuentes.regular;
  const italica = fuentes.italica;
  const seminegrita = fuentes.seminegrita;
  const tieneGlifo = (codigo: number) =>
    regular.hasGlyphForCodePoint(codigo) && italica.hasGlyphForCodePoint(codigo) && seminegrita.hasGlyphForCodePoint(codigo);
  return {
    ancho(texto, fuente, tamano, espaciado = 0) {
      if (!texto) return 0;
      const { avance, glifos } = medir(texto, fuente);
      return (avance * tamano) / fuentes[fuente].unitsPerEm + espaciado * Math.max(0, glifos - 1);
    },
    limpiar: (texto) => limpiarTexto(texto, tieneGlifo),
  };
}

export interface Fontkit {
  create(buffer: Uint8Array, postscriptName?: string): Font;
}

/**
 * fontkit, con `import()`: solo se descarga al abrir el diálogo de la carta
 * impresa. Su ESM solo trae `default` (los tipos dicen `create` suelto).
 */
export async function cargarFontkit(): Promise<Fontkit> {
  const modulo = (await import("@pdf-lib/fontkit")) as unknown as Partial<Fontkit> & { default?: Fontkit };
  const fontkit = modulo.default?.create ? modulo.default : (modulo as Fontkit);
  if (typeof fontkit.create !== "function") throw new Error("No se ha podido cargar fontkit");
  return fontkit;
}

export function crearFuentesKit(fontkit: Fontkit, bytes: BytesFuentes): FuentesKit {
  return {
    regular: fontkit.create(bytes.regular),
    italica: fontkit.create(bytes.italica),
    seminegrita: fontkit.create(bytes.seminegrita),
  };
}
