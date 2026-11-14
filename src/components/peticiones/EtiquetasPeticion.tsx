import { cn } from "@/lib/utils";
import {
  etiquetaEstado,
  etiquetaPrioridad,
  type EstadoPeticion,
  type PrioridadPeticion,
} from "../../../supabase/functions/_shared/peticiones";

const BASE = "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold";

const COLOR_ESTADO: Record<EstadoPeticion, string> = {
  nueva: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200",
  en_analisis: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  aceptada: "border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200",
  hecha: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  descartada: "border-border bg-muted text-muted-foreground",
};

const COLOR_PRIORIDAD: Record<PrioridadPeticion, string> = {
  baja: "border-border bg-background text-muted-foreground",
  normal: "border-border bg-secondary text-secondary-foreground",
  alta: "border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200",
  urgente: "border-transparent bg-destructive text-destructive-foreground",
};

export function BadgeEstado({ estado, className }: { estado: EstadoPeticion; className?: string }) {
  return (
    <span className={cn(BASE, COLOR_ESTADO[estado] ?? COLOR_ESTADO.nueva, className)} data-testid="estado-peticion">
      {etiquetaEstado(estado)}
    </span>
  );
}

export function BadgePrioridad({ prioridad, className }: { prioridad: PrioridadPeticion; className?: string }) {
  return (
    <span className={cn(BASE, COLOR_PRIORIDAD[prioridad] ?? COLOR_PRIORIDAD.normal, className)}>
      <span className="sr-only">Prioridad </span>
      {etiquetaPrioridad(prioridad)}
    </span>
  );
}
