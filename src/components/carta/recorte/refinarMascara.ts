/**
 * Refinado de la máscara del recorte a resolución completa (foto y vídeo del
 * plato). Sustituye al `post_process` de rembg (apertura + gaussiana σ=2 +
 * umbral 127), que borraba las estructuras finas: con un BOGAVANTE (petición
 * del dueño, 01-11-2026) las antenas y las patas de 1–3 px desaparecían,
 * porque la apertura se come lo que mide menos de 3 px y la gaussiana baja el
 * pico de una línea fina por debajo del umbral. Además el borde quedaba
 * binario (dientes de sierra).
 *
 * Ahora:
 *   1. limpiarMascara: quita motas e islas pequeñas de fondo LEJOS del plato
 *      y rellena agujeros pequeños DENTRO del plato. Umbrales por área
 *      RELATIVA y pequeños, conectividad 8 para lo opaco: una antena fina
 *      unida al cuerpo es parte de la componente principal y un trozo suelto
 *      de antena cerca del plato se conserva (no es «quedarse con la mayor»).
 *   2. Filtro guiado (He et al., 2010) con la luminancia de la propia imagen:
 *      el borde de la máscara (que viene de 1024² reescalada, borrosa) se
 *      pega a los bordes reales de la foto, y una antena oscura sobre fondo
 *      claro recupera su forma aunque el modelo la diera débil.
 *   3. Curva suave (smoothstep) → alfa con 1–2 px de transición (feather), no
 *      binaria.
 *
 * Para fotos grandes se usa el «fast guided filter»: los coeficientes a y b se
 * calculan a una resolución de trabajo (≤ ~1600 px) y se aplican a la
 * resolución completa con interpolación bilineal (aplicarCoeficientes), así
 * no hacen falta 7 buffers float del tamaño de una foto de 12 MP.
 *
 * Funciones puras (sin DOM) para probarlas con vitest.
 */

export interface OpcionesLimpieza {
  /** 0–255: a partir de aquí un píxel cuenta como «plato» al buscar islas. */
  umbral?: number;
  /** 0–255: por debajo de esto un píxel cuenta como fondo al buscar agujeros. */
  umbralAgujero?: number;
  /** Componentes con menos área que esta fracción de la imagen se quitan siempre (motas). */
  fraccionMota?: number;
  /** Islas con menos área que esta fracción se quitan si están lejos de la componente principal. */
  fraccionIsla?: number;
  /** «Lejos» = fuera de la caja de la principal ampliada esta fracción de la diagonal. */
  margenIsla?: number;
  /** Agujeros (fondo cerrado, sin tocar el borde) con menos área que esta fracción se rellenan siempre. */
  fraccionAgujero?: number;
  /**
   * Agujeros algo mayores (hasta esta fracción) se rellenan solo si el modelo
   * DUDABA en ellos (valor medio ≥ dudaAgujero): un hueco real entre patas da
   * ~0; un plato oscuro o con brillos que el modelo no ve claro da valores medios.
   */
  fraccionAgujeroDudoso?: number;
  dudaAgujero?: number;
}

export const LIMPIEZA_POR_DEFECTO: Required<OpcionesLimpieza> = {
  umbral: 96,
  umbralAgujero: 128,
  fraccionMota: 0.0001,
  fraccionIsla: 0.003,
  margenIsla: 0.03,
  fraccionAgujero: 0.0003,
  fraccionAgujeroDudoso: 0.01,
  dudaAgujero: 40,
};

/** Área mínima absoluta (px) de una mota, para imágenes pequeñas. */
const MOTA_MIN_PX = 6;

/**
 * Etiqueta componentes conexas de los píxeles con `dentro[i] !== 0` (relleno
 * por inundación con pila explícita). Devuelve etiquetas (0 = fuera, 1..n) y,
 * por componente, área, caja, si toca el borde y la suma de `valor`.
 */
