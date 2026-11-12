import { useEffect, useState } from "react";

const ES_CAMPO_DE_TEXTO = 'input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=button]):not([type=submit]):not([type=range]), textarea, [contenteditable=""], [contenteditable="true"]';

/**
 * ¿Está el teclado en pantalla? (móvil) Cierto mientras el foco está en un campo de texto: así una barra fija
 * inferior se quita de en medio y deja todo el alto a lo que se escribe. Sin DOM o sin foco, falso.
 */
export function useTecladoAbierto(): boolean {
  const [abierto, setAbierto] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined") return;
    let tiempo: ReturnType<typeof setTimeout> | undefined;
    const alEnfocar = (e: FocusEvent) => {
      if (tiempo) clearTimeout(tiempo);
      setAbierto(e.target instanceof Element && e.target.matches(ES_CAMPO_DE_TEXTO));
    };
    // Con un pequeño retraso: al pasar de un campo a otro el foco sale y entra, y la barra no debe parpadear.
    const alDesenfocar = () => {
      if (tiempo) clearTimeout(tiempo);
      tiempo = setTimeout(() => setAbierto(false), 120);
    };
    document.addEventListener("focusin", alEnfocar);
    document.addEventListener("focusout", alDesenfocar);
    return () => {
      if (tiempo) clearTimeout(tiempo);
      document.removeEventListener("focusin", alEnfocar);
      document.removeEventListener("focusout", alDesenfocar);
    };
  }, []);
  return abierto;
}
