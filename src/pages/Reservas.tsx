import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Clock, Mail, Plus, Settings, SlidersHorizontal, Timer } from "lucide-react";
import { FormularioReserva } from "@/components/reservas/FormularioReserva";
import { ConMotivo } from "@/components/reservas/ConMotivo";
import { BotonAvisosSeccion } from "@/components/avisos/BotonAvisosSeccion";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { ChipsSubnivel } from "@/components/panel/ChipsSubnivel";
import { VistaHoy } from "@/components/reservas/VistaHoy";
import { ListaReservasAvanzada } from "@/components/reservas/ListaReservasAvanzada";
import { CalendarioOcupacion } from "@/components/reservas/CalendarioOcupacion";
import { PlanoEspacio2D } from "@/components/reservas/PlanoEspacio2D";
import { ModoServicioPlano } from "@/components/reservas/servicio/ModoServicioPlano";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LayoutGrid, Utensils } from "lucide-react";
import { GestionBlacklist } from "@/components/reservas/GestionBlacklist";
import { ConfiguracionTurnos } from "@/components/reservas/ConfiguracionTurnos";
import { ConfiguracionGeneralReservas } from "@/components/reservas/ConfiguracionGeneralReservas";
import { GestionMesasEspacios } from "@/components/reservas/GestionMesasEspacios";
import { AvisoSoloLecturaConfiguracion } from "@/components/reservas/AvisoSoloLecturaConfiguracion";
import { PanelAsignacion } from "@/components/reservas/PanelAsignacion";
import { EditorPlantillasEmail } from "@/components/emails/EditorPlantillasEmail";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useSolicitudesPendientes } from "@/hooks/useSolicitudesPendientes";
import {
  ETIQUETAS_SUBPESTANA_CONFIGURACION,
  resolverDeepLinkReservas,
  resolverSubpestanaConfiguracion,
  TABS_RESERVAS,
  type SubpestanaConfiguracion,
} from "@/lib/reservas/vistaUnificada";
import type { DestinoAsignacion } from "@/lib/reservas/saltoAsignacion";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { toast } from "sonner";

/** Por qué «Nueva Reserva» sale deshabilitado (se ve al pasar el ratón). */
const MOTIVO_SIN_PERMISO_ALTA = "Necesitas permiso de edición en Reservas para crear reservas";

/**
 * Suelo (px) de las pestañas largas: por debajo (ventana muy baja, teclado del móvil abierto) la
 * región deja de encoger y vuelve el scroll de página. El mismo que Newsletter.
 */
const ALTURA_MINIMA_PESTANA_LARGA = 360;

/**
 * Pestañas largas (Blacklist, Configuración): el contenido ocupa el alto que queda hasta el fondo de
 * la pantalla y hace scroll por dentro, así la página no desplaza y las pestañas y «Nueva Reserva»
 * quedan fijas arriba (regla del dueño, 2026-10-07: el alto de la página es el de la pantalla). Mismo
 * patrón que las pestañas de Newsletter (`useAlturaDisponible`). Sin medida (jsdom, primer pintado)
 * cae al layout de siempre.
 *
 * `relative` imprescindible: sin él, lo que va en posición absoluta dentro (el `<input>` oculto que
 * Radix pinta junto a cada casilla `Checkbox` de un formulario) toma de referencia el `<body>`, se
 * escapa del recorte de la región y vuelve a estirar la página (medido: 1 435 px en Configuración a
 * 1024×768).
 */
function RegionPestanaLarga({ children }: { children: ReactNode }) {
  const [nodo, setNodo] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(nodo, ALTURA_MINIMA_PESTANA_LARGA);
  return (
    <div
      ref={setNodo}
      className={alto ? "relative overflow-y-auto overscroll-contain" : undefined}
      style={alto ? { height: alto } : undefined}
    >
      {children}
    </div>
  );
}

/**
 * Un chip de Reservas › Configuración (menos «Plantillas email», que lleva su propio aviso y su propio
 * scroll): región de pestaña larga con el aviso de «Solo lectura» arriba. El aviso lo ponía
 * ConfiguracionTurnos encima de todo cuando era un solo chip; al repartirlo (04/11/2026, petición del
 * dueño: «el scroll es eterno») tiene que salir en cada uno. Dentro de la región y no fijo encima, para
 * no restar alto al contenido.
 */