function componentes(
  ancho: number,
  alto: number,
  dentro: Uint8Array,
  ocho: boolean,
  valor?: ArrayLike<number>,
): { etiquetas: Int32Array; area: number[]; caja: number[][]; borde: boolean[]; suma: number[] } {
  const n = ancho * alto;
  const etiquetas = new Int32Array(n);
  const pila = new Int32Array(n);
  const area: number[] = [0];
  const caja: number[][] = [[0, 0, 0, 0]];
  const borde: boolean[] = [false];
  const suma: number[] = [0];
  const ultX = ancho - 1;
  const ultY = alto - 1;
  let sig = 0;
  for (let s = 0; s < n; s++) {
    if (etiquetas[s] !== 0 || dentro[s] === 0) continue;
    const e = ++sig;
    let a = 0;
    let x0 = ancho;
    let y0 = alto;
    let x1 = -1;
    let y1 = -1;
    let total = 0;
    let tope = 0;
    pila[tope++] = s;
    etiquetas[s] = e;
    // Vecinos escritos a mano (sin cierres ni bucles: es el bucle caliente).
    let j = 0;
    while (tope > 0) {
      const i = pila[--tope];
      const y = (i / ancho) | 0;
      const x = i - y * ancho;
      a++;
      if (valor) total += valor[i];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const izq = x > 0;
      const der = x < ultX;
      const arr = y > 0;
      const aba = y < ultY;
      if (izq) {
        j = i - 1;
        if (etiquetas[j] === 0 && dentro[j] !== 0) {
          etiquetas[j] = e;
          pila[tope++] = j;
        }
      }
      if (der) {
        j = i + 1;
        if (etiquetas[j] === 0 && dentro[j] !== 0) {
          etiquetas[j] = e;
          pila[tope++] = j;
        }
      }
      if (arr) {
        j = i - ancho;
        if (etiquetas[j] === 0 && dentro[j] !== 0) {
          etiquetas[j] = e;
          pila[tope++] = j;
        }
      }
      if (aba) {
        j = i + ancho;
        if (etiquetas[j] === 0 && dentro[j] !== 0) {
          etiquetas[j] = e;
          pila[tope++] = j;
        }
      }
      if (ocho) {
        if (arr && izq) {
          j = i - ancho - 1;
          if (etiquetas[j] === 0 && dentro[j] !== 0) {
            etiquetas[j] = e;
            pila[tope++] = j;
          }
        }
        if (arr && der) {
          j = i - ancho + 1;
          if (etiquetas[j] === 0 && dentro[j] !== 0) {
            etiquetas[j] = e;
            pila[tope++] = j;
          }
        }
        if (aba && izq) {
          j = i + ancho - 1;
          if (etiquetas[j] === 0 && dentro[j] !== 0) {
            etiquetas[j] = e;
            pila[tope++] = j;
          }
        }
        if (aba && der) {
          j = i + ancho + 1;
          if (etiquetas[j] === 0 && dentro[j] !== 0) {
            etiquetas[j] = e;
            pila[tope++] = j;
          }
        }
      }
    }
    area.push(a);
    caja.push([x0, y0, x1, y1]);
    borde.push(x0 === 0 || y0 === 0 || x1 === ultX || y1 === ultY);
    suma.push(total);
  }
  return { etiquetas, area, caja, borde, suma };
}

/** Píxeles con m[i] ≥ umbral (si `mayor`) o < umbral → 1. */
function binaria(m: Uint8Array, umbral: number, mayor: boolean): Uint8Array {
  const out = new Uint8Array(m.length);
  if (mayor) for (let i = 0; i < m.length; i++) out[i] = m[i] >= umbral ? 1 : 0;
  else for (let i = 0; i < m.length; i++) out[i] = m[i] < umbral ? 1 : 0;
  return out;
}

/**
 * Quita motas e islas pequeñas lejos del plato y rellena agujeros pequeños
 * dentro (ver cabecera). Devuelve una máscara nueva 0–255 (la entrada no se toca).
 */
