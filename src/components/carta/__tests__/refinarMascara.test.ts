import { describe, expect, it } from "vitest";
import { desenfoqueGauss, postprocesarMascara } from "../recorte/mascaraRecorte";
import {
  aplicarCoeficientes,
  coeficientesGuiado,
  entradaGuiado,
  limpiarMascara,
  luminancia,
  medidasTrabajo,
  mediaCaja,
  radioGuiado,
  refinarMascara,
} from "../recorte/refinarMascara";

const W = 200;
const H = 150;

/** Máscara vacía W×H con un disco («cuerpo del plato») opaco. */
function conCuerpo(ancho = W, alto = H, cx = 70, cy = 75, r = 35): Uint8Array {
  const m = new Uint8Array(ancho * alto);
  for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) if (Math.hypot(x - cx, y - cy) <= r) m[y * ancho + x] = 255;
  return m;
}

function rect(m: Uint8Array, ancho: number, x0: number, y0: number, w: number, h: number, v: number) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) m[y * ancho + x] = v;
}

describe("mediaCaja", () => {
  it("coincide con la media por fuerza bruta (ventana recortada en los bordes)", () => {
    const ancho = 7;
    const alto = 5;
    const src = Float32Array.from({ length: ancho * alto }, (_, i) => (i * 37) % 11);
    const r = 2;
    const out = mediaCaja(src, ancho, alto, r);
    for (let y = 0; y < alto; y++)
      for (let x = 0; x < ancho; x++) {
        let s = 0;
        let c = 0;
        for (let yy = Math.max(0, y - r); yy <= Math.min(alto - 1, y + r); yy++)
          for (let xx = Math.max(0, x - r); xx <= Math.min(ancho - 1, x + r); xx++) {
            s += src[yy * ancho + xx];
            c++;
          }
        expect(out[y * ancho + x]).toBeCloseTo(s / c, 4);
      }
  });

  it("puede escribir sobre la propia entrada", () => {
    const src = Float32Array.from({ length: 12 }, (_, i) => i);
    const esperado = mediaCaja(src, 4, 3, 1);
    expect(Array.from(mediaCaja(src, 4, 3, 1, src))).toEqual(Array.from(esperado));
  });
});

describe("limpiarMascara", () => {
  it("quita una mota y una isla pequeña LEJOS del plato", () => {
    const m = conCuerpo();
    rect(m, W, 190, 5, 2, 2, 255); // mota (4 px)
    rect(m, W, 170, 120, 8, 8, 255); // isla de 64 px lejos (< 0,3 % de 30 000 px)
    const out = limpiarMascara(m, W, H);
    expect(out[6 * W + 190]).toBe(0);
    expect(out[124 * W + 174]).toBe(0);
    expect(out[75 * W + 70]).toBe(255);
  });

  it("conserva un trozo suelto de antena CERCA del cuerpo y un segundo plato grande", () => {
    const m = conCuerpo();
    rect(m, W, 108, 70, 30, 2, 255); // trozo de antena (60 px) a 3 px del cuerpo
    rect(m, W, 150, 20, 40, 40, 255); // otro objeto grande (1600 px > 0,3 %)
    const out = limpiarMascara(m, W, H);
    expect(out[71 * W + 120]).toBe(255);
    expect(out[40 * W + 170]).toBe(255);
  });

  it("una antena fina en diagonal unida al cuerpo NO se pierde (conectividad 8)", () => {
    const m = conCuerpo();
    for (let k = 0; k < 50; k++) m[(55 - k) * W + (90 + k)] = 200; // línea de 1 px en diagonal
    const out = limpiarMascara(m, W, H);
    for (let k = 0; k < 50; k += 7) expect(out[(55 - k) * W + (90 + k)]).toBeGreaterThanOrEqual(200);
  });

  it("rellena un agujero pequeño dentro del plato", () => {
    const m = conCuerpo();
    rect(m, W, 68, 73, 2, 2, 0); // 4 px (< 0,03 % = 9 px)
    const out = limpiarMascara(m, W, H);
    expect(out[73 * W + 68]).toBe(255);
  });

  it("agujero mediano: lo rellena si el modelo dudaba, no si era fondo claro", () => {
    const dudoso = conCuerpo();
    rect(dudoso, W, 60, 65, 15, 15, 70); // 225 px (0,75 %), valor medio 70 ≥ 40
    expect(limpiarMascara(dudoso, W, H)[72 * W + 67]).toBe(255);

    const real = conCuerpo();
    rect(real, W, 60, 65, 15, 15, 0); // hueco de verdad entre patas
    expect(limpiarMascara(real, W, H)[72 * W + 67]).toBe(0);
  });

  it("no rellena el fondo que toca el borde de la imagen", () => {
    const m = conCuerpo();
    const out = limpiarMascara(m, W, H);
    expect(out[0]).toBe(0);
    expect(out[H * W - 1]).toBe(0);
  });

  it("no modifica la entrada", () => {
    const m = conCuerpo();
    rect(m, W, 190, 5, 2, 2, 255);
    const copia = new Uint8Array(m);
    limpiarMascara(m, W, H);
    expect(m).toEqual(copia);
  });
});

