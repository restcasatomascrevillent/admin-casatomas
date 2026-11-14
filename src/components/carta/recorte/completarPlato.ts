/**
 * «Completar el plato» (14/11/2026, «el recortador de platos no funciona»).
 *
 * El modelo del recorte (isnet) busca «el objeto que destaca»: en muchas fotos
 * de platos se queda con la COMIDA y tira el plato (cuenco negro sobre la
 * encimera de acero: solo quedaban las setas flotando) o se come medio plato
 * si tiene dibujo. La foto de carta salía rara y en producción se acababa
 * guardando la foto sin recortar.
 *
 * Aquí, solo para platos, se busca el plato alrededor de lo que dejó el
 * modelo: se «inunda» el fondo desde los bordes de la foto avanzando solo por
 * cambios suaves de color (la mesa, sus sombras y brillos) y se para en los
 * bordes marcados (el canto del plato). Lo que no es fondo y toca lo que dejó
 * el modelo es el plato. Solo se usa si tiene pinta de plato (más grande que
 * lo del modelo, no ocupa casi toda la foto, forma redondeada); si no, se
 * queda el recorte del modelo tal cual.
 */

/** Lado mayor de trabajo (rápido y con poca memoria; el borde se suaviza al ampliar). */
export const LADO_PLATO = 480;
/** Diferencia de color máxima entre vecinos para seguir «inundando» el fondo. */
export const SALTO_FONDO = 9;
/** Cuánto puede alejarse el fondo del color de su semilla (sombras sí; el plato no). */
export const DERIVA_FONDO = 40;
/** Diferencia máxima con el color de una esquina para que un borde de la foto cuente como mesa. */
export const COLOR_MESA = 40;
/** Alfa a partir del cual un píxel cuenta como «del modelo». */
const UMBRAL_MODELO = 128;
/** El plato no puede ocupar más de esta fracción de la foto (si no, la inundación no ha encontrado el canto). */
export const FRACCION_MAXIMA_PLATO = 0.9;
/** Plato / envolvente convexa: un plato es redondeado (por debajo, se ha colado otra cosa). */
export const SOLIDEZ_MINIMA = 0.88;
/** Radio (px de trabajo) de la limpieza de lo añadido. */
const RADIO_APERTURA = 3;
/** La elipse ajustada se agranda un poco para no recortar el canto. */
const HOLGURA_ELIPSE = 1.0;
/** Se ajusta dos veces: la segunda, sin los trozos que sesgaban la primera. */
const VUELTAS_ELIPSE = 2;
/** Lo encontrado tiene que llenar casi toda su elipse (dentro de la foto). */
export const RELLENO_MINIMO = 0.85;
/** Si el plato no añade al menos esto sobre lo del modelo, no merece la pena. */
const GANANCIA_MINIMA = 1.08;

/** Media 3×3 de un RGB (quita el grano y las rayas finas de la mesa). */
function suavizar(rgb: Uint8Array, ancho: number, alto: number): Uint8Array {
  const out = new Uint8Array(rgb.length);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= alto) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= ancho) continue;
          const o = (yy * ancho + xx) * 3;
          r += rgb[o]; g += rgb[o + 1]; b += rgb[o + 2]; n++;
        }
      }
      const o = (y * ancho + x) * 3;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  return out;
}

function distancia(c: Uint8Array, i: number, j: number): number {
  const a = i * 3, b = j * 3;
  return Math.max(Math.abs(c[a] - c[b]), Math.abs(c[a + 1] - c[b + 1]), Math.abs(c[a + 2] - c[b + 2]));
}

/** Área de la envolvente convexa de los píxeles marcados (cadena monótona sobre los extremos de cada fila). */
export function areaEnvolvente(m: Uint8Array, ancho: number, alto: number): number {
  const pts: Array<[number, number]> = [];
  for (let y = 0; y < alto; y++) {
    let x0 = -1, x1 = -1;
    for (let x = 0; x < ancho; x++) if (m[y * ancho + x]) { if (x0 < 0) x0 = x; x1 = x; }
    if (x0 >= 0) { pts.push([x0, y]); if (x1 !== x0) pts.push([x1 + 1, y]); pts.push([x0, y + 1]); pts.push([x1 + 1, y + 1]); }
  }
  if (pts.length < 3) return 0;
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cruz = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inf: Array<[number, number]> = [];
  for (const p of pts) { while (inf.length >= 2 && cruz(inf[inf.length - 2], inf[inf.length - 1], p) <= 0) inf.pop(); inf.push(p); }
  const sup: Array<[number, number]> = [];
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (sup.length >= 2 && cruz(sup[sup.length - 2], sup[sup.length - 1], p) <= 0) sup.pop(); sup.push(p); }
  const casco = inf.slice(0, -1).concat(sup.slice(0, -1));
  let a = 0;
  for (let i = 0; i < casco.length; i++) { const p = casco[i], q = casco[(i + 1) % casco.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a) / 2;
}

