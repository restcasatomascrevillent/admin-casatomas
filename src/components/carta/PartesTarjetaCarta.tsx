import { Camera, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LineaEstado } from "./estadoLectura";

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
        "max-w-full rounded-md border-muted-foreground/25 px-1.5 py-0 text-[11px] pointer-coarse:text-xs font-medium leading-5 text-muted-foreground",
        className,
      )}
    >
      <span className="truncate">{categoria}</span>
    </Badge>
  );
}

/**
 * Con solo «Ver» en la carta (sin «Editar», decisión del dueño del 06/11/2026): en vez de los
 * interruptores, dónde se publica el elemento, en texto. Una línea por dato; `aviso` en rojo
 * (no sale en la web) o ámbar (falta el origen del vino).
 */
export function EstadoLectura({ lineas }: { lineas: ReadonlyArray<LineaEstado | false | null | undefined> }) {
  const visibles = lineas.filter((l): l is LineaEstado => Boolean(l));
  if (visibles.length === 0) return null;
  return (
    <ul data-testid="estado-lectura" className="space-y-0.5 rounded-md bg-muted/50 px-2 py-1.5 text-sm">
      {visibles.map((l) => (
        <li
          key={l.texto}
          className={cn(
            "leading-snug",
            l.tono === "apagado" ? "font-medium text-destructive" : l.tono === "aviso" ? "font-medium text-amber-800 dark:text-amber-300" : "text-muted-foreground",
          )}
        >
          {l.texto}
        </li>
      ))}
    </ul>
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
