import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { CentroNotificaciones } from "@/components/notificaciones/CentroNotificaciones";
import { RouteErrorBoundary } from "@/components/ErrorBoundary";
import { format } from "date-fns";
import { es } from "date-fns/locale";

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
  return (
    <SidebarProvider>
      <div
        className={`flex w-full bg-background ${
          fixedHeight ? "h-screen overflow-hidden" : "min-h-screen"
        }`}
      >
        <AppSidebar />
        <div
          className={`flex-1 flex flex-col min-w-0 ${
            fixedHeight ? "h-screen overflow-hidden" : ""
          }`}
        >
          {/* Cabecera única (2026-09-25): antes había dos franjas — esta con
              "Gestión del Restaurante" + fecha, y debajo el título de cada
              página, a veces repitiendo la fecha otra vez (p.ej. la tarjeta
              del día en Reservas). Se funden en una sola franja compacta con
              lo imprescindible: plegar menú, la ÚNICA fecha del panel y la
              campana. "Gestión del Restaurante" no vuelve — ya lo dice el
              propio sidebar (SidebarHeader en AppSidebar.tsx) — y el título
              de cada página ya lo dice la pestaña activa del menú lateral. */}
          <header className="h-12 sm:h-14 border-b border-border bg-card flex items-center gap-2 sm:gap-4 px-3 sm:px-6 sticky top-0 z-50 w-full shrink-0">
            <SidebarTrigger className="shrink-0" />
            <p className="flex-1 min-w-0 truncate text-sm sm:text-base font-medium text-foreground">
              {format(new Date(), "EEEE, d 'de' MMMM", { locale: es })}
            </p>
            <div className="shrink-0">
              <CentroNotificaciones />
            </div>
          </header>
          <main
            className={`flex-1 min-w-0 p-3 sm:p-6 ${
              fixedHeight ? "overflow-x-hidden overflow-y-auto min-h-0" : ""
            }`}
          >
            {/* El sidebar y la cabecera sobreviven a un fallo del contenido: el usuario puede navegar a otra sección. */}
            <RouteErrorBoundary>{children}</RouteErrorBoundary>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
