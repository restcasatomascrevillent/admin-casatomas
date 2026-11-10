/**
 * RRSS · rótulos con las fuentes de marca (sharp → Pango). Devuelve PNG con
 * transparencia listos para componer sobre la foto.
 */
import type sharpTipo from "sharp";
import type { FamiliaMotor } from "../../../src/lib/rrss/estilos.js";
import { FUENTES_MOTOR, ficheroFuente } from "./recursos.js";

type Sharp = typeof sharpTipo;

export interface OpcionesTexto {
  texto: string;
  familia: FamiliaMotor;
  /** Cuerpo en píxeles. */
  px: number;
  color: string;
  anchoMax: number;
  alinear?: "izquierda" | "centro";
  /** Espaciado entre letras en px (antetítulos en versalitas). */
  espaciado?: number;
  /** Interlineado extra en px. */
  interlineado?: number;
}

export interface TextoPintado {
  png: Buffer;
  ancho: number;
  alto: number;
  px: number;
}

export function escaparPango(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Color CSS (#rgb, #rrggbb o rgba()) → #rrggbb para Pango (la transparencia no la usa el texto). */
export function colorPango(c: string): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (hex) {
    const h = hex[1];
    return h.length === 3 ? `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : `#${h}`;
  }
  const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(c);
  if (m) return `#${[m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, "0")).join("")}`;
  return "#ffffff";
}

export async function pintarTexto(sharp: Sharp, o: OpcionesTexto): Promise<TextoPintado> {
  const fuente = FUENTES_MOTOR[o.familia];
  const px = Math.max(8, Math.round(o.px));
  const espaciado = o.espaciado ? ` letter_spacing="${Math.round(o.espaciado * 1024)}"` : "";
  const markup = `<span foreground="${colorPango(o.color)}"${espaciado}>${escaparPango(o.texto)}</span>`;
  const img = sharp({
    text: {
      text: markup,
      font: `${fuente.familia} ${px}`,
      fontfile: ficheroFuente(o.familia),
      width: Math.max(16, Math.round(o.anchoMax)),
      align: o.alinear === "centro" ? "centre" : "left",
      rgba: true,
      dpi: 72,
      spacing: o.interlineado ? Math.round(o.interlineado) : 0,
      wrap: "word",
    },
  });
  const { data, info } = await img.png().toBuffer({ resolveWithObject: true });
  return { png: data, ancho: info.width, alto: info.height, px };
}

/**
 * Pinta el texto y, si pasa del alto máximo, baja el cuerpo hasta que quepa
 * (como mucho 5 intentos; el último se acepta).
 */
export async function pintarAjustado(sharp: Sharp, o: OpcionesTexto, altoMax: number): Promise<TextoPintado> {
  let actual = o.px;
  let ultimo: TextoPintado | null = null;
  for (let i = 0; i < 5; i++) {
    ultimo = await pintarTexto(sharp, { ...o, px: actual });
    if (ultimo.alto <= altoMax && ultimo.ancho <= o.anchoMax + 2) return ultimo;
    actual *= 0.85;
  }
  return ultimo as TextoPintado;
}
