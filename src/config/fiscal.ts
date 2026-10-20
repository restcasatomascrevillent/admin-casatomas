/**
 * Configuración fiscal del establecimiento.
 *
 * Centraliza el tipo de IVA aplicable y los datos fiscales que se imprimen en el
 * ticket del TPV. Aquí no hay ningún dato inventado: si una variable de entorno
 * no está definida, el valor es `undefined` y la UI simplemente no imprime esa
 * línea.
 *
 * VARIABLES DE ENTORNO (Vite). Definirlas en `.env` / `.env.local` del panel:
 *
 *   VITE_ESTABLECIMIENTO_NOMBRE     Nombre comercial que encabeza el ticket
 *                                   (si falta: "Establecimiento")
 *   VITE_ESTABLECIMIENTO_CIF        CIF / NIF fiscal (si falta: no se imprime)
 *   VITE_ESTABLECIMIENTO_DIRECCION  Dirección fiscal  (si falta: no se imprime)
 *   VITE_ESTABLECIMIENTO_TELEFONO   Teléfono público  (si falta: no se imprime)
 *
 * Recordatorio: todas las variables de Vite expuestas al cliente son públicas
 * (acaban en el bundle). Aquí solo van datos que ya aparecen impresos en el
 * ticket, nunca secretos.
 */

/**
 * Tipo de IVA aplicable a los servicios de hostelería y restauración en España.
 *
 * Los precios de `ComidaVENTA` / `BebidasVENTA` son PVP: YA llevan el IVA
 * incluido. Por tanto el IVA se desglosa hacia atrás a partir del total que
 * paga el cliente (ver `desglosarIvaIncluido`), nunca se suma encima del precio
 * de carta.
 *
 * TODO: las bebidas alcohólicas tributan al 21 %, no al 10 %. Hoy no existe una
 * columna de tipo de IVA por producto en la base de datos, así que todo el
 * ticket se desglosa al 10 % y el desglose del alcohol queda mal (el total que
 * paga el cliente es correcto; lo que no cuadra es el reparto base/IVA). Para
 * emitir tickets fiscalmente correctos hace falta:
 *   1. Añadir una columna `tipo_iva` (numeric: 0.10 / 0.21) a `ComidaVENTA` y
 *      `BebidasVENTA`, con su migración y su actualización de
 *      `src/integrations/supabase/types.ts`.
 *   2. Propagar ese `tipo_iva` hasta `LineaTPV` y desglosar el IVA por tipo,
 *      agrupando las bases imponibles por tipo en el ticket
 *      (Base 10 % / IVA 10 % / Base 21 % / IVA 21 %).
 * Requiere cambio de esquema, fuera del alcance de este arreglo.
 */
export const TIPO_IVA_RESTAURACION = 0.10;

/**
 * Etiqueta legible del tipo de IVA (p. ej. "10%") para las UI del TPV.
 * Se deriva de la constante para que nunca se desincronice del cálculo.
 */
export const TIPO_IVA_RESTAURACION_ETIQUETA = `${Math.round(TIPO_IVA_RESTAURACION * 1000) / 10}%`;

/** Nombre que se imprime si no hay `VITE_ESTABLECIMIENTO_NOMBRE` configurado. */
export const NOMBRE_ESTABLECIMIENTO_POR_DEFECTO = "Establecimiento";

export interface DatosFiscales {
  /** Nombre comercial. Siempre definido (cae al valor neutro por defecto). */
  nombre: string;
  /** CIF / NIF. `undefined` si no está configurado: no se imprime. */
  cif?: string;
  /** Dirección fiscal. `undefined` si no está configurada: no se imprime. */
  direccion?: string;
  /** Teléfono de contacto. `undefined` si no está configurado: no se imprime. */
  telefono?: string;
}

/** Normaliza una variable de entorno: cadena vacía o ausente -> `undefined`. */
const leerVariable = (valor: unknown): string | undefined => {
  if (typeof valor !== "string") return undefined;
  const limpio = valor.trim();
  return limpio.length > 0 ? limpio : undefined;
};

/** Datos fiscales del establecimiento leídos del entorno. */
export const DATOS_FISCALES: DatosFiscales = {
  nombre:
    leerVariable(import.meta.env.VITE_ESTABLECIMIENTO_NOMBRE) ??
    NOMBRE_ESTABLECIMIENTO_POR_DEFECTO,
  cif: leerVariable(import.meta.env.VITE_ESTABLECIMIENTO_CIF),
  direccion: leerVariable(import.meta.env.VITE_ESTABLECIMIENTO_DIRECCION),
  telefono: leerVariable(import.meta.env.VITE_ESTABLECIMIENTO_TELEFONO),
};

/** Redondea un importe monetario a 2 decimales (céntimos). */
export const redondearCentimos = (importe: number): number =>
  Math.round((importe + Number.EPSILON) * 100) / 100;

export interface DesgloseIva {
  /** Importe sin IVA, redondeado a céntimos. */
  baseImponible: number;
  /** Cuota de IVA, redondeada a céntimos. */
  iva: number;
  /** Importe que paga el cliente (IVA incluido), redondeado a céntimos. */
  total: number;
}

/**
 * Desglosa hacia atrás el IVA de un importe que YA lo lleva incluido.
 *
 *   total          = redondear(importeConIva)
 *   baseImponible  = redondear(total / (1 + tipo))
 *   iva            = redondear(total - baseImponible)
 *
 * La cuota se calcula DESPUÉS de redondear base y total, de forma que
 * `baseImponible + iva` siempre cuadra con `total` al céntimo y el ticket
 * impreso nunca descuadra.
 */
export const desglosarIvaIncluido = (
  importeConIva: number,
  tipo: number = TIPO_IVA_RESTAURACION
): DesgloseIva => {
  const total = redondearCentimos(importeConIva);
  const baseImponible = redondearCentimos(total / (1 + tipo));
  const iva = redondearCentimos(total - baseImponible);

  return { baseImponible, iva, total };
};
