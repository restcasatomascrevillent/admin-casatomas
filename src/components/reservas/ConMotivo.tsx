import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Envuelve un botón (o un ítem de menú) que puede salir DESHABILITADO para que
 * el motivo se vea al pasar el ratón por encima.
 *
 * Un `Button` o un `DropdownMenuItem` deshabilitado lleva `pointer-events-none`:
 * no recibe eventos de ratón y su propio `title` nunca llega a enseñarse («No
 * tienes permiso para editar reservas» no lo leía nadie). El `span` envolvente
 * sí los recibe. Es el mismo truco que `AccionIcono` en `ListaReservasAvanzada`.
 *
 * Sin `motivo` (el control está habilitado) no pone `title`: nada que explicar.
 * `className` ajusta cómo se coloca el envoltorio (`block` para un ítem de menú,
 * `flex` para un botón a todo el ancho); por defecto se comporta como el botón.
 */
export function ConMotivo({
  motivo,
  className,
  children,
}: {
  motivo?: string | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cn("inline-flex", className)} title={motivo || undefined}>
      {children}
    </span>
  );
}
