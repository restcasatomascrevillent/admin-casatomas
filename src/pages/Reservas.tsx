import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Settings } from "lucide-react";
import { FormularioReserva } from "@/components/reservas/FormularioReserva";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VistaHoy } from "@/components/reservas/VistaHoy";
import { ListaReservasAvanzada } from "@/components/reservas/ListaReservasAvanzada";
import { CalendarioOcupacion } from "@/components/reservas/CalendarioOcupacion";
import { PlanoEspacio2D } from "@/components/reservas/PlanoEspacio2D";
import { GestionBlacklist } from "@/components/reservas/GestionBlacklist";
import { GestionSolicitudes } from "@/components/reservas/GestionSolicitudes";
import { ConfiguracionTurnos } from "@/components/reservas/ConfiguracionTurnos";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { useUserRole } from "@/hooks/useUserRole";
import { useSolicitudesPendientes } from "@/hooks/useSolicitudesPendientes";

export default function Reservas() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [openDialog, setOpenDialog] = useState(false);
  const [selectedEspacio, setSelectedEspacio] = useState<{ id: string; nombre: string } | null>(null);
  const [activeTab, setActiveTab] = useState("hoy");
  const [tabsOverflow, setTabsOverflow] = useState(false);
  const tabsContainerRef = useRef<HTMLDivElement | null>(null);

  const { data: espacios } = useEspaciosReserva();
  const { role } = useUserRole();
  const isAdmin = role === "admin";
  const { countPendientes } = useSolicitudesPendientes();

  // Leer parámetros de URL para controlar tab activo
  const tabFromUrl = searchParams.get("tab");
  const statusFromUrl = searchParams.get("status");
  const dateFromUrl = searchParams.get("date");

  useEffect(() => {
    if (tabFromUrl) {
      setActiveTab(tabFromUrl);
    }
  }, [tabFromUrl]);

  useEffect(() => {
    const el = tabsContainerRef.current;
    if (!el) return;

    const checkOverflow = () => {
      // En móvil ya usamos el Select directamente.
      if (window.innerWidth < 640) {
        setTabsOverflow(false);
        return;
      }

      setTabsOverflow(el.scrollWidth > el.clientWidth + 4);
    };

    checkOverflow();

    const resizeObserver = new ResizeObserver(checkOverflow);
    resizeObserver.observe(el);

    const tabsList = el.firstElementChild;
    if (tabsList instanceof HTMLElement) {
      resizeObserver.observe(tabsList);
    }

    window.addEventListener("resize", checkOverflow);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", checkOverflow);
    };
  }, [isAdmin]);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    // Limpiar parámetros de URL cuando se cambia de tab manualmente
    setSearchParams({});
  };

  const handleEspacioClick = (espacioId: string) => {
    const espacio = espacios?.find((e) => e.id === espacioId);
    if (espacio) {
      setSelectedEspacio({ id: espacio.id, nombre: espacio.nombre });
    }
  };

  // Si hay un espacio seleccionado, mostrar el plano 2D
  if (selectedEspacio) {
    return (
      <DashboardLayout>
        <PlanoEspacio2D
          espacioId={selectedEspacio.id}
          espacioNombre={selectedEspacio.nombre}
          onBack={() => setSelectedEspacio(null)}
        />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Reservas</h2>
            <p className="text-muted-foreground text-sm sm:text-base">Gestiona las reservas del restaurante</p>
          </div>
          <Dialog open={openDialog} onOpenChange={setOpenDialog}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Nueva Reserva
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Crear Nueva Reserva</DialogTitle>
              </DialogHeader>
              <FormularioReserva
                onSuccess={() => {
                  setOpenDialog(false);
                  toast.success("Reserva creada correctamente");
                }}
              />
            </DialogContent>
          </Dialog>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          {/* Muy estrecho: selector desplegable */}
          <div className={`mb-3 ${tabsOverflow ? "block" : "sm:hidden"}`}>
            <Select value={activeTab} onValueChange={handleTabChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecciona vista" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hoy">Hoy</SelectItem>
                <SelectItem value="lista">Lista</SelectItem>
                <SelectItem value="calendario">Calendario</SelectItem>
                <SelectItem value="solicitudes">
                  Solicitudes{countPendientes > 0 ? ` (${countPendientes})` : ""}
                </SelectItem>
                <SelectItem value="blacklist">Blacklist</SelectItem>
                {isAdmin && <SelectItem value="configuracion">Configuración</SelectItem>}
              </SelectContent>
            </Select>
          </div>

          {/* Tablet/desktop: pestañas */}
          <div
            ref={tabsContainerRef}
            className={`hidden sm:block overflow-x-auto no-scrollbar ${
              tabsOverflow ? "sm:h-0 sm:overflow-hidden sm:opacity-0 sm:pointer-events-none" : ""
            }`}
          >
            <TabsList className="w-max min-w-max justify-start gap-1 p-1">
              <TabsTrigger value="hoy" className="flex-shrink-0 text-xs md:text-sm lg:text-base px-2 md:px-3 lg:px-4">Hoy</TabsTrigger>
              <TabsTrigger value="lista" className="flex-shrink-0 text-xs md:text-sm lg:text-base px-2 md:px-3 lg:px-4">Lista</TabsTrigger>
              <TabsTrigger value="calendario" className="flex-shrink-0 text-xs md:text-sm lg:text-base px-2 md:px-3 lg:px-4">Calendario</TabsTrigger>
              <TabsTrigger value="solicitudes" className="flex-shrink-0 text-xs md:text-sm lg:text-base px-2 md:px-3 lg:px-4 gap-1">
                Solicitudes
                {countPendientes > 0 && (
                  <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1 text-[10px] font-bold bg-destructive text-destructive-foreground rounded-full">
                    {countPendientes}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="blacklist" className="flex-shrink-0 text-xs md:text-sm lg:text-base px-2 md:px-3 lg:px-4">Blacklist</TabsTrigger>
              {isAdmin && (
                <TabsTrigger value="configuracion" className="gap-1 flex-shrink-0 text-xs md:text-sm lg:text-base px-2 md:px-3 lg:px-4">
                  <Settings className="h-4 w-4" />
                  <span className="hidden sm:inline">Configuración</span>
                  <span className="sm:hidden">Config</span>
                </TabsTrigger>
              )}
            </TabsList>
          </div>

          <TabsContent value="hoy" className="space-y-6 mt-6">
            <VistaHoy onEspacioClick={handleEspacioClick} />
          </TabsContent>

          <TabsContent value="lista" className="space-y-6 mt-6">
            <ListaReservasAvanzada 
              onEspacioClick={handleEspacioClick}
              initialStatusFilter={statusFromUrl || undefined}
              initialDateFilter={dateFromUrl === "today" ? new Date() : undefined}
            />
          </TabsContent>

          <TabsContent value="calendario" className="space-y-6 mt-6">
            <CalendarioOcupacion onEspacioClick={handleEspacioClick} />
          </TabsContent>

          <TabsContent value="solicitudes" className="space-y-6 mt-6">
            <GestionSolicitudes />
          </TabsContent>

          <TabsContent value="blacklist" className="space-y-6 mt-6">
            <GestionBlacklist />
          </TabsContent>

          {isAdmin && (
            <TabsContent value="configuracion" className="space-y-6 mt-6">
              <ConfiguracionTurnos />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