export function limpiarMascara(m: Uint8Array, ancho: number, alto: number, opciones: OpcionesLimpieza = {}): Uint8Array {
  const o = { ...LIMPIEZA_POR_DEFECTO, ...opciones };
  const n = ancho * alto;
  const out = new Uint8Array(m);
  if (n === 0) return out;

  // --- Islas (lo opaco, conectividad 8: las líneas finas en diagonal siguen unidas).
  const fg = componentes(ancho, alto, binaria(m, o.umbral, true), true);
  const nComp = fg.area.length - 1;
  if (nComp > 1) {
    let principal = 1;
    for (let e = 2; e <= nComp; e++) if (fg.area[e] > fg.area[principal]) principal = e;
    const margen = o.margenIsla * Math.hypot(ancho, alto);
    const [px0, py0, px1, py1] = fg.caja[principal];
    const mota = Math.max(MOTA_MIN_PX, o.fraccionMota * n);
    const isla = o.fraccionIsla * n;
    const quitar = new Uint8Array(nComp + 1);
    for (let e = 1; e <= nComp; e++) {
      if (e === principal) continue;
      const a = fg.area[e];
      if (a < mota) {
        quitar[e] = 1;
        continue;
      }
      if (a >= isla) continue;
      const [x0, y0, x1, y1] = fg.caja[e];
      const lejos = x1 < px0 - margen || x0 > px1 + margen || y1 < py0 - margen || y0 > py1 + margen;
      if (lejos) quitar[e] = 1;
    }
    for (let i = 0; i < n; i++) {
      const e = fg.etiquetas[i];
      if (e && quitar[e]) out[i] = 0;
    }
  }

  // --- Agujeros (fondo cerrado, conectividad 4: el complemento de la 8).
  const bg = componentes(ancho, alto, binaria(out, o.umbralAgujero, false), false, out);
  const maxAgujero = o.fraccionAgujero * n;
  const maxDudoso = o.fraccionAgujeroDudoso * n;
  const rellenar = new Uint8Array(bg.area.length);
  let alguno = false;
  for (let e = 1; e < bg.area.length; e++) {
    if (bg.borde[e]) continue;
    const a = bg.area[e];
    if (a < maxAgujero || (a < maxDudoso && bg.suma[e] / a >= o.dudaAgujero)) {
      rellenar[e] = 1;
      alguno = true;
    }
  }
  if (alguno) {
    for (let i = 0; i < n; i++) {
      const e = bg.etiquetas[i];
      if (e && rellenar[e]) out[i] = 255;
    }
  }
  return out;
}

/** Buffers de mediaCaja reutilizados (es síncrona: no se pisan entre llamadas). */
let tmpCaja = new Float32Array(0);
let sumaCaja = new Float64Array(0);

/**
 * Media en una ventana (2r+1)² recortada en los bordes (se divide por los
 * píxeles que caen dentro). Separable con sumas deslizantes, recorriendo
 * siempre por filas (memoria contigua): O(n) para cualquier r.
 * `out` puede ser el mismo array que `src`.
 */
export function mediaCaja(src: Float32Array, ancho: number, alto: number, r: number, out = new Float32Array(src.length)): Float32Array {
  const n = ancho * alto;
  if (tmpCaja.length < n) tmpCaja = new Float32Array(n);
  if (sumaCaja.length < ancho) sumaCaja = new Float64Array(ancho);
  const tmp = tmpCaja;
  // Horizontal: src → tmp.
  for (let y = 0; y < alto; y++) {
    const base = y * ancho;
    let s = 0;
    const hasta = Math.min(r, ancho - 1);
    for (let x = 0; x <= hasta; x++) s += src[base + x];
    for (let x = 0; x < ancho; x++) {
      const a = x - r;
      const b = x + r;
      const cuenta = Math.min(ancho - 1, b) - Math.max(0, a) + 1;
      tmp[base + x] = s / cuenta;
      if (b + 1 < ancho) s += src[base + b + 1];
      if (a >= 0) s -= src[base + a];
    }
  }
  // Vertical: tmp → out, con una fila de sumas por columna.
  const col = sumaCaja;
  col.fill(0, 0, ancho);
  const hasta = Math.min(r, alto - 1);
  for (let y = 0; y <= hasta; y++) {
    const base = y * ancho;
    for (let x = 0; x < ancho; x++) col[x] += tmp[base + x];
  }
  for (let y = 0; y < alto; y++) {
    const a = y - r;
    const b = y + r;
    const inv = 1 / (Math.min(alto - 1, b) - Math.max(0, a) + 1);
    const base = y * ancho;
    for (let x = 0; x < ancho; x++) out[base + x] = col[x] * inv;
    if (b + 1 < alto) {
      const sum = (b + 1) * ancho;
      for (let x = 0; x < ancho; x++) col[x] += tmp[sum + x];
    }
    if (a >= 0) {
      const res = a * ancho;
      for (let x = 0; x < ancho; x++) col[x] -= tmp[res + x];
    }
  }
  return out;
}

