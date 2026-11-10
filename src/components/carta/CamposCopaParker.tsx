import type { ReactNode } from "react";
import { Wine } from "lucide-react";
import { useWatch, type Control, type FieldValues, type Path } from "react-hook-form";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { propsCampoPrecio } from "./precioCarta";

export interface CamposCopaParkerValores extends FieldValues {
  copeo?: boolean;
  precio_copa_eur?: unknown;
}

/**
 * «Se sirve por copas» + precio de la copa (04/11/2026) y, al lado, el bloque
 * de la puntuación Parker (`parker`: parker/PanelParker.tsx, 08/11/2026). En la
 * web, la copa sale como un botón con una copa en la tarjeta del vino que
 * enseña este precio, y la puntuación verificada como un icono con los puntos.
 * Mismo bloque en el alta y en la edición.
 */
export function CamposCopaParker<T extends CamposCopaParkerValores>({ control, parker }: { control: Control<T>; parker?: ReactNode }) {
  const n = (k: keyof CamposCopaParkerValores) => k as Path<T>;
  const copeo = useWatch({ control, name: n("copeo") }) === true;
  return (
    <div className="grid grid-cols-1 gap-4 rounded-lg border p-3 [&>*]:min-w-0">
      <div className="space-y-3">
        <FormField
          control={control}
          name={n("copeo")}
          render={({ field }) => (
            <FormItem className="flex min-h-11 items-center justify-between gap-3 space-y-0">
              <FormLabel className="flex cursor-pointer items-center gap-2">
                <Wine className="h-4 w-4 text-primary" aria-hidden="true" />
                Se sirve por copas
              </FormLabel>
              <FormControl>
                <Switch checked={field.value === true} onCheckedChange={field.onChange} />
              </FormControl>
            </FormItem>
          )}
        />
        {copeo && (
          <FormField
            control={control}
            name={n("precio_copa_eur")}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Precio de la copa (€)</FormLabel>
                <FormControl>
                  <Input {...field} {...propsCampoPrecio} value={(field.value as string | number | undefined) ?? ""} placeholder="Ej.: 5,50" />
                </FormControl>
                <FormDescription>En la web sale al pulsar el botón de la copa.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
      </div>

      {parker && <div className="border-t pt-3">{parker}</div>}
    </div>
  );
}
