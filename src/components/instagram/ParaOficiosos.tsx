/**
 * Detalles técnicos plegados («Para Oficiosos»): ids, URLs, errores en bruto
 * de Meta, nombres de secretos… El dueño no los necesita para trabajar, pero
 * Oficiosos sí para arreglar algo. Cerrado por defecto.
 */
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function ParaOficiosos({ children, className, titulo = "Para Oficiosos" }: { children: ReactNode; className?: string; titulo?: string }) {
  return (
    <details className={cn("group rounded-md text-xs text-muted-foreground", className)} data-testid="para-oficiosos">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded py-1 font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" aria-hidden="true" />
        {titulo}
      </summary>
      <div className="mt-1 space-y-1 break-words">{children}</div>
    </details>
  );
}
