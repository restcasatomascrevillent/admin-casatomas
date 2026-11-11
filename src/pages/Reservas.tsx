import { lazy, Suspense, useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Clock, Mail, Plus, Settings, SlidersHorizontal, Timer } from "lucide-react";
import { EtiquetaSoloLectura } from "@/components/panel/EtiquetaSoloLectura";
import { BotonAvisosSeccion } from "@/components/avisos/BotonAvisosSeccion";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { ChipsSubnivel } from "@/components/panel/ChipsSubnivel";
import { VistaHoy } from "@/components/reservas/VistaHoy";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LayoutGrid, Utensils } from "lucide-react";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { usePuedeCrearReservas } from "@/hooks/usePuedeCrearReservas";
import { esEstadoReserva } from "@/lib/reservas/estadosReserva";
import {
  ETIQUETAS_SUBPESTANA_CONFIGURACION,
  FILTRO_POR_ATENDER,
  resolverDeepLinkReservas,
  resolverSubpestanaConfiguracion,
  TABS_RESERVAS,
  type SubpestanaConfiguracion,
} from "@/lib/reservas/vistaUnificada";
import type { DestinoAsignacion } from "@/lib/reservas/saltoAsignacion";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";

// ============================================================================
// PESTAÑAS BAJO DEMANDA (07/11/2026, «Hoy» ligera con poca cobertura)
// ----------------------------------------------------------------------------
// Antes esta página importaba todas sus pestañas (planos, calendario, asignación,
// configuración, plantillas de correo…) y el fichero de Reservas pesaba ~455 KB,
// que el móvil del camarero se bajaba entero para ver solo «Hoy». Ahora «Hoy» va
// en el fichero de la página y el resto se pide al abrir su pestaña (Radix monta
// solo la pestaña activa). El alta («Nueva Reserva») también, al abrir el diálogo.
// Si tras un despliegue falta un fichero viejo, la barrera de errores recarga
// sola (ErrorBoundary › PATRON_CHUNK_OBSOLETO), como con las páginas (App.tsx).
// ============================================================================
// «Nueva reserva» (10/11/2026): la hoja del día y el formulario, también bajo demanda.
const LibroReservas = lazy(() =>
  import("@/components/reservas/libro/LibroReservas").then((m) => ({ default: m.LibroReservas })),
);
// La Lista vista como el libro (10/11/2026): hojas por día que se pasan.
const ListaComoLibro = lazy(() =>
  import("@/components/reservas/libro/ListaComoLibro").then((m) => ({ default: m.ListaComoLibro })),
);
const CalendarioOcupacion = lazy(() =>
  import("@/components/reservas/CalendarioOcupacion").then((m) => ({ default: m.CalendarioOcupacion })),
);
const PlanoEspacio2D = lazy(() => import("@/components/reservas/PlanoEspacio2D").then((m) => ({ default: m.PlanoEspacio2D })));
const ModoServicioPlano = lazy(() =>
  import("@/components/reservas/servicio/ModoServicioPlano").then((m) => ({ default: m.ModoServicioPlano })),
);
const GestionBlacklist = lazy(() =>
  import("@/components/reservas/GestionBlacklist").then((m) => ({ default: m.GestionBlacklist })),
);
const ConfiguracionTurnos = lazy(() =>
  import("@/components/reservas/ConfiguracionTurnos").then((m) => ({ default: m.ConfiguracionTurnos })),
);
const ConfiguracionGeneralReservas = lazy(() =>
  import("@/components/reservas/ConfiguracionGeneralReservas").then((m) => ({ default: m.ConfiguracionGeneralReservas })),
);
const GestionMesasEspacios = lazy(() =>
  import("@/components/reservas/GestionMesasEspacios").then((m) => ({ default: m.GestionMesasEspacios })),
);
const EditorPlantillasEmail = lazy(() =>
  import("@/components/emails/EditorPlantillasEmail").then((m) => ({ default: m.EditorPlantillasEmail })),
);

/** Esqueleto ligero mientras llega el fichero de una pestaña. */
function CargandoPestana() {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <div className="h-9 animate-pulse rounded-md bg-muted" aria-hidden="true" />
      <div className="h-64 animate-pulse rounded-xl bg-muted/40" aria-hidden="true" />
      <span className="sr-only">Cargando…</span>
    </div>
  );
}

