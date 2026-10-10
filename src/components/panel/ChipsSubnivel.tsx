import type { ReactNode } from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * Segundo nivel de pestañas como «chips» (píldoras): para sub-secciones dentro de una pestaña de página
 * (Bebidas/Comida, Inventario/Historial) sin dibujar una segunda barra de pestañas con subrayado. El chip activo
 * lleva fondo suave y texto fuerte, sin dorado. Debe ir DENTRO de un `<Tabs>` de shadcn; 36 px con ratón y 44 px
 * con dedo.
 *
 *   <Tabs value={sub} onValueChange={setSub}>
 *     <ChipsSubnivel chips={[{ valor: "bebidas", etiqueta: "Bebidas", icono: <Wine /> }, { valor: "comida", etiqueta: "Comida" }]} />
 *     <TabsContent value="bebidas">…</TabsContent>
 *   </Tabs>
 */
export interface ChipSubnivel {
  valor: string;
  etiqueta: ReactNode;
  icono?: ReactNode;
}

interface ChipsSubnivelProps {
  chips: ChipSubnivel[];
  className?: string;
}

export function ChipsSubnivel({ chips, className }: ChipsSubnivelProps) {
  return (
    <TabsList data-testid="chips-subnivel" className={cn("h-auto shrink-0 justify-start gap-1.5 bg-transparent p-0", className)}>
      {chips.map((c) => (
        <TabsTrigger
          key={c.valor}
          value={c.valor}
          className="h-9 gap-1.5 rounded-full border border-transparent px-3.5 text-sm text-muted-foreground shadow-none hover:text-foreground data-[state=active]:border-border data-[state=active]:bg-muted data-[state=active]:text-foreground data-[state=active]:shadow-none pointer-coarse:h-11"
        >
          {c.icono && (
            <span aria-hidden="true" className="inline-flex shrink-0 [&>svg]:h-4 [&>svg]:w-4">
              {c.icono}
            </span>
          )}
          {c.etiqueta}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
