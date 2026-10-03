import { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Settings } from "lucide-react";
import { FormularioReserva } from "@/components/reservas/FormularioReserva";
import { ConMotivo } from "@/components/reservas/ConMotivo";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VistaHoy } from "@/components/reservas/VistaHoy";
import { ListaReservasAvanzada } from "@/components/reservas/ListaReservasAvanzada";
import { CalendarioOcupacion } from "@/components/reservas/CalendarioOcupacion";
import { PlanoEspacio2D } from "@/components/reservas/PlanoEspacio2D";
import { ModoServicioPlano } from "@/components/reservas/servicio/ModoServicioPlano";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LayoutGrid, Utensils } from "lucide-react";
import { GestionBlacklist } from "@/components/reservas/GestionBlacklist";
import { ConfiguracionTurnos } from "@/components/reservas/ConfiguracionTurnos";
import { PanelAsignacion } from "@/components/reservas/PanelAsignacion";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { useCanAccessSection, useUserRole } from "@/hooks/useUserRole";
import { useEdicionReserva } from "@/hooks/useEdicionReserva";
import { useSolicitudesPendientes } from "@/hooks/useSolicitudesPendientes";
import { contarSolicitudesPendientes, resolverDeepLinkReservas, TABS_RESERVAS } from "@/lib/reservas/vistaUnificada";
import type { DestinoAsignacion } from "@/lib/reservas/saltoAsignacion";
import { toast } from "sonner";

/** Por qué «Nueva Reserva» sale deshabilitado (se ve al pasar el ratón). */
const MOTIVO_SIN_PERMISO_ALTA = "Necesitas permiso de edición en Reservas para crear reservas";

