import { useCallback, useRef, useState, type MouseEvent, type PointerEvent } from "react";

// ============================================================================
// PASAR HOJAS ARRASTRANDO CON EL DEDO (10/11/2026, petición del dueño: «con el
// táctil se pueda pasar arrastrando»; con los eventos táctiles de antes no le
// funcionaba en la tablet).
// ----------------------------------------------------------------------------
// Con eventos de puntero, solo dedo o lápiz (`pointerType` touch/pen; el ratón
// usa las flechas). La zona que lleva estos manejadores Y su contenedor con
// scroll tienen que llevar `touch-action: pan-y` (`touch-pan-y`) y
// `overflow-x: hidden`: un `overflow-y: auto` también hace desplazable en
// horizontal al contenedor, y el navegador se quedaba el gesto lateral (por
// eso no pasaba la hoja). Así el scroll vertical sigue siendo del navegador y
// el gesto lateral llega aquí.
//
//   · Pasa hoja si el desplazamiento horizontal llega a UMBRAL_ARRASTRE px y
//     domina claramente sobre el vertical. Dedo a la izquierda: hoja siguiente.
//   · Mientras se arrastra, la hoja sigue al dedo un poco (`desplazamiento`,
//     amortiguado y con tope), y vuelve a su sitio al soltar.
//   · Si hubo arrastre, el clic que pueda venir detrás se cancela (fase de
//     captura): arrastrar sobre una reserva no la abre.
// ============================================================================

/** Desplazamiento horizontal (px) a partir del cual soltar pasa la hoja. */
export const UMBRAL_ARRASTRE = 60;
/** A partir de aquí (px) el gesto ya cuenta como arrastre: el clic siguiente no abre nada. */
const UMBRAL_ES_ARRASTRE = 10;
/** Cuánto sigue la hoja al dedo (fracción) y hasta dónde (px). */
const SEGUIMIENTO = 0.4;
const TOPE = 90;

export function useArrastrarHoja(onPasar: (delta: 1 | -1) => void) {
  const inicio = useRef<{ x: number; y: number; id: number } | null>(null);
  const huboArrastre = useRef(false);
  const [desplazamiento, setDesplazamiento] = useState(0);

  const soltar = useCallback(() => {
    inicio.current = null;
    setDesplazamiento(0);
  }, []);

  const onPointerDown = useCallback((e: PointerEvent<HTMLElement>) => {
    huboArrastre.current = false;
    if (e.pointerType === "mouse") return;
    inicio.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }, []);

  const onPointerMove = useCallback((e: PointerEvent<HTMLElement>) => {
    const ini = inicio.current;
    if (!ini || e.pointerId !== ini.id) return;
    const dx = e.clientX - ini.x;
    const dy = e.clientY - ini.y;
    if (!huboArrastre.current && Math.abs(dx) > UMBRAL_ES_ARRASTRE && Math.abs(dx) > Math.abs(dy)) huboArrastre.current = true;
    if (huboArrastre.current) setDesplazamiento(Math.max(-TOPE, Math.min(TOPE, dx * SEGUIMIENTO)));
  }, []);

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const ini = inicio.current;
      if (!ini || e.pointerId !== ini.id) return;
      const dx = e.clientX - ini.x;
      const dy = e.clientY - ini.y;
      soltar();
      if (Math.abs(dx) >= UMBRAL_ARRASTRE && Math.abs(dx) > Math.abs(dy) * 1.5) {
        huboArrastre.current = true;
        onPasar(dx < 0 ? 1 : -1);
      }
      // El clic de después de un arrastre llega justo tras soltar; pasado un momento, los clics vuelven a valer
      // (si no, un toque con teclado después de arrastrar se perdería).
      if (huboArrastre.current) window.setTimeout(() => (huboArrastre.current = false), 350);
    },
    [onPasar, soltar],
  );

  const onPointerCancel = useCallback(() => {
    // El navegador se ha quedado el gesto (scroll vertical): no se pasa hoja.
    soltar();
  }, [soltar]);

  const onClickCapture = useCallback((e: MouseEvent<HTMLElement>) => {
    if (!huboArrastre.current) return;
    huboArrastre.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return {
    manejadores: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture },
    /** px que la hoja sigue al dedo mientras se arrastra (0 en reposo). */
    desplazamiento,
  };
}
