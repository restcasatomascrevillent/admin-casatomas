import { Award, Wine } from "lucide-react";
import { useWatch, type Control, type FieldValues, type Path } from "react-hook-form";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { propsCampoPrecio } from "./precioCarta";

export interface CamposCopaParkerValores extends FieldValues {
  copeo?: boolean;
  precio_copa_eur?: unknown;
  puntuacion_parker?: unknown;
  puntuacion_parker_anada?: unknown;
}

/**
 * «Se sirve por copas» + precio de la copa, y la puntuación Parker (04/11/2026,
 * petición del dueño). En la web, la copa sale como un botón con una copa en la
 * tarjeta del vino que enseña este precio, y la puntuación como un icono con los
 * puntos. Mismo bloque en el alta y en la edición.
 */
export function CamposCopaParker<T extends CamposCopaParkerValores>({ control }: { control: Control<T> }) {
  const n = (k: keyof CamposCopaParkerValores) => k as Path<T>;
  const copeo = useWatch({ control, name: n("copeo") }) === true;
  return (
    <div className="grid grid-cols-1 gap-4 rounded-lg border p-3 sm:grid-cols-2 [&>*]:min-w-0">
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

      <div className="space-y-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Award className="h-4 w-4 text-primary" aria-hidden="true" />
          Puntuación Parker
        </p>
        <div className="grid grid-cols-2 gap-2">
          <FormField
            control={control}
            name={n("puntuacion_parker")}
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs text-muted-foreground">Puntos (50–100)</FormLabel>
                <FormControl>
                  <Input {...field} type="text" inputMode="numeric" autoComplete="off" value={(field.value as string | number | undefined) ?? ""} placeholder="Ej.: 94" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={n("puntuacion_parker_anada")}
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs text-muted-foreground">Añada</FormLabel>
                <FormControl>
                  <Input {...field} type="text" inputMode="numeric" autoComplete="off" value={(field.value as string | number | undefined) ?? ""} placeholder="Ej.: 2019" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <p className="text-xs text-muted-foreground">Vacío = sin puntuación: la web no pinta el icono.</p>
      </div>
    </div>
  );
}
