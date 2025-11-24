import { DashboardLayout } from "@/components/DashboardLayout";
import { DashboardProvider } from "@/contexts/DashboardContext";
import { DashboardFilters } from "@/components/dashboard/DashboardFilters";
import { ResumenHorasMensuales } from "@/components/dashboard/widgets/ResumenHorasMensuales";
import { PersonasActivas } from "@/components/dashboard/widgets/PersonasActivas";
import { ReservasHoy } from "@/components/dashboard/widgets/ReservasHoy";
import { GraficoDistribucionHoras } from "@/components/dashboard/widgets/GraficoDistribucionHoras";
import { TopTrabajadores } from "@/components/dashboard/widgets/TopTrabajadores";
import { AlertasInteligentes } from "@/components/dashboard/widgets/AlertasInteligentes";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";

export default function Dashboard() {
  return (
    <DashboardProvider>
      <DashboardLayout>
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h2>
              <p className="text-muted-foreground">
                Vista general de la gestión del restaurante
              </p>
            </div>
            <Button variant="outline" size="sm">
              <Settings className="h-4 w-4 mr-2" />
              Personalizar Dashboard
            </Button>
          </div>

          <DashboardFilters />

          <AlertasInteligentes />

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <ResumenHorasMensuales />
            <PersonasActivas />
            <ReservasHoy />
            <div className="bg-card border border-border rounded-lg p-6 flex items-center justify-center text-muted-foreground">
              Próximamente: Más widgets
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <GraficoDistribucionHoras />
            <TopTrabajadores />
          </div>
        </div>
      </DashboardLayout>
    </DashboardProvider>
  );
}
