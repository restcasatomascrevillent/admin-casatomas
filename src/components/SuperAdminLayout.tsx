import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { SuperAdminSidebar } from "@/components/SuperAdminSidebar";
import { RouteErrorBoundary } from "@/components/ErrorBoundary";
import { ShieldAlert } from "lucide-react";

interface SuperAdminLayoutProps {
  children: ReactNode;
}

export function SuperAdminLayout({ children }: SuperAdminLayoutProps) {
  return (
    <SidebarProvider>
      {/* Sin `overflow-x-hidden` aquí ni en el div de abajo (2026-09-25):
          fijaba overflow-x sin fijar overflow-y, así que el navegador
          calculaba `overflow-y: auto` implícito y convertía a este div (y a
          <main>) en el "contenedor de scroll" de referencia para cualquier
          `position: sticky` de dentro — que nunca desborda de verdad (crece
          con la página), así que el sticky no llegaba a quedarse pegado
          nunca. Mismo bug y mismo arreglo que en DashboardLayout.tsx: quitar
          el overflow accidental y usar `min-w-0` (no `overflow-x-hidden`)
          para que los hijos flex sigan sin forzar scroll horizontal.
          `min-h-app` (index.css, 100dvh) y no `min-h-screen` (100vh), como en
          DashboardLayout (2026-10-07, regla «el alto de la página es el de la
          pantalla»): en iPad/Android `100vh` incluye la barra del navegador y
          dejaba esa franja de scroll de página aunque el contenido cupiera.
          Cada página mide su propio alto con `useAlturaDisponible`. */}
      <div className="min-h-app flex w-full bg-background">
        <SuperAdminSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 sm:h-16 border-b border-border bg-card flex items-center px-3 sm:px-6 sticky top-0 z-50 w-full">
            <SidebarTrigger className="mr-2 sm:mr-4 shrink-0" />
            <div className="flex items-center gap-2 min-w-0">
              <ShieldAlert className="h-5 w-5 text-destructive shrink-0" />
              <div className="min-w-0">
                <h1 className="text-base sm:text-xl font-semibold text-foreground truncate">Super Admin</h1>
                <p className="text-xs sm:text-sm text-muted-foreground truncate">
                  Área restringida de control del sistema
                </p>
              </div>
            </div>
          </header>
          <main className="flex-1 min-w-0 p-3 sm:p-6">
            <RouteErrorBoundary>{children}</RouteErrorBoundary>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
