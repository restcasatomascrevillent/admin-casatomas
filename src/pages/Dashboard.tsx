import { DashboardLayout } from "@/components/DashboardLayout";
import { DashboardFilters } from "@/components/dashboard/DashboardFilters";
import { DashboardProvider } from "@/contexts/DashboardContext";

import { ReservasHoy } from "@/components/dashboard/widgets/ReservasHoy";
import { GraficoReservasPorDia } from "@/components/dashboard/widgets/GraficoReservasPorDia";
import { CurvaReservasPorHora } from "@/components/dashboard/widgets/CurvaReservasPorHora";
import { PersonasActivas } from "@/components/dashboard/widgets/PersonasActivas";
import { ResenasRecientes } from "@/components/dashboard/widgets/ResenasRecientes";
import { NoticiasHosteleria } from "@/components/dashboard/widgets/NoticiasHosteleria";

export default function Dashboard() {
  return (
    <DashboardProvider>
      <DashboardLayout>
        <div className="space-y-6">
          <DashboardFilters />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <ReservasHoy />
            <PersonasActivas />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <GraficoReservasPorDia />
            <CurvaReservasPorHora />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ResenasRecientes />
            <NoticiasHosteleria />
          </div>
        </div>
      </DashboardLayout>
    </DashboardProvider>
  );
}
