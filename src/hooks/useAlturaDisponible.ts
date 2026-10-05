import { useEffect, useLayoutEffect, useState } from "react";
import { calcularAlturaDisponible } from "@/lib/reservas/alturaCalendario";

/**
 * Alto (px) que le queda a `nodo` desde su posición REAL en la página hasta el
 * fondo del viewport VISUAL (el que descuenta barra del navegador y teclado en
 * pantalla; es el mismo que publica `useVisualViewportVars`), menos el relleno
 * inferior del `<main>` del layout. Las cuentas están en
 * `lib/reservas/alturaCalendario.ts`.
 *
 * Devuelve `null` mientras no hay nodo, si el navegador no tiene
 * `ResizeObserver` (SSR) o si el nodo no tiene layout (jsdom, `display:none`,
 * medidas a 0): el llamador cae a su layout de siempre, sin altura fija.
 *
 * Se vuelve a medir al cambiar el tamaño de la ventana, al girar la tablet, al
 * redimensionarse el viewport visual (teclado) y al cambiar de tamaño el
 * `<main>` o el `<body>` —que es lo que ocurre al plegar/desplegar el menú
 * lateral, al envolver la fila de pestañas o al cargar las fuentes—. Nunca
 * escribe el mismo valor dos veces, así que no hay bucle con la propia altura
 * que fija.
 *
 * `minimo`: suelo en px (por defecto el del calendario, `ALTURA_MINIMA_BLOQUE`);
 * por debajo el bloque no encoge más y la página hace scroll.
 */
export function useAlturaDisponible(nodo: HTMLElement | null, minimo?: number): number | null {
  const [alto, setAlto] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!nodo || typeof window === "undefined" || typeof ResizeObserver === "undefined") {
      setAlto(null);
      return;
    }
    let raf = 0;

    const medir = () => {
      raf = 0;
      const caja = nodo.getBoundingClientRect();
      // Sin layout (jsdom, nodo oculto con display:none): no hay nada que medir.
      if (caja.width === 0 && caja.height === 0) {
        setAlto(null);
        return;
      }
      const vv = window.visualViewport;
      const main = nodo.closest("main");
      const relleno = main ? parseFloat(window.getComputedStyle(main).paddingBottom) || 0 : 0;
      setAlto(
        calcularAlturaDisponible({
          topPagina: caja.top + window.scrollY,
          altoVisible: vv ? vv.height : window.innerHeight,
          paddingInferior: relleno,
          minimo,
        }),
      );
    };
    const programar = () => {
      if (!raf) raf = window.requestAnimationFrame(medir);
    };

    medir();
    // Los eventos de ventana miden al momento (no esperan al `requestAnimationFrame`, que una
    // pestaña oculta no ejecuta); el `ResizeObserver` va por frame y se junta en uno.
    const ahora = () => {
      if (raf) window.cancelAnimationFrame(raf);
      medir();
    };
    const observador = new ResizeObserver(programar);
    const main = nodo.closest("main");
    if (main) observador.observe(main);
    observador.observe(document.body);
    window.addEventListener("resize", ahora);
    window.addEventListener("orientationchange", ahora);
    window.visualViewport?.addEventListener("resize", ahora);
    return () => {
      observador.disconnect();
      window.removeEventListener("resize", ahora);
      window.removeEventListener("orientationchange", ahora);
      window.visualViewport?.removeEventListener("resize", ahora);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [nodo, minimo]);

  return alto;
}

/** Tamaño (px, enteros) de un elemento, con `ResizeObserver`. `null` sin nodo o sin soporte. */
export function useTamanoElemento(nodo: HTMLElement | null): { ancho: number; alto: number } | null {
  const [tamano, setTamano] = useState<{ ancho: number; alto: number } | null>(null);

  useEffect(() => {
    if (!nodo || typeof ResizeObserver === "undefined") {
      setTamano(null);
      return;
    }
    const leer = () => {
      const ancho = Math.round(nodo.clientWidth);
      const alto = Math.round(nodo.clientHeight);
      if (ancho === 0 || alto === 0) {
        setTamano(null);
        return;
      }
      setTamano((previo) => (previo && previo.ancho === ancho && previo.alto === alto ? previo : { ancho, alto }));
    };
    leer();
    const observador = new ResizeObserver(leer);
    observador.observe(nodo);
    return () => observador.disconnect();
  }, [nodo]);

  return tamano;
}
