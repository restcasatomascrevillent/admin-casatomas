/**
 * Pre/postprocesado del recorte en el navegador, igual que rembg con
 * `isnet-general-use` y `post_process_mask=True` (scripts/fotos-vino/recortar.py):
 *
 *   entrada: RGB redimensionado a 1024×1024, dividido por el máximo de la
 *            imagen, menos 0.5 (media 0.5, desviación 1.0), en CHW float32.
 *   salida:  mapa 1024×1024 → normalizado min-max → uint8 → redimensionado al
 *            tamaño original → apertura (disco radio 1) → gaussiana σ=2 →
 *            umbral 127 (máscara binaria con borde suavizado antes del corte).
 *
 * Funciones puras (sin DOM) para poder probarlas con vitest.
 */

/** Lado de entrada del modelo. */
export const LADO_MODELO = 1024;

/** RGBA (lado×lado) → tensor CHW float32 normalizado como rembg (`im / max(im) - 0.5`). */
export function normalizarEntrada(rgba: ArrayLike<number>, lado = LADO_MODELO): Float32Array {
  const n = lado * lado;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (rgba[o] > max) max = rgba[o];
    if (rgba[o + 1] > max) max = rgba[o + 1];
    if (rgba[o + 2] > max) max = rgba[o + 2];
  }
  const div = Math.max(max, 1e-6);
  const t = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    t[i] = rgba[o] / div - 0.5;
    t[n + i] = rgba[o + 1] / div - 0.5;
    t[2 * n + i] = rgba[o + 2] / div - 0.5;
  }
  return t;
}

/** Salida del modelo → uint8 0–255 con normalización min-max (como DisSession.predict). */
export function minMaxAUint8(pred: ArrayLike<number>): Uint8Array {
  let mi = Infinity;
  let ma = -Infinity;
  for (let i = 0; i < pred.length; i++) {
    const v = pred[i];
    if (v < mi) mi = v;
    if (v > ma) ma = v;
  }
  const rango = ma - mi;
  const out = new Uint8Array(pred.length);
  if (!(rango > 0)) return out;
  for (let i = 0; i < pred.length; i++) out[i] = Math.floor(((pred[i] - mi) / rango) * 255);
  return out;
}

/**
 * Apertura en escala de grises con el disco de radio 1 (cruz 3×3, `skimage.morphology.disk(1)`):
 * erosión (mínimo) y luego dilatación (máximo). Bordes: se ignoran los vecinos fuera de la imagen.
 */
export function apertura(m: Uint8Array, ancho: number, alto: number): Uint8Array {
  const pasada = (src: Uint8Array, minimo: boolean) => {
    const dst = new Uint8Array(src.length);
    for (let y = 0; y < alto; y++) {
      for (let x = 0; x < ancho; x++) {
        const i = y * ancho + x;
        let v = src[i];
        const a = x > 0 ? src[i - 1] : v;
        const b = x < ancho - 1 ? src[i + 1] : v;
        const c = y > 0 ? src[i - ancho] : v;
        const d = y < alto - 1 ? src[i + ancho] : v;
        v = minimo ? Math.min(v, a, b, c, d) : Math.max(v, a, b, c, d);
        dst[i] = v;
      }
    }
    return dst;
  };
  return pasada(pasada(m, true), false);
}

/** Núcleo gaussiano 1D normalizado (σ, truncado a 4σ como scipy). */
export function nucleoGauss(sigma: number): Float32Array {
  const r = Math.round(4 * sigma);
  const k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp((-0.5 * i * i) / (sigma * sigma));
    k[i + r] = v;
    s += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  return k;
}

/** Desenfoque gaussiano separable (bordes en espejo, `mode="reflect"` de scipy). */
export function desenfoqueGauss(m: ArrayLike<number>, ancho: number, alto: number, sigma = 2): Float32Array {
  const k = nucleoGauss(sigma);
  const r = (k.length - 1) / 2;
  const refl = (i: number, n: number) => {
    // reflect de scipy: d c b a | a b c d | d c b a
    while (i < 0 || i >= n) i = i < 0 ? -i - 1 : 2 * n - i - 1;
    return i;
  };
  const tmp = new Float32Array(ancho * alto);
  for (let y = 0; y < alto; y++) {
    const fila = y * ancho;
    for (let x = 0; x < ancho; x++) {
      let s = 0;
      for (let j = -r; j <= r; j++) s += k[j + r] * m[fila + refl(x + j, ancho)];
      tmp[fila + x] = s;
    }
  }
  const out = new Float32Array(ancho * alto);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      let s = 0;
      for (let j = -r; j <= r; j++) s += k[j + r] * tmp[refl(y + j, alto) * ancho + x];
      out[y * ancho + x] = s;
    }
  }
  return out;
}

/** `rembg.bg.post_process`: apertura → gaussiana σ=2 → umbral (<127 → 0, si no 255). */
export function postprocesarMascara(m: Uint8Array, ancho: number, alto: number): Uint8Array {
  const abierta = apertura(m, ancho, alto);
  const suave = desenfoqueGauss(abierta, ancho, alto, 2);
  const out = new Uint8Array(m.length);
  for (let i = 0; i < out.length; i++) out[i] = suave[i] < 127 ? 0 : 255;
  return out;
}