export default function Reservas() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [openDialog, setOpenDialog] = useState(false);
  const [selectedEspacio, setSelectedEspacio] = useState<{ id: string; nombre: string } | null>(null);
  // Dentro de una sala: "plano" es el editor/asignación de siempre
  // (PlanoEspacio2D); "servicio" es la vista en vivo del modo servicio
  // (Fase 4). Se resetea a "plano" cada vez que se entra en una sala nueva,
  // para no dejar a alguien en modo servicio de la sala anterior sin darse
  // cuenta.
  const [vistaEspacio, setVistaEspacio] = useState<"plano" | "servicio">("plano");
  // Salto "ir a darle mesa a ESTA reserva" (2026-09-28, petición del dueño).
  // Hasta ahora el plano solo se abría POR SALA —Hoy, Ocupación y calendario
  // pasan un `espacioId` y nada más—, así que para sentar una reserva concreta
  // había que deducir su sala, abrirla y buscarla dentro. Esto guarda el día y
  // la reserva del salto para pasárselos al plano; `null` = se entró por sala,
  // como siempre. Ver `src/lib/reservas/saltoAsignacion.ts`.
  const [saltoAsignacion, setSaltoAsignacion] = useState<Omit<DestinoAsignacion, "espacioId"> | null>(null);
  const [activeTab, setActiveTab] = useState<string>("hoy");

  const { data: espacios } = useEspaciosReserva();
  const { role } = useUserRole();
  const isAdmin = role === "admin";
  // Editar una reserva (2026-09-30). El diálogo vive aquí y se lo pasa a «Hoy»
  // (las pastillas de «Pendientes de mesa»); el resto de vistas de reservas
  // (Lista, Kanban, Asignación, plano, modo servicio…) llevan cada una el suyo.
  const { canAccess: puedeEditarReservas } = useCanAccessSection("reservas", "edit");
  const { editarReserva, dialogoEdicion } = useEdicionReserva();
  // ÚNICA instancia en la página: el tab la usa para el contador y la lista
  // unificada para pintar las solicitudes (ver aviso de realtime en el hook).
  const solicitudesState = useSolicitudesPendientes();
  // La insignia cuenta lo mismo que enseña la lista: solo solicitudes de Casa
  // Tomás (Touza no admite reservas, decisión del dueño 2026-10-01).
  const countPendientes = useMemo(
    () => contarSolicitudesPendientes(solicitudesState.solicitudes),
    [solicitudesState.solicitudes],
  );
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

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    // Limpiar parámetros de URL cuando se cambia de tab manualmente
    setSearchParams({});
  };

  const handleEspacioClick = (espacioId: string) => {
    const espacio = espacios?.find((e) => e.id === espacioId);
    if (espacio) {
      setVistaEspacio("plano");
      // Entrada POR SALA: se limpia el salto por si se venía de uno, para no
      // arrastrar una reserva señalada que aquí no viene a cuento.
      setSaltoAsignacion(null);
      setSelectedEspacio({ id: espacio.id, nombre: espacio.nombre });
    }
  };

  /**
   * Entrada POR RESERVA: abre el plano de SU sala, en SU día y con ella ya
   * señalada, lista para sentarla. Lo usan la pestaña "Lista"
   * (`ListaReservasAvanzada`) y la franja de pendientes de "Hoy" (`VistaHoy`).
   *
   * El destino lo decide `resolverSaltoAsignacion`, que ya ha descartado las
   * reservas sin sala (su botón llega aquí deshabilitado y explicando por qué),
   * así que aquí solo queda traducir el `espacioId` a la sala y montar la
   * pantalla. Se fuerza la vista "plano": el modo servicio es para mirar el
   * estado en vivo, no para repartir mesas.
   */
  const handleAsignarMesa = ({ espacioId, fecha, reservaId, turno }: DestinoAsignacion) => {
    const espacio = espacios?.find((e) => e.id === espacioId);
    if (!espacio) {
      // La sala existía cuando se pintó la fila y ya no está (borrada o
      // desactivada desde otra pantalla). Mejor decirlo que no hacer nada al
      // pulsar, que es lo que parecería un botón roto.
      toast.info("Esa sala ya no está disponible", {
        description: "Puede que la hayan borrado o desactivado. Recarga la pantalla para ver las salas al día.",
      });
      return;
    }
    setVistaEspacio("plano");
    setSaltoAsignacion({ fecha, reservaId, turno });
    setSelectedEspacio({ id: espacio.id, nombre: espacio.nombre });
  };

  /** Cierra el plano/modo servicio y deshace el salto, si lo hubo. */
  const volverDeEspacio = () => {
    setSelectedEspacio(null);
    setSaltoAsignacion(null);
  };

  // Si hay un espacio seleccionado, mostrar el plano 2D o el modo servicio
  // (Fase 4) según el toggle. El propio componente de servicio ya trae su
  // botón "Volver" (le pasamos el mismo `onBack`); el toggle se enseña
  // encima de los dos para poder cambiar de vista sin salir de la sala.
  if (selectedEspacio) {
    return (
      <DashboardLayout>
        <div className="mb-3 flex justify-end">
          <ToggleGroup
            type="single"
            value={vistaEspacio}
            onValueChange={(v) => v && setVistaEspacio(v as "plano" | "servicio")}
            className="rounded-md border p-1"
          >
            <ToggleGroupItem value="plano" className="h-10 gap-1.5 px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
              <LayoutGrid className="h-4 w-4" /> Plano
            </ToggleGroupItem>
            <ToggleGroupItem value="servicio" className="h-10 gap-1.5 px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
              <Utensils className="h-4 w-4" /> Servicio
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {vistaEspacio === "servicio" ? (
          <ModoServicioPlano
            espacioId={selectedEspacio.id}
            espacioNombre={selectedEspacio.nombre}
            onBack={volverDeEspacio}
          />
        ) : (
          /* `fecha`, `turno` y `reservaId` solo llegan cuando se ha entrado POR
             RESERVA. Sin salto van `undefined` y el plano se comporta igual que
             siempre: lee `?fecha=` de la URL (por donde entra el calendario) o
             abre en hoy, con el turno del reloj.

             Los tres se pasan AL MONTAR a propósito: el plano los lee en su
             primer render. Dejar que el turno lo dedujera él después de cargar
             las reservas no funcionaba (medido en el navegador el 2026-09-28:
             la URL se quedaba en `turno=cena` pero el panel seguía en comida y
             la reserva a sentar no salía). Ver `saltoAsignacion.ts`. */
          <PlanoEspacio2D
            espacioId={selectedEspacio.id}
            espacioNombre={selectedEspacio.nombre}
            onBack={volverDeEspacio}
            fecha={saltoAsignacion?.fecha}
            turno={saltoAsignacion?.turno}
            reservaId={saltoAsignacion?.reservaId}
          />
        )}
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
            {/* Muy estrecho (móvil): selector desplegable. En tablet las pestañas se quedan
                visibles aunque no quepan todas (la fila hace scroll horizontal): para una
                sección que se usa todo el día, dos toques por cambio de vista era peor. */}
            <div className="sm:hidden">
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
                  <SelectItem value="asignacion">Próximas reservas</SelectItem>
                  <SelectItem value="blacklist">Blacklist</SelectItem>
                  {isAdmin && <SelectItem value="configuracion">Configuración</SelectItem>}
                </SelectContent>
              </Select>
            </div>

            {/* Tablet/desktop: pestañas */}
            <div className="hidden sm:block scroll-x-touch no-scrollbar">
              <TabsList className="w-max min-w-max justify-start gap-1 p-1">
                <TabsTrigger value="hoy" className="flex-shrink-0 text-sm lg:text-base">Hoy</TabsTrigger>
                <TabsTrigger value="reservas" className="flex-shrink-0 text-sm lg:text-base gap-1">
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
                <TabsTrigger value="calendario" className="flex-shrink-0 text-sm lg:text-base">Calendario</TabsTrigger>
                <TabsTrigger value="asignacion" className="flex-shrink-0 text-sm lg:text-base">Próximas reservas</TabsTrigger>
                <TabsTrigger value="blacklist" className="flex-shrink-0 text-sm lg:text-base">Blacklist</TabsTrigger>
                {isAdmin && (
                  <TabsTrigger value="configuracion" className="gap-1 flex-shrink-0 text-sm lg:text-base">
                    <Settings className="h-4 w-4" />
                    <span className="hidden sm:inline">Configuración</span>
                    <span className="sm:hidden">Config</span>
                  </TabsTrigger>
                )}
              </TabsList>
            </div>
          </div>

          {/* Crear una reserva exige permiso de EDICIÓN en «reservas», como el resto
              de acciones que escriben (y la RLS del INSERT, 20261001170000). Sin él
              el botón sale deshabilitado y explica por qué: el motivo va en el
              envoltorio (`ConMotivo`), porque un botón deshabilitado no recibe el ratón. */}
          <Dialog open={openDialog} onOpenChange={setOpenDialog}>
            <ConMotivo motivo={puedeEditarReservas ? undefined : MOTIVO_SIN_PERMISO_ALTA} className="shrink-0">
              <DialogTrigger asChild>
                <Button className="shrink-0" disabled={!puedeEditarReservas}>
                  <Plus className="mr-2 h-4 w-4" />
                  Nueva Reserva
                </Button>
              </DialogTrigger>
            </ConMotivo>
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
          <VistaHoy
            onEspacioClick={handleEspacioClick}
            onAsignarMesa={handleAsignarMesa}
            onEditarReserva={editarReserva}
            puedeEditar={puedeEditarReservas}
          />
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
              onAsignarMesa={handleAsignarMesa}
              initialStatusFilter={statusFromUrl || undefined}
              initialDateFilter={dateFromUrl === "today" ? new Date() : undefined}
              solicitudesState={solicitudesState}
            />
          </section>
        </TabsContent>

        <TabsContent value="calendario" className="space-y-6 mt-6">
          <CalendarioOcupacion onEspacioClick={handleEspacioClick} />
        </TabsContent>

        {/* "Asignación" (reservas-sin-salas, Fase B): el cliente solo reserva
            una hora; aquí se reparten salas y mesas, con las próximas N horas
            arriba. "Mesas" usa el mismo salto al plano que Lista y Hoy. */}
        <TabsContent value="asignacion" className="mt-6">
          <PanelAsignacion onAsignarMesa={handleAsignarMesa} />
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

      {/* Editor de la reserva elegida con el lápiz de una pastilla de «Hoy». `null` hasta que se pide. */}
      {dialogoEdicion}
    </DashboardLayout>
  );
}
