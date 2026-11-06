// Una cifra que NUNCA se corta: si «1.362.491,57 €» no cabe en el sitio que
// tiene, sale «1.362.492 €» y, si tampoco, «1,36 M €» (lib/facturas/cifras.ts).
// La completa queda en el `title` (globo con ratón) y para el lector de
// pantalla. Mide con el ancho real de la tarjeta (ResizeObserver), así que se
// adapta al abrir la IA, al girar la tablet o al cambiar el tamaño del módulo.
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

let lienzo: CanvasRenderingContext2D | null | undefined;

/** Ancho del texto con la letra que tiene `el` (null si no se puede medir). */
function anchoTexto(el: HTMLElement, texto: string): number | null {
  if (lienzo === undefined) {
    try {
      lienzo = document.createElement("canvas").getContext("2d");
    } catch {
      lienzo = null;
    }
  }
  if (!lienzo) return null;
  const cs = getComputedStyle(el);
  lienzo.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const espacio = Number.parseFloat(cs.letterSpacing);
  const ancho = lienzo.measureText(texto).width + (Number.isFinite(espacio) ? espacio * texto.length : 0);
  // Margen para las cifras tabulares y el redondeo del navegador.
  return ancho * 1.04 + 2;
}

export function Cifra({ formas, className }: { formas: string[]; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [indice, setIndice] = useState(0);
  const clave = formas.join("|");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || formas.length < 2 || typeof ResizeObserver === "undefined") {
      setIndice(0);
      return;
    }
    const medir = () => {
      const disponible = el.clientWidth;
      if (!disponible) return;
      let elegido = formas.length - 1;
      for (let i = 0; i < formas.length; i++) {
        const ancho = anchoTexto(el, formas[i]);
        if (ancho === null) {
          elegido = 0;
          break;
        }
        if (ancho <= disponible) {
          elegido = i;
          break;
        }
      }
      setIndice((v) => (v === elegido ? v : elegido));
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    // La letra web llega después: se vuelve a medir con la de verdad.
    void document.fonts?.ready.then(medir).catch(() => undefined);
    return () => ro.disconnect();
    // `clave` resume `formas` (un array nuevo en cada render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  const completa = formas[0];
  const corta = formas[Math.min(indice, formas.length - 1)];
  return (
    <span
      ref={ref}
      className={cn("block min-w-0 overflow-hidden whitespace-nowrap", className)}
      title={corta !== completa ? completa : undefined}
      data-cifra-abreviada={corta !== completa || undefined}
    >
      {corta === completa ? (
        completa
      ) : (
        <>
          <span aria-hidden="true">{corta}</span>
          <span className="sr-only">{completa}</span>
        </>
      )}
    </span>
  );
}
