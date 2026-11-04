import { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { SuperAdminSidebar } from "@/components/SuperAdminSidebar";
import { RouteErrorBoundary } from "@/components/ErrorBoundary";
import { useIsCompactNav } from "@/hooks/use-mobile";
import { VersionPanel } from "@/components/panel/VersionPanel";

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
            <header className="lg:hidden h-[calc(3.5rem+env(safe-area-inset-top))] border-b border-destructive/20 bg-destructive/5 flex items-center gap-2 sm:gap-3 px-3 pt-[env(safe-area-inset-top)] sticky top-0 z-40 w-full shrink-0">
              <SidebarTrigger className="shrink-0 text-destructive hover:bg-destructive/10" />
              <span className="flex min-w-0 flex-1 items-center gap-2 text-base font-semibold text-destructive">
                <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="truncate">Super Admin</span>
              </span>
              {/* Versión y entorno también aquí: con el menú cerrado no se veían. */}
              <VersionPanel className="px-1.5 py-0.5 text-[10px] pointer-coarse:text-[10px] sm:px-2 sm:py-1 sm:text-[11px] sm:pointer-coarse:text-xs" />
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
