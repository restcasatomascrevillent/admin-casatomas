import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { horaCorta } from "@/lib/reservas/ocupacionSalas";
import { ESTADO_NO_SHOW, infoEstadoReserva } from "@/lib/reservas/estadosReserva";

// ============================================================================
// Un renglón de la Lista (11/11/2026, «ajusta la estética de lista»): la misma
// rejilla en todas las filas para que hora, nombre, personas, sala y estado
// queden en columna. Lo usan la hoja del día (`ReservasDeLaHoja`) y los
// resultados del buscador y de «Pendientes» (`ResultadosLista`).
// En el móvil la sala no sale (no cabe).
// ============================================================================

export interface DatosRenglon {
  id: string;
  hora: string;
  nombre: string | null;
  numero_comensales: number;
  estado: string;
  notas_cliente?: string | null;
  telefono?: string | null;
}

interface Props {
  reserva: DatosRenglon;
  sala?: string | null;
  resaltada?: boolean;
  /** Teléfono bajo el nombre (en los resultados de búsqueda: ayuda a distinguir a dos «María»). */
  conTelefono?: boolean;
  onAbrir?: (id: string) => void;
}

export function RenglonReserva({ reserva: r, sala, resaltada = false, conTelefono = false, onAbrir }: Props) {
  const info = infoEstadoReserva(r.estado);
  const hora = horaCorta(r.hora) ?? r.hora;
  const debajo = [conTelefono ? r.telefono : null].filter(Boolean).join(" · ");
  const contenido = (
    <>
      <span className="font-semibold tabular-nums">{hora}</span>
      <span className="min-w-0">
        <span className="block break-words font-medium leading-snug">{r.nombre || "Sin nombre"}</span>
        {debajo ? <span className="block truncate text-sm text-muted-foreground tabular-nums">{debajo}</span> : null}
        {r.notas_cliente ? <span className="block truncate text-sm text-amber-800 dark:text-amber-300">{r.notas_cliente}</span> : null}
      </span>
      <span className="justify-self-end rounded-md border px-2 py-0.5 text-sm font-semibold tabular-nums">{r.numero_comensales} px</span>
      <span className="hidden truncate text-sm text-muted-foreground sm:block">{sala ?? "—"}</span>
      <span className="flex justify-end">
        {info && (
          <Badge className={cn("text-xs", info.insignia)} variant={info.varianteInsignia}>
            {info.etiqueta}
          </Badge>
        )}
      </span>
    </>
  );
  const clases =
    "grid min-h-14 w-full grid-cols-[3.25rem_minmax(0,1fr)_auto_auto] items-center gap-x-3 px-3 py-2 text-left text-base sm:grid-cols-[3.5rem_minmax(0,1fr)_4rem_8rem_7rem]";
  return (
    <li className={cn("border-b border-border/60 last:border-b-0", r.estado === ESTADO_NO_SHOW && "opacity-60", resaltada && "bg-amber-100 dark:bg-amber-900/30")}>
      {onAbrir ? (
        <button
          type="button"
          className={cn(clases, "rounded-md hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
          onClick={() => onAbrir(r.id)}
          aria-label={`Abrir la reserva de ${r.nombre || "Sin nombre"}, ${hora}, ${r.numero_comensales} personas`}
        >
          {contenido}
        </button>
      ) : (
        <div className={clases}>{contenido}</div>
      )}
    </li>
  );
}
