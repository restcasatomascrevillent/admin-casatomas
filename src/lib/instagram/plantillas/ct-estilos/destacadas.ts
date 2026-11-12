/**
 * Portada de historia destacada de Casa Tomás (12/11/2026): un juego coherente
 * para Opináis, Jueves de tapas, Platos, Vosotros y Touza. Story 1080×1920
 * (Instagram recorta el círculo del centro): fondo pizarra, un círculo oro
 * fino y, dentro, un icono de línea fina en blanco. El nombre de la destacada
 * va debajo, fuera del recorte (se ve en la story, no en el círculo).
 *
 * El icono sale del titular: «Opináis/Reseñas» → bocadillo con estrella,
 * «Tapas/Jueves» → montadito con palillo, «Platos/Carta» → plato y cubiertos,
 * «Vosotros/Clientes» → dos copas brindando, «Touza/Cóctel» → copa de cóctel.
 * Cualquier otro nombre lleva el medallón del logo.
 */
import { esc, type ContextoPlantilla, type DatosPieza, type Plantilla } from "../../tipos.js";
import { CSS_BASE, SANS, fuentes, type Cara } from "./base.js";

export type IconoDestacada = "opinais" | "tapas" | "platos" | "vosotros" | "touza";

/** Trazos de cada icono (viewBox 0 0 100 100, línea de 3, sin relleno). */
export const ICONOS: Record<IconoDestacada, string> = {
  opinais:
    '<path d="M22 22h56a9 9 0 0 1 9 9v30a9 9 0 0 1-9 9H46L31 82V70h-9a9 9 0 0 1-9-9V31a9 9 0 0 1 9-9z"/><path d="M50 33.5l3.6 7.3 8 1.2-5.8 5.6 1.4 8-7.2-3.8-7.2 3.8 1.4-8-5.8-5.6 8-1.2z"/>',
  tapas:
    '<ellipse cx="50" cy="77" rx="36" ry="8"/><rect x="27" y="57" width="46" height="12" rx="4"/><path d="M29 57c4-8 12-11 21-11s17 3 21 11"/><path d="M47 64l9-46"/><circle cx="57" cy="14" r="4.5"/>',
  platos:
    '<circle cx="50" cy="50" r="25"/><circle cx="50" cy="50" r="16"/><path d="M13 24v12a4 4 0 0 0 8 0V24"/><path d="M17 24v52"/><path d="M85 76V24c-6 4-8 14-8 24h8"/>',
  vosotros:
    '<g transform="rotate(-14 34 46)"><path d="M23 20h22c0 15-4 24-11 24s-11-9-11-24z"/><path d="M34 44v26"/><path d="M25 70h18"/></g><g transform="rotate(14 66 46)"><path d="M55 20h22c0 15-4 24-11 24s-11-9-11-24z"/><path d="M66 44v26"/><path d="M57 70h18"/></g><path d="M50 8v7"/><path d="M42 11l3 6"/><path d="M58 11l-3 6"/>',
  touza:
    '<path d="M22 32h56c0 15-12.5 25-28 25S22 47 22 32z"/><path d="M50 57v22"/><path d="M37 79h26"/><path d="M58 40l12-26"/><circle cx="72" cy="11" r="4"/>',
};

/** Icono que corresponde a un nombre de destacada, o null (lleva el medallón). */
export function iconoPara(nombre: string): IconoDestacada | null {
  const t = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  if (/opin|resen|valora/.test(t)) return "opinais";
  if (/tapa|jueves/.test(t)) return "tapas";
  if (/touza|coctel|cocktail/.test(t)) return "touza";
  if (/vosotros|client|celebr|brind/.test(t)) return "vosotros";
  if (/plato|carta|cocina|menu/.test(t)) return "platos";
  return null;
}

export const CARAS_DESTACADA: readonly Cara[] = ["sans-400"];

function html(datos: DatosPieza, ctx: ContextoPlantilla): string {
  const icono = iconoPara(datos.titular);
  const dentro = icono
    ? `<svg class="ctsd__icono" viewBox="0 0 100 100" fill="none" stroke="var(--color-blanco)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[icono]}</svg>`
    : `<img class="ctsd__medallon" src="${esc(ctx.urlLogo("medallon", "blanco"))}" alt="">`;
  return `<style>${fuentes(ctx, CARAS_DESTACADA)}${CSS_BASE}
.ctsd{background:var(--color-pizarra)}
.ctsd__circulo{position:absolute;left:50%;top:960px;width:600px;height:600px;margin:-300px 0 0 -300px;border:5px solid var(--color-oro);border-radius:50%;display:flex;align-items:center;justify-content:center}
.ctsd__icono{width:350px;height:350px;display:block}
.ctsd__medallon{width:300px;height:300px;display:block}
.ctsd__nombre{position:absolute;left:72px;right:72px;top:1350px;font-family:${SANS};font-weight:400;font-size:40px;line-height:1.3;letter-spacing:.3em;padding-left:.3em;text-transform:uppercase;text-align:center;white-space:nowrap;color:var(--color-oro-claro)}
</style>
<div class="cts ctsd cts--story">
  <div class="ctsd__circulo">${dentro}</div>
  <p class="ctsd__nombre" data-campo="titular" data-ajuste>${esc(datos.titular)}</p>
</div>`;
}

export const PLANTILLAS_DESTACADAS: readonly Plantilla[] = [
  {
    id: "ct-icono-destacada",
    marca: "casa-tomas",
    nombre: "Portada de destacada",
    descripcion:
      "Portada de historia destacada: fondo pizarra, círculo oro fino y un icono de línea según el nombre (Opináis, Jueves de tapas, Platos, Vosotros, Touza; otro nombre lleva el medallón). El nombre va debajo, fuera del recorte.",
    formatos: ["story"],
    // El titular ya es obligatorio; declararlo deja la plantilla fuera de las campañas de la IA
    // (una portada de destacada no es una publicación).
    obligatorios: ["titular"],
    admitidos: ["titular"],
    limites: { titular: 18 },
    papel: "tipografica",
    html,
  },
];
