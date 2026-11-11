import { useEffect } from "react";
import { useSidebar } from "@/components/ui/sidebar";
import { NAV_EXPANDED_MIN_WIDTH } from "@/hooks/use-mobile";

/**
 * ¿Pantalla táctil sin ratón (tablet o teléfono)? Lo deciden el puntero principal (dedo) y que no
 * se pueda pasar el ratón por encima: un iPad con teclado y trackpad, o un portátil con pantalla
 * táctil, cuentan como ordenador.
 */
export function esPantallaTactil(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(hover: none) and (pointer: coarse)").matches === true;
}

/**
 * Estado inicial del menú lateral fijo (>= 1024 px): desplegado solo si hay
 * ancho de sobra (>= 1280 px) y NO es una pantalla táctil. En iPad Air apaisado
 * (1180) o iPad Pro vertical (1024) arranca plegado a iconos para no robar ancho
 * al contenido; el botón del propio menú lo despliega.
 *
 * 11/11/2026, petición del dueño («en los móviles y tablets que la barra lateral salga por defecto
 * cerrada»): las tablets anchas (iPad Pro apaisado 1366 px, Android de 1280 px o más) arrancaban
 * con el menú desplegado. En una pantalla táctil arranca siempre plegado. En el teléfono y en la
 * tablet vertical (< 1024 px) el menú es un panel deslizante que ya empieza cerrado.
 */
export function defaultSidebarOpen(): boolean {
  if (typeof window === "undefined") return true;
  if (esPantallaTactil()) return false;
  return window.innerWidth >= NAV_EXPANDED_MIN_WIDTH;
}

/**
 * Al girar la tablet (o cambiar el tamaño de la ventana) el menú fijo se
 * pliega/despliega según el ancho disponible. Solo reacciona al CRUCE del
 * umbral: si el usuario lo despliega a mano en 1180 px, se respeta hasta que
 * vuelva a cruzar. En una pantalla táctil solo se pliega: girar la tablet no lo
 * abre solo. Debe renderizarse dentro de <SidebarProvider>.
 */
export function NavAutoCollapse() {
  const { setOpen } = useSidebar();

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(`(min-width: ${NAV_EXPANDED_MIN_WIDTH}px)`);
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches && esPantallaTactil()) return;
      setOpen(e.matches);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [setOpen]);

  return null;
}
