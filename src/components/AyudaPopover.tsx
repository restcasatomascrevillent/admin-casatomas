import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface AyudaPopoverProps {
  /** Nombre accesible del botón (lo que lee el lector de pantalla). */
  etiqueta: string;
  children: ReactNode;
  className?: string;
  /** Clases extra para el contenido desplegado. */
  contentClassName?: string;
  /** Icono del botón (por defecto una "i"). */
  icono?: ReactNode;
}

/**
 * Ayuda contextual que funciona con el dedo. Sustituye a los `Tooltip` que
 * solo aparecen al pasar el ratón o al enfocar con teclado: en una tablet no
 * hay hover y Radix no abre el tooltip con un toque, así que esa información
 * no se podía leer. Aquí un toque abre y otro toque fuera la cierra.
 *
 * El icono es pequeño (16px) pero el área pulsable mide 44x44 gracias al
 * margen negativo: no descuadra la línea de texto en la que va metido.
 */
export function AyudaPopover({ etiqueta, children, className, contentClassName, icono }: AyudaPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={etiqueta}
          className={cn(
            "-m-3.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          {icono ?? <Info className="h-4 w-4" aria-hidden="true" />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        collisionPadding={12}
        // El contenido se pinta en un portal pero los eventos de React suben por
        // el árbol: sin esto, un toque aquí dentro activaría el onClick de la
        // fila/tarjeta que contiene el botón.
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "w-[min(20rem,calc(100vw-1.5rem))] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto text-sm leading-relaxed",
          contentClassName,
        )}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
