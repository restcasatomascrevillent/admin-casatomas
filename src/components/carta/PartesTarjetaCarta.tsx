import { Camera, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Categoría del elemento, discreta, encima del nombre. Sirve sobre todo al
 * buscar: la búsqueda mezcla categorías y sin esto no se sabe de dónde es cada
 * tarjeta.
 */
export function EtiquetaCategoria({ categoria, className }: { categoria: string | null | undefined; className?: string }) {
  if (!categoria?.trim()) return null;
  return (
    <Badge
      variant="outline"
      title={`Categoría: ${categoria}`}
      className={cn(
        "max-w-full rounded-md border-muted-foreground/25 px-1.5 py-0 text-[11px] font-medium leading-5 text-muted-foreground",
        className,
      )}
    >
      <span className="truncate">{categoria}</span>
    </Badge>
  );
}

interface AccionesTarjetaProps {
  /** Para los títulos: «Cambiar la foto de Croquetas». */
  nombre: string | null | undefined;
  tieneFoto: boolean;
  onFoto: () => void;
  onEditar: () => void;
  onEliminar: () => void;
}

// Con dedo, `size="sm"` sube el relleno a px-4: aquí se fuerza px-1.5 para que
// los tres botones quepan en una tarjeta de móvil (≈ 300 px de ancho).
const CLASE_BOTON = "h-11 min-w-0 gap-1.5 px-1.5 pointer-coarse:px-1.5";

/**
 * Los tres botones de cada tarjeta de la carta, en una fila y del mismo ancho:
 * «Foto» (sube o cambia la foto sin abrir la ficha entera), «Editar» y
 * «Eliminar».
 */
export function AccionesTarjeta({ nombre, tieneFoto, onFoto, onEditar, onEliminar }: AccionesTarjetaProps) {
  const quien = nombre?.trim() || "este elemento";
  return (
    <div className="grid grid-cols-3 gap-1.5 border-t pt-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={CLASE_BOTON}
        title={tieneFoto ? `Cambiar la foto de ${quien}` : `Añadir una foto a ${quien}`}
        onClick={onFoto}
      >
        <Camera />
        <span className="truncate">Foto</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(CLASE_BOTON, "text-blue-600 hover:bg-blue-50 hover:text-blue-700")}
        title={`Editar ${quien}`}
        onClick={onEditar}
      >
        <Pencil />
        <span className="truncate">Editar</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(CLASE_BOTON, "text-destructive hover:bg-destructive/10 hover:text-destructive")}
        title={`Eliminar ${quien}`}
        onClick={onEliminar}
      >
        <Trash2 />
        <span className="truncate">Eliminar</span>
      </Button>
    </div>
  );
}
