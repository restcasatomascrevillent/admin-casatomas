import { AlertOctagon, CheckCircle2, MousePointerClick, FileText, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { EventoWeb } from "@/hooks/useLogsWeb";
import { cn } from "@/lib/utils";
import { describirEvento, desplazamiento, fmtHora, NOMBRE_CATEGORIA } from "./calculos";

const ICONO = { actividad: MousePointerClick, operacion: CheckCircle2, tecnico: Wrench, error: AlertOctagon } as const;
const COLOR = {
  actividad: "text-muted-foreground",
  operacion: "text-emerald-600 dark:text-emerald-400",
  tecnico: "text-sky-600 dark:text-sky-400",
  error: "text-destructive",
} as const;

interface LineaTiempoProps {
  eventos: EventoWeb[];
  /** Evento a resaltar (el error desde el que se abre el contexto). */
  resaltado?: number | null;
  onAbrirIncidencia?: (id: number) => void;
  onAbrirSesion?: (id: string) => void;
  /** En el recorrido de UNA sesión la marca bot/prueba/interno ya va en la cabecera: no se repite por fila. */
  sinMarcas?: boolean;
}

/** Recorrido en orden cronológico con el tiempo desde el primer evento y entre eventos. */
export function LineaTiempo({ eventos, resaltado, onAbrirIncidencia, onAbrirSesion, sinMarcas = false }: LineaTiempoProps) {
  if (!eventos.length) return <p className="py-4 text-sm italic text-muted-foreground">Sin eventos.</p>;
  const inicio = eventos[0].ocurrido_en;
  return (
    <ol className="relative space-y-1 border-l border-border pl-4" data-testid="linea-tiempo">
      {eventos.map((e, i) => {
        const Icono = ICONO[e.categoria] ?? FileText;
        const esResaltado = resaltado === e.id;
        return (
          <li
            key={e.id}
            data-testid="evento-linea"
            data-tipo={e.tipo}
            data-secuencia={e.secuencia ?? undefined}
            className={cn("relative rounded-md px-2 py-1 text-sm", esResaltado && "bg-destructive/10 ring-1 ring-destructive/40", e.categoria === "error" && !esResaltado && "bg-destructive/5")}
          >
            <span className={cn("absolute -left-[1.4rem] top-1.5 rounded-full bg-background p-0.5", COLOR[e.categoria])}>
              <Icono className="h-3.5 w-3.5" aria-label={NOMBRE_CATEGORIA[e.categoria]} />
            </span>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="tabular-nums text-xs text-muted-foreground" title={e.ocurrido_en}>
                {fmtHora(e.ocurrido_en)} · {i === 0 ? "inicio" : desplazamiento(inicio, e.ocurrido_en)}
              </span>
              <span className={cn("min-w-0 break-words", e.categoria === "error" && "text-destructive", e.categoria === "operacion" && "font-medium")}>{describirEvento(e)}</span>
              {e.ruta && e.tipo !== "pagina_vista" && e.tipo !== "pagina_salida" && <span className="text-xs text-muted-foreground">en {e.ruta}</span>}
              {e.incidencia_id && onAbrirIncidencia && (
                <button type="button" className="text-xs text-primary underline underline-offset-2" onClick={() => onAbrirIncidencia(e.incidencia_id!)}>
                  ver incidencia #{e.incidencia_id}
                </button>
              )}
              {e.sesion_id && onAbrirSesion && (
                <button type="button" className="text-xs text-primary underline underline-offset-2" onClick={() => onAbrirSesion(e.sesion_id!)}>
                  ver sesión
                </button>
              )}
              {!sinMarcas && (e.es_bot || e.es_interno || e.es_prueba) && (
                <Badge variant="outline" className="px-1 py-0 text-[10px]">{e.es_bot ? "bot" : e.es_prueba ? "prueba" : "interno"}</Badge>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
