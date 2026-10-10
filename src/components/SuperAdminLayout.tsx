import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { SuperAdminSidebar } from "@/components/SuperAdminSidebar";
import { RouteErrorBoundary } from "@/components/ErrorBoundary";
import { useIsCompactNav } from "@/hooks/use-mobile";

interface SuperAdminLayoutProps {
  children: ReactNode;
}

export function SuperAdminLayout({ children }: SuperAdminLayoutProps) {
  // Mismo umbral que el sidebar (`ui/sidebar.tsx`): por debajo de 1024px el
  // menú es un panel deslizante y necesita el botón de fuera para abrirse.
  const isCompactNav = useIsCompactNav();

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
          {/* Sin cabecera en escritorio (2026-10-09, petición del dueño, "para
              tener más hueco"): la franja "Super Admin · Área restringida de
              control del sistema" repetía lo que ya dice el sidebar y se comía
              64px de alto en todas las páginas. El plegador del menú se muda a
              la cabecera del sidebar (SuperAdminSidebar.tsx), como en
              DashboardLayout. En tablet vertical / móvil (< 1024px) queda una
              barra mínima: el sidebar es un Sheet y no hay otra forma de
              abrirlo. */}
          {isCompactNav && (
            <header className="lg:hidden h-[calc(3.5rem+env(safe-area-inset-top))] border-b border-border bg-card flex items-center gap-2 px-3 pt-[env(safe-area-inset-top)] sticky top-0 z-40 w-full shrink-0">
              <SidebarTrigger className="shrink-0" />
            </header>
          )}
          <main className="flex-1 min-w-0 p-3 sm:p-6">
            <RouteErrorBoundary>{children}</RouteErrorBoundary>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
