import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface BloqueProps {
  /** id del título (la sección se nombra con él). */
  id: string;
  titulo: ReactNode;
  /** Icono a la izquierda del título (lucide, 16 px). */
  icono?: ReactNode;
  descripcion?: ReactNode;
  /** Botones a la derecha del título (bajan de línea si no caben). */
  acciones?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Bloque de las pestañas de Super Admin › Servicios: tarjeta con borde fino,
 * título pequeño (h2) y, a la derecha, sus acciones. Todos los bloques de las
 * cuatro pestañas tienen la misma cara.
 */
export function Bloque({ id, titulo, icono, descripcion, acciones, children, className }: BloqueProps) {
  return (
    <section aria-labelledby={id} className={cn("flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-3 sm:p-4", className)}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-[1_1_14rem]">
          <h2 id={id} className="flex items-center gap-2 text-base font-semibold leading-tight text-foreground">
            {icono && <span className="inline-flex shrink-0 text-muted-foreground [&>svg]:h-4 [&>svg]:w-4" aria-hidden="true">{icono}</span>}
            <span className="min-w-0">{titulo}</span>
          </h2>
          {descripcion && <p className="mt-1 text-sm text-muted-foreground">{descripcion}</p>}
        </div>
        {acciones && <div className="flex min-w-0 flex-wrap items-center gap-2">{acciones}</div>}
      </div>
      {children}
    </section>
  );
}
