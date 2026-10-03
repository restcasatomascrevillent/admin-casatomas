// ============================================================================
// Etiqueta «Fuera de aforo» — para lo que está en una sala privada (el Reservado)
// ----------------------------------------------------------------------------
// Decisión del dueño (2026-10-03): el Reservado no cuenta en los aforos ni en las
// cifras de ocupación, pero el personal tiene que saber que está. Esta etiqueta
// se pone en la columna del Reservado del kanban, en sus reservas, en la Lista y
// en la rejilla de salas. No es interactiva (no lleva `onClick`): el `title` es
// solo una ayuda al pasar el ratón; el texto visible ya dice lo importante.
// La regla (qué sala es privada) vive en `src/lib/reservas/salaPrivada.ts`.
// ============================================================================

import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { AYUDA_FUERA_DE_AFORO, ETIQUETA_FUERA_DE_AFORO } from "@/lib/reservas/salaPrivada";

export function EtiquetaFueraDeAforo({ className }: { className?: string }) {
  return (
    <span
      data-testid="etiqueta-fuera-de-aforo"
      title={AYUDA_FUERA_DE_AFORO}
      className={cn(
        "inline-flex h-4 shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full border border-violet-300 bg-violet-50 px-1.5 text-[10px] font-medium leading-none text-violet-800",
        "dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200",
        className,
      )}
    >
      <Lock className="h-2.5 w-2.5" aria-hidden="true" />
      {ETIQUETA_FUERA_DE_AFORO}
    </span>
  );
}