/** Luminancia 0–1 de un RGBA (Rec. 601, como el gris del canvas). */
export function luminancia(rgba: ArrayLike<number>, n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[i] = (0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]) / 255;
  }
  return out;
}

/** Radio del filtro guiado según el tamaño (≈ ancho de la franja dudosa de la máscara reescalada). */
export function radioGuiado(ancho: number, alto: number): number {
  return Math.max(2, Math.min(8, Math.round(Math.max(ancho, alto) / 320)));
}

/** Regularización del filtro guiado (guía en 0–1): bordes con desviación > ~0,03 se respetan. */
export const EPS_GUIADO = 1e-3;

/**
 * Coeficientes medios (ā, b̄) del filtro guiado: q = ā·I + b̄. `I` guía 0–1,
 * `p` máscara 0–1, ambos ancho×alto. Devuelve arrays nuevos.
 */
export function coeficientesGuiado(
  I: Float32Array,
  p: Float32Array,
  ancho: number,
  alto: number,
  r = radioGuiado(ancho, alto),
  eps = EPS_GUIADO,
): { a: Float32Array; b: Float32Array } {
  const n = ancho * alto;
  const mI = mediaCaja(I, ancho, alto, r);
  const mP = mediaCaja(p, ancho, alto, r);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = I[i] * p[i];
  mediaCaja(a, ancho, alto, r, a); // a = media(I·p)
  for (let i = 0; i < n; i++) b[i] = I[i] * I[i];
  mediaCaja(b, ancho, alto, r, b); // b = media(I²)
  for (let i = 0; i < n; i++) {
    const cov = a[i] - mI[i] * mP[i];
    const v = b[i] - mI[i] * mI[i];
    const ai = cov / (v + eps);
    a[i] = ai;
    b[i] = mP[i] - ai * mI[i];
  }
  mediaCaja(a, ancho, alto, r, a);
  mediaCaja(b, ancho, alto, r, b);
  return { a, b };
}

/**
 * Rampa de la máscara ANTES del filtro guiado (0–1): lo que el modelo da por
 * debajo de `bajo` es fondo, por encima de `alto` plato, y en medio una
 * transición lineal. Sin ella el velo débil que el modelo deja sobre el fondo
 * (10–30 %) salía semitransparente; con ella las zonas dudosas se deciden como
 * con el umbral 127 de antes, pero el borde lo vuelve a suavizar el filtro.
 */
export const RAMPA_BAJO = 0.45;
export const RAMPA_ALTO = 0.55;

/** Máscara 0–255 → entrada 0–1 del filtro guiado (rampa RAMPA_BAJO–RAMPA_ALTO). */
export function entradaGuiado(m: ArrayLike<number>, bajo = RAMPA_BAJO, alto = RAMPA_ALTO): Float32Array {
  const out = new Float32Array(m.length);
  const k = 1 / (alto - bajo);
  for (let i = 0; i < m.length; i++) {
    const t = (m[i] / 255 - bajo) * k;
    out[i] = t <= 0 ? 0 : t >= 1 ? 1 : t;
  }
  return out;
}

