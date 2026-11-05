/**
 * CSS de ct-foto-titular (Casa Tomás, foto a sangre + titular).
 *
 * Solo variables de marca (generarCss): ningún hex escrito a mano. Las
 * transparencias del velo se hacen con color-mix() sobre --color-pizarra.
 *
 * Reglas de ajuste (el motor las comprueba):
 * - Los textos con data-ajuste tienen ancho fijo (100 % del bloque) y, el
 *   titular, un alto máximo de 3 líneas. Si el texto no cabe, DESBORDA (no se
 *   recorta, no se encoge, no hay puntos suspensivos) y el motor da error.
 * - Antetítulo, botón y pie van en una sola línea (white-space: nowrap): si
 *   son largos, desbordan en horizontal y el motor lo detecta.
 */

/** Rampa del velo con paradas suavizadas (evita el «escalón» de un degradado lineal de 2 paradas). */
const veloInferior = (alfaMax: number): string => {
  // [posición desde abajo en %, opacidad relativa 0..1]
  const paradas: Array<[number, number]> = [
    [0, 1],
    [22, 0.98],
    [36, 0.93],
    [48, 0.82],
    [58, 0.64],
    [68, 0.42],
    [79, 0.2],
    [90, 0.06],
    [100, 0],
  ];
  return paradas
    .map(([pos, k]) => {
      const alfa = Math.round(alfaMax * k * 10) / 10;
      return `color-mix(in srgb, var(--color-pizarra) ${alfa}%, transparent) ${pos}%`;
    })
    .join(", ");
};

const veloSuperior = (alfaMax: number): string => {
  const paradas: Array<[number, number]> = [
    [0, 1],
    [25, 0.82],
    [50, 0.5],
    [75, 0.2],
    [100, 0],
  ];
  return paradas
    .map(([pos, k]) => {
      const alfa = Math.round(alfaMax * k * 10) / 10;
      return `color-mix(in srgb, var(--color-pizarra) ${alfa}%, transparent) ${pos}%`;
    })
    .join(", ");
};

