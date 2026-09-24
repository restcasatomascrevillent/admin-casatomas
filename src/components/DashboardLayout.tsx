import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { CentroNotificaciones } from "@/components/notificaciones/CentroNotificaciones";
import { RouteErrorBoundary } from "@/components/ErrorBoundary";

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
        className={`flex w-full bg-background overflow-x-hidden ${
          fixedHeight ? "h-screen overflow-hidden" : "min-h-screen"
        }`}
      >
        <AppSidebar />
        <div
          className={`flex-1 flex flex-col overflow-x-hidden ${
            fixedHeight ? "h-screen overflow-hidden" : ""
          }`}
        >
          <header className="h-14 sm:h-16 border-b border-border bg-card flex items-center px-3 sm:px-6 sticky top-0 z-50 w-full shrink-0">
            <SidebarTrigger className="mr-2 sm:mr-4 shrink-0" />
            <div className="flex items-center justify-between w-full min-w-0">
              <div className="min-w-0">
                <h1 className="text-base sm:text-xl font-semibold text-foreground truncate">Gestión del Restaurante</h1>
                <p className="text-xs sm:text-sm text-muted-foreground truncate">
                  {new Date().toLocaleDateString("es-ES", {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
              </div>
              <div className="shrink-0 ml-2">
                <CentroNotificaciones />
              </div>
            </div>
          </header>
          <main
            className={`flex-1 p-3 sm:p-6 overflow-x-hidden ${
              fixedHeight ? "overflow-y-auto min-h-0" : ""
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