function ChipConfiguracion({ children }: { children: ReactNode }) {
  return (
    <RegionPestanaLarga>
      <div className="space-y-6">
        <AvisoSoloLecturaConfiguracion />
        {children}
      </div>
    </RegionPestanaLarga>
  );
}

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
  // Subpestaña de «Configuración» (04/11/2026): «Reglas», «Servicio», «Mesas», «Turnos» o «Plantillas email».
  const [subConfiguracion, setSubConfiguracion] = useState<SubpestanaConfiguracion>("reglas");

  const { data: espacios } = useEspaciosReserva();
  // «Configuración» tiene permiso propio, «Reservas · Configuración» (04/11/2026, como las pestañas del
  // Gestor Web): con «Ver» se entra y con «Puede editar» se cambia (cada parte lo comprueba). El super
  // admin, siempre; ser admin ya no basta por sí solo (hasta ahora era `role === "admin"`).
  const { canAccess: puedeVerConfiguracion } = useCanAccessSection("reservas_configuracion");
  // Editar una reserva: cada vista de reservas (Lista, Kanban de Hoy, Asignación,
  // plano, modo servicio…) lleva su propio diálogo de edición.
  const { canAccess: puedeEditarReservas } = useCanAccessSection("reservas", "edit");
  // ÚNICA instancia en la página: la lista unificada la usa para pintar las
  // solicitudes (ver aviso de realtime en el hook).
  const solicitudesState = useSolicitudesPendientes();
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
  const subFromUrl = searchParams.get("sub");
  const statusFromUrl = destino.status;
  const dateFromUrl = destino.date;
  const hayPresetLista = !!(statusFromUrl || dateFromUrl);

  useEffect(() => {
    if (!tabFromUrl) return;
    setActiveTab(destino.tab);
    // `?tab=configuracion&sub=plantillas` (la ruta vieja del Super Admin redirige aquí). `sub=general`, el
    // chip único de antes del reparto, abre «Reglas» (`resolverSubpestanaConfiguracion`).
    if (destino.tab === "configuracion") setSubConfiguracion(resolverSubpestanaConfiguracion(subFromUrl));
    // Normalizar la URL de una pestaña antigua sin perder los filtros.
    if (!(TABS_RESERVAS as readonly string[]).includes(tabFromUrl)) {
      const params: Record<string, string> = { tab: destino.tab };
      if (destino.status) params.status = destino.status;
      if (destino.date) params.date = destino.date;
      setSearchParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabFromUrl, destino.tab, destino.status, destino.date, subFromUrl]);

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

  // Igual con los chips de Configuración: el enlace ya se aplicó, la URL vuelve a quedar limpia.
  const cambiarSubConfiguracion = (value: string) => {
    setSubConfiguracion(resolverSubpestanaConfiguracion(value));
    if (searchParams.toString()) setSearchParams({});
  };

  // Sin permiso de «Configuración», quien llegue por un enlace (`?tab=configuracion`) cae en «Hoy» en
  // vez de en una pestaña vacía.
  const pestanaVisible = activeTab === "configuracion" && !puedeVerConfiguracion ? "hoy" : activeTab;

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
   * (`ListaReservasAvanzada`) y el panel de Asignación.
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
             la reserva a sentar no salía). Ver `saltoAsignacion.ts`.

             `altoDePantalla`: aquí el plano ocupa justo lo que queda de ventana y la
             página no desplaza (en el diálogo «Elegir mesa» no se pasa). */
          <PlanoEspacio2D
            espacioId={selectedEspacio.id}
            espacioNombre={selectedEspacio.nombre}
            onBack={volverDeEspacio}
            fecha={saltoAsignacion?.fecha}
            turno={saltoAsignacion?.turno}
            reservaId={saltoAsignacion?.reservaId}
            altoDePantalla
          />
        )}
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <Tabs value={pestanaVisible} onValueChange={handleTabChange} className="w-full">
        {/* Pestañas y «Nueva Reserva» en la MISMA línea (2026-09-25, petición del dueño): "Nueva
            Reserva" tenía su propia banda encima, que solo servía para alinear un botón a la derecha
            y se comía ~64px de alto (botón + separación). Ahora comparte fila con las pestañas vía
            `acciones` de PestanasPagina (como en Facturas), que ocupa el hueco de la derecha sin
            cortarlas. El desplegable de móvil de antes ya no hace falta (2026-10-17, migración al
            estilo común de pestañas): PestanasPagina resuelve el mismo problema — pestañas que no
            caben en poco ancho — con scroll horizontal y degradado en el borde, igual que en
            Facturas/Ecommerce; dos toques por cambio de vista era peor para una sección que se usa
            todo el día. Sin título de página: la pestaña "Reservas" del menú lateral ya dice dónde
            estás. */}
        <PestanasPagina
          accionesDebajoEnMovil="lg"
          pestanas={[
            { valor: "hoy", etiqueta: "Hoy" },
            { valor: "reservas", etiqueta: "Lista" },
            { valor: "calendario", etiqueta: "Calendario" },
            { valor: "asignacion", etiqueta: "Próximas reservas" },
            { valor: "blacklist", etiqueta: "Blacklist" },
            ...(puedeVerConfiguracion ? [{ valor: "configuracion", etiqueta: "Configuración", icono: <Settings /> }] : []),
          ]}
          acciones={
            /* Crear una reserva exige permiso de EDICIÓN en «reservas», como el resto de acciones
               que escriben (y la RLS del INSERT, 20261001170000). Sin él el botón sale deshabilitado
               y explica por qué: el motivo va en el envoltorio (`ConMotivo`), porque un botón
               deshabilitado no recibe el ratón. */
            <>
            {/* Avisos de reservas (06/11/2026, petición del dueño: antes era una entrada de la barra lateral). */}
            <BotonAvisosSeccion seccion="reservas" />
            <Dialog open={openDialog} onOpenChange={setOpenDialog}>
              <ConMotivo motivo={puedeEditarReservas ? undefined : MOTIVO_SIN_PERMISO_ALTA} className="shrink-0">
                <DialogTrigger asChild>
                  <Button className="touch-hit h-9 shrink-0 pointer-coarse:h-9" disabled={!puedeEditarReservas}>
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
            </>
          }
        />

        {/* "Hoy" (2026-09-25, petición del dueño): el kanban por espacios
            es la vista principal — lo primero que se ve al entrar en
            /reservas. Sin lista/tabla aquí a propósito: con el kanban
            delante, una tabla debajo solo duplicaba las mismas reservas.
            Desde el 06/10/2026 con dos vistas, «Kanban | Plano»: el plano de
            Hoy es el servicio en vivo de todas las salas; su botón «Reparto de
            mesas» abre la sala aquí, a pantalla completa (el mismo salto que el
            Calendario: reparto `PlanoEspacio2D` ↔ modo servicio), y «Volver»
            regresa a Hoy en la vista en que se estaba. */}
        <TabsContent value="hoy" className="mt-2">
          <VistaHoy onAbrirSala={handleEspacioClick} />
        </TabsContent>

        {/* "Lista" (antes "Reservas", unificaba Hoy + Lista + Solicitudes):
            todas las reservas y solicitudes, de cualquier fecha —
            incluida la de hoy, con su propio filtro de fecha y el atajo
            "Hoy": no se oculta a propósito, así sigue pudiéndose buscar
            una reserva de hoy cancelada o un dato que el kanban no
            muestre. Las solicitudes del bot sin resolver siguen viviendo
            aquí, mezcladas como filas "Solicitud" (sin insignia en la
            pestaña desde el 17/10/2026, petición del dueño). */}
        <TabsContent value="reservas" className="mt-6">
          {/* Sin título ni subtítulo (2026-10-06, petición del dueño: «perdemos mucho espacio vertical»):
              la pestaña «Lista» ya dice dónde estás. La región conserva su nombre para el lector de pantalla
              y la explicación, como descripción (no ocupa alto). */}
          <section
            ref={listaRef}
            aria-label="Todas las reservas y solicitudes"
            aria-describedby="descripcion-todas-reservas"
            className="scroll-mt-4"
          >
            <p id="descripcion-todas-reservas" className="sr-only">
              Historial completo, de cualquier fecha. Las solicitudes que el asistente telefónico no pudo cerrar aparecen marcadas como «Solicitud» con su motivo.
            </p>
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
          <CalendarioOcupacion />
        </TabsContent>

        {/* "Asignación" (reservas-sin-salas, Fase B): el cliente solo reserva
            una hora; aquí se reparten salas y mesas, con las próximas N horas
            arriba. "Mesas" usa el mismo salto al plano que Lista y Hoy. */}
        <TabsContent value="asignacion" className="mt-6">
          <PanelAsignacion onAsignarMesa={handleAsignarMesa} />
        </TabsContent>

        <TabsContent value="blacklist" className="space-y-6 mt-6">
          <RegionPestanaLarga>
            <GestionBlacklist />
          </RegionPestanaLarga>
        </TabsContent>

        {puedeVerConfiguracion && (
          <TabsContent value="configuracion" className="mt-4">
            {/* Subpestañas en chips, como Cheques › Configuración. «Plantillas email» llegó del Super Admin
                el 04/11/2026 (petición del dueño). Todas se rigen por «Reservas · Configuración», igual que
                su RLS (20261104111000): con «Ver» se consultan y con «Puede editar» se cambian. Sin
                `RegionPestanaLarga` en las plantillas: su editor ya mide el alto que le queda y hace
                scroll por dentro, y envolverlo daría un doble scroll.

                El mismo día, el antiguo chip «General» (reglas, mesas y turnos, todo seguido) se repartió
                en cuatro porque «el scroll es eterno» (petición del dueño). «Reglas» y «Servicio» son dos
                partes del MISMO formulario (`ConfiguracionGeneralReservas`, una fila que se guarda entera):
                como Radix desmonta el chip que no se ve, solo hay uno montado cada vez. `flex-wrap`: con
                cinco chips no caben en una fila del móvil (390 px) y bajan a una segunda, como en Cheques. */}
            <Tabs value={subConfiguracion} onValueChange={cambiarSubConfiguracion} className="space-y-4">
              <ChipsSubnivel
                className="flex-wrap"
                chips={[
                  { valor: "reglas", etiqueta: ETIQUETAS_SUBPESTANA_CONFIGURACION.reglas, icono: <SlidersHorizontal /> },
                  { valor: "servicio", etiqueta: ETIQUETAS_SUBPESTANA_CONFIGURACION.servicio, icono: <Timer /> },
                  { valor: "mesas", etiqueta: ETIQUETAS_SUBPESTANA_CONFIGURACION.mesas, icono: <LayoutGrid /> },
                  { valor: "turnos", etiqueta: ETIQUETAS_SUBPESTANA_CONFIGURACION.turnos, icono: <Clock /> },
                  { valor: "plantillas", etiqueta: ETIQUETAS_SUBPESTANA_CONFIGURACION.plantillas, icono: <Mail /> },
                ]}
              />
              <TabsContent value="reglas" className="mt-0">
                <ChipConfiguracion>
                  <ConfiguracionGeneralReservas parte="reglas" />
                </ChipConfiguracion>
              </TabsContent>
              <TabsContent value="servicio" className="mt-0">
                <ChipConfiguracion>
                  <ConfiguracionGeneralReservas parte="servicio" />
                </ChipConfiguracion>
              </TabsContent>
              <TabsContent value="mesas" className="mt-0">
                <ChipConfiguracion>
                  <GestionMesasEspacios />
                </ChipConfiguracion>
              </TabsContent>
              <TabsContent value="turnos" className="mt-0">
                <ChipConfiguracion>
                  <ConfiguracionTurnos />
                </ChipConfiguracion>
              </TabsContent>
              <TabsContent value="plantillas" className="mt-0">
                <EditorPlantillasEmail />
              </TabsContent>
            </Tabs>
          </TabsContent>
        )}
      </Tabs>
    </DashboardLayout>
  );
}
