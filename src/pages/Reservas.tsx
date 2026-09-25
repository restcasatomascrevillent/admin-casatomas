import { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Settings } from "lucide-react";
import { FormularioReserva } from "@/components/reservas/FormularioReserva";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VistaHoy } from "@/components/reservas/VistaHoy";
import { ListaReservasAvanzada } from "@/components/reservas/ListaReservasAvanzada";
import { CalendarioOcupacion } from "@/components/reservas/CalendarioOcupacion";
import { PlanoEspacio2D } from "@/components/reservas/PlanoEspacio2D";
import { GestionBlacklist } from "@/components/reservas/GestionBlacklist";
import { ConfiguracionTurnos } from "@/components/reservas/ConfiguracionTurnos";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { useUserRole } from "@/hooks/useUserRole";
import { useSolicitudesPendientes } from "@/hooks/useSolicitudesPendientes";
import { resolverDeepLinkReservas, TABS_RESERVAS } from "@/lib/reservas/vistaUnificada";

export default function Reservas() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [openDialog, setOpenDialog] = useState(false);
  const [selectedEspacio, setSelectedEspacio] = useState<{ id: string; nombre: string } | null>(null);
  const [activeTab, setActiveTab] = useState<string>("hoy");
  const [tabsOverflow, setTabsOverflow] = useState(false);
  const tabsContainerRef = useRef<HTMLDivElement | null>(null);

  const { data: espacios } = useEspaciosReserva();
  const { role } = useUserRole();
  const isAdmin = role === "admin";
  // ÚNICA instancia en la página: el tab la usa para el contador y la lista
  // unificada para pintar las solicitudes (ver aviso de realtime en el hook).
  const solicitudesState = useSolicitudesPendientes();
  const { countPendientes } = solicitudesState;
  const listaRef = useRef<HTMLElement | null>(null);

  // Identidad estable mientras el diálogo está abierto: si se recreara en cada render,
  // el formulario reescribiría la fecha continuamente.
  const datosNuevaReserva = useMemo(() => ({ fecha: new Date() }), [openDialog]);

  // Leer parámetros de URL para controlar tab activo. `resolverDeepLinkReservas`
  // (src/lib/reservas/vistaUnificada.ts, sin tocar en el rediseño 2026-09-25)
  // sigue traduciendo los enlaces viejos: `?tab=solicitudes` o `?tab=reservas`
  // abren la pestaña "Lista" (antes "Reservas") con su filtro; `?tab=hoy`
  // (marcador de ANTES de la unificación del 2026-09-23) también cae en
  // "Lista" por ese mismo resolver — NO en la pestaña "Hoy" nueva del kanban,
  // que es un valor distinto que solo se alcanza por clic o por ser la
  // pestaña por defecto. No hacía falta enlazar la nueva "Hoy" por URL: es lo
  // primero que se ve al entrar en /reservas sin parámetros.
  const tabFromUrl = searchParams.get("tab");
  const destino = resolverDeepLinkReservas({
    tab: tabFromUrl,
    status: searchParams.get("status"),
    date: searchParams.get("date"),
  });
  const statusFromUrl = destino.status;
  const dateFromUrl = destino.date;
  const hayPresetLista = !!(statusFromUrl || dateFromUrl);

  useEffect(() => {
    if (!tabFromUrl) return;
    setActiveTab(destino.tab);
    // Normalizar la URL de una pestaña antigua sin perder los filtros.
    if (!(TABS_RESERVAS as readonly string[]).includes(tabFromUrl)) {
      const params: Record<string, string> = { tab: destino.tab };
      if (destino.status) params.status = destino.status;
      if (destino.date) params.date = destino.date;
      setSearchParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabFromUrl, destino.tab, destino.status, destino.date]);

  // Si se llega con un filtro preestablecido (campana, widget del dashboard),
  // lo que interesa es la lista, que está debajo de "Reservas de hoy".
  useEffect(() => {
    if (activeTab !== "reservas" || !hayPresetLista) return;
    const t = window.setTimeout(() => {
      listaRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }, 150);
    return () => window.clearTimeout(t);
  }, [activeTab, hayPresetLista, statusFromUrl, dateFromUrl]);

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
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        {/* Pestañas y acción principal en la MISMA línea (2026-09-25, petición
            del dueño): "Nueva Reserva" tenía su propia banda encima, que solo
            servía para alinear un botón a la derecha y se comía ~64px de alto
            (botón + separación). Ahora comparte fila con las pestañas —o con el
            desplegable, cuando estas no caben—, que miden lo mismo (40px), así
            que la fila queda alineada sin alto extra. Sin título de página: la
            pestaña "Reservas" del menú lateral ya dice dónde estás. */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* `min-w-0`: deja que las pestañas se midan contra el hueco que
              queda junto al botón — de eso vive `checkOverflow` para decidir si
              cambia al desplegable. Sin esto no encogerían nunca. */}
          <div className="flex-1 min-w-0">
            {/* Muy estrecho: selector desplegable */}
            <div className={tabsOverflow ? "block" : "sm:hidden"}>
              <Select value={activeTab} onValueChange={handleTabChange}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecciona vista" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hoy">Hoy</SelectItem>
                  <SelectItem value="reservas">
                    Lista{countPendientes > 0 ? ` (${countPendientes} solicitud${countPendientes === 1 ? "" : "es"})` : ""}
                  </SelectItem>
                  <SelectItem value="calendario">Calendario</SelectItem>
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
                <TabsTrigger value="reservas" className="flex-shrink-0 text-xs md:text-sm lg:text-base px-2 md:px-3 lg:px-4 gap-1">
                  Lista
                  {countPendientes > 0 && (
                    <span
                      className="inline-flex items-center justify-center h-5 min-w-[20px] px-1 text-[10px] font-bold bg-destructive text-destructive-foreground rounded-full"
                      aria-label={`${countPendientes} solicitud${countPendientes === 1 ? "" : "es"} sin resolver`}
                      title="Solicitudes del bot sin resolver"
                    >
                      {countPendientes}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="calendario" className="flex-shrink-0 text-xs md:text-sm lg:text-base px-2 md:px-3 lg:px-4">Calendario</TabsTrigger>
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
          </div>

          <Dialog open={openDialog} onOpenChange={setOpenDialog}>
            <DialogTrigger asChild>
              <Button className="shrink-0">
                <Plus className="mr-2 h-4 w-4" />
                Nueva Reserva
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Crear Nueva Reserva</DialogTitle>
              </DialogHeader>
              <FormularioReserva
                datosPreseleccionados={datosNuevaReserva}
                onSuccess={() => setOpenDialog(false)}
              />
            </DialogContent>
          </Dialog>
        </div>

        {/* "Hoy" (2026-09-25, petición del dueño): el kanban por espacios
            es la vista principal — lo primero que se ve al entrar en
            /reservas. Sin lista/tabla aquí a propósito: con el kanban
            delante, una tabla debajo solo duplicaba las mismas reservas. */}
        <TabsContent value="hoy" className="mt-6">
          <VistaHoy onEspacioClick={handleEspacioClick} />
        </TabsContent>

        {/* "Lista" (antes "Reservas", unificaba Hoy + Lista + Solicitudes):
            todas las reservas y solicitudes, de cualquier fecha —
            incluida la de hoy, con su propio filtro de fecha y el atajo
            "Hoy": no se oculta a propósito, así sigue pudiéndose buscar
            una reserva de hoy cancelada o un dato que el kanban no
            muestre. Las solicitudes del bot sin resolver (insignia roja)
            siguen viviendo aquí, mezcladas como filas "Solicitud". */}
        <TabsContent value="reservas" className="mt-6">
          <section ref={listaRef} aria-labelledby="titulo-todas-reservas" className="space-y-3 scroll-mt-4">
            <div>
              <h3 id="titulo-todas-reservas" className="text-lg sm:text-xl font-semibold">Todas las reservas y solicitudes</h3>
              <p className="text-muted-foreground text-xs sm:text-sm">
                Historial completo, de cualquier fecha. Las solicitudes que el asistente telefónico no pudo cerrar aparecen marcadas como «Solicitud» con su motivo.
              </p>
            </div>
            <ListaReservasAvanzada
              // `key`: si llega otro filtro por URL estando ya en la página
              // (p. ej. desde la campana), la lista se reinicia con él.
              key={`${statusFromUrl ?? ""}|${dateFromUrl ?? ""}`}
              onEspacioClick={handleEspacioClick}
              initialStatusFilter={statusFromUrl || undefined}
              initialDateFilter={dateFromUrl === "today" ? new Date() : undefined}
              solicitudesState={solicitudesState}
            />
          </section>
        </TabsContent>

        <TabsContent value="calendario" className="space-y-6 mt-6">
          <CalendarioOcupacion onEspacioClick={handleEspacioClick} />
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
    </DashboardLayout>
  );
}
