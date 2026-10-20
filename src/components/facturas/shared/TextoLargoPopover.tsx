import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Texto recortado que se lee entero con un toque (antes era un `Tooltip` con
 * `cursor-help`, que en una tablet no se podía abrir). Lo usan las celdas de
 * observaciones de las tablas de facturas y albaranes.
 */
export function TextoLargoPopover({ completo, corto }: { completo: string; corto: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Observaciones: ${completo}`}
          className="block min-h-11 w-full truncate rounded-sm text-left text-sm text-muted-foreground underline decoration-dotted underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {corto}
        </button>
      </PopoverTrigger>
      <PopoverContent
        collisionPadding={12}
        onClick={(e) => e.stopPropagation()}
        className="w-[min(24rem,calc(100vw-1.5rem))] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto whitespace-pre-wrap text-sm"
      >
        {completo}
      </PopoverContent>
    </Popover>
  );
}