/**
 * Ajusta una elipse con los momentos de `plato` y quita lo de fuera (salvo lo
 * del modelo). Devuelve qué fracción de la elipse (dentro de la foto) estaba
 * llena, o null si no hay nada.
 */
function recortarAElipse(plato: Uint8Array, alfa: Uint8Array, ancho: number, alto: number): number | null {
  const n = ancho * alto;
  let sx = 0, sy = 0, cnt = 0;
  for (let i = 0; i < n; i++) if (plato[i]) { sx += i % ancho; sy += (i / ancho) | 0; cnt++; }
  if (cnt === 0) return null;
  const cx = sx / cnt, cy = sy / cnt;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) if (plato[i]) { const dx = (i % ancho) - cx, dy = ((i / ancho) | 0) - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  sxx /= cnt; syy /= cnt; sxy /= cnt;
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(1e-6, tr / 2 - disc);
  const ang = Math.atan2(l1 - sxx, sxy || 1e-9);
  const co = Math.cos(ang), si = Math.sin(ang);
  const a = 2 * Math.sqrt(l1) * HOLGURA_ELIPSE, b = 2 * Math.sqrt(l2) * HOLGURA_ELIPSE;
  let dentroElipse = 0, platoEnElipse = 0;
  for (let i = 0; i < n; i++) {
    const dx = (i % ancho) - cx, dy = ((i / ancho) | 0) - cy;
    const u = dx * co + dy * si, v = -dx * si + dy * co;
    const dentro = (u / a) ** 2 + (v / b) ** 2 <= 1;
    if (dentro) dentroElipse++;
    if (dentro && plato[i]) platoEnElipse++;
    else if (!dentro && alfa[i] < UMBRAL_MODELO) plato[i] = 0;
  }
  return platoEnElipse / Math.max(1, dentroElipse);
}

/** Apertura binaria (erosión y dilatación de `radio` px, vecindad 4) de lo añadido; lo del modelo se queda siempre. */
function abrir(m: Uint8Array, alfa: Uint8Array, ancho: number, alto: number, radio: number): void {
  const paso = (src: Uint8Array, erosion: boolean) => {
    const dst = new Uint8Array(src.length);
    for (let y = 0; y < alto; y++) {
      for (let x = 0; x < ancho; x++) {
        const i = y * ancho + x;
        const v = [src[i], x > 0 ? src[i - 1] : src[i], x < ancho - 1 ? src[i + 1] : src[i], y > 0 ? src[i - ancho] : src[i], y < alto - 1 ? src[i + ancho] : src[i]];
        dst[i] = erosion ? (v.every(Boolean) ? 1 : 0) : (v.some(Boolean) ? 1 : 0);
      }
    }
    return dst;
  };
  let extra = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) extra[i] = m[i] && alfa[i] < UMBRAL_MODELO ? 1 : 0;
  for (let k = 0; k < radio; k++) extra = paso(extra, true);
  for (let k = 0; k < radio; k++) extra = paso(extra, false);
  for (let i = 0; i < m.length; i++) m[i] = alfa[i] >= UMBRAL_MODELO || (extra[i] && m[i]) ? 1 : 0;
}

export interface ResultadoPlato {
  /** 255 = plato (incluye lo del modelo), 0 = fondo. */
  mascara: Uint8Array;
  /** Por qué se aceptó o no (diagnóstico en la consola). */
  motivo: string;
}

/**
 * RGB (3 canales) + alfa del modelo, a la misma medida (pequeña) → máscara del
 * plato, o `null` con el motivo si no se encuentra un plato creíble.
 */
