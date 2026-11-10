import * as React from "react";

/** Móvil (teléfono): por debajo de `md`. */
const MOBILE_BREAKPOINT = 768;

/**
 * Por debajo de este ancho (= `lg` de Tailwind) el menú lateral NO es una
 * columna fija: es un panel deslizante (Sheet) con botón de apertura en una
 * barra superior. Cubre iPad vertical (768/810/820), Android 800 y tablets
 * pequeñas. A partir de 1024 px (iPad Pro vertical, cualquier tablet apaisada,
 * escritorio) el menú es fijo. Debe coincidir con los `lg:` de ui/sidebar.tsx.
 */
export const NAV_DRAWER_BREAKPOINT = 1024;

/**
 * Por debajo de este ancho el menú fijo arranca plegado a iconos para no
 * comerse el contenido (iPad Air apaisado 1180 px, iPad Pro vertical 1024 px).
 * El usuario puede desplegarlo con el botón del propio menú.
 */
export const NAV_EXPANDED_MIN_WIDTH = 1280;

/**
 * Hook genérico "el ancho de la ventana es menor que `breakpoint`". Seguro
 * en SSR/tests (sin `matchMedia` devuelve false).
 */
export function useIsBelow(breakpoint: number) {
  // Valor inicial síncrono: evita un primer render "de escritorio" y el salto de layout al
  // aparecer la barra superior / cambiar el menú a panel deslizante.
  const [below, setBelow] = React.useState<boolean>(() =>
    typeof window === "undefined" ? false : window.innerWidth < breakpoint,
  );

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = typeof window.matchMedia === "function" ? window.matchMedia(`(max-width: ${breakpoint - 1}px)`) : null;
    const onChange = () => {
      setBelow(window.innerWidth < breakpoint);
    };
    mql?.addEventListener("change", onChange);
    // Rotar la tablet o abrir un panel dividido cambia el ancho: reevaluar
    // también en `resize` por si `matchMedia` no avisa (algunos WebView).
    window.addEventListener("resize", onChange);
    setBelow(window.innerWidth < breakpoint);
    return () => {
      mql?.removeEventListener("change", onChange);
      window.removeEventListener("resize", onChange);
    };
  }, [breakpoint]);

  return below;
}

/**
 * Lado corto de la PANTALLA (no de la ventana) por debajo del cual un aparato táctil es un teléfono.
 * Los teléfonos rondan 360-430; las tablets pequeñas (iPad mini 744) y los plegables abiertos quedan por encima.
 */
export const TELEFONO_LADO_CORTO_MAX = 600;

/**
 * ¿Es un teléfono táctil aunque la ventana diga otra cosa? (10/11/2026) En Chrome Android con «Sitio de
 * escritorio» activado (también se hereda en la app instalada) se ignora `<meta name="viewport">` y la página
 * se maqueta a ~980 px: `innerWidth` y las media queries de ancho dicen «tablet» y salía la vista de escritorio
 * de Reservas › Hoy en miniatura. Ese modo NO cambia `screen` ni el tipo de puntero, así que se decide también
 * por ellos: dedo como puntero principal + pantalla con lado corto de teléfono.
 */
export function esTelefonoTactil(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  const pantalla = window.screen;
  const ladoCorto = Math.min(pantalla?.width || 0, pantalla?.height || 0);
  if (!(ladoCorto > 0 && ladoCorto < TELEFONO_LADO_CORTO_MAX)) return false;
  return window.matchMedia("(pointer: coarse)").matches === true;
}

/** Teléfono: ventana < 768 px, o teléfono táctil con la página maquetada más ancha (modo «sitio de escritorio»). */
export function useIsMobile() {
  const estrecha = useIsBelow(MOBILE_BREAKPOINT);
  // `screen` y el puntero no cambian al girar ni al redimensionar: basta con leerlo una vez.
  const [telefono] = React.useState(esTelefonoTactil);
  return estrecha || telefono;
}

/**
 * Navegación compacta: el menú es un panel deslizante y hay barra superior
 * (< 1024 px). Úsalo para decidir dónde vive el botón del menú o la campana.
 */
export function useIsCompactNav() {
  return useIsBelow(NAV_DRAWER_BREAKPOINT);
}

/** El puntero principal es el dedo (`pointer: coarse`). */
export function useIsCoarsePointer() {
  const [coarse, setCoarse] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(pointer: coarse)");
    const onChange = () => setCoarse(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return coarse;
}
