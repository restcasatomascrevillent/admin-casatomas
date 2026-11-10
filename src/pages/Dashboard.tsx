import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { DashboardProvider } from "@/contexts/DashboardContext";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useIsBelow } from "@/hooks/use-mobile";
import { usePermisosFacturas } from "@/hooks/usePermisosFacturas";

import { ReservasHoy } from "@/components/dashboard/widgets/ReservasHoy";
import { CurvaReservasPorHora } from "@/components/dashboard/widgets/CurvaReservasPorHora";
import { MargenesPrecio } from "@/components/dashboard/widgets/MargenesPrecio";
import { AvisosDashboard } from "@/components/dashboard/widgets/AvisosDashboard";

/**
 * ALTO DE LA PANTALLA (06/10/2026, regla del dueño para todo el panel: «que no haya scroll vertical: el alto de
 * la página es el alto de la pantalla del dispositivo»). Mismo mecanismo que Hoy, Calendario, «Próximas reservas»
 * y la Newsletter (`useAlturaDisponible`: alto del viewport visual − posición del bloque − relleno inferior del
 * <main>, recalculado al redimensionar, girar la tablet o plegar el menú). El Dashboard mide justo eso y lo reparte:
 * «Reservas de Hoy» arriba, compacta y con su alto natural; los módulos de debajo se quedan con lo que sobra.
 *
 * MÓDULOS (10/11/2026, petición del dueño: «quitar una de las gráficas de reservas y añadir dos módulos, uno de
 * márgenes de precio y otro de avisos»): fuera «Reservas por día» (se queda la curva por hora) y entran
 * «Márgenes de precio» (solo quien consulta Facturas: enseña lo que cuesta comprar) y «Avisos» (cada aviso solo a
 * quien ve su sección). Desde `lg`, los tres lado a lado; en la tablet vertical, la curva arriba y los otros dos
 * debajo; en el móvil, uno encima de otro.
 *
 * Los widgets se reparten el sitio que haya (flex): si alguno no se pinta, el resto ocupa su hueco.
 *
 * SUELO (px): por debajo el bloque no encoge más y, solo entonces, la página hace scroll. Escritorio: 480 =
 * «Reservas de Hoy» (≈ 250 px desde `lg`) + una fila de módulos de ≈ 210 px. Con los módulos apilados (tablet
 * vertical y móvil) no caben en una pantalla sin que se dejen de leer: el suelo sube y la página hace scroll.
 */
export const ALTURA_MINIMA_DASHBOARD = 480;
/** Tablet vertical (768–1023 px): la curva en una fila y los otros dos módulos en otra. */
export const ALTURA_MINIMA_DASHBOARD_TABLET = 820;
/** Móvil (< 768 px): los tres módulos uno encima de otro. */
export const ALTURA_MINIMA_DASHBOARD_MOVIL = 1100;

export default function Dashboard() {
  // Sin medida (jsdom, primer pintado sin layout) cae al layout de siempre: cada widget con su alto natural.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const movil = useIsBelow(768);
  const tablet = useIsBelow(1024);
  const minimo = movil ? ALTURA_MINIMA_DASHBOARD_MOVIL : tablet ? ALTURA_MINIMA_DASHBOARD_TABLET : ALTURA_MINIMA_DASHBOARD;
  const alto = useAlturaDisponible(raiz, minimo);
  const medida = alto !== null;
  // «Márgenes de precio» enseña precios de compra: solo para quien consulta Facturas («Ver» o «Editar»).
  const facturas = usePermisosFacturas();
  const conMargenes = !facturas.cargando && facturas.consultar;

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

          <div
            data-testid="dashboard-modulos"
            className="flex min-h-0 flex-1 flex-col gap-3 sm:gap-4 md:flex-row md:flex-wrap lg:flex-nowrap"
          >
            <div data-testid="modulo-curva" className="min-h-0 min-w-0 flex-1 md:basis-full lg:basis-0">
              <CurvaReservasPorHora />
            </div>
            {conMargenes && (
              <div data-testid="modulo-margenes" className="min-h-0 min-w-0 flex-1 md:basis-0">
                <MargenesPrecio />
              </div>
            )}
            <div data-testid="modulo-avisos" className="min-h-0 min-w-0 flex-1 md:basis-0">
              <AvisosDashboard />
            </div>
          </div>
        </div>
      </DashboardLayout>
    </DashboardProvider>
  );
}