/** "2026-11-20" → «viernes 20 de noviembre». */
function diaLargo(clave: string): string {
  const [a, m, d] = clave.split("-").map(Number);
  return new Date(a, m - 1, d).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
}

const bajoDemanda = (contenido: ReactNode) => <Suspense fallback={<CargandoPestana />}>{contenido}</Suspense>;

/**
 * Qué abre la Lista cuando llega un estado por la URL (avisos, campana, Dashboard): «por atender»,
 * «solicitudes» y «pendiente» → «Pendientes»; otro estado de reserva (p. ej. «cancelada») → esas
 * reservas de hoy en adelante. Sin estado, la hoja de hoy.
 */
function estadoDesdeUrl(status: string | undefined): string | null {
  if (!status) return null;
  if (status === FILTRO_POR_ATENDER || status === "solicitudes" || status === "pendiente") return "pendiente";
  return esEstadoReserva(status) ? status : null;
}

/**
 * La pestaña «Lista» (11/11/2026, petición del dueño: «merge libro y tabla con la vista de libro pero que se
 * llame lista sin toggle y que haya un buscador que busque en todo el histórico… quita el botón Por atender y
 * pon Pendientes»): una sola vista, la hoja por día (`ListaComoLibro`), con el buscador de todo el histórico y
 * «Pendientes». La tabla con filtros y su conmutador «Libro | Tabla» se han quitado.
 */
function PestanaLista({
  status,
  onAnadirReserva,
  resaltar,
}: {
  /** El estado que llega por la URL (`?status=`). */
  status?: string;
  /** «+ Añadir reserva a este día»: abre «Nueva Reserva» en ese día. Sin permiso de crear, no sale. */
  onAnadirReserva?: (fecha: string) => void;
  /** La última reserva creada desde «Nueva Reserva»: la hoja va a su día y la resalta. */
  resaltar?: { id: string; fecha: string } | null;
}) {
  return bajoDemanda(<ListaComoLibro estadoInicial={estadoDesdeUrl(status)} onAnadirReserva={onAnadirReserva} resaltar={resaltar} />);
}

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
 * Un chip de Reservas › Configuración (menos «Plantillas email», que lleva su propio scroll): región de
 * pestaña larga. Hasta el 06/11/2026 llevaba arriba un aviso de «Solo lectura» para quien tenía «Ver» sin
 * «Puede editar»; desde entonces solo entra quien puede editar (ver `puedeVerConfiguracion`).
 */
function ChipConfiguracion({ children }: { children: ReactNode }) {
  return (
    <RegionPestanaLarga>
      <div className="space-y-6">{children}</div>
    </RegionPestanaLarga>
  );
}

