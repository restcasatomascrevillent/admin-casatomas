import { Switch } from "@/components/ui/switch";
import { EyeOff, UtensilsCrossed, Wine } from "lucide-react";
import { cn } from "@/lib/utils";

interface VisibilidadTogglesProps {
  restaurante?: boolean;
  touza?: boolean;
  onRestauranteChange?: (checked: boolean) => void;
  onTouzaChange?: (checked: boolean) => void;
  isPending?: boolean;
  compact?: boolean;
  /**
   * Estado de publicación (columna `activado`). Es opcional para no romper
   * usos antiguos: si no se pasa `onActivadoChange`, el control no se pinta.
   */
  activado?: boolean;
  onActivadoChange?: (checked: boolean) => void;
  isActivadoPending?: boolean;
}

export function VisibilidadToggles({
  restaurante,
  touza = false,
  onRestauranteChange,
  onTouzaChange,
  isPending = false,
  compact = false,
  activado,
  onActivadoChange,
  isActivadoPending = false,
}: VisibilidadTogglesProps) {
  const estaActivado = activado ?? true;

  return (
    <div className="space-y-1.5">
      {(onRestauranteChange || onTouzaChange) && (
        <div
          className={cn(
            "flex gap-3 py-2 px-3 rounded-md bg-muted/50",
            compact && "gap-2 py-1.5 px-2"
          )}
        >
          {onRestauranteChange && (
            <label className="flex min-h-11 cursor-pointer items-center gap-2">
              <UtensilsCrossed className={cn("text-muted-foreground", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
              <span className={cn("text-muted-foreground", "text-sm")}>Restaurante</span>
              <Switch
                checked={restaurante}
                onCheckedChange={onRestauranteChange}
                disabled={isPending}
                className={cn(
                  "data-[state=checked]:bg-amber-600"
                )}
              />
            </label>
          )}
          {onTouzaChange && (
            <label className="flex min-h-11 cursor-pointer items-center gap-2">
              <Wine className={cn("text-muted-foreground", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
              <span className={cn("text-muted-foreground", "text-sm")}>Touza</span>
              <Switch
                checked={touza}
                onCheckedChange={onTouzaChange}
                disabled={isPending}
                className={cn(
                  "data-[state=checked]:bg-purple-600"
                )}
              />
            </label>
          )}
        </div>
      )}

      {/*
        Despublicar sin borrar. Hasta ahora `toggleActivado` existía en los
        hooks pero no se exportaba, así que la única forma de quitar algo de la
        web era eliminarlo. Un elemento despublicado sigue en el panel y en la
        base de datos; simplemente deja de salir en las webs.
      */}
      {onActivadoChange && (
        <label
          className={cn(
            "flex min-h-11 cursor-pointer items-center justify-between gap-2 py-2 px-3 rounded-md",
            compact && "py-1.5 px-2",
            estaActivado ? "bg-muted/50" : "bg-destructive/10"
          )}
        >
          <div className="flex items-center gap-2 min-w-0">
            <EyeOff
              className={cn(
                estaActivado ? "text-muted-foreground" : "text-destructive",
                compact ? "h-3.5 w-3.5" : "h-4 w-4"
              )}
            />
            <span
              className={cn(
                "truncate",
                "text-sm",
                estaActivado ? "text-muted-foreground" : "text-destructive font-medium"
              )}
            >
              {estaActivado ? "Activo (se publica en la web)" : "Despublicado (no sale en la web)"}
            </span>
          </div>
          <Switch
            checked={estaActivado}
            onCheckedChange={onActivadoChange}
            disabled={isActivadoPending}
            aria-label={estaActivado ? "Despublicar de la web" : "Volver a publicar en la web"}
            className={cn(
              "data-[state=checked]:bg-emerald-600"
            )}
          />
        </label>
      )}
    </div>
  );
}
