/**
 * Plantilla mínima de prueba (no está en PLANTILLAS).
 * Sirve para probar el motor aunque aún no existan las plantillas reales.
 */
import { esc, type Plantilla } from "../../tipos";
import type { MarcaId } from "../../tokens";

export function plantillaPrueba(marca: MarcaId = "casa-tomas"): Plantilla {
  return {
    id: `prueba-${marca}`,
    marca,
    nombre: "Prueba",
    descripcion: "Plantilla mínima para tests del motor.",
    formatos: ["post", "story"],
    obligatorios: [],
    admitidos: ["foto", "antetitulo", "titular", "cta"],
    limites: { antetitulo: 40, cta: 24 },
    tiposFoto: ["sala", "ambiente", "bebida", "barra", "coctel", "interior", "plato"],
    html(d, ctx) {
      const arriba = ctx.zonaSegura.arriba || ctx.margen;
      const abajo = ctx.zonaSegura.abajo || ctx.margen;
      const foto = d.foto ? `<img class="foto" src="${ctx.urlFoto(d.foto)}" alt="">` : "";
      return `<style>
  .foto { position: absolute; inset: 0; width: 100%; height: 55%; object-fit: cover; }
  .caja { position: absolute; left: ${ctx.margen}px; right: ${ctx.margen}px; top: ${arriba}px; bottom: ${abajo}px;
          display: flex; flex-direction: column; justify-content: flex-end; gap: 24px; }
  .ante { font-size: 22px; letter-spacing: var(--tracking-antetitulo); text-transform: uppercase; color: var(--color-antetitulo); }
  .tit-caja { height: 360px; overflow: hidden; }
  .tit { font-family: var(--fuente-titular); font-weight: var(--peso-titular); color: var(--color-titular); font-size: 88px; line-height: 1.05; }
  .cta { align-self: flex-start; background: var(--color-boton-fondo); color: var(--color-boton-texto); border-radius: var(--radio-boton); padding: 18px 36px; font-size: 24px; }
</style>
${foto}
<div class="caja">
  ${d.antetitulo ? `<p class="ante" data-campo="antetitulo">${esc(d.antetitulo)}</p>` : ""}
  <div class="tit-caja" data-ajuste="titular"><h1 class="tit" data-campo="titular">${esc(d.titular)}</h1></div>
  ${d.cta ? `<span class="cta" data-campo="cta">${esc(d.cta)}</span>` : ""}
</div>`;
    },
  };
}
