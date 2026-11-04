import * as z from "zod";
import { MENSAJES_PRECIO, normalizarPrecio } from "./precioCarta";

/**
 * Vino por copas y puntuación Parker (04/11/2026, petición del dueño). Campos
 * de "Vinos" de la migración 20261104140000_vinos_copeo_y_parker: `copeo`,
 * `precio_copa_eur`, `puntuacion_parker` y `puntuacion_parker_anada`. Los
 * comparten el alta (VinoForm) y la edición (EditarVinoModal); los límites son
 * los mismos que los CHECK de la base de datos.
 */
export const PRECIO_COPA_MAX = 999.99;
export const PARKER_MIN = 50;
export const PARKER_MAX = 100;

export const MENSAJES_COPA_PARKER = {
  copaObligatoria: "Pon el precio de la copa",
  copaMaximo: "La copa no puede pasar de 999,99 €",
  parkerRango: "La puntuación Parker va de 50 a 100",
  parkerEntero: "La puntuación Parker es un número entero, p. ej. 94",
  anadaRango: "Pon una añada de cuatro cifras, p. ej. 2019",
} as const;

/** Lo escrito en un campo de número entero: vacío → undefined; si no es un entero, se deja tal cual (sale el mensaje). */
export function normalizarEntero(valor: unknown): unknown {
  if (typeof valor === "number") return Number.isNaN(valor) ? undefined : valor;
  if (valor === null || valor === undefined) return undefined;
  if (typeof valor !== "string") return valor;
  const limpio = valor.trim();
  if (limpio === "") return undefined;
  return /^\d+$/.test(limpio) ? Number(limpio) : valor;
}

const precioCopa = z.preprocess(
  normalizarPrecio,
  z
    .number({ invalid_type_error: MENSAJES_PRECIO.noNumero })
    .positive(MENSAJES_PRECIO.noPositivo)
    .max(PRECIO_COPA_MAX, MENSAJES_COPA_PARKER.copaMaximo)
    .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, MENSAJES_PRECIO.decimales)
    .optional(),
);

const puntuacionParker = z.preprocess(
  normalizarEntero,
  z
    .number({ invalid_type_error: MENSAJES_COPA_PARKER.parkerEntero })
    .int(MENSAJES_COPA_PARKER.parkerEntero)
    .min(PARKER_MIN, MENSAJES_COPA_PARKER.parkerRango)
    .max(PARKER_MAX, MENSAJES_COPA_PARKER.parkerRango)
    .optional(),
);

const anadaParker = z.preprocess(
  normalizarEntero,
  z
    .number({ invalid_type_error: MENSAJES_COPA_PARKER.anadaRango })
    .int(MENSAJES_COPA_PARKER.anadaRango)
    .min(1900, MENSAJES_COPA_PARKER.anadaRango)
    .max(2100, MENSAJES_COPA_PARKER.anadaRango)
    .optional(),
);

/** Campos para añadir al `z.object` de cada formulario de vino. */
export const camposCopaParker = {
  copeo: z.boolean(),
  precio_copa_eur: precioCopa,
  puntuacion_parker: puntuacionParker,
  puntuacion_parker_anada: anadaParker,
};

/** Un vino por copas necesita precio de copa (la web no tendría qué enseñar). Para `.superRefine`. */
export function exigirPrecioCopa(
  valores: { copeo?: boolean; precio_copa_eur?: number },
  ctx: z.RefinementCtx,
) {
  if (valores.copeo && valores.precio_copa_eur === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["precio_copa_eur"], message: MENSAJES_COPA_PARKER.copaObligatoria });
  }
}

/** Valores iniciales de un vino nuevo. */
export const COPA_PARKER_VACIO = {
  copeo: false,
  precio_copa_eur: "",
  puntuacion_parker: "",
  puntuacion_parker_anada: "",
} as const;

/** Valores del formulario al abrir la edición de un vino guardado. */
export function copaParkerParaCampos(vino: {
  copeo?: boolean | null;
  precio_copa_eur?: number | null;
  puntuacion_parker?: number | null;
  puntuacion_parker_anada?: number | null;
}) {
  const texto = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
  return {
    copeo: vino.copeo === true,
    precio_copa_eur: texto(vino.precio_copa_eur),
    puntuacion_parker: texto(vino.puntuacion_parker),
    puntuacion_parker_anada: texto(vino.puntuacion_parker_anada),
  };
}

/**
 * Lo que se guarda en BD. El precio de la copa se conserva aunque se apague el
 * copeo (al volver a encenderlo ya está puesto); sin puntuación no hay añada.
 */
export function copaParkerParaGuardar(valores: {
  copeo?: boolean;
  precio_copa_eur?: number;
  puntuacion_parker?: number;
  puntuacion_parker_anada?: number;
}) {
  return {
    copeo: valores.copeo === true,
    precio_copa_eur: valores.precio_copa_eur ?? null,
    puntuacion_parker: valores.puntuacion_parker ?? null,
    puntuacion_parker_anada: valores.puntuacion_parker !== undefined ? valores.puntuacion_parker_anada ?? null : null,
  };
}
