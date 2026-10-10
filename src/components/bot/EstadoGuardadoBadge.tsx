import { AlertCircle, Check, Loader2 } from "lucide-react";

interface EstadoGuardadoBadgeProps {
  dirty: boolean;
  saving: boolean;
  error?: string | null;
}

// Estado de guardado honesto, en texto plano con punto/icono (sin cajas): nunca
// dice "guardado" hasta que Supabase confirma el UPDATE/INSERT, y si falla lo
// dice con el motivo en vez de quedarse callado o mostrar un mensaje optimista.
export function EstadoGuardadoBadge({ dirty, saving, error }: EstadoGuardadoBadgeProps) {
  if (saving) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Guardando…
      </span>
    );
  }
  if (error) {
    return (
      // El motivo se lee en pantalla (con el dedo no hay `title`).
      <span role="alert" className="inline-flex max-w-full items-start gap-1.5 text-left text-sm text-destructive">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          Error al guardar<span className="font-normal">: {error}</span>
        </span>
      </span>
    );
  }
  if (dirty) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-amber-700 dark:text-amber-400">
        <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
        Cambios sin guardar
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground">
      <Check className="h-3.5 w-3.5" aria-hidden="true" />
      Guardado
    </span>
  );
}
