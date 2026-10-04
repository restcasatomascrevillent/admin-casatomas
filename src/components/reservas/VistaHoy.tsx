import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useResumenOcupacionHoy } from "@/hooks/useOcupacionHoy";
import { CalendarCheck, ChevronDown, Clock, MapPin, TrendingUp, Users, type LucideIcon } from "lucide-react";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { supabase } from "@/integrations/supabase/client";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { ReservasEnVivoContexto, useReservasEnVivo } from "@/hooks/useReservasEnVivo";
import { REFRESCO_PERIODICO } from "@/lib/realtimeCanal";
import { hoyLocal } from "./asignacionPlano";
import { GestorReservasKanban } from "./GestorReservasKanban";
import { DisponibilidadCuartos } from "./DisponibilidadCuartos";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { admiteReservas } from "@/lib/reservas/negocios";
import { avisosSalasPrivadas } from "@/lib/reservas/salaPrivada";
import { AvisoSalasPrivadas } from "./AvisoSalasPrivadas";
import { cn } from "@/lib/utils";
import type { ReservaServicio } from "@/lib/reservas/servicioSala";

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
 */
export function VistaHoy() {
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
  const hoy = useMemo(() => hoyLocal(), []);
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
  const { data: reservasHoy } = useQuery({
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
      return ((data ?? []) as unknown as (ReservaServicio & { marca?: string | null })[]).filter((r) =>
        admiteReservas(r.marca),
      );
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

  return (
    // `ReservasEnVivoContexto`: lo de dentro (la rejilla por cuartos, el editor
    // del kanban) ya lo refresca `useReservasEnVivo` y no abre su propio canal a
    // `reservas`.
    <ReservasEnVivoContexto.Provider value={true}>
      <div className="space-y-3 sm:space-y-4">
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

        {/* Sala privada (el Reservado): fuera de aforo y de las cifras de arriba, pero a la vista. */}
        <AvisoSalasPrivadas avisos={avisosPrivadas} reservas={reservasHoy} />

        <CuartosDeHoy fecha={hoy} />

        <GestorReservasKanban />
      </div>
    </ReservasEnVivoContexto.Provider>
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
