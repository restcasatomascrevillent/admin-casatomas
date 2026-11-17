import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Desplegable nativo (en el móvil abre el selector del sistema), con objetivo táctil de 44 px. */
export const CLASE_SELECT = "h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";

export function Campo({ id, etiqueta, children, className }: { id: string; etiqueta: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <Label htmlFor={id}>{etiqueta}</Label>
      {children}
    </div>
  );
}

interface PropsSelectLista {
  id: string;
  valor: string;
  onCambio: (valor: string) => void;
  /** Los valores del desplegable del propio Excel. */
  opciones: readonly string[];
  /** Texto de la opción «sin valor»; sin él, hay que elegir uno. */
  vacio?: string;
  disabled?: boolean;
}

/**
 * Desplegable con los valores que admite esa columna del Excel. Si la celda
 * tiene un valor que ya no está en la lista, se conserva como opción.
 */
export function SelectLista({ id, valor, onCambio, opciones, vacio, disabled }: PropsSelectLista) {
  const fuera = valor !== "" && !opciones.includes(valor);
  return (
    <select id={id} className={CLASE_SELECT} value={valor} disabled={disabled} onChange={(e) => onCambio(e.target.value)}>
      {(vacio !== undefined || valor === "") && <option value="">{vacio ?? "Elegir…"}</option>}
      {fuera && <option value={valor}>{valor}</option>}
      {opciones.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
