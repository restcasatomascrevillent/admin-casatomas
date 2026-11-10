import { useEffect, useState } from "react";

/**
 * «Nueva reserva» en dos columnas (10/11/2026, petición del dueño: «quizá dos columnas para que se vea bien
 * en estos dispositivos en horizontal»): pantalla ancha (≥ 1024 px) o tablet en horizontal con ≥ 900 px.
 * Sin `matchMedia` (jsdom, SSR) devuelve false: apilado, como en vertical.
 */
export const CONSULTA_DOS_COLUMNAS = "(min-width: 1024px), (orientation: landscape) and (min-width: 900px)";

export function useDosColumnas(): boolean {
  const consulta = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(CONSULTA_DOS_COLUMNAS).matches;
  const [dos, setDos] = useState<boolean>(consulta);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(CONSULTA_DOS_COLUMNAS);
    const alCambiar = () => setDos(mql.matches);
    alCambiar();
    mql.addEventListener?.("change", alCambiar);
    return () => mql.removeEventListener?.("change", alCambiar);
  }, []);
  return dos;
}
