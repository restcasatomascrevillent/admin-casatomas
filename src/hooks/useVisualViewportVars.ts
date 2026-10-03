import { useEffect } from "react";

/**
 * Publica el viewport VISUAL (el que queda por encima del teclado en pantalla)
 * como variables CSS en <html>:
 *   --vv-h       alto visible (px)
 *   --vv-top     desplazamiento superior del viewport visual dentro del layout (px)
 *   --vv-bottom  alto que tapa el teclado por abajo (px)
 *
 * Los diálogos y hojas (ui/dialog, ui/sheet, ui/alert-dialog) las usan solo con
 * dedo (`pointer-coarse:`) para centrarse y limitar su alto a la zona visible, de
 * modo que con el teclado abierto no queden botones ocultos. Sin soporte de
 * `visualViewport` no se define nada y los componentes caen a `dvh`.
 */
export function useVisualViewportVars() {
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const root = document.documentElement;
    let raf = 0;

    const actualizar = () => {
      raf = 0;
      const bottom = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
      root.style.setProperty("--vv-h", `${Math.round(vv.height)}px`);
      root.style.setProperty("--vv-top", `${Math.round(vv.offsetTop)}px`);
      root.style.setProperty("--vv-bottom", `${Math.round(bottom)}px`);
    };
    const programar = () => {
      if (!raf) raf = requestAnimationFrame(actualizar);
    };

    actualizar();
    vv.addEventListener("resize", programar);
    vv.addEventListener("scroll", programar);
    return () => {
      vv.removeEventListener("resize", programar);
      vv.removeEventListener("scroll", programar);
      if (raf) cancelAnimationFrame(raf);
      root.style.removeProperty("--vv-h");
      root.style.removeProperty("--vv-top");
      root.style.removeProperty("--vv-bottom");
    };
  }, []);
}
