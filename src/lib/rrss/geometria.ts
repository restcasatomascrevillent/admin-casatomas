/**
 * RRSS · cuentas de encuadre compartidas por el motor (fotos y vídeo) y la
 * vista previa del panel, para que el recorte que se ve sea el que sale.
 */
import type { Encuadre } from "./plan";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Recorte de proporción `ancho:alto` dentro de una imagen W×H: el más grande
 * que cabe, dividido por el zoom, centrado en (x, y) y sin salirse.
 */
export function rectanguloRecorte(W: number, H: number, ancho: number, alto: number, e: Encuadre): Rect {
  const r = ancho / alto;
  let cw: number;
  let ch: number;
  if (W / H > r) {
    ch = H;
    cw = H * r;
  } else {
    cw = W;
    ch = W / r;
  }
  const zoom = Math.max(1, Math.min(3, e.zoom || 1));
  cw = Math.max(2, cw / zoom);
  ch = Math.max(2, ch / zoom);
  const cx = Math.max(0, Math.min(1, e.x)) * W;
  const cy = Math.max(0, Math.min(1, e.y)) * H;
  let left = cx - cw / 2;
  let top = cy - ch / 2;
  left = Math.max(0, Math.min(W - cw, left));
  top = Math.max(0, Math.min(H - ch, top));
  // Enteros pares (los códecs de vídeo los necesitan pares).
  const par = (v: number) => Math.max(2, Math.floor(v / 2) * 2);
  const w = Math.min(par(cw), W - (W % 2));
  const h = Math.min(par(ch), H - (H % 2));
  return { left: Math.min(Math.round(left), W - w), top: Math.min(Math.round(top), H - h), width: w, height: h };
}

/**
 * Para la vista previa en CSS (`object-fit: cover` no sabe de zoom): tamaño y
 * desplazamiento de la imagen dentro de un marco de `marcoAncho × marcoAlto`.
 */
export function estiloRecorteCss(W: number, H: number, marcoAncho: number, marcoAlto: number, e: Encuadre) {
  const rc = rectanguloRecorte(W, H, marcoAncho, marcoAlto, e);
  const escala = marcoAncho / rc.width;
  return {
    width: W * escala,
    height: H * escala,
    left: -rc.left * escala,
    top: -rc.top * escala,
  };
}

/** ¿La foto es pequeña para la salida? (se amplía más de 1,6 veces). */
export function seAmpliaDemasiado(rc: Rect, ancho: number): boolean {
  return ancho / rc.width > 1.6;
}
