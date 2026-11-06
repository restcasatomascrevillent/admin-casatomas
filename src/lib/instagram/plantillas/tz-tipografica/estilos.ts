/**
 * CSS de tz-tipografica. Solo variables de marca; los px son de composición.
 */
import type { ContextoPlantilla } from "../../tipos.js";

/** Máximo de filas de la lista (también va a `limites.lista`). */
export const MAX_FILAS = 4;

const M = {
  tau: 84,
  numeral: 44,
  trazo: 48,
  antetitulo: 20,
  titular: 128,
  interlineaTitular: 1.0,
  lineasTitular: 3,
  etiqueta: 40,
  valor: 26,
  alturaFila: 104,
  pie: 20,
} as const;

/** Colchón bajo el titular para los descendentes (em). */
const COLCHON = 0.14;

export function estilos(ctx: ContextoPlantilla): string {
  const altoTitular = Math.ceil(M.titular * M.interlineaTitular * M.lineasTitular);
  // 1 px del filete superior + filas de alto fijo (cada una con su filete).
  const altoLista = 1 + MAX_FILAS * M.alturaFila;

  return `
.tzt {
  position: relative;
  width: ${ctx.ancho}px;
  height: ${ctx.alto}px;
  overflow: hidden;
  background: var(--color-negro);
  color: var(--color-crema);
}
/* Halo cálido muy tenue (el del hero de la web: radial oro al 14 %), aquí
   arriba a la derecha y más bajo, para que el negro no sea plano. */
.tzt-halo {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 70% 55% at 100% 0%, color-mix(in srgb, var(--color-oro) 12%, transparent), transparent 70%);
}
.tzt-contenido {
  position: absolute;
  inset: ${ctx.margen + ctx.zonaSegura.arriba}px ${ctx.margen}px ${ctx.margen + ctx.zonaSegura.abajo}px;
  display: flex;
  flex-direction: column;
}
/* La cabecera reserva 120 px de aire bajo la cruz, pero puede ceder hasta
   48 px cuando el contenido es máximo (titular de 3 líneas + 4 filas). */
.tzt-cabecera {
  display: flex;
  align-items: flex-start;
  flex: 0 1 ${M.tau + 120}px;
  min-height: ${M.tau + 48}px;
}
.tzt-tau { display: block; height: ${M.tau}px; width: auto; }

/* Composición de cartel: cabecera (índice + titular) arriba, bajo la cruz,
   y la lista apoyada en el pie. Con poco texto el aire queda en el centro,
   entre titular y lista (probado: si todo se apoya abajo, un titular de una
   línea deja un hueco muerto de ~450 px bajo la cruz). */
.tzt-cuerpo {
  flex: 1 0 auto;
  display: flex;
  flex-direction: column;
}

/* Fila «01 ── ANTETÍTULO» (Showcase.tsx: numeral serif oro tabular-nums,
   trazo h-px w-12 bg-primary/40, label 0.3em uppercase font-medium). */
.tzt-indice {
  display: flex;
  align-items: center;
  gap: 22px;
  width: 100%;
  margin-bottom: 40px;
}
/* La Cormorant dibuja cifras elzevirianas por defecto («01» parece «OI»).
   lining-nums las pone a altura de mayúscula; tabular-nums, como la web. */
.tzt-numeral {
  flex: none;
  font-family: var(--fuente-titular);
  font-weight: var(--peso-numeral);
  font-variant-numeric: lining-nums tabular-nums;
  color: var(--color-oro);
  font-size: ${M.numeral}px;
  line-height: 1;
  white-space: nowrap;
}
.tzt-trazo {
  flex: none;
  width: ${M.trazo}px;
  height: 1px;
  background: var(--color-trazo);
}
.tzt-antetitulo {
  flex: 0 1 auto;
  min-width: 0;
  font-family: var(--fuente-texto);
  font-weight: var(--peso-antetitulo);
  letter-spacing: var(--tracking-antetitulo);
  text-transform: uppercase;
  color: var(--color-antetitulo);
  font-size: ${M.antetitulo}px;
  line-height: 1.2;
  white-space: nowrap;
}

/* Titular: Cormorant 500, no el 600 de la web. Sobre negro liso y a 128 px
   el contraste es de sobra (18:1) y el 600 se ve pesado, de «negrita de
   libro»; el 500 conserva el contraste de trazo de la Cormorant y casa con
   las etiquetas de la lista (también 500). En tz-foto-titular, sobre foto,
   sí se usa el 600. */
.tzt-titular {
  font-family: var(--fuente-titular);
  font-weight: 500;
  color: var(--color-crema);
  font-size: ${M.titular}px;
  line-height: ${M.interlineaTitular};
  letter-spacing: -0.005em;
  text-wrap: balance;
  width: 100%;
  /* Colchón para los descendentes de la Cormorant con interlineado 1 (si no,
     cuentan como desborde); una 4.ª línea sigue fallando. */
  padding-bottom: ${COLCHON}em;
  max-height: calc(${altoTitular}px + ${COLCHON}em);
  margin-bottom: calc(64px - ${COLCHON}em);
}

/* Lista (Claves.tsx: ul border-t border-white/10, li border-b). */
.tzt-lista {
  list-style: none;
  margin: 0;
  padding: 0;
  margin-top: auto;
  border-top: 1px solid var(--color-linea);
  max-height: ${altoLista}px;
}
.tzt-fila {
  box-sizing: border-box;
  height: ${M.alturaFila}px;
  border-bottom: 1px solid var(--color-linea);
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 40px;
  padding-top: ${Math.round((M.alturaFila - M.etiqueta) / 2) - 4}px;
  white-space: nowrap;
}
.tzt-etiqueta {
  flex: none;
  font-family: var(--fuente-titular);
  font-weight: 500;
  color: var(--color-crema);
  font-size: ${M.etiqueta}px;
  line-height: 1.15;
  font-variant-numeric: lining-nums;
}
/* Horas en Montserrat 300: sus cifras ya son de caja alta; tabular-nums
   alinea «20:00 – 02:00» y «18:00 – 00:00» columna a columna. */
.tzt-valor {
  flex: none;
  font-family: var(--fuente-texto);
  font-weight: var(--peso-texto);
  color: var(--color-crema);
  font-size: ${M.valor}px;
  line-height: 1.15;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.tzt-pie-fila {
  margin-top: 64px;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 32px;
}
.tzt-pie {
  min-width: 0;
  font-family: var(--fuente-texto);
  font-weight: var(--peso-texto);
  color: var(--color-texto-suave);
  font-size: ${M.pie}px;
  line-height: 1.3;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.tzt-marca {
  flex: none;
  font-family: var(--fuente-titular);
  font-weight: var(--peso-wordmark);
  letter-spacing: var(--tracking-wordmark);
  margin-right: calc(-1 * var(--tracking-wordmark));
  color: var(--color-oro);
  font-size: 30px;
  line-height: 1;
}
`;
}
