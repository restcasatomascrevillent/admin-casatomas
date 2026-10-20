// ============================================================================
// DIBUJO DE LOS ELEMENTOS DE UN PLANO (paredes, áreas, puertas…) — compartido
// ----------------------------------------------------------------------------
// Sacado TAL CUAL de `PlanoEspacio2D.tsx` (06/10/2026) para que el plano de
// reparto de mesas y la vista «Plano» de «Hoy» (`servicio/MapaSalaServicio.tsx`)
// pinten la sala con EXACTAMENTE la misma geometría: misma lectura de cada
// elemento, mismo encuadre (`limitesContenidoPlano`) y mismas convenciones de giro.
// Nada de aquí cambia lo que se veía: son las mismas cuentas y los mismos estilos.
// ============================================================================

import type { CSSProperties } from "react";
import {
  aabbRectFabric,
  rectFabricDesdeElemento,
  type RectFabric,
} from "@/components/espacios/puertaGeometria";

export interface ElementoPlano {
  id: string;
  tipo: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  radius?: number;
  angle?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  points?: Array<{ x: number; y: number }>;
  fill?: string;
  // JSON tal cual lo guarda el editor (`planos_espacio.configuracion.elementos`): cada `tipo` trae sus
  // propias claves (x1…y2 una pared, left/top/width/height un área…), así que no hay un tipo único.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  props?: Record<string, any>;
}

// ── Geometría de los elementos del plano ─────────────────────────────────────
//
// DOS CONVENCIONES DE ROTACIÓN CONVIVEN EN ESTA PANTALLA. No es un descuido,
// es lo que persiste cada cosa, y confundirlas descoloca el dibujo:
//
//   · ELEMENTOS del plano (`planos_espacio.configuracion.elementos`: paredes,
//     áreas, puertas) se guardan en la convención de Fabric v6: `left`/`top`
//     es la ESQUINA y el objeto gira ALREDEDOR DE ESA ESQUINA. El equivalente
//     exacto en CSS es `transform-origin: 0 0`. Ver `puertaGeometria.ts` y el
//     commit 1e77baf, que arregló lo mismo en el editor.
//
//   · MESAS (`mesas.pos_x` / `pos_y` / `rotacion`) van al revés A PROPÓSITO:
//     el editor persiste la esquina de la caja SIN rotar (`centro - ancho/2`)
//     porque esta pantalla las gira por CSS alrededor del CENTRO. Por eso las
//     mesas llevan `transform-origin: center center` y los elementos no.
//
// Hasta ahora esta vista NO rotaba ningún elemento, así que toda puerta salía
// horizontal aunque su `angle` estuviera bien guardado.
const ORIGEN_ROTACION_ELEMENTO = "0 0";

/**
 * Grosor con el que se pinta una pared, en unidades de escena.
 *
 * La pared se dibuja como una BANDA que tiene que quedar CENTRADA en la línea
 * `(x1,y1)-(x2,y2)`, igual que el trazo de la `Line` de Fabric en el editor.
 * Como el div se coloca por su borde superior, hay que subirlo medio grosor:
 * sin eso la banda salía entera por debajo de su propia línea y la puerta
 * —que sí cae sobre la línea— parecía despegada de la pared.
 *
 * Medido en el navegador el 2026-09-28 con el harness: 3,97 px de separación
 * en las paredes horizontales (≈8 cm a 50 px/m) y 0 en las verticales, porque
 * en esas el giro alrededor de `0 50%` ya recentraba la banda por casualidad.
 */
export const GROSOR_PARED_ESCENA = 6;

/**
 * Lectura ÚNICA de la geometría de un elemento rectangular (área, puerta,
 * ventana, "elemento"). La usan las TRES ramas que dibujan el plano: la vista,
 * el PDF y el cálculo de `contentBounds`.
 *
 * Vive en `puertaGeometria.ts` (compartido con el editor) porque lo que
 * codifica es la CONVENCIÓN DE PERSISTENCIA, no una decisión de esta pantalla:
 * así la vista y el editor no pueden volver a divergir.
 */
export const rectDeElemento = (
  elem: ElementoPlano,
  anchoPorDefecto: number,
  altoPorDefecto: number,
): RectFabric => rectFabricDesdeElemento(elem, anchoPorDefecto, altoPorDefecto);

