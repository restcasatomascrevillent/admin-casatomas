import { createContext, useContext, useLayoutEffect, type ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { CentroNotificaciones } from "@/components/notificaciones/CentroNotificaciones";
import { AvisosEnVivo } from "@/components/notificaciones/AvisosEnVivo";
import { RouteErrorBoundary } from "@/components/ErrorBoundary";
import { useIsCompactNav, useIsMobile } from "@/hooks/use-mobile";
import { NavAutoCollapse, defaultSidebarOpen } from "@/components/NavAutoCollapse";
import { PrecargaRecorte } from "@/components/carta/recorte/PrecargaRecorte";
import { VersionPanel } from "@/components/panel/VersionPanel";
import { useLocation } from "react-router-dom";
import { OPCIONES_INICIO } from "@/lib/seccionInicio";

interface DashboardLayoutProps {
  children: ReactNode;
  /** Cuando es true, la página encaja en el alto de la pantalla sin scroll
   * horizontal ni scroll de la página completa (el sidebar y la cabecera
   * quedan siempre visibles). Si el contenido no cabe en pantallas más
   * pequeñas, el área de contenido hace scroll vertical por sí sola para
   * que nunca se oculte información. */
  fixedHeight?: boolean;
  /** Solo en móvil (< 768 px): sin la barra superior (menú, «Casa Tomás», versión y campana). La página
   * pone su propio botón de menú (`SidebarTrigger`). Lo usa Reservas › Hoy del camarero (07/11/2026,
   * petición del dueño: cada píxel para la lista). Tablet y escritorio no cambian. */
  sinCabeceraMovil?: boolean;
}

/** Opciones de la página que cambian el marco (las mismas props de `DashboardLayout`). */
export type OpcionesMarcoPanel = Pick<DashboardLayoutProps, "fixedHeight" | "sinCabeceraMovil">;

/**
 * Marco montado UNA vez por la ruta de layout (`PanelLayout`, 07/11/2026, «¿por qué al cambiar de sección se
 * recarga toda la página?»). Dentro de él, el `<DashboardLayout>` de cada página no vuelve a pintar el menú ni la
 * cabecera: solo pasa sus opciones al marco y devuelve su contenido. Fuera (pruebas, páginas sueltas), igual que
 * siempre.
 */
export const MarcoPanelContext = createContext<((opciones: OpcionesMarcoPanel) => void) | null>(null);

export function DashboardLayout({ children, fixedHeight = false, sinCabeceraMovil = false }: DashboardLayoutProps) {
  const fijarOpciones = useContext(MarcoPanelContext);
  if (fijarOpciones) {
    return (
      <OpcionesEnMarco fijarOpciones={fijarOpciones} fixedHeight={fixedHeight} sinCabeceraMovil={sinCabeceraMovil}>
        {children}
      </OpcionesEnMarco>
    );
  }
  return (
    <MarcoPanel fixedHeight={fixedHeight} sinCabeceraMovil={sinCabeceraMovil}>
      {children}
    </MarcoPanel>
  );
}

function OpcionesEnMarco({
  children,
  fijarOpciones,
  fixedHeight,
  sinCabeceraMovil,
}: DashboardLayoutProps & { fijarOpciones: (opciones: OpcionesMarcoPanel) => void }) {
  // Antes de pintar (sin parpadeo de la barra), y al salir de la página el marco vuelve a lo de siempre.
  useLayoutEffect(() => {
    fijarOpciones({ fixedHeight, sinCabeceraMovil });
    return () => fijarOpciones({});
  }, [fijarOpciones, fixedHeight, sinCabeceraMovil]);
  return <>{children}</>;
}

/** Menú lateral + cabecera de tablet/móvil + `<main>`. Lo pinta `DashboardLayout` suelto o `PanelLayout` una vez. */
export function MarcoPanel({ children, fixedHeight = false, sinCabeceraMovil = false }: DashboardLayoutProps) {
  const { pathname } = useLocation();
  const seccionActual = pathname === "/" ? "Dashboard" : OPCIONES_INICIO.find((o) => pathname === o.ruta || pathname.startsWith(`${o.ruta}/`))?.titulo ?? "Contenido";
  // Por debajo de 1024px (`useIsCompactNav`: iPad vertical 768/810/820, Android
  // 800, teléfonos) el menú lateral se renderiza como panel deslizante (Sheet)
  // y SOLO se puede abrir desde fuera de él: sin esta barra no habría manera de
  // navegar. Por eso el mismo flag decide dónde vive la campana — así solo hay
  // UNA instancia montada en todo momento (dos suscripciones realtime al mismo
  // canal sobraban; ReservasHoy también lo consulta para no duplicarla).
  // A partir de 1024px el menú es fijo: desplegado desde 1280px y plegado a
  // iconos entre 1024 y 1279 (iPad Air apaisado, iPad Pro vertical).
  const isCompactNav = useIsCompactNav();
  const esMovil = useIsMobile();
  const sinCabecera = sinCabeceraMovil && esMovil;

  return (
    <SidebarProvider defaultOpen={defaultSidebarOpen()}>
      <NavAutoCollapse />
      {/* Baja en segundo plano el modelo del recorte de fotos de la carta. */}
      <PrecargaRecorte />
      {/* Aviso grande, sonido y cifra en la pestaña cuando entra algo que gestionar (10/11/2026). */}
      <AvisosEnVivo />
      {/* `h-app`/`min-h-app` (index.css): en iPad/Android el alto de `100vh` incluye la barra del
          navegador y cortaba el pie de la página; `dvh` la descuenta (con `vh` de respaldo). */}
      <div
        className={`flex w-full bg-background ${
          fixedHeight ? "h-app overflow-hidden" : "min-h-app"
        }`}
      >
        <AppSidebar />
        <div
          className={`flex-1 flex flex-col min-w-0 ${
            fixedHeight ? "h-app overflow-hidden" : ""
          }`}
        >
          {/* Sin cabecera en escritorio (2026-09-25, petición del dueño):
              la franja superior solo llevaba la fecha larga y la campana, y se
              comía ~57px de alto en TODAS las páginas para no decir nada que
              no se pudiera deducir. La fecha desaparece del panel (el
              calendario sigue mostrando la del día que selecciones); el
              plegador del menú se muda a la cabecera del propio sidebar y la
              campana a su pie (AppSidebar.tsx) — "al otro lado", como pidió,
              y sin ocupar alto. En tablet vertical / móvil (< 1024px) sí queda
              esta barra mínima: el sidebar es un Sheet y no hay otra forma de
              abrirlo. 56px de alto con botones de 44px; respeta el notch.
              En el centro, «Casa Tomás» en todas las secciones (02/11/2026,
              petición del dueño: el hueco entre el menú y la campana quedaba
              vacío). */}
          {isCompactNav && !sinCabecera && (
            <header className="lg:hidden h-[calc(3.5rem+env(safe-area-inset-top))] border-b border-border bg-card grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-3 pt-[env(safe-area-inset-top)] sticky top-0 z-40 w-full shrink-0">
              <SidebarTrigger className="shrink-0" />
              {/* Debajo del nombre, la versión y el entorno (2026-11-03): con el menú
                  cerrado no se veían. Dos líneas para que quepa a 320 px. */}
              <div className="flex min-w-0 flex-col items-center gap-0.5">
                <p className="max-w-full truncate text-center text-base font-semibold leading-tight tracking-tight text-foreground" data-testid="cabecera-negocio">
                  Casa Tomás
                </p>
                <VersionPanel className="px-1.5 py-0.5 text-[10px] pointer-coarse:text-[10px]" />
              </div>
              <CentroNotificaciones className="shrink-0" />
            </header>
          )}
          {/* Fase 3 (11/11/2026): las páginas no llevan título visible (dueño, 06/10: «perdemos mucho espacio vertical»);
              la región principal se nombra con la sección para el lector de pantalla. */}
          <main
            aria-label={seccionActual}
            className={`flex-1 min-w-0 p-3 sm:p-6 ${
              // Sin la barra superior, el contenido baja lo que ocupe la barra del sistema (notch).
              sinCabecera ? "pt-[calc(0.75rem+env(safe-area-inset-top))] sm:pt-[calc(1.5rem+env(safe-area-inset-top))] " : ""
            }${
              fixedHeight ? "overflow-x-hidden overflow-y-auto overscroll-contain min-h-0" : ""
            }`}
          >
            {/* El sidebar sobrevive a un fallo del contenido: el usuario puede navegar a otra sección. */}
            <RouteErrorBoundary>{children}</RouteErrorBoundary>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
