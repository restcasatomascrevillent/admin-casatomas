// Utilidades de Facturas › Análisis para mover la vista SIN mover la página.
//
// `scrollIntoView` desplaza todos los antepasados con scroll, la ventana
// incluida: en la tablet eso dejaba la página corrida (y en blanco) por debajo
// de la barra (QA 05/11/2026). Aquí se desplaza solo el contenedor con scroll
// más cercano y a mano, respetando «reducir movimiento».
import { useRef } from "react";

/** ¿El sistema pide reducir el movimiento? */
export function prefiereMenosMovimiento(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** ¿Pantalla táctil (dedo)? Para no abrir el teclado ni dejar globos pegados. */
export function esTactil(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}

/** ¿Móvil (por debajo de `sm`, 640 px)? */
export function esMovil(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 639px)").matches;
}

/** El antepasado más cercano que hace scroll vertical de verdad (nunca la página). */
export function contenedorConScroll(el: HTMLElement): HTMLElement | null {
  let p = el.parentElement;
  while (p && p !== document.body && p !== document.documentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
    p = p.parentElement;
  }
  return null;
}

/** Lleva el scroll de `contenedor` a `top` (suave salvo «reducir movimiento»). */
export function desplazarA(contenedor: HTMLElement, top: number) {
  const destino = Math.max(0, Math.min(top, contenedor.scrollHeight - contenedor.clientHeight));
  if (typeof contenedor.scrollTo === "function") contenedor.scrollTo({ top: destino, behavior: prefiereMenosMovimiento() ? "auto" : "smooth" });
  else contenedor.scrollTop = destino;
}

/**
 * Enseña `el` dentro de su contenedor con scroll, sin tocar la página.
 *   · "start": su borde de arriba arriba del todo (con `margen`);
 *   · "nearest": solo si no se ve entero, lo mínimo para que se vea.
 */
export function desplazarDentro(el: HTMLElement | null | undefined, bloque: "start" | "nearest" = "nearest", margen = 8) {
  if (!el) return;
  const contenedor = contenedorConScroll(el);
  if (!contenedor) return;
  const c = contenedor.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const arriba = r.top - c.top + contenedor.scrollTop - margen;
  if (bloque === "start") return desplazarA(contenedor, arriba);
  if (r.top >= c.top && r.bottom <= c.bottom) return;
  if (r.top < c.top || r.height > c.height) return desplazarA(contenedor, arriba);
  desplazarA(contenedor, contenedor.scrollTop + (r.bottom - c.bottom) + margen);
}

/**
 * Devuelve el foco a lo que lo tenía al abrir un diálogo/hoja que se abre
 * por código (sin `Trigger`): Radix lo dejaría en `<body>` al cerrar.
 * Uso: `const foco = useFocoAlCerrar(abierto); <DialogContent onCloseAutoFocus={foco} />`.
 */
export function useFocoAlCerrar(abierto: boolean) {
  const previo = useRef<HTMLElement | null>(null);
  const estaba = useRef(false);
  // Se apunta al RENDERIZAR la apertura: los efectos de Radix (que mueven el
  // foco dentro) van antes que los del padre.
  if (abierto && !estaba.current && typeof document !== "undefined") {
    previo.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  }
  estaba.current = abierto;
  return (e: Event) => {
    const el = previo.current;
    if (el && el.isConnected) {
      e.preventDefault();
      el.focus({ preventScroll: true });
    }
  };
}
