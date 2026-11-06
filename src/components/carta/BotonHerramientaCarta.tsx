import { forwardRef, type ReactNode } from "react";
import { Portal as PortalAyuda } from "@radix-ui/react-tooltip";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props extends Omit<ButtonProps, "children" | "variant"> {
  icono: ReactNode;
  /** Texto del botón y su nombre accesible. */
  etiqueta: string;
  /**
   * Texto corto para cuando no cabe el largo: por debajo de 360 px (móvil
   * estrecho) y entre 1280 y 1536 px (escritorio con el menú lateral, donde la
   * barra va en una sola fila junto a las secciones). El nombre accesible sigue
   * siendo `etiqueta`, que contiene al corto.
   */
  etiquetaCorta?: string;
  /** Explicación al pasar el ratón (o con el foco del teclado). */
  ayuda: string;
  /** Nombre accesible si no es `etiqueta` (p. ej. con un contador). */
  nombreAccesible?: string;
  /** Algo detrás del texto (p. ej. «(3)»). */
  extra?: ReactNode;
}

/**
 * Botón secundario de la barra de Gestor Web › Carta («PDF Carta», «Ajustar
 * precios», «Varias botellas»): contorno, misma altura y radio que el resto
 * (40 px; 44 px con dedo), icono de 16 px y texto, con ayuda emergente.
 *
 * La ayuda va en un portal para que, abierta, no se cuele como hermana del
 * botón dentro de un grupo de botones unidos (rompería sus esquinas).
 */
export const BotonHerramientaCarta = forwardRef<HTMLButtonElement, Props>(function BotonHerramientaCarta(
  { icono, etiqueta, etiquetaCorta, ayuda, nombreAccesible, extra, className, type = "button", ...props },
  ref,
) {
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            ref={ref}
            type={type}
            variant="outline"
            aria-label={nombreAccesible ?? etiqueta}
            className={cn("min-w-0 px-3", className)}
            {...props}
          >
            {icono}
            {etiquetaCorta ? (
              <>
                <span aria-hidden="true" className="truncate min-[360px]:hidden xl:inline 2xl:hidden">
                  {etiquetaCorta}
                </span>
                <span aria-hidden="true" className="hidden truncate min-[360px]:inline xl:hidden 2xl:inline">
                  {etiqueta}
                </span>
              </>
            ) : (
              <span aria-hidden="true" className="truncate">
                {etiqueta}
              </span>
            )}
            {extra}
          </Button>
        </TooltipTrigger>
        <PortalAyuda>
          <TooltipContent side="bottom" className="max-w-64 text-center">
            {ayuda}
          </TooltipContent>
        </PortalAyuda>
      </Tooltip>
    </TooltipProvider>
  );
});