/**
 * CSS que reproduce el giro de un Rect de Fabric con origen `left`/`top`.
 *
 * Es exacto también con zoom: la escala es uniforme, así que escalar y girar
 * conmutan, y el centro cae donde `centroRectFabric` dice que cae.
 */
export function estiloRotacionElemento(angle: number): {
  transform: string;
  transformOrigin: string;
} {
  return {
    transform: `rotate(${angle}deg)`,
    transformOrigin: ORIGEN_ROTACION_ELEMENTO,
  };
}

/** Lo que hace falta de una mesa para el encuadre: posición en METROS y tamaño en CM. */
export interface MesaEncuadre {
  pos_x: number | null;
  pos_y: number | null;
  ancho: number | null;
  alto: number | null;
}

export interface LimitesContenido {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

/**
 * La caja (en unidades de escena) que encierra paredes, elementos y mesas, con un
 * metro de margen y recortada al lienzo. Sin nada dibujado, el lienzo entero. Es
 * lo que se encuadra en pantalla.
 */
export function limitesContenidoPlano(
  elementosPlano: readonly ElementoPlano[],
  mesas: readonly MesaEncuadre[],
  PIXELS_PER_METER: number,
  canvasWidth: number,
  canvasHeight: number,
): LimitesContenido {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  elementosPlano.forEach((elem) => {
    const props = elem.props || elem;
    if (elem.tipo === "wall" && props.x1 !== undefined) {
      minX = Math.min(minX, props.x1, props.x2);
      minY = Math.min(minY, props.y1, props.y2);
      maxX = Math.max(maxX, props.x1, props.x2);
      maxY = Math.max(maxY, props.y1, props.y2);
    } else if (props.left !== undefined && props.top !== undefined) {
      // Un círculo no guarda width/height, solo `radius`: su caja es 2r.
      const diametro = props.radius !== undefined ? props.radius * 2 : 100;
      // La caja tiene que ser la del elemento YA GIRADO. Con `angle = 0` sale
      // exactamente la de antes; con ángulo, la puerta de 70x12 tumbada a 90°
      // ocupa 12 de ancho y 70 de alto y sobresale a la izquierda de `left`.
      // Con la caja ingenua se quedaba fuera del encuadre y el PDF la cortaba.
      const caja = aabbRectFabric(rectDeElemento(elem, diametro, diametro));
      minX = Math.min(minX, caja.minX);
      minY = Math.min(minY, caja.minY);
      maxX = Math.max(maxX, caja.maxX);
      maxY = Math.max(maxY, caja.maxY);
    }
  });

  mesas.forEach((mesa) => {
    const x = (mesa.pos_x || 0) * PIXELS_PER_METER;
    const y = (mesa.pos_y || 0) * PIXELS_PER_METER;
    const w = ((mesa.ancho || 80) / 100) * PIXELS_PER_METER;
    const h = ((mesa.alto || 80) / 100) * PIXELS_PER_METER;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  });

  if (minX === Infinity) {
    return {
      minX: 0,
      minY: 0,
      maxX: canvasWidth,
      maxY: canvasHeight,
      width: canvasWidth,
      height: canvasHeight,
    };
  }

  const gridPadding = PIXELS_PER_METER;
  minX = Math.max(0, minX - gridPadding);
  minY = Math.max(0, minY - gridPadding);
  maxX = Math.min(canvasWidth, maxX + gridPadding);
  maxY = Math.min(canvasHeight, maxY + gridPadding);

  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Encuadre con el que se pinta: origen de la caja de contenido y zoom. */
export interface VistaPlano {
  offsetX: number;
  offsetY: number;
  scale: number;
}

// ── Elementos arquitectónicos del plano ───────────────────────────────────
export const renderElementoPlano = (elem: ElementoPlano, { offsetX, offsetY, scale }: VistaPlano) => {
  const baseStyle: CSSProperties = { position: "absolute", pointerEvents: "none" };
  const props = elem.props || elem;

  switch (elem.tipo) {
    case "wall": {
      const { x1, y1, x2, y2 } = props;
      if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return null;
      const length = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
      const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
      return (
        <div
          key={elem.id}
          style={{
            ...baseStyle,
            left: (x1 - offsetX) * scale,
            // Medio grosor arriba: así el punto de giro (`0 50%`) cae JUSTO
            // en (x1, y1) y la banda queda centrada en la línea de la pared,
            // como el trazo de la `Line` de Fabric en el editor.
            top: ((y1 - offsetY) - GROSOR_PARED_ESCENA / 2) * scale,
            width: length * scale,
            height: GROSOR_PARED_ESCENA * scale,
            backgroundColor: "#374151",
            transform: `rotate(${angle}deg)`,
            transformOrigin: "0 50%",
          }}
        />
      );
    }

    case "rectangle":
    case "area": {
      const rect = rectDeElemento(elem, 100, 100);
      return (
        <div
          key={elem.id}
          style={{
            ...baseStyle,
            left: (rect.left - offsetX) * scale,
            top: (rect.top - offsetY) * scale,
            width: rect.width * scale,
            height: rect.height * scale,
            // `||` a propósito: un `fill` vacío NO es un color válido, así que
            // sí debe caer al de por defecto (con `??` se pintaría transparente).
            backgroundColor: props.fill || elem.fill || "rgba(226, 232, 240, 0.5)",
            border: `${2 * scale}px solid #64748b`,
            borderRadius: 4 * scale,
            ...estiloRotacionElemento(rect.angle),
          }}
        />
      );
    }

    case "circle": {
      // Un círculo es invariante al giro, pero el punto que se guarda es la
      // esquina de su caja: girar movería el círculo entero. El editor nunca
      // les pone ángulo, así que aquí se dibujan sin rotar.
      const radius = (props.radius ?? elem.radius ?? 30) * scale;
      return (
        <div
          key={elem.id}
          style={{
            ...baseStyle,
            left: ((props.left ?? elem.left ?? 0) - offsetX) * scale,
            top: ((props.top ?? elem.top ?? 0) - offsetY) * scale,
            width: radius * 2,
            height: radius * 2,
            backgroundColor: props.fill || elem.fill || "#e2e8f0",
            border: `${2 * scale}px solid #64748b`,
            borderRadius: "50%",
          }}
        />
      );
    }

    case "door": {
      const rect = rectDeElemento(elem, 70, 12);
      return (
        <div
          key={elem.id}
          style={{
            ...baseStyle,
            left: (rect.left - offsetX) * scale,
            top: (rect.top - offsetY) * scale,
            width: rect.width * scale,
            height: rect.height * scale,
            backgroundColor: "#fef3c7",
            border: `${2 * scale}px solid #d97706`,
            borderRadius: 2 * scale,
            ...estiloRotacionElemento(rect.angle),
          }}
        />
      );
    }

    case "silla": {
      const sillaRadius = (props.radius ?? elem.radius ?? 15) * scale;
      return (
        <div
          key={elem.id}
          style={{
            ...baseStyle,
            left: ((props.left ?? elem.left ?? 0) - offsetX) * scale,
            top: ((props.top ?? elem.top ?? 0) - offsetY) * scale,
            width: sillaRadius * 2,
            height: sillaRadius * 2,
            backgroundColor: "#fde68a",
            border: `${2 * scale}px solid #d97706`,
            borderRadius: "50%",
          }}
        />
      );
    }

    case "elemento": {
      const rect = rectDeElemento(elem, 40, 40);
      return (
        <div
          key={elem.id}
          style={{
            ...baseStyle,
            left: (rect.left - offsetX) * scale,
            top: (rect.top - offsetY) * scale,
            width: rect.width * scale,
            height: rect.height * scale,
            backgroundColor: "#94a3b8",
            border: `${1 * scale}px solid #475569`,
            borderRadius: 4 * scale,
            ...estiloRotacionElemento(rect.angle),
          }}
        />
      );
    }

    case "polygon": {
      const rect = rectDeElemento(elem, 60, 60);
      return (
        <div
          key={elem.id}
          style={{
            ...baseStyle,
            left: (rect.left - offsetX) * scale,
            top: (rect.top - offsetY) * scale,
            // El tamaño sigue siendo fijo: el polígono no guarda width/height,
            // es un triángulo recortado de una caja de 60x60.
            width: 60 * scale,
            height: 60 * scale,
            clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)",
            backgroundColor: props.fill || elem.fill || "#e2e8f0",
            ...estiloRotacionElemento(rect.angle),
          }}
        />
      );
    }

    default:
      return null;
  }
};
