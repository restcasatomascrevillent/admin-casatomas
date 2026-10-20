import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useResumenOcupacionHoy } from "@/hooks/useOcupacionHoy";
import { ChevronDown, Clock, Info, MapIcon, Search, SquareKanban, Wand2 } from "lucide-react";
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
import {
  esModoVistaHoy,
  guardarSalaPlanoHoy,
  guardarVistaHoy,
  leerSalaPlanoHoy,
  leerVistaHoy,
  type FiltroTurnoHoy,
  type ModoVistaHoy,
} from "@/lib/reservas/vistaHoy";
import { VistaPlanoHoy, type ReservaPlanoHoy } from "./servicio/VistaPlanoHoy";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { VistaHoyMovil } from "./movil/VistaHoyMovil";
import { BotonSentarSinReserva } from "./SentarSinReserva";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
 * en este navegador. Lo de arriba —cifras, cuartos de hora, buscador y
 * «Todo el día / Comida / Cena»— es UNO para las dos: el buscador y el turno viven aquí (antes
 * dentro del kanban) y filtran igual el kanban y el plano (`coincideFiltroHoy`). El plano está en
 * `servicio/VistaPlanoHoy.tsx`. Tocar el nombre de una sala en el kanban abre su plano.
 *
 * ORGANIZAR (10/10/2026): botón en la fila de filtros (tablet y escritorio). Con «Todo el día» pregunta
 * «¿Comida o Cena?»; después la vista pasa a Plano en MODO PROPUESTA (`VistaPlanoHoy`, prop `organizar`).
 * «Reparto de mesas» (`PlanoEspacio2D`) ya no se ofrece desde Hoy: lo esencial está en el Plano.
 *
 * `onAbrirSala` (sin uso desde el 10/10/2026): abría el reparto de mesas de una sala (`Reservas.tsx`, el
 * mismo salto que el Calendario: `PlanoEspacio2D`, con su conmutador al modo servicio).
 */
