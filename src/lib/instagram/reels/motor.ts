/**
 * Motor de tiempo de los reels: funciones PURAS de `t` (segundos).
 *
 * Portado de marca-base/animations-v3.jsx (Easing, clamp, interpolate) y de
 * marca-base/reel-kit.jsx (pr, MOTION, TR_IN/TR_OUT). Regla del motor original
 * («RENDER FROM T ONLY… A seeked frame is a deterministic render at that
 * time»): nada de Math.random, Date, requestAnimationFrame ni transiciones
 * CSS aquí dentro. Lo que se ve en el instante t depende SOLO de (reel, t), así
 * que la fase 6 puede capturar fotograma a fotograma con Chromium (t = n / 30).
 *
 * Sin React ni DOM: vale en el navegador, en Node y en las pruebas.
 */

// ── Lienzo y reglas de vídeo de la marca (marca-base/readme.md y tokens/motion.css) ──

/** Ancho y alto del lienzo 9:16 en px. */
export const ANCHO_REEL = 1080;
export const ALTO_REEL = 1920;
/** --video-fps: 30 */
export const FPS_REEL = 30;
/** --safe-9x16-top / --safe-9x16-bottom / --safe-side (px del lienzo). */
export const ZONA_SEGURA_REEL = { arriba: 220, abajo: 320, lados: 64 } as const;

// ── Easing (animations-v3.jsx, «hand-rolled, Popmotion-style») ──────────────

export type FuncionEasing = (t: number) => number;

export const Easing = {
  linear: (t: number) => t,
  easeOutCubic: (t: number) => {
    const u = t - 1;
    return u * u * u + 1;
  },
  easeInOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  easeOutBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
} satisfies Record<string, FuncionEasing>;

/**
 * cubic-bezier(x1, y1, x2, y2) de CSS como función pura de t ∈ [0, 1]
 * (Newton-Raphson con respaldo por bisección; misma curva que el navegador).
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): FuncionEasing {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const x = (s: number) => ((ax * s + bx) * s + cx) * s;
  const y = (s: number) => ((ay * s + by) * s + cy) * s;
  const dx = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  const resolver = (t: number) => {
    let s = t;
    for (let i = 0; i < 8; i++) {
      const err = x(s) - t;
      if (Math.abs(err) < 1e-7) return s;
      const d = dx(s);
      if (Math.abs(d) < 1e-6) break;
      s -= err / d;
    }
    let a = 0;
    let b = 1;
    s = t;
    for (let i = 0; i < 40; i++) {
      const v = x(s);
      if (Math.abs(v - t) < 1e-7) break;
      if (v < t) a = s;
      else b = s;
      s = (a + b) / 2;
    }
    return s;
  };
  return (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : y(resolver(t)));
}

/**
 * Curvas oficiales de cada marca (marca-base/tokens/motion.css). Los reels
 * usan los tres ayudantes de MOVIMIENTO tal cual los escribió el dueño en
 * reel-kit.jsx (son la versión «vídeo» de la marca); estas curvas y
 * entradaMarca() son las de la web, para lo que el panel añada fuera del kit.
 */
export const CURVAS_MARCA = {
  /** --ease-smooth: cubic-bezier(.4,0,.2,1) · Casa Tomás --transition-smooth, 400 ms */
  suave: cubicBezier(0.4, 0, 0.2, 1),
  /** --ease-bounce: cubic-bezier(.34,1.56,.64,1) · Casa Tomás, solo como acento, 600 ms */
  rebote: cubicBezier(0.34, 1.56, 0.64, 1),
  /** --ease-touza: cubic-bezier(.25,.1,.25,1) · Touza, 500 ms */
  touza: cubicBezier(0.25, 0.1, 0.25, 1),
} as const;

// ── Ayudantes (animations-v3.jsx / reel-kit.jsx) ─────────────────────────────

