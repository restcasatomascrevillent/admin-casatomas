/**
 * Captura de un reel a MP4 (fase 6, docs/instagram-video.md): lógica pura que
 * comparten la página de captura (src/instagram-captura/reel.tsx, montada en
 * __reel-instagram.html) y sus pruebas. El trabajador Node
 * (scripts/instagram/render-reels.mjs) abre esa página con Chromium, le pasa
 * el reel en window.__REEL_CAPTURA__ y usa lo que la página expone:
 *
 *   window.__reelEstado        { ok, problemas, avisos, duracion, fotogramas, instantesMedida, portada_s }
 *   window.__listo()           espera a las fuentes y a que TODAS las fotos estén decodificadas
 *   window.__fijarTiempo(t)    pinta el instante t (flushSync) y espera a las <img> visibles
 *   window.__medirTextos()     mide los textos (data-campo) del instante actual
 */
import { ALTO_REEL, ANCHO_REEL, FPS_REEL, ZONA_SEGURA_REEL, calcularTiempos, SALIDA_ROTULO_POR_DEFECTO } from "./motor.js";
import { entradaCierre_s, entradaRotulo_s, type ReelPieza } from "./esquema.js";

/** Lo que el trabajador inyecta en la página antes de cargarla. */
export interface DatosCaptura {
  reel: unknown;
  /** id de foto («drive:…», «carta:…») → URL pública (copias tmp/ del cubo instagram). */
  fotos?: Record<string, string>;
  /** Base de fuentes, logos y muestras (por defecto "/instagram", el mismo origen). */
  baseRecursos?: string;
  /** Instante de la portada pedido (s); si no, el del primer rótulo entero. */
  portada_s?: number | null;
  /** Solo para pruebas: renderiza solo los primeros N segundos (sin la regla de 5-90 s). */
  limiteSegundos?: number | null;
}

export interface EstadoCaptura {
  ok: boolean;
  problemas: string[];
  avisos: string[];
  duracion: number;
  fotogramas: number;
  instantesMedida: number[];
  portada_s: number;
}

/** Margen tras la entrada de un rótulo para medirlo ya quieto. */
const MARGEN_QUIETO_S = 0.8;

/**
 * Instantes en los que cada rótulo (y el cierre) está entero y aún no se va:
 * ahí se miden los textos en el DOM.
 */
export function instantesDeMedida(reel: ReelPieza): number[] {
  const tiempos = calcularTiempos(reel);
  const salida = reel.salidaRotulo_s ?? SALIDA_ROTULO_POR_DEFECTO;
  const instantes = new Set<number>();
  reel.escenas.forEach((e, i) => {
    if (!e.rotulo) return;
    const [inicio, fin] = tiempos.tramos[i];
    const t = Math.min(inicio + entradaRotulo_s(e.rotulo) + MARGEN_QUIETO_S, fin - salida - 0.05);
    if (t > inicio) instantes.add(redondearAFotograma(t));
  });
  const cierre = Math.min(tiempos.inicioCierre + entradaCierre_s(reel.cierre) + MARGEN_QUIETO_S, tiempos.total - 0.7);
  if (cierre > tiempos.inicioCierre) instantes.add(redondearAFotograma(cierre));
  return [...instantes].sort((a, b) => a - b);
}

/** Instante de la portada: el pedido (si cae dentro del reel) o el primer rótulo entero. */
export function instantePortada(reel: ReelPieza, pedido?: number | null): number {
  const total = calcularTiempos(reel).total;
  if (typeof pedido === "number" && Number.isFinite(pedido) && pedido >= 0 && pedido < total) return redondearAFotograma(pedido);
  return instantesDeMedida(reel)[0] ?? Math.min(1.5, total / 2);
}

const redondearAFotograma = (t: number) => Math.round(t * FPS_REEL) / FPS_REEL;

/** Caja de un texto medido en el DOM (px del lienzo 1080×1920). */
export interface CajaTexto {
  campo: string;
  izquierda: number;
  derecha: number;
  arriba: number;
  abajo: number;
}

const TOLERANCIA_PX = 2;

/**
 * Problemas (bloquean: el texto se sale del vídeo y se cortaría) y avisos
 * (fuera de la zona segura de Instagram: lo taparían los botones o el pie).
 */
export function revisarCajas(cajas: readonly CajaTexto[], t: number): { problemas: string[]; avisos: string[] } {
  const problemas: string[] = [];
  const avisos: string[] = [];
  const cuando = `${t.toFixed(1).replace(".", ",")} s`;
  for (const c of cajas) {
    if (c.derecha - c.izquierda <= 0 || c.abajo - c.arriba <= 0) continue;
    if (c.izquierda < -TOLERANCIA_PX || c.derecha > ANCHO_REEL + TOLERANCIA_PX) {
      problemas.push(`El texto «${c.campo}» se sale del vídeo por ${c.izquierda < 0 ? "la izquierda" : "la derecha"} (en ${cuando}): acórtalo o baja el tamaño.`);
      continue;
    }
    if (c.arriba < -TOLERANCIA_PX || c.abajo > ALTO_REEL + TOLERANCIA_PX) {
      problemas.push(`El texto «${c.campo}» se sale del vídeo por ${c.arriba < 0 ? "arriba" : "abajo"} (en ${cuando}).`);
      continue;
    }
    const z = ZONA_SEGURA_REEL;
    if (c.izquierda < z.lados - TOLERANCIA_PX || c.derecha > ANCHO_REEL - z.lados + TOLERANCIA_PX) {
      avisos.push(`El texto «${c.campo}» queda muy pegado al borde (en ${cuando}); Instagram puede taparlo.`);
    } else if (c.arriba < z.arriba - TOLERANCIA_PX || c.abajo > ALTO_REEL - z.abajo + TOLERANCIA_PX) {
      avisos.push(`El texto «${c.campo}» cae fuera de la zona segura (${c.arriba < z.arriba ? "arriba" : "abajo"}, en ${cuando}): lo pueden tapar los botones de Instagram.`);
    }
  }
  return { problemas: [...new Set(problemas)], avisos: [...new Set(avisos)] };
}
