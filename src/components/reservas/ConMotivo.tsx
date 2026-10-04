import type { ReactNode } from "react";
import { toast } from "sonner";
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
 *
 * TÁCTIL (03/10/2026): con el dedo no hay «pasar el ratón», así que el `title`
 * nunca se veía. Al TOCAR el envoltorio (el control deshabilitado tiene
 * `pointer-events-none`, el toque cae aquí) se enseña el motivo en un aviso.
 * Si el toque cae sobre un control habilitado de dentro, el destino no es el
 * propio span y no se avisa de nada.
 *
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
    <span
      className={cn("inline-flex", className)}
      title={motivo || undefined}
      // Un toque sobre el envoltorio de un control apagado tampoco abre el menú de la tarjeta
      // (`ReservaCard`): el control tiene su propia respuesta (el aviso del motivo).
      data-sin-menu-tarjeta=""
      onClick={
        motivo
          ? (e) => {
              if (e.target !== e.currentTarget) return;
              toast.info(motivo, { id: `motivo:${motivo}` });
            }
          : undefined
      }
    >
      {children}
    </span>
  );
}
