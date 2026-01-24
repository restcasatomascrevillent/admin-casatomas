import { Switch } from "@/components/ui/switch";
import { UtensilsCrossed, Wine } from "lucide-react";
import { cn } from "@/lib/utils";

interface VisibilidadTogglesProps {
  restaurante: boolean;
  touza: boolean;
  onRestauranteChange: (checked: boolean) => void;
  onTouzaChange: (checked: boolean) => void;
  isPending?: boolean;
  compact?: boolean;
}

export function VisibilidadToggles({
  restaurante,
  touza,
  onRestauranteChange,
  onTouzaChange,
  isPending = false,
  compact = false,
}: VisibilidadTogglesProps) {
  return (
    <div className={cn(
      "flex gap-3 py-2 px-3 rounded-md bg-muted/50",
      compact && "gap-2 py-1.5 px-2"
    )}>
      <div className="flex items-center gap-2">
        <UtensilsCrossed className={cn("text-muted-foreground", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
        <span className={cn("text-muted-foreground", compact ? "text-xs" : "text-sm")}>Rest</span>
        <Switch
          checked={restaurante}
          onCheckedChange={onRestauranteChange}
          disabled={isPending}
          className={cn(
            "data-[state=checked]:bg-amber-600",
            compact && "scale-90"
          )}
        />
      </div>
      <div className="flex items-center gap-2">
        <Wine className={cn("text-muted-foreground", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
        <span className={cn("text-muted-foreground", compact ? "text-xs" : "text-sm")}>Touza</span>
        <Switch
          checked={touza}
          onCheckedChange={onTouzaChange}
          disabled={isPending}
          className={cn(
            "data-[state=checked]:bg-purple-600",
            compact && "scale-90"
          )}
        />
      </div>
    </div>
  );
}
