import { useState, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { DashboardProvider } from "@/contexts/DashboardContext";
import { DashboardFilters } from "@/components/dashboard/DashboardFilters";
import { ResumenHorasMensuales } from "@/components/dashboard/widgets/ResumenHorasMensuales";
import { PersonasActivas } from "@/components/dashboard/widgets/PersonasActivas";
import { ReservasHoy } from "@/components/dashboard/widgets/ReservasHoy";
import { GraficoDistribucionHoras } from "@/components/dashboard/widgets/GraficoDistribucionHoras";
import { TopTrabajadores } from "@/components/dashboard/widgets/TopTrabajadores";
import { AlertasInteligentes } from "@/components/dashboard/widgets/AlertasInteligentes";
import { GraficoReservasPorDia } from "@/components/dashboard/widgets/GraficoReservasPorDia";
import { CurvaReservasPorHora } from "@/components/dashboard/widgets/CurvaReservasPorHora";
import { NoShowsCancelaciones } from "@/components/dashboard/widgets/NoShowsCancelaciones";
import { ResumenMarketing } from "@/components/dashboard/widgets/ResumenMarketing";
import { ResenasRecientes } from "@/components/dashboard/widgets/ResenasRecientes";
import { CampanasActivas } from "@/components/dashboard/widgets/CampanasActivas";
import { NoticiasHosteleria } from "@/components/dashboard/widgets/NoticiasHosteleria";
import { PersonalizarDashboard } from "@/components/dashboard/PersonalizarDashboard";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import { useDashboardConfig } from "@/hooks/useDashboardConfig";

const WIDGETS_DISPONIBLES = [
  { id: "alertas", nombre: "Alertas Inteligentes", component: AlertasInteligentes },
  { id: "horas-mensuales", nombre: "Horas Mensuales", component: ResumenHorasMensuales },
  { id: "personas-activas", nombre: "Personal Activo", component: PersonasActivas },
  { id: "reservas-hoy", nombre: "Reservas de Hoy", component: ReservasHoy },
  { id: "no-shows", nombre: "Cancelaciones", component: NoShowsCancelaciones },
  { id: "distribucion-horas", nombre: "Distribución de Horas", component: GraficoDistribucionHoras },
  { id: "top-trabajadores", nombre: "Top Trabajadores", component: TopTrabajadores },
  { id: "reservas-dia", nombre: "Gráfico Reservas por Día", component: GraficoReservasPorDia },
  { id: "reservas-hora", nombre: "Curva Reservas por Hora", component: CurvaReservasPorHora },
  { id: "resumen-marketing", nombre: "Resumen Marketing", component: ResumenMarketing },
  { id: "resenas", nombre: "Reseñas Recientes", component: ResenasRecientes },
  { id: "campanas", nombre: "Campañas Activas", component: CampanasActivas },
  { id: "noticias", nombre: "Noticias del Sector", component: NoticiasHosteleria },
];

const DEFAULT_ACTIVOS = [
  "alertas",
  "horas-mensuales",
  "personas-activas",
  "reservas-hoy",
  "no-shows",
  "distribucion-horas",
  "top-trabajadores",
  "resumen-marketing",
  "resenas",
  "campanas",
  "noticias",
];

const DEFAULT_ORDEN = [
  "alertas",
  "horas-mensuales",
  "personas-activas",
  "reservas-hoy",
  "no-shows",
  "distribucion-horas",
  "top-trabajadores",
  "reservas-dia",
  "reservas-hora",
  "resumen-marketing",
  "resenas",
  "campanas",
  "noticias",
];

export default function Dashboard() {
  const [personalizarOpen, setPersonalizarOpen] = useState(false);
  const { activeConfig } = useDashboardConfig();
  
  const [widgetsActivos, setWidgetsActivos] = useState<string[]>(
    Array.isArray(activeConfig?.widgets_activos) 
      ? (activeConfig.widgets_activos as string[]) 
      : DEFAULT_ACTIVOS
  );
  const [ordenWidgets, setOrdenWidgets] = useState<string[]>(
    Array.isArray(activeConfig?.orden_widgets) 
      ? (activeConfig.orden_widgets as string[]) 
      : DEFAULT_ORDEN
  );

  const widgetsOrdenados = useMemo(() => {
    return ordenWidgets
      .filter((id) => widgetsActivos.includes(id))
      .map((id) => WIDGETS_DISPONIBLES.find((w) => w.id === id))
      .filter(Boolean);
  }, [ordenWidgets, widgetsActivos]);

  const handleSaveConfig = (activos: string[], orden: string[]) => {
    setWidgetsActivos(activos);
    setOrdenWidgets(orden);
  };

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
            <Button variant="outline" size="sm" onClick={() => setPersonalizarOpen(true)}>
              <Settings className="h-4 w-4 mr-2" />
              Personalizar Dashboard
            </Button>
          </div>

          <DashboardFilters />

          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
            {widgetsOrdenados.map((widget) => {
              if (!widget) return null;
              const WidgetComponent = widget.component;
              return <WidgetComponent key={widget.id} />;
            })}
          </div>
        </div>

        <PersonalizarDashboard
          open={personalizarOpen}
          onOpenChange={setPersonalizarOpen}
          widgetsDisponibles={WIDGETS_DISPONIBLES}
          widgetsActivos={widgetsActivos}
          ordenWidgets={ordenWidgets}
          onSave={handleSaveConfig}
        />
      </DashboardLayout>
    </DashboardProvider>
  );
}
