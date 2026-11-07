import { WifiOff } from "lucide-react";
import { format } from "date-fns";
import { useEnLinea } from "@/hooks/useEnLinea";
import { cn } from "@/lib/utils";

/**
 * Banda fina «Sin conexión · datos de las HH:MM» (07/11/2026, «Hoy» con poca cobertura): sale cuando
 * el navegador dice que no hay red o cuando la última lectura falló por red, y dice de qué hora es lo
 * que se está viendo (la última lectura buena). Con red no pinta nada: no roba altura.
 */
export function AvisoSinConexion({
  actualizadoEn,
  falloRed,
  className,
}: {
  /** `dataUpdatedAt` de la consulta (ms); 0 si nunca llegó nada. */
  actualizadoEn: number;
  /** La consulta falló por red o está en pausa esperando red. */
  falloRed: boolean;
  className?: string;
}) {
  const enLinea = useEnLinea();
  if (enLinea && !falloRed) return null;
  const hora = actualizadoEn > 0 ? format(new Date(actualizadoEn), "HH:mm") : null;
  return (
    <div
      role="status"
      data-testid="aviso-sin-conexion"
      className={cn(
        "flex items-center gap-1.5 rounded-md border border-amber-300/70 bg-amber-50 px-2 py-0.5 text-xs leading-5 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200",
        className,
      )}
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">Sin conexión{hora ? ` · datos de las ${hora}` : ""}</span>
    </div>
  );
}
