import * as z from "zod";
import { MENSAJES_PRECIO, normalizarPrecio } from "./precioCarta";

/**
 * Vino por copas (04/11/2026) y añada que se sirve (08/11/2026). Campos de
 * "Vinos": `copeo` y `precio_copa_eur` (migración 20261104140000) y `anada` y
 * `sin_anada` (20261118100000). Los comparten el alta (VinoForm) y la edición
 * (EditarVinoModal); los límites son los mismos que los CHECK de la BD.
 *
 * La puntuación Parker YA NO se escribe a mano aquí (08/11/2026): va en
 * vinos_puntuacion_parker con su fuente (parker/PanelParker.tsx) y la base de
 * datos calcula `puntuacion_parker*` solo con la verificada de la añada que se
 * sirve. Por eso este formulario manda `anada`/`sin_anada` y nunca los puntos.
 */
export const PRECIO_COPA_MAX = 999.99;
export const PARKER_MIN = 50;
export const PARKER_MAX = 100;

export const MENSAJES_COPA_PARKER = {
  copaObligatoria: "Pon el precio de la copa",
  copaMaximo: "La copa no puede pasar de 999,99 €",
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

const anadaServida = z.preprocess(
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
  anada: anadaServida,
  sin_anada: z.boolean().optional(),
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
  anada: "",
  sin_anada: false,
} as const;

/** Valores del formulario al abrir la edición de un vino guardado. */
export function copaParkerParaCampos(vino: {
  copeo?: boolean | null;
  precio_copa_eur?: number | null;
  anada?: number | null;
  sin_anada?: boolean | null;
}) {
  const texto = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
  return {
    copeo: vino.copeo === true,
    precio_copa_eur: texto(vino.precio_copa_eur),
    anada: texto(vino.anada),
    sin_anada: vino.sin_anada === true,
  };
}

/**
 * Solo los campos de copa y añada que CAMBIAN respecto a lo guardado. Así un
 * panel desplegado antes de aplicar las migraciones (columnas que aún no
 * existen) puede seguir editando y creando vinos mientras no se toquen estos
 * campos: no los manda.
 */
export function cambiosCopaParker(
  valores: Parameters<typeof copaParkerParaGuardar>[0],
  guardado: Parameters<typeof copaParkerParaCampos>[0] = {},
) {
  const nuevo = copaParkerParaGuardar(valores);
  const antes = {
    copeo: guardado.copeo === true,
    precio_copa_eur: guardado.precio_copa_eur ?? null,
    anada: guardado.anada ?? null,
    sin_anada: guardado.sin_anada === true,
  };
  return Object.fromEntries(
    (Object.keys(nuevo) as (keyof typeof nuevo)[]).filter((k) => nuevo[k] !== antes[k]).map((k) => [k, nuevo[k]]),
  ) as Partial<typeof nuevo>;
}

/**
 * Lo que se guarda en BD. El precio de la copa se conserva aunque se apague el
 * copeo (al volver a encenderlo ya está puesto); un vino sin añada (NV) no
 * lleva año.
 */
export function copaParkerParaGuardar(valores: {
  copeo?: boolean;
  precio_copa_eur?: number;
  anada?: number;
  sin_anada?: boolean;
}) {
  const sinAnada = valores.sin_anada === true;
  return {
    copeo: valores.copeo === true,
    precio_copa_eur: valores.precio_copa_eur ?? null,
    anada: sinAnada ? null : valores.anada ?? null,
    sin_anada: sinAnada,
  };
}
