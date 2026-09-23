import { DashboardLayout } from "@/components/DashboardLayout";
import { DashboardProvider } from "@/contexts/DashboardContext";

import { ReservasHoy } from "@/components/dashboard/widgets/ReservasHoy";
import { GraficoReservasPorDia } from "@/components/dashboard/widgets/GraficoReservasPorDia";
import { CurvaReservasPorHora } from "@/components/dashboard/widgets/CurvaReservasPorHora";
import { ResenasRecientes } from "@/components/dashboard/widgets/ResenasRecientes";

export default function Dashboard() {
  return (
    <DashboardProvider>
      <DashboardLayout>
        <div className="space-y-4 sm:space-y-6">
          {/* El widget "Personas Activas" (personal en turno) se retiró junto con
              la sección Personal el 2026-09-23; ReservasHoy pasa a ocupar toda la fila. */}
          <ReservasHoy />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <GraficoReservasPorDia />
            <CurvaReservasPorHora />
          </div>

          {/* Reseñas ocupaba media fila junto al widget de Noticias del Sector.
              Eliminada la funcionalidad de noticias, se deja a ancho completo
              en vez de dejar la columna derecha vacía. */}
          <ResenasRecientes />
        </div>
      </DashboardLayout>
    </DashboardProvider>
  );
}
