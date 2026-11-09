import { Link } from "react-router-dom";
import { MousePointerClick } from "lucide-react";
import { useConfigLogs } from "@/hooks/useLogsWeb";
import { ComportamientoWeb } from "./ComportamientoWeb";
import { ResumenIa } from "./ResumenIa";

/**
 * Tráfico web › Comportamiento: lo que hacen los visitantes (eventos propios
 * con consentimiento), en el mismo periodo que el resto de la página. Las
 * cifras salen de la misma RPC que Super Admin › Logs › Estadísticas: no hay
 * dos sistemas con cifras distintas.
 */
export function SeccionComportamiento({ desde, hasta }: { desde: string; hasta: string }) {
  const config = useConfigLogs();
  // El entorno de ESTA base de datos (la demo enseña lo que se ha registrado en la demo).
  const entorno = config.data?.entorno_bd ?? null;
  return (
    <section className="space-y-3" data-testid="seccion-comportamiento">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <MousePointerClick className="h-4 w-4 text-muted-foreground" aria-hidden /> Comportamiento de los visitantes
        </h2>
        <Link to="/super-admin/logs?tab=estadisticas" className="text-sm text-primary underline underline-offset-2">Ver recorridos y errores en Logs</Link>
      </div>
      {config.isError ? (
        <p className="text-sm text-muted-foreground">El comportamiento estará disponible cuando se aplique la migración de Logs.</p>
      ) : entorno ? (
        <>
          <ComportamientoWeb desde={desde} hasta={hasta} entorno={entorno} contexto="trafico" />
          <ResumenIa desde={desde} hasta={hasta} entorno={entorno} />
        </>
      ) : null}
    </section>
  );
}
