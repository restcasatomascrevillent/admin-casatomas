// ============================================================================
// GESTOS TÁCTILES DEL LIENZO DEL PLANO (Fabric v6) — lógica sin dependencia de Fabric
// ----------------------------------------------------------------------------
// Encargo del dueño (2026-10-03): el editor de plano tiene que poder manejarse
// con el DEDO en una tablet. Fabric v6 solo trae «un dedo = un ratón»: no hay
// pellizco para hacer zoom, no hay pan con dos dedos, y un dedo sobre el vacío
// dibuja un rectángulo de selección en vez de mover el plano. Todo eso vive
// aquí, aparte de CanvasPlano, para poder probarlo con eventos simulados.
//
// MODELO
//   · Dos dedos: pellizco (zoom hacia el punto medio) + arrastre (pan) a la vez.
//   · Un dedo: lo decide `decidirUnDedo` (lo da el lienzo):
//       'pan'        → el plano sigue al dedo desde el primer píxel (modo «mano»).
//       'pan-umbral' → pulsación corta = pulsación (colocar pared, mesa…);
//                      arrastre de más de `umbralPan` px = mover el plano.
//       'no'         → lo gestiona Fabric (arrastrar una mesa, dibujar una sala).
//   · Ratón/lápiz: solo hace pan si `panConRaton()` (Espacio pulsado o modo mano).
//
// POR QUÉ LOS LISTENERS CUELGAN DEL CONTENEDOR (captura) Y DE `window`
//   Fabric escucha en el canvas superior y, tras el primer pointerdown, en el
//   documento. Un listener en captura sobre el contenedor se ejecuta SIEMPRE
//   antes que los de Fabric, lo que permite decidir (¿pan o arrastre?) antes de
//   que Fabric arranque su transformación.
// ============================================================================

export type Vpt = [number, number, number, number, number, number];

export interface PuntoXY {
  x: number;
  y: number;
}

export const ZOOM_MIN_PLANO = 0.25;
export const ZOOM_MAX_PLANO = 3;

/** Distancia (px de pantalla) que un dedo debe recorrer para que deje de ser una pulsación. */
export const UMBRAL_PULSACION_PX = 10;
/** Distancia a partir de la cual un dedo sobre el vacío arrastra el plano. */
export const UMBRAL_PAN_PX = 8;

export function limitarZoom(zoom: number, min = ZOOM_MIN_PLANO, max = ZOOM_MAX_PLANO): number {
  if (!Number.isFinite(zoom)) return min;
  return Math.max(min, Math.min(max, zoom));
}

/** Matriz de viewport tras hacer zoom manteniendo fijo `punto` (px de lienzo). */
export function vptZoomHaciaPunto(vpt: Vpt, punto: PuntoXY, nuevoZoom: number, min = ZOOM_MIN_PLANO, max = ZOOM_MAX_PLANO): Vpt {
  const z = limitarZoom(nuevoZoom, min, max);
  const actual = vpt[0] || 1;
  const k = z / actual;
  return [z, 0, 0, z, punto.x - (punto.x - vpt[4]) * k, punto.y - (punto.y - vpt[5]) * k];
}