export function VistaHoy(_props: { onAbrirSala?: (espacioId: string) => void } = {}) {
  // Lo que comparten las dos vistas: el buscador y el turno de la fila de filtros, y la vista elegida.
  const [vista, setVista] = useState<ModoVistaHoy>(leerVistaHoy);
  const [busqueda, setBusqueda] = useState("");
  const [filtroTurno, setFiltroTurno] = useState<FiltroTurnoHoy>("todo");
  const [salaPlano, setSalaPlano] = useState<string | null>(leerSalaPlanoHoy);
  // Móvil (< 768 px): vista propia para el camarero (`movil/VistaHoyMovil.tsx`). Tablet y escritorio, igual.
  const esMovil = useIsMobile();
  // «Organizar»: turno de la propuesta en curso (o `null`) y la pregunta «¿Comida o Cena?».
  const [organizando, setOrganizando] = useState<"comida" | "cena" | null>(null);
  const [preguntarTurno, setPreguntarTurno] = useState(false);
  const empezarOrganizar = (turno: "comida" | "cena") => {
    setPreguntarTurno(false);
    setFiltroTurno(turno);
    cambiarVista("plano");
    setOrganizando(turno);
  };
  const pulsarOrganizar = () => (filtroTurno === "todo" ? setPreguntarTurno(true) : empezarOrganizar(filtroTurno));
  const cambiarTurno = (t: FiltroTurnoHoy) => {
    setFiltroTurno(t);
    if (t !== organizando) setOrganizando(null);
  };
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
    isLoading,
    isError: errorResumen,
    error: errorResumenDetalle,
    refetch: refetchResumen,
  } = useResumenOcupacionHoy();

  // Ojo con el orden: estos hooks van ANTES de los `return` de carga/error de
  // arriba, o React se queda sin hooks a mitad de render.
  // Cambios de `reservas` y de mesas hechos en otro dispositivo: UNA suscripción
  // para toda la pestaña (kanban, cifras y la rejilla
  // por cuartos, que no abre la suya: `ReservasEnVivoContexto`).
  useReservasEnVivo();
  // Cambia a medianoche (la tablet se queda toda la noche en «Hoy»).
  const hoy = useHoyLocal();
  const { data: espacios } = useEspaciosReserva();
  /**
   * Reservas de hoy de Casa Tomás, para el plano del servicio y la vista de hoy en móvil
   * (`marca`, para quedarse con las de Casa Tomás: `admiteReservas`).
   *
   * `select("*")`, como el kanban: trae `llegada_at`, `importante`, `telefono`… si existen (las tarjetas
   * del plano los necesitan) sin romper si una migración no está aplicada. NO se reutiliza
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
      <div className="space-y-2">
        {/* Revisión 17/10/2026: sin cifras de ocupación en la fila de filtros (a petición del
            dueño). En el kanban sigue «Disponibilidad por cuartos de hora», plegada; el plano
            empieza justo debajo de la fila de filtros. */}
        {vista !== "plano" && <CuartosDeHoy fecha={hoy} />}

        <BarraFiltrosHoy
          busqueda={busqueda}
          onBusqueda={setBusqueda}
          filtroTurno={filtroTurno}
          onFiltroTurno={cambiarTurno}
          vista={vista}
          onVista={(v) => {
            cambiarVista(v);
            if (v !== "plano") setOrganizando(null);
          }}
          accion={
            <div className="flex shrink-0 gap-2 sm:order-2">
              <Button className="touch-hit h-9 gap-1.5 px-4 pointer-coarse:h-9" onClick={pulsarOrganizar} disabled={!!organizando}>
                <Wand2 className="h-4 w-4" aria-hidden="true" />
                Organizar
              </Button>
              <BotonSentarSinReserva className="touch-hit h-9 shrink-0 pointer-coarse:h-9" />
            </div>
          }
        />

        {vista === "plano" ? (
          <VistaPlanoHoy
            reservas={reservasHoy}
            busqueda={busqueda}
            filtroTurno={filtroTurno}
            salaId={salaPlano}
            onCambiarSala={cambiarSala}
            organizar={organizando ? { turno: organizando, onSalir: () => setOrganizando(null) } : null}
            reservasError={errorReservasHoy}
            onReintentarReservas={() => void refetchReservasHoy()}
          />
        ) : (
          <GestorReservasKanban busqueda={busqueda} filtroTurno={filtroTurno} onVerPlanoSala={verPlanoDeSala} />
        )}
      </div>
      <Dialog open={preguntarTurno} onOpenChange={setPreguntarTurno}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>¿Qué servicio organizo?</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {(["comida", "cena"] as const).map((t) => (
              <Button
                key={t}
                variant={t === turnoSiguiente() ? "default" : "outline"}
                className="h-16 text-lg"
                onClick={() => empezarOrganizar(t)}
              >
                {t === "comida" ? "Comida" : "Cena"}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </ReservasEnVivoContexto.Provider>
  );
}

/** El turno en curso o el siguiente: comida hasta las 16:00, después cena. */
function turnoSiguiente(): "comida" | "cena" {
  return new Date().getHours() < 16 ? "comida" : "cena";
}

/**
 * Opción del selector «Kanban | Plano». Marcada, OSCURA (`bg-primary`), como el resto de conmutadores de
 * vista del panel (Plano | Servicio de una sala): el dorado de `accent` sobre blanco daba 3,5:1.
 */
const CLASES_OPCION_VISTA =
  "touch-hit h-9 pointer-coarse:h-9 gap-1.5 whitespace-nowrap data-[state=on]:bg-primary data-[state=on]:text-primary-foreground";

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
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-1">
      {/* Móvil: buscador y selector en una fila. Desde `sm`, `contents` los deja sueltos en la fila de
          siempre y `order` pone el selector detrás del turno. */}
      <div className="flex min-w-0 items-center gap-2 sm:contents">
        <div className="relative w-full min-w-0 sm:order-1 sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input
            placeholder="Buscar por nombre, email o teléfono…"
            value={busqueda}
            onChange={(e) => onBusqueda(e.target.value)}
            className="h-9 pl-9 pointer-coarse:h-10"
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
        <ToggleGroupItem value="todo" className="touch-hit whitespace-nowrap pointer-coarse:h-9">Todo el día</ToggleGroupItem>
        <ToggleGroupItem value="comida" className="touch-hit whitespace-nowrap pointer-coarse:h-9">Comida</ToggleGroupItem>
        <ToggleGroupItem value="cena" className="touch-hit whitespace-nowrap pointer-coarse:h-9">Cena</ToggleGroupItem>
      </ToggleGroup>
      {accion}
      {!soloFiltros && (
        // La ayuda, como un ⓘ (10/10/2026): el texto entero en el título y para el lector de pantalla.
        <span
          role="note"
          className="hidden shrink-0 text-muted-foreground sm:order-4 sm:inline-flex"
          aria-label={
            vista === "plano"
              ? "Toca una mesa para ver su reserva y sus acciones."
              : "Toca una tarjeta para ver sus acciones, o mantenla pulsada y arrástrala a otro espacio."
          }
          title={
            vista === "plano"
              ? "Toca una mesa para ver su reserva y sus acciones."
              : "Toca una tarjeta para ver sus acciones, o mantenla pulsada y arrástrala a otro espacio."
          }
        >
          <Info className="h-4 w-4" aria-hidden="true" />
        </span>
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
