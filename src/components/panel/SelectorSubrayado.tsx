import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

/**
 * Selector de una opción entre pocas (periodo, intervalo…) como texto con subrayado en la elegida: sin cajas
 * ni color de acento (el dorado queda para la acción principal de la página). 40 px con ratón, 44 px con dedo.
 * Es un `ToggleGroup` de un solo valor (accesible como grupo de botones con `aria-pressed`/radio) y no deja
 * quedarse sin selección.
 *
 *   <SelectorSubrayado aria-label="Periodo" valor={String(dias)} onCambio={(v) => setDias(Number(v))}
 *     opciones={[{ valor: "30", etiqueta: "30 días" }, { valor: "90", etiqueta: "90 días" }]} />
 */
export interface OpcionSelectorSubrayado {
  valor: string;
  etiqueta: string;
}

interface SelectorSubrayadoProps {
  opciones: OpcionSelectorSubrayado[];
  valor: string;
  onCambio: (valor: string) => void;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  className?: string;
}

export function SelectorSubrayado({ opciones, valor, onCambio, className, ...aria }: SelectorSubrayadoProps) {
  return (
    <ToggleGroup
      type="single"
      value={valor}
      onValueChange={(v) => {
        if (v) onCambio(v);
      }}
      className={cn("justify-start gap-1", className)}
      {...aria}
    >
      {opciones.map((o) => (
        <ToggleGroupItem
          key={o.valor}
          value={o.valor}
          className="h-10 rounded-none border-b-2 border-transparent bg-transparent px-3 text-sm text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground data-[state=on]:border-foreground data-[state=on]:bg-transparent data-[state=on]:text-foreground pointer-coarse:h-11"
        >
          {o.etiqueta}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