export function puntoMedio(a: PuntoXY, b: PuntoXY): PuntoXY {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function distancia(a: PuntoXY, b: PuntoXY): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export interface InicioPellizco {
  vpt: Vpt;
  medio: PuntoXY;
  distancia: number;
}

/**
 * Viewport durante un pellizco: el punto de ESCENA que estaba bajo el punto
 * medio inicial de los dos dedos queda bajo el punto medio ACTUAL, y el zoom
 * escala con la razón entre distancias. Así el mismo gesto hace zoom y pan.
 */
export function vptPellizco(
  inicio: InicioPellizco,
  actual: { medio: PuntoXY; distancia: number },
  min = ZOOM_MIN_PLANO,
  max = ZOOM_MAX_PLANO,
): Vpt {
  const zoomInicial = inicio.vpt[0] || 1;
  const razon = inicio.distancia > 0 ? actual.distancia / inicio.distancia : 1;
  const z = limitarZoom(zoomInicial * razon, min, max);
  const escenaX = (inicio.medio.x - inicio.vpt[4]) / zoomInicial;
  const escenaY = (inicio.medio.y - inicio.vpt[5]) / zoomInicial;
  return [z, 0, 0, z, actual.medio.x - escenaX * z, actual.medio.y - escenaY * z];
}

// ── Área táctil ampliada de los objetos ──────────────────────────────────────
//
// Una pared mide 7,5 px de grosor a 50 px/m y una puerta 6: con el dedo
// (≈ 40 px de yema) son imposibles de acertar. `puntoEnAreaAmpliada` es el
// «containsPoint» de Fabric pero con un mínimo de semi-ancho/semi-alto en
// PANTALLA, calculado sobre el rectángulo local del objeto (gira con él).

export type Matriz = [number, number, number, number, number, number];

export function invertirMatriz(m: ArrayLike<number>): Matriz | null {
  const [a, b, c, d, e, f] = [m[0], m[1], m[2], m[3], m[4], m[5]];
  const det = a * d - b * c;
  if (!det) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function aplicarMatriz(m: ArrayLike<number>, p: PuntoXY): PuntoXY {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export interface GeometriaObjeto {
  /** `obj.calcTransformMatrix()`: local → escena (incluye escala y giro). */
  matriz: ArrayLike<number>;
  /** width/height propios del objeto (sin escala) y grosor del trazo. */
  width: number;
  height: number;
  strokeWidth: number;
  scaleX: number;
  scaleY: number;
}

/**
 * ¿Cae `punto` (coordenadas de escena) dentro del rectángulo del objeto,
 * ensanchado hasta un mínimo de `minMitadEscena` por cada lado?
 */
export function puntoEnAreaAmpliada(punto: PuntoXY, g: GeometriaObjeto, minMitadEscena: number): boolean {
  const inv = invertirMatriz(g.matriz);
  if (!inv) return false;
  const q = aplicarMatriz(inv, punto);
  const sx = Math.abs(g.scaleX) || 1;
  const sy = Math.abs(g.scaleY) || 1;
  const mitadX = Math.max(((g.width + g.strokeWidth) * sx) / 2, minMitadEscena);
  const mitadY = Math.max(((g.height + g.strokeWidth) * sy) / 2, minMitadEscena);
  return Math.abs(q.x * sx) <= mitadX && Math.abs(q.y * sy) <= mitadY;
}

// ── Controlador de gestos ────────────────────────────────────────────────────

export type DecisionUnDedo = "pan" | "pan-umbral" | "no";

export interface EstadoGestos {
  /** Hay (o hubo, dentro de esta secuencia de toques) un pellizco o un pan: lo que sigue NO es una pulsación. */
  gestoEnCurso: boolean;
  /** Mayor distancia (px) que se ha movido algún dedo desde que tocó. */
  movimientoMax: number;
  /** El último puntero fue un dedo. */
  esToque: boolean;
  /** Dedos apoyados ahora mismo. */
  dedos: number;
  /** El dedo ya ha superado el umbral de arrastre sobre un objeto (los micro-temblores no mueven mesas). */
  arrastreArmado: boolean;
  /** Posición (client) en la que tocó el primer dedo de la secuencia. */
  inicio: PuntoXY | null;
}

export interface OpcionesGestos {
  /** Contenedor del lienzo (en captura). */
  elemento: HTMLElement;
  obtenerVpt: () => Vpt;
  aplicarVpt: (vpt: Vpt) => void;
  decidirUnDedo: (e: PointerEvent) => DecisionUnDedo;
  /** Empieza un pellizco: el lienzo debe abortar lo que Fabric tuviera a medias (arrastre, sala, selección). */
  alIniciarPellizco?: () => void;
  /** El zoom ha cambiado (para el indicador del %). */
  alCambiarZoom?: (zoom: number) => void;
  /** El usuario ha movido o ampliado la vista a mano. */
  alMoverVista?: () => void;
  /** Se ha levantado el último dedo. */
  alTerminarSecuencia?: () => void;
  /** Ratón/lápiz: ¿está armado el pan (Espacio o modo mano)? */
  panConRaton?: () => boolean;
  umbralPan?: number;
  /** Límites del zoom del pellizco (por defecto los del editor: 0,25-3). */
  zoomMin?: number;
  zoomMax?: number;
}

export interface ControladorGestos {
  estado: EstadoGestos;
  destruir: () => void;
}

interface Toque {
  x0: number;
  y0: number;
  x: number;
  y: number;
}

export function crearGestosTactiles(opciones: OpcionesGestos): ControladorGestos {
  const { elemento } = opciones;
  const umbralPan = opciones.umbralPan ?? UMBRAL_PAN_PX;
  const zoomMin = opciones.zoomMin ?? ZOOM_MIN_PLANO;
  const zoomMax = opciones.zoomMax ?? ZOOM_MAX_PLANO;

  const estado: EstadoGestos = {
    gestoEnCurso: false,
    movimientoMax: 0,
    esToque: false,
    dedos: 0,
    arrastreArmado: false,
    inicio: null,
  };

  const toques = new Map<number, Toque>();
  let modoUnDedo: DecisionUnDedo = "no";
  let panActivo = false;
  let ancla: PuntoXY = { x: 0, y: 0 };
  let pellizco: InicioPellizco | null = null;
  // Pan con ratón/lápiz (Espacio o modo mano).
  let ratonPan: { id: number; x: number; y: number } | null = null;

  const origen = (): PuntoXY => {
    const r = elemento.getBoundingClientRect();
    return { x: r.left, y: r.top };
  };

  const primerosDos = (): [Toque, Toque] | null => {
    const it = toques.values();
    const a = it.next().value as Toque | undefined;
    const b = it.next().value as Toque | undefined;
    return a && b ? [a, b] : null;
  };

  const anclarPellizco = () => {
    const par = primerosDos();
    if (!par) {
      pellizco = null;
      return;
    }
    const o = origen();
    const a = { x: par[0].x - o.x, y: par[0].y - o.y };
    const b = { x: par[1].x - o.x, y: par[1].y - o.y };
    pellizco = { vpt: [...opciones.obtenerVpt()] as Vpt, medio: puntoMedio(a, b), distancia: distancia(a, b) };
  };

  const moverVista = (dx: number, dy: number) => {
    if (!dx && !dy) return;
    const v = opciones.obtenerVpt();
    opciones.aplicarVpt([v[0], v[1], v[2], v[3], v[4] + dx, v[5] + dy]);
    opciones.alMoverVista?.();
  };

  const alBajar = (e: PointerEvent) => {
    if (e.pointerType === "touch") {
      estado.esToque = true;
      if (toques.size === 0) {
        estado.gestoEnCurso = false;
        estado.movimientoMax = 0;
        estado.arrastreArmado = false;
        estado.inicio = { x: e.clientX, y: e.clientY };
        panActivo = false;
        pellizco = null;
      }
      toques.set(e.pointerId, { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY });
      estado.dedos = toques.size;

      if (toques.size === 1) {
        modoUnDedo = opciones.decidirUnDedo(e);
        if (modoUnDedo === "pan") {
          panActivo = true;
          estado.gestoEnCurso = true;
          ancla = { x: e.clientX, y: e.clientY };
        }
      } else if (toques.size === 2) {
        // Segundo dedo: pasa a ser un gesto de dos dedos, sea lo que sea que
        // el primero hubiera empezado.
        estado.gestoEnCurso = true;
        panActivo = false;
        if (!pellizco) opciones.alIniciarPellizco?.();
        anclarPellizco();
      } else {
        // 3 o más dedos: no se reancla, se siguen los dos primeros.
      }
      return;
    }

    estado.esToque = false;
    if (e.button === 0 && opciones.panConRaton?.()) {
      ratonPan = { id: e.pointerId, x: e.clientX, y: e.clientY };
      estado.gestoEnCurso = true;
    }
  };

  const alMover = (e: PointerEvent) => {
    if (e.pointerType === "touch") {
      const t = toques.get(e.pointerId);
      if (!t) return;
      t.x = e.clientX;
      t.y = e.clientY;
      const mov = Math.hypot(t.x - t.x0, t.y - t.y0);
      if (mov > estado.movimientoMax) estado.movimientoMax = mov;
      if (mov > umbralPan) estado.arrastreArmado = true;

      if (toques.size >= 2 && pellizco) {
        const par = primerosDos();
        if (!par) return;
        const o = origen();
        const a = { x: par[0].x - o.x, y: par[0].y - o.y };
        const b = { x: par[1].x - o.x, y: par[1].y - o.y };
        const vpt = vptPellizco(pellizco, { medio: puntoMedio(a, b), distancia: distancia(a, b) }, zoomMin, zoomMax);
        opciones.aplicarVpt(vpt);
        opciones.alCambiarZoom?.(vpt[0]);
        opciones.alMoverVista?.();
        return;
      }

      if (toques.size === 1) {
        if (!panActivo && modoUnDedo === "pan-umbral" && mov > umbralPan) {
          panActivo = true;
          estado.gestoEnCurso = true;
          // Anclado al punto de partida: el plano alcanza al dedo sin dar tirón.
          ancla = { x: t.x0, y: t.y0 };
        }
        if (panActivo) {
          moverVista(e.clientX - ancla.x, e.clientY - ancla.y);
          ancla = { x: e.clientX, y: e.clientY };
        }
      }
      return;
    }

    if (ratonPan && ratonPan.id === e.pointerId) {
      moverVista(e.clientX - ratonPan.x, e.clientY - ratonPan.y);
      ratonPan = { id: e.pointerId, x: e.clientX, y: e.clientY };
    }
  };

  const alSubir = (e: PointerEvent) => {
    if (e.pointerType === "touch") {
      if (!toques.has(e.pointerId)) return;
      toques.delete(e.pointerId);
      estado.dedos = toques.size;

      if (toques.size >= 2) {
        anclarPellizco();
      } else if (toques.size === 1) {
        // Tras un pellizco, el dedo que queda sigue arrastrando el plano.
        pellizco = null;
        const resto = toques.values().next().value as Toque;
        modoUnDedo = "pan";
        panActivo = true;
        estado.gestoEnCurso = true;
        ancla = { x: resto.x, y: resto.y };
      } else {
        pellizco = null;
        panActivo = false;
        modoUnDedo = "no";
        opciones.alTerminarSecuencia?.();
      }
      return;
    }
    if (ratonPan && ratonPan.id === e.pointerId) ratonPan = null;
  };

  elemento.addEventListener("pointerdown", alBajar, true);
  window.addEventListener("pointermove", alMover, true);
  window.addEventListener("pointerup", alSubir, true);
  window.addEventListener("pointercancel", alSubir, true);

  return {
    estado,
    destruir: () => {
      elemento.removeEventListener("pointerdown", alBajar, true);
      window.removeEventListener("pointermove", alMover, true);
      window.removeEventListener("pointerup", alSubir, true);
      window.removeEventListener("pointercancel", alSubir, true);
      toques.clear();
    },
  };
}