export function regionPlato(rgbCrudo: Uint8Array, alfa: Uint8Array, ancho: number, alto: number): ResultadoPlato | { mascara: null; motivo: string } {
  const n = ancho * alto;
  let areaModelo = 0;
  for (let i = 0; i < n; i++) if (alfa[i] >= UMBRAL_MODELO) areaModelo++;
  if (areaModelo === 0) return { mascara: null, motivo: "el modelo no dejó nada" };
  const rgb = suavizar(rgbCrudo, ancho, alto);

  // 1. Fondo: desde los bordes de la foto que el modelo no marcó, por saltos suaves.
  const fondo = new Uint8Array(n);
  const cola = new Int32Array(n);
  /** Semilla de la que viene cada píxel de fondo (para no derivar poco a poco hasta otro color). */
  const origen = new Int32Array(n);
  let ini = 0, fin = 0;
  // Semillas: bordes con el color de alguna esquina (la mesa). Un plato que se
  // sale de la foto toca el borde y no debe servir de semilla.
  const esquinas: number[][] = [];
  const PARCHE = Math.max(2, Math.round(Math.min(ancho, alto) * 0.03));
  for (const [ex, ey] of [[0, 0], [ancho - PARCHE, 0], [0, alto - PARCHE], [ancho - PARCHE, alto - PARCHE]]) {
    let r = 0, g = 0, b = 0, k = 0;
    for (let y = ey; y < ey + PARCHE; y++) for (let x = ex; x < ex + PARCHE; x++) {
      const i = y * ancho + x;
      if (alfa[i] >= UMBRAL_MODELO) continue;
      r += rgb[i * 3]; g += rgb[i * 3 + 1]; b += rgb[i * 3 + 2]; k++;
    }
    if (k > 0) esquinas.push([r / k, g / k, b / k]);
  }
  const comoMesa = (i: number) =>
    esquinas.some((c) => Math.max(Math.abs(rgb[i * 3] - c[0]), Math.abs(rgb[i * 3 + 1] - c[1]), Math.abs(rgb[i * 3 + 2] - c[2])) <= COLOR_MESA);
  const sembrar = (i: number) => {
    if (!fondo[i] && alfa[i] < UMBRAL_MODELO && comoMesa(i)) { fondo[i] = 1; origen[i] = i; cola[fin++] = i; }
  };
  for (let x = 0; x < ancho; x++) { sembrar(x); sembrar((alto - 1) * ancho + x); }
  for (let y = 0; y < alto; y++) { sembrar(y * ancho); sembrar(y * ancho + ancho - 1); }
  while (ini < fin) {
    const i = cola[ini++];
    const x = i % ancho, y = (i / ancho) | 0;
    const vecinos = [x > 0 ? i - 1 : -1, x < ancho - 1 ? i + 1 : -1, y > 0 ? i - ancho : -1, y < alto - 1 ? i + ancho : -1];
    for (const j of vecinos) {
      if (j < 0 || fondo[j] || alfa[j] >= UMBRAL_MODELO) continue;
      if (distancia(rgb, i, j) <= SALTO_FONDO && distancia(rgb, origen[i], j) <= DERIVA_FONDO) {
        fondo[j] = 1;
        origen[j] = origen[i];
        cola[fin++] = j;
      }
    }
  }

  // 2. Plato: lo que no es fondo y está unido a lo del modelo (sin agujeros: lo que el fondo no alcanza, dentro).
  const plato = new Uint8Array(n);
  ini = 0; fin = 0;
  for (let i = 0; i < n; i++) if (alfa[i] >= UMBRAL_MODELO) { plato[i] = 1; cola[fin++] = i; }
  while (ini < fin) {
    const i = cola[ini++];
    const x = i % ancho, y = (i / ancho) | 0;
    const vecinos = [x > 0 ? i - 1 : -1, x < ancho - 1 ? i + 1 : -1, y > 0 ? i - ancho : -1, y < alto - 1 ? i + ancho : -1];
    for (const j of vecinos) {
      if (j < 0 || plato[j] || fondo[j]) continue;
      plato[j] = 1; cola[fin++] = j;
    }
  }
  // 2b. Lo añadido, sin bordes finos: el halo de 1-2 px alrededor de la comida
  // (el suavizado mezcla comida y mesa) no es plato.
  abrir(plato, alfa, ancho, alto, RADIO_APERTURA);

  // 3. Un plato es una elipse (en perspectiva): se ajusta una elipse con los
  // momentos de lo encontrado y se queda solo lo de dentro (más lo del
  // modelo). Así se caen las líneas finas y los trozos de mantel pegados.
  for (let vuelta = 0; vuelta < VUELTAS_ELIPSE; vuelta++) {
    const r = recortarAElipse(plato, alfa, ancho, alto);
    if (r === null) return { mascara: null, motivo: "sin plato" };
    if (r < RELLENO_MINIMO) return { mascara: null, motivo: `no parece un plato redondo (relleno ${r.toFixed(2)})` };
  }
  let area = 0;
  for (let i = 0; i < n; i++) if (plato[i]) area++;

  // 4. ¿Tiene pinta de plato?
  if (area < areaModelo * GANANCIA_MINIMA) return { mascara: null, motivo: "no se ha encontrado más plato que lo del modelo" };
  if (area > n * FRACCION_MAXIMA_PLATO) return { mascara: null, motivo: "no se ve el canto del plato (ocuparía toda la foto)" };
  const solidez = area / Math.max(1, areaEnvolvente(plato, ancho, alto));
  if (solidez < SOLIDEZ_MINIMA) return { mascara: null, motivo: `forma poco redonda (${solidez.toFixed(2)})` };
  for (let i = 0; i < n; i++) plato[i] = plato[i] ? 255 : 0;
  return { mascara: plato, motivo: `plato ×${(area / areaModelo).toFixed(2)} del modelo, solidez ${solidez.toFixed(2)}` };
}

