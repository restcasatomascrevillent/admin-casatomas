import { AlertCircle, Check, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface EstadoGuardadoBadgeProps {
  dirty: boolean;
  saving: boolean;
  error?: string | null;
}

// Estado de guardado honesto: nunca dice "guardado" hasta que Supabase
// confirma el UPDATE/INSERT, y si falla lo dice con el motivo en vez de
// quedarse callado o mostrar un mensaje optimista. El detalle del error va
// en title/sr-only (y en el toast) para no desbordar la barra superior.
export function EstadoGuardadoBadge({ dirty, saving, error }: EstadoGuardadoBadgeProps) {
  if (saving) {
    return (
      <Badge variant="outline" className="gap-1.5 text-muted-foreground font-normal whitespace-nowrap">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        Guardando…
      </Badge>
    );
  }
  if (error) {
    return (
      // El motivo se lee en pantalla (antes solo en `title`/lector de pantalla: con el dedo no se veía).
      <Badge variant="destructive" className="max-w-full items-start gap-1.5 whitespace-normal text-left">
        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        <span>
          Error al guardar<span className="font-normal">: {error}</span>
        </span>
      </Badge>
    );
  }
  if (dirty) {
    return (
      <Badge variant="outline" className="gap-1.5 border-amber-400 text-amber-700 dark:text-amber-400 font-normal whitespace-nowrap">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
        Cambios sin guardar
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1.5 text-muted-foreground font-normal whitespace-nowrap">
      <Check className="h-3 w-3" aria-hidden="true" />
      Guardado
    </Badge>
  );
}