export const CSS_FOTO_TITULAR = `
.ct-ft {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: var(--color-pizarra);
  color: var(--color-blanco);
  font-family: var(--fuente-texto);
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
  font-kerning: normal;
}

/* ── Foto y velos (sin data-campo) ─────────────────────────────────────── */
.ct-ft__foto {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.ct-ft__velo {
  position: absolute;
  left: 0;
  right: 0;
  pointer-events: none;
}
.ct-ft__velo--inf {
  bottom: 0;
  height: 80%;
  background: linear-gradient(to top, ${veloInferior(92)});
}
.ct-ft__velo--sup {
  top: 0;
  height: 340px;
  background: linear-gradient(to bottom, ${veloSuperior(58)});
}

/* ── Medallón ──────────────────────────────────────────────────────────── */
.ct-ft__medallon {
  position: absolute;
  top: var(--margen);
  left: var(--margen);
  width: 132px;
  height: 132px;
  display: block;
  filter: drop-shadow(0 2px 10px color-mix(in srgb, var(--color-pizarra) 45%, transparent));
}

/* ── Bloque de texto ───────────────────────────────────────────────────── */
.ct-ft__bloque {
  position: absolute;
  left: var(--margen);
  right: var(--margen);
  bottom: var(--margen);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.ct-ft__antetitulo {
  width: 100%;
  font-family: var(--fuente-texto);
  font-weight: var(--peso-antetitulo);
  font-size: 21px;
  line-height: 1.3;
  letter-spacing: var(--tracking-antetitulo);
  text-transform: uppercase;
  color: var(--color-oro-claro);
  white-space: nowrap;
  /* Halo pizarra: separa el antetítulo de fotos con zonas claras (grifos, manteles). */
  text-shadow: 0 0 14px color-mix(in srgb, var(--color-pizarra) 85%, transparent), 0 1px 2px color-mix(in srgb, var(--color-pizarra) 60%, transparent);
}

.ct-ft__filete {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 26px;
}
.ct-ft__filete span:nth-child(odd) {
  width: 40px;
  height: 1.5px;
  background: color-mix(in srgb, var(--color-oro-claro) 75%, transparent);
}
.ct-ft__filete span:nth-child(2) {
  width: 8px;
  height: 8px;
  transform: rotate(45deg);
  background: var(--color-oro-claro);
}

.ct-ft__titular {
  width: 100%;
  /* Libre Baskerville tiene ascendente+descendente ≈ 1,24 em: con interlineado
     1,06 el área de los glifos sobresale de la línea y el motor lo vería como
     desborde. Se da ese aire como relleno y se compensa con margen negativo. */
  --aire: 0.14em;
  padding-block: var(--aire);
  margin-top: calc(30px - var(--aire));
  margin-bottom: calc(-1 * var(--aire));
  font-family: var(--fuente-titular);
  font-weight: var(--peso-titular);
  font-size: 92px;
  line-height: 1.06;
  letter-spacing: -0.018em;
  /* 3 líneas como máximo: si no cabe, desborda y el motor da error. */
  max-height: calc(1.06em * 3 + 2 * var(--aire) + 2px);
  color: var(--color-blanco);
  text-wrap: balance;
  overflow-wrap: normal;
  hyphens: manual;
  font-feature-settings: "kern" 1, "liga" 1;
  text-shadow: 0 1px 24px color-mix(in srgb, var(--color-pizarra) 35%, transparent);
}

.ct-ft__cta {
  margin-top: 44px;
  max-width: 100%;
  display: inline-block;
  padding: 22px 46px 23px;
  border-radius: var(--radio-boton);
  background: var(--color-boton-fondo);
  color: var(--color-boton-texto);
  font-family: var(--fuente-texto);
  font-weight: var(--peso-titular);
  font-size: 26px;
  line-height: 1.2;
  letter-spacing: 0.01em;
  white-space: nowrap;
  box-shadow: 0 10px 30px color-mix(in srgb, var(--color-pizarra) 45%, transparent);
}

.ct-ft__pie {
  width: 100%;
  margin-top: 52px;
  padding-top: 26px;
  border-top: 1px solid color-mix(in srgb, var(--color-blanco) 26%, transparent);
  font-family: var(--fuente-texto);
  font-weight: var(--peso-texto);
  font-size: 21px;
  line-height: 1.3;
  letter-spacing: 0.04em;
  color: color-mix(in srgb, var(--color-blanco) 84%, transparent);
  white-space: nowrap;
}

/* ── Story: composición centrada dentro de la zona segura ───────────────── */
.ct-ft--story .ct-ft__velo--inf { height: 68%; }
.ct-ft--story .ct-ft__velo--sup {
  height: 640px;
  background: linear-gradient(to bottom, ${veloSuperior(62)});
}
.ct-ft--story .ct-ft__medallon {
  top: var(--story-zona-segura-arriba);
  left: 50%;
  width: 150px;
  height: 150px;
  transform: translateX(-50%);
}
.ct-ft--story .ct-ft__bloque {
  bottom: var(--story-zona-segura-abajo);
  align-items: center;
  text-align: center;
}
.ct-ft--story .ct-ft__antetitulo {
  /* El tracking añade aire tras la última letra: se compensa para centrar ópticamente. */
  text-indent: var(--tracking-antetitulo);
}
.ct-ft--story .ct-ft__filete { margin-top: 28px; }
.ct-ft--story .ct-ft__titular {
  margin-top: calc(34px - var(--aire));
  font-size: 104px;
  line-height: 1.05;
  max-height: calc(1.05em * 3 + 2 * var(--aire) + 2px);
}
.ct-ft--story .ct-ft__cta { margin-top: 52px; }
.ct-ft--story .ct-ft__pie {
  margin-top: 56px;
  padding-top: 0;
  border-top: 0;
}
`;
