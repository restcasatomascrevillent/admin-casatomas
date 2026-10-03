import { useEffect } from "react";
import { useSidebar } from "@/components/ui/sidebar";
import { NAV_EXPANDED_MIN_WIDTH } from "@/hooks/use-mobile";

/**
 * Estado inicial del menú lateral fijo (>= 1024 px): desplegado solo si hay
 * ancho de sobra (>= 1280 px). En iPad Air apaisado (1180) o iPad Pro vertical
 * (1024) arranca plegado a iconos para no robar ancho al contenido; el botón
 * del propio menú lo despliega.
 */
export function defaultSidebarOpen(): boolean {
  if (typeof window === "undefined") return true;
  return window.innerWidth >= NAV_EXPANDED_MIN_WIDTH;
}

/**
 * Al girar la tablet (o cambiar el tamaño de la ventana) el menú fijo se
 * pliega/despliega según el ancho disponible. Solo reacciona al CRUCE del
 * umbral: si el usuario lo despliega a mano en 1180 px, se respeta hasta que
 * vuelva a cruzar. Debe renderizarse dentro de <SidebarProvider>.
 */
export function NavAutoCollapse() {
  const { setOpen } = useSidebar();

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(`(min-width: ${NAV_EXPANDED_MIN_WIDTH}px)`);
    const onChange = (e: MediaQueryListEvent) => setOpen(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [setOpen]);

  return null;
}
