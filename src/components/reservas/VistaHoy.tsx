import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useResumenOcupacionHoy } from "@/hooks/useOcupacionHoy";
import {
  CalendarCheck,
  ChevronDown,
  Clock,
  Lock,
  MapIcon,
  MapPin,
  MoreVertical,
  Search,
  SquareKanban,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { supabase } from "@/integrations/supabase/client";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { ReservasEnVivoContexto, useReservasEnVivo } from "@/hooks/useReservasEnVivo";
import { REFRESCO_PERIODICO } from "@/lib/realtimeCanal";
import { useHoyLocal } from "@/hooks/useHoyLocal";
import { GestorReservasKanban } from "./GestorReservasKanban";
import { DisponibilidadCuartos } from "./DisponibilidadCuartos";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { admiteReservas } from "@/lib/reservas/negocios";
import { avisosSalasPrivadas, textoAvisoSalaPrivada } from "@/lib/reservas/salaPrivada";
import {
  esModoVistaHoy,
  guardarSalaPlanoHoy,
  guardarVistaHoy,
  leerSalaPlanoHoy,
  leerVistaHoy,
  type FiltroTurnoHoy,
  type ModoVistaHoy,
} from "@/lib/reservas/vistaHoy";
import { AvisoSalasPrivadas } from "./AvisoSalasPrivadas";
import { VistaPlanoHoy, type ReservaPlanoHoy } from "./servicio/VistaPlanoHoy";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { VistaHoyMovil } from "./movil/VistaHoyMovil";
import { BotonSentarSinReserva } from "./SentarSinReserva";

/**
 * Pestaña "Hoy" (rediseñada 2026-09-25, petición del dueño): antes esto era
 * 4 tarjetas grandes de ocupación + una tabla "Reservas de Hoy" + el kanban
 * escondido detrás de un botón "Gestor de reservas" — en 1366px las 4
 * tarjetas solas ya llenaban la pantalla y no se veía ni una reserva.
 *
 * Ahora: una franja compacta con los mismos 4 datos y, justo debajo, el
 * kanban por espacios como protagonista — es la vista de servicio, así que
 * es lo primero que se ve. Solo Casa Tomás: Touza no admite reservas
 * (decisión del dueño, 2026-10-01), así que lo que quede de Touza en la base
 * de datos no sale ni cuenta en ninguna parte de esta pestaña.
 *
 * Ojo: NO hay lista/tabla de reservas de hoy aquí (decisión explícita del
 * dueño — "quita la lista de reservas de hoy, solo el kanban"). Buscar por
 * nombre/teléfono, marcar importante y añadir a blacklist siguen
 * disponibles, pero dentro del propio kanban (GestorReservasKanban.tsx) en
 * vez de en una tabla aparte. Las reservas que NO son de hoy están en la
 * pestaña "Lista".
 *
 * Retirado el 04/10/2026, por petición del dueño, porque duplicaban lo que ya
 * se ve en el kanban (ruido visual que agrandaba la pantalla): la franja
 * «Pendientes de mesa» (el kanban marca ahora cada tarjeta «Sin mesa» y su menú
 * «⋮» tiene «Dar mesa») y la línea «Cómo avanza una reserva» (esa vive en la
 * pestaña «Lista», como filtro por estado).
 *
 * DOS VISTAS (06/10/2026, petición del dueño: «montar aquí DOS VISTAS: una de kanban y luego
 * montar la vista con los planos del local»): «Kanban | Plano», en la fila del buscador y del
 * turno, sin alto de más. Por defecto el kanban; la elección (y la sala del plano) se recuerda
 * en este navegador. Lo de arriba —cifras, aviso del Reservado, cuartos de hora, buscador y
 * «Todo el día / Comida / Cena»— es UNO para las dos: el buscador y el turno viven aquí (antes
 * dentro del kanban) y filtran igual el kanban y el plano (`coincideFiltroHoy`). El plano está en
 * `servicio/VistaPlanoHoy.tsx`. Tocar el nombre de una sala en el kanban abre su plano.
 *
 * `onAbrirSala`: abre el reparto de mesas de una sala a pantalla completa (`Reservas.tsx`, el
 * mismo salto que el Calendario: `PlanoEspacio2D`, con su conmutador al modo servicio).
 */
export function VistaHoy({ onAbrirSala }: { onAbrirSala?: (espacioId: string) => void } = {}) {
  // Lo que comparten las dos vistas: el buscador y el turno de la fila de filtros, y la vista elegida.
  const [vista, setVista] = useState<ModoVistaHoy>(leerVistaHoy);
  const [busqueda, setBusqueda] = useState("");
  const [filtroTurno, setFiltroTurno] = useState<FiltroTurnoHoy>("todo");
  const [salaPlano, setSalaPlano] = useState<string | null>(leerSalaPlanoHoy);
  // Móvil (< 768 px): vista propia para el camarero (`movil/VistaHoyMovil.tsx`). Tablet y escritorio, igual.
  const esMovil = useIsMobile();
  const cambiarVista = (nueva: ModoVistaHoy) => {
    setVista(nueva);
    guardarVistaHoy(nueva);
  };
  const cambiarSala = (salaId: string) => {
    setSalaPlano(salaId);
    guardarSalaPlanoHoy(salaId);
  };
  /** Desde el kanban (nombre de una sala): el plano de esa sala. */
  const verPlanoDeSala = (salaId: string) => {
    cambiarSala(salaId);
    cambiarVista("plano");
  };

  const {
    data: resumen,
    isLoading,
    isError: errorResumen,
    error: errorResumenDetalle,
    refetch: refetchResumen,
  } = useResumenOcupacionHoy();

  // Ojo con el orden: estos hooks van ANTES de los `return` de carga/error de
  // arriba, o React se queda sin hooks a mitad de render.
  // Cambios de `reservas` y de mesas hechos en otro dispositivo: UNA suscripción
  // para toda la pestaña (kanban, aviso de salas privadas, cifras y la rejilla
  // por cuartos, que no abre la suya: `ReservasEnVivoContexto`).
  useReservasEnVivo();
  // Cambia a medianoche (la tablet se queda toda la noche en «Hoy»).
  const hoy = useHoyLocal();
  const { data: espacios } = useEspaciosReserva();
  /**
   * Reservas de hoy de Casa Tomás, para el aviso de salas privadas y las tarjetas de su desplegable
   * (`marca`, para quedarse con las de Casa Tomás: `admiteReservas`).
   *
   * `select("*")`, como el kanban: trae `llegada_at`, `importante`, `telefono`… si existen (las tarjetas
   * del Reservado los necesitan) sin romper si una migración no está aplicada. NO se reutiliza
   * `useReservasServicioDia`: ese pide `llegada_at` y `salida_at` por nombre, y su error subiría hasta
   * aquí y tumbaría la pestaña entera. (`"reservas" as any` porque `espacio_id` no está en los tipos generados.)
   *
   * CLAVE: empieza por "reservas-hoy", prefijo de `CLAVES_LISTAS_RESERVAS` (`clavesCache.ts`):
   * las acciones de reserva y el alta/edición la refrescan (y la actualizan de forma optimista).
   * Lo que cambie OTRO dispositivo llega por `useReservasEnVivo` y, sin realtime, con el refresco
   * de cada minuto (`REFRESCO_PERIODICO`). El nombre "pendientes-mesa" es herencia de la franja
   * retirada: se conserva porque otros hooks y tests la usan como clave.
   */
  const {
    data: reservasHoy,
    isError: errorReservasHoy,
    refetch: refetchReservasHoy,
  } = useQuery({
    ...REFRESCO_PERIODICO,
    queryKey: ["reservas-hoy", "pendientes-mesa", hoy],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reservas" as any)
        .select("*")
        .eq("fecha", hoy)
        .neq("estado", "cancelada")
        .order("hora");
      if (error) throw error;
      // `ReservaPlanoHoy`: con `salida_at` si la columna existe (la vista Plano pinta las mesas con esta lista).
      return ((data ?? []) as unknown as ReservaPlanoHoy[]).filter((r) => admiteReservas(r.marca));
    },
  });

  // El Reservado (sala privada) está FUERA DE AFORO: no entra en las cifras de arriba, pero se avisa
  // aparte de si está ocupado hoy.
  const avisosPrivadas = useMemo(
    () => avisosSalasPrivadas(espacios as Array<{ id?: string; nombre?: string }> | undefined, reservasHoy),
    [espacios, reservasHoy],
  );

  if (isLoading) {
    return (
      <div className="space-y-3 sm:space-y-4">
        <div className="rounded-xl border bg-card/50 p-3 sm:p-4 animate-pulse">
          <div className="h-10 sm:h-8 bg-muted rounded" />
        </div>
        <div className="h-80 bg-muted/40 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (errorResumen) {
    return (
      <EstadoErrorCarga
        titulo="el resumen de ocupación de hoy"
        error={errorResumenDetalle}
        onReintentar={() => refetchResumen()}
      />
    );
  }

  const reservasCanceladas = resumen?.reservasCanceladas ?? 0;

  if (esMovil) {
    return (
      <ReservasEnVivoContexto.Provider value={true}>
        <div className="space-y-2">
          <BarraFiltrosHoy
            busqueda={busqueda}
            onBusqueda={setBusqueda}
            filtroTurno={filtroTurno}
            onFiltroTurno={setFiltroTurno}
            vista={vista}
            onVista={cambiarVista}
            soloFiltros
            accion={<BotonSentarSinReserva className="shrink-0" />}
          />
          {errorReservasHoy ? (
            <EstadoErrorCarga titulo="las reservas de hoy" onReintentar={() => void refetchReservasHoy()} />
          ) : (
            <VistaHoyMovil reservas={reservasHoy} fecha={hoy} busqueda={busqueda} filtroTurno={filtroTurno} />
          )}
        </div>
      </ReservasEnVivoContexto.Provider>
    );
  }

  return (
    // `ReservasEnVivoContexto`: lo de dentro (la rejilla por cuartos, el editor
    // del kanban) ya lo refresca `useReservasEnVivo` y no abre su propio canal a
    // `reservas`.
    <ReservasEnVivoContexto.Provider value={true}>
      <div className="space-y-3 sm:space-y-4">
        {/* Vista PLANO (revisión 07/10/2026): el plano necesita el alto. Las cifras van en UNA línea y el
            aviso del Reservado dentro de ella; «Disponibilidad por cuartos de hora» no sale (está en el kanban
            y en el Calendario). */}
        {vista === "plano" ? (
          <p
            data-testid="resumen-hoy-plano"
            className="flex min-w-0 items-center gap-x-3 overflow-hidden whitespace-nowrap rounded-xl border bg-card/50 px-3 py-2 text-sm text-muted-foreground"
          >
            <span>
              <strong className="tabular-nums text-foreground">{resumen?.totalReservas ?? 0}</strong> reservas
            </span>
            <span aria-hidden="true">·</span>
            <span>
              <strong className="tabular-nums text-foreground">{resumen?.totalComensales ?? 0}</strong> comensales
            </span>
            <span aria-hidden="true">·</span>
            <span>
              <strong className="tabular-nums text-foreground">{`${resumen?.porcentajeTotal ?? 0} %`}</strong> de{" "}
              <span className="tabular-nums">{resumen?.capacidadTotal ?? 0}</span>
            </span>
            {reservasHoy !== undefined &&
              avisosPrivadas.map((aviso) => (
                <span key={aviso.espacioId} className="flex min-w-0 items-center gap-1 text-violet-800 dark:text-violet-200">
                  <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{textoAvisoSalaPrivada(aviso)}</span>
                </span>
              ))}
          </p>
        ) : (
          <>
            {/* Franja compacta de ocupación: los 4 datos que antes eran 4
                tarjetas grandes, ahora en una sola línea en escritorio (2x2 en
                móvil) para que no compitan con el kanban por la pantalla. */}
            <div className="rounded-xl border bg-card/50 px-3 py-2.5 sm:px-2 sm:py-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2.5 sm:gap-x-0 sm:divide-x sm:divide-border">
                <IndicadorHoy
                  icon={CalendarCheck}
                  iconClass="bg-primary/10 text-primary"
                  label="Reservas hoy"
                  value={resumen?.totalReservas ?? 0}
                  detalle={reservasCanceladas > 0 ? `· ${reservasCanceladas} canc.` : undefined}
                />
                <IndicadorHoy
                  icon={Users}
                  iconClass="bg-accent/10 text-accent"
                  label="Comensales"
                  value={resumen?.totalComensales ?? 0}
                />
                <IndicadorHoy
                  icon={MapPin}
                  iconClass="bg-secondary/10 text-secondary"
                  label="Capacidad"
                  value={resumen?.capacidadTotal ?? 0}
                />
                <IndicadorHoy
                  icon={TrendingUp}
                  iconClass="bg-green-500/10 text-green-600 dark:text-green-500"
                  label="Ocupación"
                  value={`${resumen?.porcentajeTotal ?? 0}%`}
                />
              </div>
            </div>

            {/* Sala privada (el Reservado): fuera de aforo y de las cifras de arriba, pero a la vista. Solo con
                las reservas ya leídas: antes, mientras cargaban (o si fallaban), decía «Reservado: libre». */}
            {reservasHoy !== undefined && <AvisoSalasPrivadas avisos={avisosPrivadas} reservas={reservasHoy} />}

            <CuartosDeHoy fecha={hoy} />
          </>
        )}

        <BarraFiltrosHoy
          busqueda={busqueda}
          onBusqueda={setBusqueda}
          filtroTurno={filtroTurno}
          onFiltroTurno={setFiltroTurno}
          vista={vista}
          onVista={cambiarVista}
          accion={<BotonSentarSinReserva className="shrink-0 sm:order-2" />}
        />

        {vista === "plano" ? (
          <VistaPlanoHoy
            reservas={reservasHoy}
            busqueda={busqueda}
            filtroTurno={filtroTurno}
            salaId={salaPlano}
            onCambiarSala={cambiarSala}
            onAbrirReparto={onAbrirSala}
            reservasError={errorReservasHoy}
            onReintentarReservas={() => void refetchReservasHoy()}
          />
        ) : (
          <GestorReservasKanban busqueda={busqueda} filtroTurno={filtroTurno} onVerPlanoSala={verPlanoDeSala} />
        )}
      </div>
    </ReservasEnVivoContexto.Provider>
  );
}

/**
 * Opción del selector «Kanban | Plano». Marcada, OSCURA (`bg-primary`), como el resto de conmutadores de
 * vista del panel (Plano | Servicio de una sala): el dorado de `accent` sobre blanco daba 3,5:1.
 */
const CLASES_OPCION_VISTA =
  "h-10 gap-1.5 whitespace-nowrap data-[state=on]:bg-primary data-[state=on]:text-primary-foreground";

/**
 * La fila de filtros de «Hoy», COMÚN a las dos vistas (antes vivía dentro del kanban, idéntica):
 * buscador, «Todo el día / Comida / Cena», el selector «Kanban | Plano» y la ayuda de cada vista.
 *
 * Sin alto de más: el selector va junto al turno y la ayuda ocupa lo que sobre de la línea (en dos
 * renglones si hace falta, que miden menos que el buscador); solo baja a su propia línea donde ya
 * bajaba antes (tablet). En móvil el selector se queda en iconos (el texto sigue para el lector de
 * pantalla) y comparte fila con el buscador.
 */
function BarraFiltrosHoy({
  busqueda,
  onBusqueda,
  filtroTurno,
  onFiltroTurno,
  vista,
  onVista,
  soloFiltros = false,
  accion,
}: {
  /** Botón de acción junto al turno («Sin reserva»). */
  accion?: ReactNode;
  /** Móvil: solo buscador y turno (sin «Kanban | Plano» ni la ayuda). */
  soloFiltros?: boolean;
  busqueda: string;
  onBusqueda: (texto: string) => void;
  filtroTurno: FiltroTurnoHoy;
  onFiltroTurno: (turno: FiltroTurnoHoy) => void;
  vista: ModoVistaHoy;
  onVista: (vista: ModoVistaHoy) => void;
}) {
  return (
    // `flex-wrap`: por debajo de ~1100px el texto de ayuda se baja a su propia línea en vez de
    // estrujar el filtro de turno hasta partir "Todo el día" en dos renglones.
    <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3">
      {/* Móvil: buscador y selector en una fila. Desde `sm`, `contents` los deja sueltos en la fila de
          siempre y `order` pone el selector detrás del turno. */}
      <div className="flex min-w-0 items-center gap-2 sm:contents">
        <div className="relative w-full min-w-0 sm:order-1 sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input
            placeholder="Buscar por nombre, email o teléfono…"
            value={busqueda}
            onChange={(e) => onBusqueda(e.target.value)}
            className="pl-9"
            aria-label="Buscar reservas"
          />
        </div>
        {!soloFiltros && (
        <ToggleGroup
          type="single"
          value={vista}
          onValueChange={(v) => esModoVistaHoy(v) && onVista(v)}
          variant="outline"
          size="sm"
          className="shrink-0 sm:order-3"
          aria-label="Vista de Hoy"
        >
          <ToggleGroupItem value="kanban" aria-label="Kanban" title="Kanban: una columna por sala" className={CLASES_OPCION_VISTA}>
            <SquareKanban className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">Kanban</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="plano" aria-label="Plano" title="Plano: las salas con sus mesas" className={CLASES_OPCION_VISTA}>
            <MapIcon className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">Plano</span>
          </ToggleGroupItem>
        </ToggleGroup>
        )}
      </div>
      <ToggleGroup
        type="single"
        value={filtroTurno}
        onValueChange={(v) => v && onFiltroTurno(v as FiltroTurnoHoy)}
        variant="outline"
        size="sm"
        className="shrink-0 sm:order-2"
        aria-label="Filtrar por turno"
      >
        <ToggleGroupItem value="todo" className="whitespace-nowrap">Todo el día</ToggleGroupItem>
        <ToggleGroupItem value="comida" className="whitespace-nowrap">Comida</ToggleGroupItem>
        <ToggleGroupItem value="cena" className="whitespace-nowrap">Cena</ToggleGroupItem>
      </ToggleGroup>
      {accion}
      {soloFiltros ? null : vista === "plano" ? (
        // Corta a propósito: desde 1024 px cabe en la línea del buscador y no le roba alto al plano. En
        // móvil no sale (el plano necesita ese alto y tocar una mesa se explica solo).
        <p className="hidden text-xs text-muted-foreground sm:order-4 sm:block sm:basis-full lg:min-w-48 lg:flex-1 lg:text-right">
          Toca una mesa para ver su reserva y sus acciones.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground sm:order-4 sm:basis-full lg:min-w-64 lg:flex-1 lg:text-right">
          Toca una tarjeta para ver sus acciones (<MoreVertical className="inline h-3 w-3" aria-hidden="true" />), o mantenla pulsada y arrástrala a otro espacio.
        </p>
      )}
    </div>
  );
}

/**
 * Rejilla interna por cuartos de hora del día (reservas-sin-salas,
 * 2026-09-29), PLEGADA: el kanban sigue siendo el protagonista de Hoy. Una
 * sola rejilla, la de Casa Tomás con su aforo (antes había otra para Touza).
 * Mientras está plegada no se monta nada (Radix desmonta el contenido), así
 * que no cuesta consultas.
 */
function CuartosDeHoy({ fecha }: { fecha: string }) {
  return (
    <Collapsible className="rounded-xl border bg-card/50 px-3 py-2">
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded-md py-1 pointer-coarse:min-h-11 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" aria-hidden />
          Disponibilidad por cuartos de hora
        </span>
        <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 pt-2">
        {/* `ocultarTitulo`: el botón del plegable ya dice «Disponibilidad por cuartos de hora»; repetirlo
            justo debajo sobraba (antes el segundo llevaba «· Casa Tomás», de cuando había dos negocios). */}
        <DisponibilidadCuartos fecha={fecha} compacto ocultarTitulo />
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Un dato de la franja compacta: icono + número. */
function IndicadorHoy({
  icon: Icon,
  iconClass,
  label,
  value,
  detalle,
}: {
  icon: LucideIcon;
  iconClass: string;
  label: string;
  value: string | number;
  detalle?: string;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0 sm:px-3 sm:first:pl-1">
      <div className={cn("p-1.5 rounded-lg shrink-0", iconClass)}>
        <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] sm:text-xs font-medium text-muted-foreground leading-none truncate">{label}</p>
        <p className="text-base sm:text-lg font-bold leading-tight tabular-nums">
          {value}
          {detalle && <span className="ml-1 text-[10px] font-normal text-muted-foreground">{detalle}</span>}
        </p>
      </div>
    </div>
  );
}
