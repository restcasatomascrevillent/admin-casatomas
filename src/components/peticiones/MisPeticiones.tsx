import { Inbox, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import type { Peticion } from "@/lib/peticiones";
import { ESTADOS, etiquetaModulo } from "../../../supabase/functions/_shared/peticiones";
import { BadgeEstado, BadgePrioridad } from "./EtiquetasPeticion";
import { fechaCorta } from "./utilidades";

interface Props {
  peticiones: Peticion[] | undefined;
  cargando: boolean;
  error: unknown;
  onReintentar: () => void;
  onNueva?: () => void;
}

/** «Mis peticiones»: lo que ha enviado el usuario, su estado y, si se descartó, el motivo. */
export function MisPeticiones({ peticiones, cargando, error, onReintentar, onNueva }: Props) {
  if (error) {
    return <EstadoErrorCarga titulo="tus peticiones" onReintentar={onReintentar} />;
  }
  if (cargando && !peticiones) {
    return (
      <div className="flex justify-center py-10" role="status" aria-live="polite">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Cargando tus peticiones…</span>
      </div>
    );
  }
  if (!peticiones?.length) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center" data-testid="sin-peticiones">
        <Inbox className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Aún no has enviado ninguna petición.</p>
        {onNueva && <Button className="h-12" onClick={onNueva}>Nueva petición</Button>}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3" aria-label="Mis peticiones">
        {peticiones.map((p) => (
          <li key={p.id} className="rounded-lg border bg-card p-4" data-testid="mi-peticion">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="min-w-0 flex-1 break-words text-base font-semibold">{p.titulo}</h3>
              <BadgeEstado estado={p.estado} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <BadgePrioridad prioridad={p.prioridad} />
              <span>{etiquetaModulo(p.modulo)}</span>
              <span aria-hidden="true">·</span>
              <time dateTime={p.created_at}>{fechaCorta(p.created_at)}</time>
            </div>
            {p.estado === "descartada" && p.motivo_descarte && (
              <p className="mt-3 rounded-md bg-muted p-3 text-sm" data-testid="motivo-descarte">
                <span className="font-medium">Motivo: </span>
                {p.motivo_descarte}
              </p>
            )}
            <details className="mt-2 text-sm">
              <summary className="flex min-h-11 cursor-pointer items-center text-muted-foreground">Ver lo que escribiste</summary>
              <p className="whitespace-pre-wrap break-words pt-1">{p.descripcion}</p>
            </details>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {ESTADOS.map((e) => `${e.etiqueta}: ${e.ayuda.toLowerCase()}`).join(" · ")}.
      </p>
    </div>
  );
}
