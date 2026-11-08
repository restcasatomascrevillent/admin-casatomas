/**
 * Piezas comunes de las plantillas v2 (08/11/2026): degradados suaves y
 * ayudas para pintar campos de texto. Isomórfico.
 */
import { esc, type CampoPieza } from "../tipos.js";

/**
 * Degradado lineal con paradas suavizadas (sin el «escalón» de uno de dos
 * paradas): de `alfaMax` % del color en el arranque a transparente al final.
 * `color` es una variable CSS (p. ej. "--color-negro").
 */
export function degradado(color: string, alfaMax: number, direccion = "to top"): string {
  const paradas: Array<[number, number]> = [
    [0, 1],
    [18, 0.96],
    [32, 0.86],
    [46, 0.68],
    [60, 0.46],
    [74, 0.25],
    [87, 0.09],
    [100, 0],
  ];
  const tramos = paradas.map(([pos, k]) => `color-mix(in srgb, var(${color}) ${Math.round(alfaMax * k * 10) / 10}%, transparent) ${pos}%`);
  return `linear-gradient(${direccion}, ${tramos.join(", ")})`;
}

/** Un campo de texto con data-campo y data-ajuste, o "" si no hay valor. */
export function campo(etiqueta: string, clase: string, nombre: CampoPieza, valor: string | undefined): string {
  if (!valor) return "";
  return `<${etiqueta} class="${clase}" data-campo="${nombre}" data-ajuste>${esc(valor)}</${etiqueta}>`;
}

/**
 * Información de la firma: el botón (en versalitas, como «Reserva · 966…» del
 * post del dueño) y el pie debajo, cada uno en una línea (nowrap): si no
 * caben, desbordan y el motor da error. "" si no hay ninguno.
 */
export function lineaInfo(clase: string, cta: string | undefined, pie: string | undefined): string {
  if (!cta && !pie) return "";
  return `<div class="${clase}">${campo("p", `${clase}-cta`, "cta", cta)}${campo("p", `${clase}-pie`, "pie", pie)}</div>`;
}
