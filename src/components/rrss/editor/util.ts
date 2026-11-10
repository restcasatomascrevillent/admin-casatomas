import { estiloRecorteCss } from "@/lib/rrss/geometria";
import type { Encuadre } from "@/lib/rrss/plan";

/** Utilidades pequeñas del Editor IA (formato de tamaños, fechas y URL locales). */

export function formatoBytes(b: number): string {
  if (b >= 1048576) return `${(b / 1048576).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(b / 1024))} KB`;
}

export function formatoSegundos(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return "";
  const total = Math.round(s);
  const m = Math.floor(total / 60);
  const r = total % 60;
  return m > 0 ? `${m}:${String(r).padStart(2, "0")} min` : `${s.toFixed(1).replace(".", ",")} s`;
}

export function fechaCorta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

/** URL local de un archivo recién elegido (undefined si el entorno no sabe crearla). */
export function urlLocal(f: File): string | undefined {
  try {
    return typeof URL.createObjectURL === "function" ? URL.createObjectURL(f) : undefined;
  } catch {
    return undefined;
  }
}

/** Número con coma decimal, para etiquetas. */
export const coma = (n: number, d = 1) => n.toFixed(d).replace(".", ",");

/** Redondea a décimas (inputs de 0,1 s). */
export const aDecimas = (n: number) => Math.round(n * 10) / 10;

/** Posición y tamaño (en %) del original dentro del marco de salida, con el mismo recorte que el motor. */
export function posicionOriginal(original: { ancho: number | null; alto: number | null } | undefined, ancho: number, alto: number, encuadre: Encuadre) {
  if (!original?.ancho || !original.alto) return null;
  const e = estiloRecorteCss(original.ancho, original.alto, ancho, alto, encuadre);
  return { width: `${(e.width / ancho) * 100}%`, height: `${(e.height / alto) * 100}%`, left: `${(e.left / ancho) * 100}%`, top: `${(e.top / alto) * 100}%` };
}

