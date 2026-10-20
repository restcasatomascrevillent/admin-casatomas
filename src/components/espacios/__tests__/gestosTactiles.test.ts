import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ZOOM_MAX_PLANO,
  ZOOM_MIN_PLANO,
  crearGestosTactiles,
  invertirMatriz,
  limitarZoom,
  puntoEnAreaAmpliada,
  vptPellizco,
  vptZoomHaciaPunto,
  type Vpt,
} from "../gestosTactiles";

// ── Matemáticas puras ────────────────────────────────────────────────────────

describe("vptZoomHaciaPunto", () => {
  it("deja fijo el punto indicado al cambiar el zoom", () => {
    const vpt: Vpt = [1, 0, 0, 1, 30, 20];
    const punto = { x: 200, y: 100 };
    const nuevo = vptZoomHaciaPunto(vpt, punto, 2);
    // El punto de escena bajo `punto` antes y después es el mismo.
    const antes = { x: (punto.x - vpt[4]) / vpt[0], y: (punto.y - vpt[5]) / vpt[0] };
    const despues = { x: (punto.x - nuevo[4]) / nuevo[0], y: (punto.y - nuevo[5]) / nuevo[0] };
    expect(despues.x).toBeCloseTo(antes.x);
    expect(despues.y).toBeCloseTo(antes.y);
    expect(nuevo[0]).toBe(2);
  });

  it("limita el zoom a [0,25 ; 3]", () => {
    expect(limitarZoom(10)).toBe(ZOOM_MAX_PLANO);
    expect(limitarZoom(0.01)).toBe(ZOOM_MIN_PLANO);
    expect(limitarZoom(Number.NaN)).toBe(ZOOM_MIN_PLANO);
    expect(vptZoomHaciaPunto([1, 0, 0, 1, 0, 0], { x: 0, y: 0 }, 50)[0]).toBe(ZOOM_MAX_PLANO);
  });
});

describe("vptPellizco", () => {
  const inicio = { vpt: [1, 0, 0, 1, 0, 0] as Vpt, medio: { x: 100, y: 100 }, distancia: 100 };

  it("separar los dedos al doble amplía x2 hacia el punto medio", () => {
    const vpt = vptPellizco(inicio, { medio: { x: 100, y: 100 }, distancia: 200 });
    expect(vpt[0]).toBe(2);
    // El punto de escena (100,100) sigue bajo (100,100).
    expect(vpt[4]).toBeCloseTo(-100);
    expect(vpt[5]).toBeCloseTo(-100);
  });

  it("mover el punto medio sin cambiar la distancia es solo un pan", () => {
    const vpt = vptPellizco(inicio, { medio: { x: 160, y: 130 }, distancia: 100 });
    expect(vpt[0]).toBe(1);
    expect(vpt[4]).toBeCloseTo(60);
    expect(vpt[5]).toBeCloseTo(30);
  });

  it("no pasa de los límites de zoom", () => {
    expect(vptPellizco(inicio, { medio: inicio.medio, distancia: 100000 })[0]).toBe(ZOOM_MAX_PLANO);
    expect(vptPellizco(inicio, { medio: inicio.medio, distancia: 0.0001 })[0]).toBe(ZOOM_MIN_PLANO);
  });
});

describe("puntoEnAreaAmpliada (zona de toque de paredes y puertas)", () => {
  // Pared horizontal de 200 px de largo y 7,5 de grosor centrada en (100, 50).
  const pared = (angulo = 0) => {
    const rad = (angulo * Math.PI) / 180;
    return {
      matriz: [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 100, 50],
      width: 200,
      height: 0,
      strokeWidth: 7.5,
      scaleX: 1,
      scaleY: 1,
    };
  };

  it("acepta un toque a 12 px de una pared fina si el mínimo es 16 px", () => {
    expect(puntoEnAreaAmpliada({ x: 100, y: 62 }, pared(), 16)).toBe(true);
    expect(puntoEnAreaAmpliada({ x: 100, y: 38 }, pared(), 16)).toBe(true);
  });

  it("rechaza un toque más lejos que el mínimo", () => {
    expect(puntoEnAreaAmpliada({ x: 100, y: 70 }, pared(), 16)).toBe(false);
    expect(puntoEnAreaAmpliada({ x: 230, y: 50 }, pared(), 16)).toBe(false);
  });

  it("sigue el giro del objeto (pared vertical)", () => {
    const vertical = pared(90);
    // Eje de la pared: x = 100, y de -50 a 150. Un toque a 10 px al lado vale.
    expect(puntoEnAreaAmpliada({ x: 110, y: 50 }, vertical, 16)).toBe(true);
    expect(puntoEnAreaAmpliada({ x: 100, y: 130 }, vertical, 16)).toBe(true);
    // Un punto que sería "cerca" de la horizontal sin girar ya no vale.
    expect(puntoEnAreaAmpliada({ x: 190, y: 50 }, vertical, 16)).toBe(false);
  });

  it("no encoge objetos que ya son grandes", () => {
    const grande = { matriz: [1, 0, 0, 1, 100, 100], width: 80, height: 80, strokeWidth: 2, scaleX: 1, scaleY: 1 };
    expect(puntoEnAreaAmpliada({ x: 100 + 40, y: 100 }, grande, 5)).toBe(true);
    expect(puntoEnAreaAmpliada({ x: 100 + 45, y: 100 }, grande, 5)).toBe(false);
  });

  it("la matriz singular no rompe nada", () => {
    expect(invertirMatriz([0, 0, 0, 0, 0, 0])).toBeNull();
    expect(
      puntoEnAreaAmpliada({ x: 0, y: 0 }, { ...pared(), matriz: [0, 0, 0, 0, 0, 0] }, 16),
    ).toBe(false);
  });
});

