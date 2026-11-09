import { useQueries, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { generacionActiva, leerUltimaGeneracion, listarProyectos, type Generacion } from "@/components/rrss/api";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { InsigniaEstado } from "@/components/instagram/InsigniaEstado";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ESTILOS } from "@/lib/rrss/estilos";
import { formatoSalida, NOMBRE_CANAL } from "@/lib/rrss/formatos";
import { cn } from "@/lib/utils";
import { infoEstadoTrabajo } from "./estadoTrabajo";
import { CLAVES, INTERVALO_SEGUIMIENTO } from "./useTrabajo";
import { fechaCorta } from "./util";

interface Props {
  origen: "editor" | "facebook";
  actual: string | null;
  onAbrir: (id: string) => void;
  onNuevo: () => void;
}

export function ListaTrabajos({ origen, actual, onAbrir, onNuevo }: Props) {
  const lista = useQuery({ queryKey: CLAVES.proyectos(origen), queryFn: () => listarProyectos({ origen, limite: 30 }), refetchOnWindowFocus: true });
  const proyectos = lista.data ?? [];
  const generaciones = useQueries({
    queries: proyectos.map((p) => ({
      queryKey: CLAVES.generacion(p.id),
      queryFn: () => leerUltimaGeneracion(p.id),
      staleTime: 15_000,
      refetchInterval: (q: { state: { data?: Generacion | null } }) => (generacionActiva(q.state.data) ? INTERVALO_SEGUIMIENTO : false),
    })),
  });

  return (
    <nav aria-label="Trabajos recientes" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Trabajos</h2>
        <Button type="button" size="sm" className="gap-1" onClick={onNuevo}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Nuevo trabajo
        </Button>
      </div>

      {lista.isLoading && (
        <div className="space-y-2" aria-busy="true" aria-label="Cargando los trabajos">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}
      {lista.isError && <EstadoErrorCarga titulo="los trabajos" error={lista.error} onReintentar={() => void lista.refetch()} />}
      {!lista.isLoading && !lista.isError && proyectos.length === 0 && (
        <p data-testid="sin-trabajos" className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Aún no hay trabajos. Pulsa «Nuevo trabajo» o sube una foto para empezar.
        </p>
      )}

      <ul className="space-y-2">
        {proyectos.map((p, i) => {
          const g = generaciones[i]?.data;
          const f = formatoSalida(p.canal, p.tipo);
          return (
            <li key={p.id}>
              <button
                type="button"
                data-testid={`trabajo:${p.id}`}
                aria-current={p.id === actual ? "true" : undefined}
                onClick={() => onAbrir(p.id)}
                className={cn("flex min-h-11 w-full flex-col gap-1 rounded-md border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", p.id === actual ? "border-primary bg-primary/5" : "hover:bg-muted")}
              >
                <span className="truncate text-sm font-medium">{p.titulo || `${f.etiqueta} sin título`}</span>
                <span className="text-xs text-muted-foreground">
                  {NOMBRE_CANAL[p.canal]} · {f.etiqueta} · {ESTILOS[p.estilo]?.nombre.split(" ")[0] ?? p.estilo} · {fechaCorta(p.updated_at)}
                </span>
                <InsigniaEstado info={infoEstadoTrabajo(p, g)} className="self-start" />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
