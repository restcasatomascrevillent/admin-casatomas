import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTourSeccion } from "@/hooks/useTourSeccion";
import { TOUR_BOTON_AYUDA, type SeccionAyuda } from "@/lib/ayuda/tours";

/**
 * Botón «?» de la cabecera de una sección: lanza su tour guiado. Además, al
 * montarse, lanza el tour solo la primera vez que el usuario entra en la
 * sección y cuando se llega desde «Ver tour» del Centro de Ayuda.
 */
export function BotonAyuda({ seccion, className }: { seccion: SeccionAyuda; className?: string }) {
  const { lanzar } = useTourSeccion(seccion);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={lanzar}
      aria-label="Ayuda: ver cómo funciona esta pantalla"
      title="Ayuda: ver cómo funciona esta pantalla"
      data-tour={TOUR_BOTON_AYUDA}
      className={cn("h-11 w-11 shrink-0 text-muted-foreground hover:text-foreground", className)}
    >
      <HelpCircle className="h-5 w-5" aria-hidden="true" />
    </Button>
  );
}
