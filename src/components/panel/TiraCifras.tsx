import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Una línea de cifras: etiqueta pequeña y gris encima, cifra debajo, separadas por una raya vertical fina.
 * Sin tarjetas, sin fondos y sin iconos decorativos. Si no caben se envuelve en una segunda línea (las rayas
 * del borde izquierdo de cada línea quedan recortadas). El color solo se usa para avisar: `tono` «ambar» o «rojo».
 *
 *   <TiraCifras cifras={[
 *     { etiqueta: "Activas", valor: 26 },
 *     { etiqueta: "Pendientes", valor: 2, tono: "ambar", onClick: irAPendientes },
 *     { etiqueta: "Próxima", valor: "13:00" },
 *   ]} />
 */
export interface CifraTira {
  etiqueta: string;
  valor: ReactNode;
  /** Texto pequeño pegado a la cifra («de 150», «pax»). */
  detalle?: string;
  tono?: "ambar" | "rojo";
  /** Si se da, la cifra es un botón (44 px con dedo). */
  onClick?: () => void;
}

interface TiraCifrasProps {
  cifras: CifraTira[];
  className?: string;
  "data-testid"?: string;
}

const TONO_VALOR = {
  ambar: "text-amber-600 dark:text-amber-400",
  rojo: "text-red-600 dark:text-red-400",
} as const;

function Contenido({ c }: { c: CifraTira }) {
  return (
    <>
      <span className="block text-xs leading-tight text-muted-foreground">{c.etiqueta}</span>
      <span className="flex items-baseline gap-1">
        <span className={cn("text-xl font-semibold leading-tight tabular-nums", c.tono && TONO_VALOR[c.tono])}>{c.valor}</span>
        {c.detalle && <span className="text-xs text-muted-foreground">{c.detalle}</span>}
      </span>
    </>
  );
}

export function TiraCifras({ cifras, className, "data-testid": testId }: TiraCifrasProps) {
  return (
    // `overflow-hidden` + `-ml-4` en la lista: el borde izquierdo del primer elemento de CADA línea queda fuera
    // y solo se ven las rayas entre cifras, también cuando se envuelve.
    <div className={cn("overflow-hidden", className)} data-testid={testId}>
      <ul className="-ml-4 flex flex-wrap gap-y-2">
        {cifras.map((c) => (
          <li key={c.etiqueta} className="border-l border-border/70 pl-4 pr-4 first:border-l-0">
            {c.onClick ? (
              <button
                type="button"
                onClick={c.onClick}
                className="-my-1 rounded-sm py-1 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
              >
                <Contenido c={c} />
              </button>
            ) : (
              <Contenido c={c} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
