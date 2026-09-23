import type { ReactNode } from "react";

interface CabeceraPestanaProps {
  titulo: string;
  descripcion?: ReactNode;
  /** Botones de acción alineados a la derecha (se apilan debajo en móvil). */
  acciones?: ReactNode;
}

/**
 * Cabecera común de todas las pestañas del Gestor Web: mismo tamaño de
 * título, misma descripción y acciones siempre en el mismo sitio, para que
 * Carta, Novedades, Menús, Tapas y Bot se lean como una sola herramienta.
 */
export function CabeceraPestana({ titulo, descripcion, acciones }: CabeceraPestanaProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h3 className="text-xl font-semibold tracking-tight">{titulo}</h3>
        {descripcion && <p className="text-sm text-muted-foreground mt-0.5">{descripcion}</p>}
      </div>
      {acciones && <div className="flex flex-wrap items-center gap-2 shrink-0">{acciones}</div>}
    </div>
  );
}
