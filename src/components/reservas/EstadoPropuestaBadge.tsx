import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { EstadoPropuestaVista } from "@/lib/reservas/propuestaCliente";

const TONO: Record<EstadoPropuestaVista["tono"], string> = {
  neutro: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
  info: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  exito: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  aviso: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  peligro: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
};

/** Estado de la propuesta al cliente (Borrador / Propuesta enviada dd/mm hh:mm / Aceptada / Rechazada / Caducada). */
export function EstadoPropuestaBadge({ vista, className }: { vista: EstadoPropuestaVista; className?: string }) {
  return (
    <Badge variant="outline" className={cn("border-transparent text-[10px] pointer-coarse:text-xs font-medium tabular-nums", TONO[vista.tono], className)}>
      {vista.etiqueta}
    </Badge>
  );
}