/** Curva final del alfa: smoothstep entre `bajo` y `alto` (0–1) → 0–255. */
export const CURVA_BAJO = 0.25;
export const CURVA_ALTO = 0.75;

function curva(q: number, bajo: number, alto: number): number {
  const t = (q - bajo) / (alto - bajo);
  if (t <= 0) return 0;
  if (t >= 1) return 255;
  return Math.round(t * t * (3 - 2 * t) * 255);
}

/**
 * Aplica los coeficientes (calculados a anchoC×altoC) a una imagen RGBA de
 * ancho×alto (puede ser mayor: interpolación bilineal de ā y b̄, «fast guided
 * filter») y ESCRIBE el alfa en el canal 3 de `rgba`. Devuelve cuántos píxeles
 * quedan con algo de opacidad.
 */
export function aplicarCoeficientes(
  coef: { a: Float32Array; b: Float32Array },
  anchoC: number,
  altoC: number,
  rgba: Uint8ClampedArray | Uint8Array,
  ancho: number,
  alto: number,
  { bajo = CURVA_BAJO, alto: altoCurva = CURVA_ALTO } = {},
): number {
  const { a, b } = coef;
  const sx = anchoC / ancho;
  const sy = altoC / alto;
  let opacos = 0;
  for (let y = 0; y < alto; y++) {
    const fy = Math.min(altoC - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(altoC - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < ancho; x++) {
      const fx = Math.min(anchoC - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(anchoC - 1, x0 + 1);
      const tx = fx - x0;
      const i00 = y0 * anchoC + x0;
      const i01 = y0 * anchoC + x1;
      const i10 = y1 * anchoC + x0;
      const i11 = y1 * anchoC + x1;
      const w00 = (1 - tx) * (1 - ty);
      const w01 = tx * (1 - ty);
      const w10 = (1 - tx) * ty;
      const w11 = tx * ty;
      const ai = a[i00] * w00 + a[i01] * w01 + a[i10] * w10 + a[i11] * w11;
      const bi = b[i00] * w00 + b[i01] * w01 + b[i10] * w10 + b[i11] * w11;
      const o = (y * ancho + x) * 4;
      const lum = (0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]) / 255;
      const v = curva(ai * lum + bi, bajo, altoCurva);
      rgba[o + 3] = v;
      if (v) opacos++;
    }
  }
  return opacos;
}

export interface OpcionesRefinado {
  limpieza?: OpcionesLimpieza | false;
  radio?: number;
  eps?: number;
}

/**
 * Máscara (0–255, ancho×alto) + imagen guía RGBA del mismo tamaño → alfa 0–255
 * refinado: limpieza + filtro guiado + curva suave. No modifica las entradas.
 */
export function refinarMascara(
  mascara: Uint8Array,
  guia: Uint8ClampedArray | Uint8Array,
  ancho: number,
  alto: number,
  opciones: OpcionesRefinado = {},
): Uint8Array {
  const n = ancho * alto;
  const limpia = opciones.limpieza === false ? mascara : limpiarMascara(mascara, ancho, alto, opciones.limpieza || {});
  const p = entradaGuiado(limpia);
  const I = luminancia(guia, n);
  const coef = coeficientesGuiado(I, p, ancho, alto, opciones.radio ?? radioGuiado(ancho, alto), opciones.eps ?? EPS_GUIADO);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = curva(coef.a[i] * I[i] + coef.b[i], CURVA_BAJO, CURVA_ALTO);
  return out;
}

/** Medidas de trabajo: lado mayor como mucho `maxLado`, sin agrandar. */
export function medidasTrabajo(ancho: number, alto: number, maxLado: number): { ancho: number; alto: number } {
  const e = Math.min(1, maxLado / Math.max(ancho, alto));
  return { ancho: Math.max(1, Math.round(ancho * e)), alto: Math.max(1, Math.round(alto * e)) };
}
