import { cn } from "@/lib/utils";
import { DIAS_RENOVACION_CERCANA, type Renovacion, fechaCorta, textoDias } from "@/lib/servicios";

/**
 * Próximas renovaciones (la fecha apuntada y lo que dicen las APIs: dominios y
 * suscripciones), de la más cercana a la más lejana. Las ya pasadas en rojo y
 * las de 30 días o menos en ámbar, siempre con la fecha y los días escritos.
 */
export function ListaRenovaciones({ renovaciones, max = 6, idTitulo }: { renovaciones: Renovacion[]; max?: number; idTitulo: string }) {
  if (renovaciones.length === 0) {
    return <p className="text-sm text-muted-foreground">Ninguna fecha apuntada. Ponlas en «Editar» de cada servicio (por ejemplo, la caducidad del dominio).</p>;
  }
  return (
    <ul className="min-w-0 divide-y divide-border/60" aria-labelledby={idTitulo}>
      {renovaciones.slice(0, max).map((r) => {
        const cerca = r.dias <= DIAS_RENOVACION_CERCANA;
        return (
          <li key={`${r.proveedor}-${r.concepto}-${r.fecha}`} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 text-sm first:pt-0 last:pb-0">
            <span className="min-w-0 break-words">
              <span className="font-medium text-foreground">{r.nombre}</span>
              <span className="text-muted-foreground"> · {r.concepto}{r.deLaApi ? " (según su API)" : ""}</span>
            </span>
            <span className={cn("tabular-nums", r.dias < 0 ? "font-medium text-red-800 dark:text-red-300" : cerca ? "font-medium text-amber-900 dark:text-amber-200" : "text-muted-foreground")}>
              {fechaCorta(r.fecha)} · {r.dias < 0 ? `pasó ${textoDias(r.dias)}` : textoDias(r.dias)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
