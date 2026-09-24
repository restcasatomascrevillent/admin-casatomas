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
      <div className="min-h-screen flex w-full bg-background overflow-x-hidden">
        <SuperAdminSidebar />
        <div className="flex-1 flex flex-col overflow-x-hidden">
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
          <main className="flex-1 p-3 sm:p-6 overflow-x-hidden">
            <RouteErrorBoundary>{children}</RouteErrorBoundary>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
