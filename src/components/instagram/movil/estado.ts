/**
 * Estado puro de las fotos del asistente móvil (sin React): añadir hasta 10,
 * quitar, reordenar y apuntar cómo va la subida de cada una.
 */
import { MAX_FOTOS_CARRUSEL, type FotoParaMontar } from "@/lib/instagram/montar";

export type EstadoSubida = "preparando" | "subiendo" | "subida" | "error";

export interface FotoMovil {
  /** Id estable en el móvil; también es el uuid de su copia tmp/<clave>.jpg. */
  clave: string;
  origen: "subida" | "carta";
  nombre: string;
  /** JPEG ya convertido (las de la carta no tienen: ya están en el servidor). */
  blob: Blob | null;
  /** URL para la miniatura (object URL del blob o la foto de la carta). */
  vista: string;
  ancho: number | null;
  alto: number | null;
  estado: EstadoSubida;
  error?: string | null;
  /** Lo que se manda a «Montar con IA» cuando ya está en el servidor. */
  subida: FotoParaMontar | null;
  /** Hora (ms) en que se subió: las copias tmp/ se borran a las 24 h. */
  subidaEn?: number | null;
  platoId?: string | null;
}

export type AccionFotos =
  | { tipo: "anadir"; fotos: FotoMovil[] }
  | { tipo: "quitar"; clave: string }
  | { tipo: "mover"; desde: number; hasta: number }
  | { tipo: "actualizar"; clave: string; cambios: Partial<FotoMovil> }
  | { tipo: "reemplazar"; fotos: FotoMovil[] };

/** Mueve un elemento de `desde` a `hasta` (índices fuera de rango: sin cambios). */
export function moverEnLista<T>(lista: readonly T[], desde: number, hasta: number): T[] {
  if (desde === hasta || desde < 0 || hasta < 0 || desde >= lista.length || hasta >= lista.length) return [...lista];
  const copia = [...lista];
  const [x] = copia.splice(desde, 1);
  copia.splice(hasta, 0, x);
  return copia;
}

/** Huecos libres hasta el máximo del carrusel. */
export function huecosLibres(lista: readonly FotoMovil[]): number {
  return Math.max(0, MAX_FOTOS_CARRUSEL - lista.length);
}

export function reducirFotos(lista: FotoMovil[], a: AccionFotos): FotoMovil[] {
  switch (a.tipo) {
    case "anadir":
      return [...lista, ...a.fotos].slice(0, MAX_FOTOS_CARRUSEL);
    case "quitar":
      return lista.filter((f) => f.clave !== a.clave);
    case "mover":
      return moverEnLista(lista, a.desde, a.hasta);
    case "actualizar":
      return lista.some((f) => f.clave === a.clave) ? lista.map((f) => (f.clave === a.clave ? { ...f, ...a.cambios } : f)) : lista;
    case "reemplazar":
      return a.fotos.slice(0, MAX_FOTOS_CARRUSEL);
  }
}

/** Fotos ya subidas, en el orden elegido, tal como las pide «Montar con IA». */
export function fotosParaMontar(lista: readonly FotoMovil[]): FotoParaMontar[] {
  return lista.filter((f) => f.estado === "subida" && f.subida).map((f) => f.subida as FotoParaMontar);
}

export function todasSubidas(lista: readonly FotoMovil[]): boolean {
  return lista.length > 0 && lista.every((f) => f.estado === "subida" && !!f.subida);
}

/** Resumen para la línea de estado: «Subiendo 3 de 6…». */
export function resumenSubidas(lista: readonly FotoMovil[]): { subidas: number; total: number; errores: number; pendientes: number } {
  const subidas = lista.filter((f) => f.estado === "subida").length;
  const errores = lista.filter((f) => f.estado === "error").length;
  return { subidas, total: lista.length, errores, pendientes: lista.length - subidas - errores };
}

/** Copia tmp/ demasiado vieja (la función borra las de más de 24 h; margen de 4 h). */
export const VIDA_SUBIDA_MS = 20 * 60 * 60 * 1000;

export function subidaCaducada(f: Pick<FotoMovil, "subidaEn">, ahora = Date.now()): boolean {
  return !f.subidaEn || ahora - f.subidaEn > VIDA_SUBIDA_MS;
}
