import { DashboardLayout } from "@/components/DashboardLayout";
import { DashboardProvider } from "@/contexts/DashboardContext";

import { ReservasHoy } from "@/components/dashboard/widgets/ReservasHoy";
import { GraficoReservasPorDia } from "@/components/dashboard/widgets/GraficoReservasPorDia";
import { CurvaReservasPorHora } from "@/components/dashboard/widgets/CurvaReservasPorHora";
import { PersonasActivas } from "@/components/dashboard/widgets/PersonasActivas";
import { ResenasRecientes } from "@/components/dashboard/widgets/ResenasRecientes";

export default function Dashboard() {
  return (
    <DashboardProvider>
      <DashboardLayout>
        <div className="space-y-4 sm:space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <ReservasHoy />
            </div>
            <PersonasActivas />
          </div>

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
