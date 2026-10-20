import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { DashboardProvider } from "@/contexts/DashboardContext";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";

import { ReservasHoy } from "@/components/dashboard/widgets/ReservasHoy";
import { GraficoReservasPorDia } from "@/components/dashboard/widgets/GraficoReservasPorDia";
import { CurvaReservasPorHora } from "@/components/dashboard/widgets/CurvaReservasPorHora";

/**
 * ALTO DE LA PANTALLA (06/10/2026, regla del dueño para todo el panel: «que no haya scroll vertical: el alto de
 * la página es el alto de la pantalla del dispositivo»). Mismo mecanismo que Hoy, Calendario, «Próximas reservas»
 * y la Newsletter (`useAlturaDisponible`: alto del viewport visual − posición del bloque − relleno inferior del
 * <main>, recalculado al redimensionar, girar la tablet o plegar el menú). El Dashboard mide justo eso y lo reparte:
 * «Reservas de Hoy» arriba, compacta y con su alto natural; las dos gráficas debajo se quedan con lo que sobra
 * (lado a lado desde `lg`, una encima de otra en la tablet vertical). Ni la página ni los widgets hacen scroll.
 * Antes la página usaba `fixedHeight` (el <main> hacía de barra de scroll) y la tarjeta de reservas medía 446 px:
 * a 1280×711 (la ventana del dueño, a 150 %) las gráficas se salían 147 px por abajo.
 *
 * Los widgets se reparten el sitio que haya (flex): si un día alguno no se pinta, el resto ocupa su hueco (sin las
 * gráficas, «Reservas de Hoy» llega hasta abajo con `only:flex-1`). Hoy no hay permisos por widget: quien entra en el
 * Dashboard (permiso «dashboard») ve los tres.
 *
 * SUELO (px): por debajo el bloque no encoge más y, solo entonces, la página hace scroll. 480 = «Reservas de Hoy»
 * (≈ 250 px desde `lg`) + una fila de gráficas de ≈ 210 px; equivale a una ventana de ≈ 530 px de alto. Las
 * gráficas tienen además su propio mínimo (`GraficoReservasPorDia`): en la tablet vertical, una encima de otra,
 * el contenido no baja de ≈ 720 px.
 */
export const ALTURA_MINIMA_DASHBOARD = 480;

export default function Dashboard() {
  // Sin medida (jsdom, primer pintado sin layout) cae al layout de siempre: cada widget con su alto natural.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_DASHBOARD);
  const medida = alto !== null;

  return (
    <DashboardProvider>
      <DashboardLayout>
        <div
          ref={setRaiz}
          data-testid="dashboard"
          data-altura-fija={medida ? String(alto) : undefined}
          className="flex min-w-0 flex-col gap-3 sm:gap-4"
          style={medida ? { height: alto } : undefined}
        >
          {/* El widget "Personas Activas" (personal en turno) se retiró junto con
              la sección Personal el 2026-09-23; ReservasHoy pasa a ocupar toda la fila. */}
          <div data-testid="dashboard-reservas" className="min-h-0 flex-none only:flex-1">
            <ReservasHoy />
          </div>

          <div data-testid="dashboard-graficas" className="flex min-h-0 flex-1 flex-col gap-3 sm:gap-4 lg:flex-row">
            <div className="min-h-0 min-w-0 flex-1">
              <GraficoReservasPorDia />
            </div>
            <div className="min-h-0 min-w-0 flex-1">
              <CurvaReservasPorHora />
            </div>
          </div>
        </div>
      </DashboardLayout>
    </DashboardProvider>
  );
}