// ── Controlador de gestos con eventos de puntero simulados ───────────────────

function puntero(tipo: string, init: { id: number; x: number; y: number; type?: string; button?: number }) {
  const ev = new MouseEvent(tipo, {
    bubbles: true,
    cancelable: true,
    clientX: init.x,
    clientY: init.y,
    button: init.button ?? 0,
  });
  Object.defineProperty(ev, "pointerId", { value: init.id });
  Object.defineProperty(ev, "pointerType", { value: init.type ?? "touch" });
  return ev;
}

describe("crearGestosTactiles", () => {
  let contenedor: HTMLDivElement;
  let vpt: Vpt;
  let aplicar: ReturnType<typeof vi.fn>;
  let destruir: () => void;
  let unDedo: "pan" | "pan-umbral" | "no";
  let alIniciarPellizco: ReturnType<typeof vi.fn>;
  let alTerminar: ReturnType<typeof vi.fn>;
  let estado: ReturnType<typeof crearGestosTactiles>["estado"];
  let panConRaton: boolean;

  const bajar = (id: number, x: number, y: number, type = "touch") =>
    contenedor.dispatchEvent(puntero("pointerdown", { id, x, y, type }));
  const mover = (id: number, x: number, y: number, type = "touch") =>
    window.dispatchEvent(puntero("pointermove", { id, x, y, type }));
  const subir = (id: number, x = 0, y = 0, type = "touch") =>
    window.dispatchEvent(puntero("pointerup", { id, x, y, type }));

  beforeEach(() => {
    contenedor = document.createElement("div");
    document.body.appendChild(contenedor);
    contenedor.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 500, right: 800, bottom: 500, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    vpt = [1, 0, 0, 1, 0, 0];
    aplicar = vi.fn((v: Vpt) => {
      vpt = v;
    });
    unDedo = "pan-umbral";
    panConRaton = false;
    alIniciarPellizco = vi.fn();
    alTerminar = vi.fn();
    const c = crearGestosTactiles({
      elemento: contenedor,
      obtenerVpt: () => vpt,
      aplicarVpt: aplicar as unknown as (v: Vpt) => void,
      decidirUnDedo: () => unDedo,
      alIniciarPellizco: alIniciarPellizco as unknown as () => void,
      alTerminarSecuencia: alTerminar as unknown as () => void,
      panConRaton: () => panConRaton,
    });
    estado = c.estado;
    destruir = c.destruir;
  });

  afterEach(() => {
    destruir();
    contenedor.remove();
  });

  it("un dedo que apenas se mueve es una pulsación: no hay pan ni gesto", () => {
    bajar(1, 100, 100);
    mover(1, 103, 102);
    subir(1, 103, 102);
    expect(aplicar).not.toHaveBeenCalled();
    expect(estado.gestoEnCurso).toBe(false);
    expect(estado.movimientoMax).toBeLessThan(10);
    expect(alTerminar).toHaveBeenCalledTimes(1);
  });

  it("un dedo sobre el vacío que pasa del umbral mueve el plano entero (sin tirón)", () => {
    bajar(1, 100, 100);
    mover(1, 140, 130);
    expect(estado.gestoEnCurso).toBe(true);
    // 40 px a la derecha y 30 abajo desde donde tocó, no desde el umbral.
    expect(vpt[4]).toBe(40);
    expect(vpt[5]).toBe(30);
    mover(1, 150, 130);
    expect(vpt[4]).toBe(50);
    subir(1);
  });

  it("modo mano: el plano sigue al dedo desde el primer píxel", () => {
    unDedo = "pan";
    bajar(1, 100, 100);
    mover(1, 102, 100);
    expect(vpt[4]).toBe(2);
    expect(estado.gestoEnCurso).toBe(true);
    subir(1);
  });

  it("si Fabric se queda con el dedo ('no') nunca se mueve el plano", () => {
    unDedo = "no";
    bajar(1, 100, 100);
    mover(1, 300, 300);
    expect(aplicar).not.toHaveBeenCalled();
    expect(estado.gestoEnCurso).toBe(false);
    expect(estado.arrastreArmado).toBe(true);
    subir(1);
  });

  it("la zona muerta del arrastre se arma al pasar de 8 px", () => {
    unDedo = "no";
    bajar(1, 100, 100);
    mover(1, 104, 103);
    expect(estado.arrastreArmado).toBe(false);
    mover(1, 120, 100);
    expect(estado.arrastreArmado).toBe(true);
  });

  it("pellizco: dos dedos que se separan amplían y avisan para abortar a Fabric", () => {
    unDedo = "no";
    bajar(1, 300, 250);
    bajar(2, 400, 250);
    expect(alIniciarPellizco).toHaveBeenCalledTimes(1);
    expect(estado.gestoEnCurso).toBe(true);
    expect(estado.dedos).toBe(2);
    // Separación 100 → 200: zoom x2 centrado en (350, 250).
    mover(1, 250, 250);
    mover(2, 450, 250);
    expect(vpt[0]).toBeCloseTo(2);
    // El punto de escena (350,250) sigue bajo (350,250).
    expect((350 - vpt[4]) / vpt[0]).toBeCloseTo(350);
    expect((250 - vpt[5]) / vpt[0]).toBeCloseTo(250);
  });

  it("dos dedos que se desplazan juntos hacen pan sin cambiar el zoom", () => {
    bajar(1, 300, 250);
    bajar(2, 400, 250);
    mover(1, 330, 280);
    mover(2, 430, 280);
    expect(vpt[0]).toBeCloseTo(1);
    expect(vpt[4]).toBeCloseTo(30);
    expect(vpt[5]).toBeCloseTo(30);
  });

  it("al levantar un dedo del pellizco, el que queda sigue moviendo el plano; no es una pulsación", () => {
    bajar(1, 300, 250);
    bajar(2, 400, 250);
    subir(1);
    expect(estado.dedos).toBe(1);
    const antes = vpt[4];
    mover(2, 420, 250);
    expect(vpt[4]).toBeCloseTo(antes + 20);
    subir(2);
    // El gesto sigue marcado hasta el próximo toque: el mouse:up de Fabric lo consulta.
    expect(estado.gestoEnCurso).toBe(true);
    expect(alTerminar).toHaveBeenCalledTimes(1);
  });

  it("una secuencia nueva empieza limpia", () => {
    bajar(1, 300, 250);
    bajar(2, 400, 250);
    subir(1);
    subir(2);
    expect(estado.gestoEnCurso).toBe(true);
    unDedo = "no";
    bajar(3, 10, 10);
    expect(estado.gestoEnCurso).toBe(false);
    expect(estado.movimientoMax).toBe(0);
    subir(3);
  });

  it("pointercancel cuenta como levantar", () => {
    bajar(1, 10, 10);
    window.dispatchEvent(puntero("pointercancel", { id: 1, x: 10, y: 10 }));
    expect(estado.dedos).toBe(0);
    expect(alTerminar).toHaveBeenCalledTimes(1);
  });

  it("ratón: solo hace pan si el modo mano / Espacio está armado", () => {
    bajar(1, 100, 100, "mouse");
    mover(1, 160, 100, "mouse");
    expect(aplicar).not.toHaveBeenCalled();
    subir(1, 160, 100, "mouse");

    panConRaton = true;
    bajar(1, 100, 100, "mouse");
    mover(1, 160, 120, "mouse");
    expect(vpt[4]).toBe(60);
    expect(vpt[5]).toBe(20);
    subir(1, 160, 120, "mouse");
    mover(1, 300, 300, "mouse");
    expect(vpt[4]).toBe(60);
  });

  it("marca esToque según el último puntero", () => {
    bajar(1, 10, 10, "mouse");
    expect(estado.esToque).toBe(false);
    subir(1, 10, 10, "mouse");
    bajar(2, 10, 10, "touch");
    expect(estado.esToque).toBe(true);
    subir(2);
  });

  it("destruir deja de escuchar", () => {
    destruir();
    bajar(1, 10, 10);
    expect(estado.dedos).toBe(0);
    // evita doble destrucción en afterEach
    destruir = () => {};
  });
});