export default function Reservas() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Móvil (< 768 px): solo «Hoy» para sentar (ver más abajo).
  const esMovil = useIsMobile();
  const [openDialog, setOpenDialog] = useState(false);
  // «+ Añadir reserva a este día» (libro de la Lista, 10/11/2026): el MISMO diálogo «Nueva Reserva», abierto en
  // ese día. `null` = abierto desde el botón de arriba (hoy).
  const [fechaNuevaReserva, setFechaNuevaReserva] = useState<string | null>(null);
  const [ultimaCreada, setUltimaCreada] = useState<{ id: string; fecha: string } | null>(null);
  // El día de la hoja abierta en «Nueva Reserva», para el título cuando se abre desde la hoja («solo apuntar»).
  const [fechaHojaNueva, setFechaHojaNueva] = useState<string | null>(null);
  const abrirNuevaReserva = (fecha: string | null = null) => {
    setFechaNuevaReserva(fecha);
    setOpenDialog(true);
  };
  const cambiarDialogoNueva = (abierto: boolean) => {
    if (abierto) setFechaNuevaReserva(null);
    setOpenDialog(abierto);
  };
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
  // Gestor Web). Desde el 06/11/2026 (decisión del dueño) solo entra quien tiene «Puede editar» en esa
  // sección: con solo «Ver» no hay pestaña, y un enlace `?tab=configuracion` cae en «Hoy». Se exigen los
  // dos (editar implica ver, la regla de siempre). El super admin, siempre; ser admin no basta.
  const { canAccess: verConfiguracion } = useCanAccessSection("reservas_configuracion");
  const { canAccess: editarConfiguracion, loading: cargandoPermisos } = useCanAccessSection("reservas_configuracion", "edit");
  const puedeVerConfiguracion = verConfiguracion && editarConfiguracion;
  // Escribir en una reserva (crear, modificar, aceptar, cancelar, llegadas, mesas…) exige «Editar» en
  // «Reservas». Sin él (solo «Ver», 06/11/2026) cada vista OCULTA lo que escribe y aquí, junto a las
  // pestañas, sale la etiqueta común «Solo lectura» en lugar de «Nueva Reserva».
  const { canAccess: puedeEditarReservas, loading: cargandoEdicion } = useCanAccessSection("reservas", "edit");
  // Tipo de usuario «Reservas» (10/11/2026): con «Reservas · Crear» sale «Nueva Reserva» aunque no
  // tenga «Editar»; lo demás sigue en solo lectura (la BD solo le deja el alta, 20261122143500).
  const { puedeCrear: puedeCrearReservas, soloCrear } = usePuedeCrearReservas();
  const soloLectura = !cargandoEdicion && !puedeEditarReservas;
  const listaRef = useRef<HTMLElement | null>(null);


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
  // vez de en una pestaña vacía, y el enlace se limpia de la URL.
  const pestanaVisible = activeTab === "configuracion" && !puedeVerConfiguracion ? "hoy" : activeTab;
  useEffect(() => {
    if (cargandoPermisos || puedeVerConfiguracion || tabFromUrl !== "configuracion") return;
    setActiveTab("hoy");
    setSearchParams({}, { replace: true });
  }, [cargandoPermisos, puedeVerConfiguracion, tabFromUrl, setSearchParams]);

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
        <div className="mb-3 flex items-center justify-end gap-2">
          {soloLectura && <EtiquetaSoloLectura />}
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

        {bajoDemanda(vistaEspacio === "servicio" ? (
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
        ))}
      </DashboardLayout>
    );
  }

  // Móvil (< 768 px, 07/11/2026, petición del dueño): el teléfono del camarero es SOLO para sentar. Solo
  // «Hoy», sin pestañas, sin «Nueva reserva» ni avisos, y sin la barra superior del panel (el botón de menú
  // va en la fila de controles de `VistaHoyMovil`). Un `?tab=otra` también cae aquí. Tablet y escritorio, igual.
  if (esMovil) {
    return (
      <DashboardLayout sinCabeceraMovil>
        <div className="reservas-contraste contents">
          <VistaHoy onAbrirSala={handleEspacioClick} />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <Tabs value={pestanaVisible} onValueChange={handleTabChange} className="reservas-contraste w-full">
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
            // «Hoy» pasa a llamarse «Reservas», con flechas para pasar días (11/11/2026, petición del dueño).
            { valor: "hoy", etiqueta: "Reservas" },
            { valor: "reservas", etiqueta: "Lista" },
            { valor: "calendario", etiqueta: "Calendario" },
            { valor: "blacklist", etiqueta: "Blacklist" },
            ...(puedeVerConfiguracion ? [{ valor: "configuracion", etiqueta: "Configuración", icono: <Settings /> }] : []),
          ]}
          acciones={
            /* Crear una reserva exige permiso de EDICIÓN en «reservas», como el resto de acciones
               que escriben (y la RLS del INSERT, 20261001170000). Sin él (solo «Ver») el botón no
               existe y su sitio lo ocupa la etiqueta común «Solo lectura» (06/11/2026, decisión del
               dueño: lo que no se puede usar se oculta, no se desactiva). */
            // 11/11/2026: en tablet y móvil la fila de acciones va a todo lo ancho, Avisos a la izquierda y
            // «Nueva Reserva» a la derecha; en portátil, juntos a la derecha de las pestañas.
            <div className="flex w-full flex-wrap items-center justify-between gap-2 lg:w-auto lg:flex-nowrap lg:justify-end">
            {/* Avisos de reservas (06/11/2026, petición del dueño: antes era una entrada de la barra lateral). */}
            <BotonAvisosSeccion seccion="reservas" />
            {soloLectura && (soloCrear ? <EtiquetaSoloLectura
                  texto="Solo ver y crear"
                  detalle="Puedes ver las reservas y crear reservas nuevas, pero no modificarlas, cambiar su estado ni configurar. Si necesitas más, pídeselo a un administrador."
                /> : <EtiquetaSoloLectura />)}
            {/* «Nueva Reserva» única (10/11/2026, petición del dueño: «un solo botón y dentro formulario o
                libro»). Dentro, la lista del día y el formulario (LibroReservas; sin lápiz desde el 11/11/2026). Ocupa
                casi toda la pantalla y hace scroll por dentro: la página sigue sin desplazar. */}
            {puedeCrearReservas && (
              <Dialog open={openDialog} onOpenChange={cambiarDialogoNueva}>
                <DialogTrigger asChild>
                  <Button className="touch-hit h-9 shrink-0 bg-emerald-600 font-semibold text-white shadow-sm hover:bg-emerald-700 pointer-coarse:h-9">
                    <Plus className="mr-2 h-4 w-4" />
                    Nueva Reserva
                  </Button>
                </DialogTrigger>
                <DialogContent className="reservas-contraste flex h-[94dvh] max-h-[94dvh] w-[98vw] max-w-[98vw] flex-col gap-0 overflow-hidden p-0">
                  <DialogHeader className="flex-row flex-wrap items-center gap-3 space-y-0 border-b px-4 py-2 pr-12">
                    <DialogTitle className="text-lg">
                      Nueva reserva
                      {fechaNuevaReserva && fechaHojaNueva ? ` · ${diaLargo(fechaHojaNueva)}` : ""}
                    </DialogTitle>
                    <DialogDescription className="sr-only">Las reservas del día y, al lado, el formulario para apuntar una nueva.</DialogDescription>
                  </DialogHeader>
                  {bajoDemanda(
                    <LibroReservas
                      soloCrear={soloCrear}
                      fechaInicial={fechaNuevaReserva}
                      onReservaCreada={setUltimaCreada}
                      // Desde «+ Añadir reserva a este día»: sin la hoja (ya se ve detrás), solo apuntar.
                      soloApuntar={!!fechaNuevaReserva}
                      onCambioFecha={setFechaHojaNueva}
                    />,
                  )}
                </DialogContent>
              </Dialog>
            )}
            </div>
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
            <PestanaLista
              // `key`: si llega otro estado por URL estando ya en la página (p. ej. desde la campana),
              // la lista se reinicia con él.
              key={statusFromUrl ?? ""}
              status={statusFromUrl || undefined}
              onAnadirReserva={puedeCrearReservas ? abrirNuevaReserva : undefined}
              resaltar={ultimaCreada}
            />
          </section>
        </TabsContent>

        <TabsContent value="calendario" className="space-y-6 mt-6">
          {bajoDemanda(<CalendarioOcupacion />)}
        </TabsContent>

        {/* «Próximas reservas» (reparto de salas y mesas de los próximos días) se unificó con la Lista el
            11/11/2026, petición del dueño: la tabla de la Lista tiene el mismo «Dar mesa» por reserva. */}

        <TabsContent value="blacklist" className="space-y-6 mt-6">
          <RegionPestanaLarga>
            {bajoDemanda(<GestionBlacklist />)}
          </RegionPestanaLarga>
        </TabsContent>

        {puedeVerConfiguracion && (
          <TabsContent value="configuracion" className="mt-4">
            {/* Subpestañas en chips, como Cheques › Configuración. «Plantillas email» llegó del Super Admin
                el 04/11/2026 (petición del dueño). Todas se rigen por «Reservas · Configuración», igual que
                su RLS (20261104111000); desde el 06/11/2026 solo llega aquí quien puede editarla. Sin
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
                  {bajoDemanda(<ConfiguracionGeneralReservas parte="reglas" />)}
                </ChipConfiguracion>
              </TabsContent>
              <TabsContent value="servicio" className="mt-0">
                <ChipConfiguracion>
                  {bajoDemanda(<ConfiguracionGeneralReservas parte="servicio" />)}
                </ChipConfiguracion>
              </TabsContent>
              <TabsContent value="mesas" className="mt-0">
                <ChipConfiguracion>
                  {bajoDemanda(<GestionMesasEspacios />)}
                </ChipConfiguracion>
              </TabsContent>
              <TabsContent value="turnos" className="mt-0">
                <ChipConfiguracion>
                  {bajoDemanda(<ConfiguracionTurnos />)}
                </ChipConfiguracion>
              </TabsContent>
              <TabsContent value="plantillas" className="mt-0">
                {bajoDemanda(<EditorPlantillasEmail />)}
              </TabsContent>
            </Tabs>
          </TabsContent>
        )}
      </Tabs>
    </DashboardLayout>
  );
}
