/**
 * `useAlturaDisponible`: CUÁNDO se vuelve a medir el alto que le queda a un bloque hasta el fondo de la ventana
 * (las cuentas están en `alturaCalendario.test.ts`).
 *
 * Caso de «Hoy» (05/10/2026): al plegar algo que hay ENCIMA del bloque («Disponibilidad por cuartos de hora»
 * sobre el kanban) el bloque sube, pero el `<main>` no cambia de tamaño (ya medía el alto de la ventana) y el
 * kanban se quedaba corto, con un hueco debajo. Por eso el hook vigila también los contenedores del bloque.
 *
 * jsdom no calcula layout ni tiene `ResizeObserver` de verdad: las medidas se dan a mano, el `ResizeObserver`
 * es un doble que avisa de los elementos que se le digan y `requestAnimationFrame` va a una cola que se vacía a
 * mano.
 */
import { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";

/** Qué avisos recibe cada elemento vigilado. */
const vigilados = new Map<Element, Set<ResizeObserverCallback>>();
class ResizeObserverDoble {
  constructor(private readonly aviso: ResizeObserverCallback) {}
  observe(el: Element) {
    if (!vigilados.has(el)) vigilados.set(el, new Set());
    vigilados.get(el)!.add(this.aviso);
  }
  unobserve(el: Element) {
    vigilados.get(el)?.delete(this.aviso);
  }
  disconnect() {
    for (const avisos of vigilados.values()) avisos.delete(this.aviso);
  }
}
/** El navegador avisa de que `el` ha cambiado de tamaño (y de nada más). */
function cambiaDeTamano(el: Element) {
  act(() => {
    for (const aviso of vigilados.get(el) ?? []) aviso([{ target: el } as ResizeObserverEntry], {} as ResizeObserver);
  });
  act(() => vaciarFrames());
}

let frames: FrameRequestCallback[] = [];
function vaciarFrames() {
  const pendientes = frames;
  frames = [];
  pendientes.forEach((f) => f(0));
}

function Bloque() {
  const [nodo, setNodo] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(nodo, 280);
  return <div ref={setNodo} data-testid="bloque" data-alto={alto ?? "sin-medida"} />;
}

/** `<main>` (24 px de relleno abajo) › contenedor › [lo de encima, el bloque]. El bloque empieza en `topBloque`. */
let topBloque = 150;
function montar() {
  render(
    <main style={{ paddingBottom: 24 }}>
      <div data-testid="contenedor">
        <div data-testid="encima" />
        <Bloque />
      </div>
    </main>,
  );
}
const alto = () => screen.getByTestId("bloque").getAttribute("data-alto");

const innerHeightOriginal = window.innerHeight;
beforeEach(() => {
  vigilados.clear();
  frames = [];
  topBloque = 150;
  vi.stubGlobal("ResizeObserver", ResizeObserverDoble);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((f) => frames.push(f));
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const top = this.dataset.testid === "bloque" ? topBloque : 0;
    return { top, bottom: top + 100, left: 0, right: 100, width: 100, height: 100, x: 0, y: top, toJSON: () => ({}) };
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(window, "innerHeight", { configurable: true, value: innerHeightOriginal });
});

describe("useAlturaDisponible · cuándo se vuelve a medir", () => {
  it("al moverse el bloque porque algo de ENCIMA se despliega o se pliega, aunque el <main> no cambie de tamaño", () => {
    montar();
    // 800 − 150 − 24.
    expect(alto()).toBe("626");

    // Se despliega lo de encima: el bloque baja 200 px y su contenedor cambia de alto.
    topBloque = 350;
    cambiaDeTamano(screen.getByTestId("contenedor"));
    expect(alto()).toBe("426");

    // Se pliega: el bloque sube. El <main> sigue midiendo la ventana (no avisa); el contenedor, sí.
    topBloque = 150;
    cambiaDeTamano(screen.getByTestId("contenedor"));
    expect(alto()).toBe("626");
  });

  it("sigue vigilando el <main> y el <body> (plegar el menú lateral, cargar las fuentes)", () => {
    montar();
    topBloque = 250;
    cambiaDeTamano(document.querySelector("main")!);
    expect(alto()).toBe("526");

    topBloque = 200;
    cambiaDeTamano(document.body);
    expect(alto()).toBe("576");
  });
});
