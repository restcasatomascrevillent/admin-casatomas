import { Suspense, useCallback, useLayoutEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { MarcoPanel, MarcoPanelContext, type OpcionesMarcoPanel } from "@/components/DashboardLayout";

/**
 * Ruta de layout del panel (07/11/2026, pregunta del dueño: «¿por qué cuando cambio de sección se recarga toda la
 * página y no solo la parte de la derecha?»). Antes cada página traía su propio `<DashboardLayout>`: al navegar se
 * desmontaba todo, se veía «Cargando» a pantalla completa mientras bajaba el fichero de la página y el menú se
 * volvía a montar (perdía el scroll, el plegado y la campana). Ahora el menú lateral y la cabecera se montan UNA vez
 * aquí y solo cambia el contenido (`<Outlet/>`). El `<DashboardLayout>` que sigue dentro de cada página detecta
 * `MarcoPanelContext` y solo devuelve su contenido y sus opciones (`fixedHeight`, `sinCabeceraMovil`).
 *
 * Los permisos siguen por ruta (`ProtectedRoute` en cada hija); la sesión la comprueba quien envuelve esta ruta.
 */
export function PanelLayout() {
  const [opciones, setOpciones] = useState<OpcionesMarcoPanel>({});
  // Igual valor → mismo objeto: así el marco no se repinta cuando una página repite sus opciones.
  const fijarOpciones = useCallback((nuevas: OpcionesMarcoPanel) => {
    setOpciones((previas) =>
      !!previas.fixedHeight === !!nuevas.fixedHeight && !!previas.sinCabeceraMovil === !!nuevas.sinCabeceraMovil
        ? previas
        : nuevas,
    );
  }, []);

  // Al cambiar de sección se empieza arriba, como cuando se montaba la página entera.
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    if (typeof window.scrollTo === "function") {
      try {
        window.scrollTo(0, 0);
      } catch {
        /* jsdom: scrollTo no implementado */
      }
    }
  }, [pathname]);

  return (
    <MarcoPanelContext.Provider value={fijarOpciones}>
      <MarcoPanel fixedHeight={opciones.fixedHeight} sinCabeceraMovil={opciones.sinCabeceraMovil}>
        <Suspense fallback={<CargandoContenido />}>
          <Outlet />
        </Suspense>
      </MarcoPanel>
    </MarcoPanelContext.Provider>
  );
}

/** Mientras baja el fichero de una sección: discreto y SOLO en la zona de contenido (el menú no se toca). */
export function CargandoContenido() {
  return (
    <div className="flex w-full justify-center py-16" role="status" aria-live="polite" data-testid="cargando-contenido">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/60 border-t-transparent" aria-hidden="true" />
      <span className="sr-only">Cargando…</span>
    </div>
  );
}
