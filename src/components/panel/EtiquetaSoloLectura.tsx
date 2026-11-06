import { Eye } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * «Solo lectura»: etiqueta discreta para las pantallas que alguien ve con el
 * permiso «Ver» pero sin «Editar» (06/11/2026, decisión del dueño: los botones
 * que no puede usar se OCULTAN y esta etiqueta explica por qué no están).
 * Va arriba, junto al título o a las pestañas de la sección.
 */
export function EtiquetaSoloLectura({
  className,
  texto = "Solo lectura",
  detalle = "Tienes permiso para ver esta sección, pero no para cambiarla. Si necesitas hacer cambios, pídeselo a un administrador.",
}: {
  className?: string;
  /** Texto visible (por defecto, «Solo lectura»). */
  texto?: string;
  /** Explicación al pasar el ratón y para lectores de pantalla. */
  detalle?: string;
}) {
  return (
    <span
      role="note"
      aria-label={`${texto}. ${detalle}`}
      title={detalle}
      data-testid="etiqueta-solo-lectura"
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-muted/60 px-2.5 text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      <Eye className="h-3.5 w-3.5" aria-hidden />
      {texto}
    </span>
  );
}
