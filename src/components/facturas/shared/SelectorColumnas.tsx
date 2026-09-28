import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Settings2 } from "lucide-react";
import { PRESUPUESTO_LG, PESOS, pesoVisible, cabeColumna } from "./tabla";

export type ColumnaType = {
  key: string;
  label: string;
};

/**
 * Selector de columnas CON TOPE.
 *
 * Antes ofrecia doce columnas conmutables sin ningun limite, o sea que era la
 * otra mitad del problema del scroll horizontal: aunque se quite el `min-w` de
 * la tabla, con dos clics se podian encender mas columnas de las que caben y
 * los importes volvian a salir cortados.
 *
 * Ahora cada columna declara lo que pide como minimo en la franja estrecha
 * (ver `PESOS` en `tabla.ts`) y la suma no puede pasar de `PRESUPUESTO_LG`.
 * Lo que no cabe sale deshabilitado explicando por que, en vez de dejar que
 * reaparezca el recorte. Apagar siempre se puede.
 */
export const SelectorColumnas = ({
  columnas,
  visibles,
  onChange,
}: {
  columnas: ColumnaType[];
  visibles: Record<string, boolean>;
  onChange: (key: string, checked: boolean) => void;
}) => {
  const usado = pesoVisible(visibles);
  const libre = Math.max(0, PRESUPUESTO_LG - usado);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 border-border/50 shadow-sm transition-colors hover:bg-muted/50"
        >
          <Settings2 className="h-4 w-4" />
          Columnas
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60" align="end">
        <p className="text-sm font-medium">Columnas visibles</p>
        <p className="mb-3 mt-1 text-xs text-muted-foreground">
          Solo caben las que se puedan leer enteras. Para añadir otra, quita una antes.
        </p>
        <div className="space-y-2">
          {columnas.map((col) => {
            const activa = visibles[col.key] === true;
            const cabe = cabeColumna(visibles, col.key);
            const bloqueada = !activa && !cabe;
            return (
              <label
                key={col.key}
                title={
                  bloqueada
                    ? `"${col.label}" necesita ${PESOS[col.key] ?? 0} px y solo quedan ${libre} px. Quita otra columna primero.`
                    : undefined
                }
                className={`flex items-center gap-2 text-sm ${
                  bloqueada ? "cursor-not-allowed opacity-40" : "cursor-pointer"
                }`}
              >
                <Checkbox
                  checked={activa}
                  disabled={bloqueada}
                  onCheckedChange={(checked) => onChange(col.key, !!checked)}
                />
                {col.label}
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
};
