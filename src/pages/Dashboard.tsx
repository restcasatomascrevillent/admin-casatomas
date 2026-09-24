import { DashboardLayout } from "@/components/DashboardLayout";
import { DashboardProvider } from "@/contexts/DashboardContext";

import { ReservasHoy } from "@/components/dashboard/widgets/ReservasHoy";
import { GraficoReservasPorDia } from "@/components/dashboard/widgets/GraficoReservasPorDia";
import { CurvaReservasPorHora } from "@/components/dashboard/widgets/CurvaReservasPorHora";

export default function Dashboard() {
  return (
    <DashboardProvider>
      <DashboardLayout fixedHeight>
        <div className="h-full flex flex-col gap-4 sm:gap-6 overflow-hidden">
          {/* El widget "Personas Activas" (personal en turno) se retiró junto con
              la sección Personal el 2026-09-23; ReservasHoy pasa a ocupar toda la fila. */}
          <ReservasHoy />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0 overflow-hidden">
            <GraficoReservasPorDia />
            <CurvaReservasPorHora />
          </div>
        </div>
      </DashboardLayout>
    </DashboardProvider>
  );
}
