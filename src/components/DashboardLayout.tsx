import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { CentroNotificaciones } from "@/components/notificaciones/CentroNotificaciones";
import { RouteErrorBoundary } from "@/components/ErrorBoundary";
import { useIsCompactNav } from "@/hooks/use-mobile";
import { NavAutoCollapse, defaultSidebarOpen } from "@/components/NavAutoCollapse";
import { PrecargaRecorte } from "@/components/carta/recorte/PrecargaRecorte";

interface DashboardLayoutProps {
  children: ReactNode;
  /** Cuando es true, la página encaja en el alto de la pantalla sin scroll
   * horizontal ni scroll de la página completa (el sidebar y la cabecera
   * quedan siempre visibles). Si el contenido no cabe en pantallas más
   * pequeñas, el área de contenido hace scroll vertical por sí sola para
   * que nunca se oculte información. */
  fixedHeight?: boolean;
}

export function DashboardLayout({ children, fixedHeight = false }: DashboardLayoutProps) {
  // Por debajo de 1024px (`useIsCompactNav`: iPad vertical 768/810/820, Android
  // 800, teléfonos) el menú lateral se renderiza como panel deslizante (Sheet)
  // y SOLO se puede abrir desde fuera de él: sin esta barra no habría manera de
  // navegar. Por eso el mismo flag decide dónde vive la campana — así solo hay
  // UNA instancia montada en todo momento (dos suscripciones realtime al mismo
  // canal sobraban; ReservasHoy también lo consulta para no duplicarla).
  // A partir de 1024px el menú es fijo: desplegado desde 1280px y plegado a
  // iconos entre 1024 y 1279 (iPad Air apaisado, iPad Pro vertical).
  const isCompactNav = useIsCompactNav();

  return (
    <SidebarProvider defaultOpen={defaultSidebarOpen()}>
      <NavAutoCollapse />
      {/* Baja en segundo plano el modelo del recorte de fotos de la carta. */}
      <PrecargaRecorte />
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
              abrirlo. 56px de alto con botones de 44px; respeta el notch. */}
          {isCompactNav && (
            <header className="lg:hidden h-[calc(3.5rem+env(safe-area-inset-top))] border-b border-border bg-card flex items-center justify-between gap-2 px-3 pt-[env(safe-area-inset-top)] sticky top-0 z-40 w-full shrink-0">
              <SidebarTrigger className="shrink-0" />
              <CentroNotificaciones className="shrink-0" />
            </header>
          )}
          <main
            className={`flex-1 min-w-0 p-3 sm:p-6 ${
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