export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** interpolate([0, 1], [a, b], ease)(t): mapea t por tramos (Popmotion). */
export function interpolate(input: readonly number[], output: readonly number[], ease: FuncionEasing = Easing.linear) {
  return (t: number): number => {
    if (t <= input[0]) return output[0];
    if (t >= input[input.length - 1]) return output[output.length - 1];
    for (let i = 0; i < input.length - 1; i++) {
      if (t >= input[i] && t <= input[i + 1]) {
        const tramo = input[i + 1] - input[i];
        const local = tramo === 0 ? 0 : (t - input[i]) / tramo;
        return output[i] + (output[i + 1] - output[i]) * ease(local);
      }
    }
    return output[output.length - 1];
  };
}

/** Progreso lineal 0→1 de t entre a y b (pr de reel-kit). */
export const progreso = (t: number, a: number, b: number) => (b === a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a), 0, 1));

/**
 * Los tres ayudantes de movimiento del reel-kit («nothing else eases»):
 * entrar (easeOutCubic), suavizar (easeInOutCubic) y saltar (easeOutBack).
 */
export const MOVIMIENTO = {
  entrar: (t: number, a: number, d = 0.9) => Easing.easeOutCubic(progreso(t, a, a + d)),
  suavizar: (t: number, a: number, b: number) => Easing.easeInOutCubic(progreso(t, a, b)),
  saltar: (t: number, a: number, d = 0.6) => Easing.easeOutBack(progreso(t, a, a + d)),
} as const;

/**
 * Entrada oficial de cada marca en el instante t (motion.css):
 * Casa Tomás: fade-up de 30 px, --ease-smooth, 400 ms.
 * Touza: desenfoque de 8 px + subida de 20 px, --ease-touza, 500 ms.
 */
export function entradaMarca(marca: "casa-tomas" | "touza", t: number, inicio: number) {
  if (marca === "touza") {
    const p = CURVAS_MARCA.touza(progreso(t, inicio, inicio + 0.5));
    return { opacidad: p, desplazamientoY: 20 * (1 - p), desenfoque: 8 * (1 - p) };
  }
  const p = CURVAS_MARCA.suave(progreso(t, inicio, inicio + 0.4));
  return { opacidad: p, desplazamientoY: 30 * (1 - p), desenfoque: 0 };
}

/** Solape de cada transición alrededor del corte (TR_IN / TR_OUT de reel-kit). */
export const TRANSICION_POR_DEFECTO = { entrada: 0.75, salida: 0.95 } as const;
/** Lo que tarda el rótulo en desvanecerse antes del corte (textOut de reel-kit). */
export const SALIDA_ROTULO_POR_DEFECTO = 0.6;

// ── Tiempos de un reel ───────────────────────────────────────────────────────

/** Mínimo que necesita calcularTiempos (para no depender del esquema). */
export interface DuracionesReel {
  escenas: ReadonlyArray<{ duracion_s: number }>;
  cierre: { duracion_s: number };
}

export interface TiemposReel {
  /** [inicio, fin] de cada escena (las CUES de OM_SCENES). */
  tramos: Array<[number, number]>;
  /** Inicio del cierre (= fin de la última escena). */
  inicioCierre: number;
  /** Duración total en segundos (authoredTotal). */
  total: number;
  /** Fotogramas a 30 fps (redondeo hacia arriba). */
  fotogramas: number;
}

/** Tiempos de cada escena y del cierre. Cambiar una duración mueve todos los cortes siguientes. */
export function calcularTiempos(reel: DuracionesReel): TiemposReel {
  const tramos: Array<[number, number]> = [];
  let t = 0;
  for (const e of reel.escenas) {
    const fin = redondear(t + e.duracion_s);
    tramos.push([t, fin]);
    t = fin;
  }
  const total = redondear(t + reel.cierre.duracion_s);
  return { tramos, inicioCierre: t, total, fotogramas: Math.ceil(total * FPS_REEL - 1e-9) };
}

/** Instante del fotograma n (n / 30). */
export const instanteDeFotograma = (n: number) => n / FPS_REEL;

/** Fotograma que se ve en el instante t. */
export const fotogramaDeInstante = (t: number) => Math.floor(t * FPS_REEL + 1e-9);

/** Evita 0.1 + 0.2 = 0.30000000000000004 en los cortes. */
function redondear(v: number): number {
  return Math.round(v * 1000) / 1000;
}