/**
 * Escena sintética «bogavante»: cuerpo claro y una ANTENA de 2 px que sale
 * del cuerpo sobre un fondo oscuro. La máscara imita la del modelo reescalada:
 * el cuerpo seguro (≈235) y la antena débil y borrosa (pico ≈ 160).
 */
function escenaAntena() {
  const guia = new Uint8ClampedArray(W * H * 4);
  const real = conCuerpo();
  for (let x = 104; x < 190; x++) {
    real[74 * W + x] = 255;
    real[75 * W + x] = 255;
  }
  for (let i = 0; i < W * H; i++) {
    const v = real[i] ? 210 : 40;
    guia[i * 4] = guia[i * 4 + 1] = guia[i * 4 + 2] = v;
    guia[i * 4 + 3] = 255;
  }
  const borrosa = desenfoqueGauss(real, W, H, 1.2);
  const mascara = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) mascara[i] = Math.min(235, Math.round(borrosa[i] * 1.0));
  return { guia, mascara };
}

describe("refinarMascara (antena fina)", () => {
  it("el post_process de antes (apertura + gaussiana + umbral) borraba la antena", () => {
    const { mascara } = escenaAntena();
    const viejo = postprocesarMascara(mascara, W, H);
    let vivos = 0;
    for (let x = 120; x < 185; x++) if (viejo[74 * W + x] || viejo[75 * W + x]) vivos++;
    expect(vivos).toBeLessThan(10);
  });

  it("la antena sobrevive y el fondo queda transparente", () => {
    const { guia, mascara } = escenaAntena();
    const alfa = refinarMascara(mascara, guia, W, H);
    for (let x = 110; x < 185; x += 5) expect(Math.max(alfa[74 * W + x], alfa[75 * W + x])).toBeGreaterThan(160);
    // Cuerpo opaco, fondo (incluso pegado a la antena) transparente.
    expect(alfa[75 * W + 70]).toBe(255);
    expect(alfa[10 * W + 150]).toBe(0);
    expect(alfa[70 * W + 150]).toBeLessThan(20);
    expect(alfa[80 * W + 150]).toBeLessThan(20);
  });

  it("el borde del cuerpo es suave (alguna transición), no binario", () => {
    const { guia, mascara } = escenaAntena();
    const alfa = refinarMascara(mascara, guia, W, H);
    const fila = Array.from({ length: 20 }, (_, k) => alfa[100 * W + 60 + k]); // cruza el borde inferior-izquierdo
    expect(fila.some((v) => v > 0 && v < 255) || alfa.some((v) => v > 0 && v < 255)).toBe(true);
  });

  it("aplicarCoeficientes: misma resolución = refinarMascara; al doble conserva la antena", () => {
    const { guia, mascara } = escenaAntena();
    const limpia = limpiarMascara(mascara, W, H);
    const coef = coeficientesGuiado(luminancia(guia, W * H), entradaGuiado(limpia), W, H);
    const igual = new Uint8ClampedArray(guia);
    aplicarCoeficientes(coef, W, H, igual, W, H);
    const directo = refinarMascara(mascara, guia, W, H);
    for (let i = 0; i < W * H; i += 97) expect(Math.abs(igual[i * 4 + 3] - directo[i])).toBeLessThanOrEqual(1);

    // Imagen al doble (como una foto grande con coeficientes a resolución de trabajo).
    const W2 = W * 2;
    const H2 = H * 2;
    const grande = new Uint8ClampedArray(W2 * H2 * 4);
    for (let y = 0; y < H2; y++)
      for (let x = 0; x < W2; x++) {
        const o = (y * W2 + x) * 4;
        const s = (((y / 2) | 0) * W + ((x / 2) | 0)) * 4;
        grande[o] = guia[s];
        grande[o + 1] = guia[s + 1];
        grande[o + 2] = guia[s + 2];
        grande[o + 3] = 255;
      }
    const opacos = aplicarCoeficientes(coef, W, H, grande, W2, H2);
    expect(opacos).toBeGreaterThan(0);
    for (let x = 230; x < 370; x += 10) {
      const v = Math.max(...[147, 148, 149, 150, 151, 152].map((y) => grande[(y * W2 + x) * 4 + 3]));
      expect(v).toBeGreaterThan(160);
    }
    expect(grande[(20 * W2 + 300) * 4 + 3]).toBe(0);
  });

  it("quita el velo débil del modelo sobre el fondo (sin niebla semitransparente)", () => {
    const { guia, mascara } = escenaAntena();
    for (let i = 0; i < mascara.length; i++) if (mascara[i] < 10) mascara[i] = 60; // velo del 25 %
    const alfa = refinarMascara(mascara, guia, W, H);
    expect(alfa[10 * W + 150]).toBe(0);
    expect(alfa[140 * W + 10]).toBe(0);
  });
});

describe("medidas y radio", () => {
  it("medidasTrabajo no agranda y respeta la proporción", () => {
    expect(medidasTrabajo(4000, 3000, 1600)).toEqual({ ancho: 1600, alto: 1200 });
    expect(medidasTrabajo(800, 600, 1600)).toEqual({ ancho: 800, alto: 600 });
  });
  it("radioGuiado entre 2 y 8", () => {
    expect(radioGuiado(100, 100)).toBe(2);
    expect(radioGuiado(1280, 960)).toBe(4);
    expect(radioGuiado(10000, 10000)).toBe(8);
  });
});