// ---------------------------------------------------------------------------
// Navegador
// ---------------------------------------------------------------------------

function lienzo(ancho: number, alto: number) {
  const c = document.createElement("canvas");
  c.width = ancho;
  c.height = alto;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas no disponible");
  return { c, ctx };
}

/**
 * Foto (con fondo) + sticker del modelo → sticker con el plato entero, o el
 * mismo sticker si no se encuentra un plato creíble (nunca empeora el recorte).
 */
export async function completarPlato(foto: Blob, sticker: Blob): Promise<Blob> {
  const [bf, bs] = await Promise.all([createImageBitmap(foto), createImageBitmap(sticker, { premultiplyAlpha: "none" })]);
  const ancho = bs.width, alto = bs.height;
  const grande = lienzo(ancho, alto);
  const peq = (() => {
    const e = Math.min(1, LADO_PLATO / Math.max(ancho, alto));
    return lienzo(Math.max(1, Math.round(ancho * e)), Math.max(1, Math.round(alto * e)));
  })();
  try {
    const w = peq.c.width, h = peq.c.height;
    peq.ctx.drawImage(bf, 0, 0, w, h);
    const fp = peq.ctx.getImageData(0, 0, w, h).data;
    peq.ctx.clearRect(0, 0, w, h);
    peq.ctx.drawImage(bs, 0, 0, w, h);
    const sp = peq.ctx.getImageData(0, 0, w, h).data;
    const rgb = new Uint8Array(w * h * 3);
    const alfa = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      rgb[i * 3] = fp[i * 4]; rgb[i * 3 + 1] = fp[i * 4 + 1]; rgb[i * 3 + 2] = fp[i * 4 + 2];
      alfa[i] = sp[i * 4 + 3];
    }
    const r = regionPlato(rgb, alfa, w, h);
    console.info("[recorte] completar plato:", r.motivo);
    if (!r.mascara) return sticker;

    // Máscara del plato ampliada con suavizado (borde suave) → alfa = máx(modelo, plato).
    const md = peq.ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { md.data[i * 4 + 3] = r.mascara[i]; }
    peq.ctx.clearRect(0, 0, w, h);
    peq.ctx.putImageData(md, 0, 0);
    grande.ctx.imageSmoothingEnabled = true;
    grande.ctx.imageSmoothingQuality = "high";
    grande.ctx.drawImage(peq.c, 0, 0, ancho, alto);
    const mp = grande.ctx.getImageData(0, 0, ancho, alto).data;
    grande.ctx.clearRect(0, 0, ancho, alto);
    grande.ctx.drawImage(bs, 0, 0);
    const sd = grande.ctx.getImageData(0, 0, ancho, alto).data;
    grande.ctx.clearRect(0, 0, ancho, alto);
    grande.ctx.drawImage(bf, 0, 0, ancho, alto);
    const px = grande.ctx.getImageData(0, 0, ancho, alto);
    for (let i = 3; i < px.data.length; i += 4) px.data[i] = Math.max(sd[i], mp[i]);
    grande.ctx.putImageData(px, 0, 0);
    const png = await new Promise<Blob | null>((ok) => grande.c.toBlob(ok, "image/png"));
    if (!png) return sticker;
    return png;
  } finally {
    bf.close();
    bs.close();
    grande.c.width = grande.c.height = 0;
    peq.c.width = peq.c.height = 0;
  }
}
