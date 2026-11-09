import { AlertTriangle, CheckCircle2, CircleSlash, Clock } from "lucide-react";
import type { EstadoRecogidaDatos } from "@/hooks/useLogsWeb";
import { cn } from "@/lib/utils";
import { estadoRecogida } from "./calculos";

const ESTILO = {
  ok: { clase: "border-emerald-300 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-100", Icono: CheckCircle2 },
  aviso: { clase: "border-amber-300 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100", Icono: AlertTriangle },
  sin_actividad: { clase: "border-border bg-muted/50 text-foreground", Icono: CircleSlash },
  sin_datos_aun: { clase: "border-border bg-muted/50 text-foreground", Icono: Clock },
  parada: { clase: "border-destructive/50 bg-destructive/5 text-destructive", Icono: AlertTriangle },
} as const;

/**
 * Salud de la recogida: «no hay actividad» (nadie visita) no es lo mismo que
 * «la recogida se ha parado» (Vercel ve visitas y a nosotros no llega nada).
 */
export function EstadoRecogidaAviso({ datos }: { datos: EstadoRecogidaDatos | undefined }) {
  const e = estadoRecogida(datos);
  if (!e) return null;
  const { clase, Icono } = ESTILO[e.nivel];
  return (
    <div role={e.nivel === "parada" ? "alert" : "status"} data-testid="estado-recogida" data-nivel={e.nivel} className={cn("rounded-md border p-3 text-sm", clase)}>
      <p className="flex items-start gap-2 font-medium">
        <Icono className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>{e.titulo}</span>
      </p>
      <p className="mt-0.5 pl-6 text-xs opacity-90">{e.detalle}</p>
      {e.avisos.length > 0 && (
        <ul className="mt-1 list-disc pl-10 text-xs">
          {e.avisos.map((a) => <li key={a}>{a}</li>)}
        </ul>
      )}
    </div>
  );
}
