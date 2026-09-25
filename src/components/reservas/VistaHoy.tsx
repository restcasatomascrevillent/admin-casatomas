import { useResumenOcupacionHoy } from "@/hooks/useOcupacionHoy";
import { CalendarCheck, Users, MapPin, TrendingUp, type LucideIcon } from "lucide-react";
import type { CifrasNegocio } from "@/lib/reservas/resumenNegocios";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { GestorReservasKanban } from "./GestorReservasKanban";
import { cn } from "@/lib/utils";

interface VistaHoyProps {
  onEspacioClick: (espacioId: string) => void;
}

/**
 * Pestaña "Hoy" (rediseñada 2026-09-25, petición del dueño): antes esto era
 * 4 tarjetas grandes de ocupación + una tabla "Reservas de Hoy" + el kanban
 * escondido detrás de un botón "Gestor de reservas" — en 1366px las 4
 * tarjetas solas ya llenaban la pantalla y no se veía ni una reserva.
 *
 * Ahora: una franja compacta con los mismos 4 datos (+ desglose por
 * negocio, que no se pierde) y, justo debajo, el kanban por espacios como
 * protagonista — es la vista de servicio, así que es lo primero que se ve.
 *
 * Ojo: NO hay lista/tabla de reservas de hoy aquí (decisión explícita del
 * dueño — "quita la lista de reservas de hoy, solo el kanban"). Buscar por
 * nombre/teléfono, marcar importante y añadir a blacklist siguen
 * disponibles, pero dentro del propio kanban (GestorReservasKanban.tsx) en
 * vez de en una tabla aparte. Las reservas que NO son de hoy están en la
 * pestaña "Lista".
 */
export function VistaHoy({ onEspacioClick }: VistaHoyProps) {
  const {
    data: resumen,
    isLoading,
    isError: errorResumen,
    error: errorResumenDetalle,
    refetch: refetchResumen,
  } = useResumenOcupacionHoy();

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
  const porNegocio = resumen?.porNegocio ?? [];

  return (
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
            porNegocio={porNegocio}
            cifra={(n) => `${n.totalReservas}`}
          />
          <IndicadorHoy
            icon={Users}
            iconClass="bg-accent/10 text-accent"
            label="Comensales"
            value={resumen?.totalComensales ?? 0}
            porNegocio={porNegocio}
            cifra={(n) => `${n.totalComensales}`}
          />
          <IndicadorHoy
            icon={MapPin}
            iconClass="bg-secondary/10 text-secondary"
            label="Capacidad"
            value={resumen?.capacidadTotal ?? 0}
            porNegocio={porNegocio}
            cifra={(n) => `${n.capacidadTotal}`}
          />
          <IndicadorHoy
            icon={TrendingUp}
            iconClass="bg-green-500/10 text-green-600 dark:text-green-500"
            label="Ocupación"
            value={`${resumen?.porcentajeTotal ?? 0}%`}
            porNegocio={porNegocio}
            cifra={(n) => `${n.porcentajeTotal}%`}
          />
        </div>
      </div>

      <GestorReservasKanban />
    </div>
  );
}

/** Un dato de la franja compacta: icono + número + (si hay 2 negocios) su desglose. */
function IndicadorHoy({
  icon: Icon,
  iconClass,
  label,
  value,
  detalle,
  porNegocio,
  cifra,
}: {
  icon: LucideIcon;
  iconClass: string;
  label: string;
  value: string | number;
  detalle?: string;
  porNegocio: CifrasNegocio[];
  cifra: (n: CifrasNegocio) => string;
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
        {porNegocio.length > 1 && (
          <p className="text-[10px] text-muted-foreground truncate tabular-nums" aria-label="Desglose por negocio">
            {porNegocio.map((n) => `${n.negocio.nombre} ${cifra(n)}`).join(" · ")}
          </p>
        )}
      </div>
    </div>
  );
}
