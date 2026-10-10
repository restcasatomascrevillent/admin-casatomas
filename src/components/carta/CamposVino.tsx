import type { ReactNode } from "react";
import type { Control, FieldValues, Path } from "react-hook-form";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ComboboxCreatable } from "@/components/ui/combobox-creatable";

/**
 * Longitud máxima recomendada de la descripción (la BD es `text`, sin límite;
 * la web la pinta en una tarjeta pequeña). Igual que el recorte de la
 * función `extraer-vino-foto` (DESCRIPCION_MAX).
 */
export const DESCRIPCION_RECOMENDADA = 320;

/** Campos de texto comunes de un vino (alta y edición). Sin alérgenos: se conservan tal cual en BD. */
export interface CamposVinoValores extends FieldValues {
  nombre?: string;
  categoria?: string;
  precio_eur?: number;
  descripcion?: string;
  ingredientes?: string;
  denominacion_origen?: string;
  ubicacion_pais?: string;
  ubicacion_region?: string;
}

interface Props<T extends CamposVinoValores> {
  control: Control<T>;
  categorias: string[];
  denominaciones: string[];
  regiones: string[];
  paises: string[];
  /** Algo a mostrar bajo el precio (p. ej. el precio sugerido de la foto). */
  bajoPrecio?: ReactNode;
}

/**
 * Orden pensado para el móvil en vertical: Nombre, Categoría + Precio,
 * D.O./Región/País, Uva y Descripción. La foto la pinta cada formulario
 * encima de estos campos. En móvil todo va a 1 columna; desde `sm`, 2.
 */
export function CamposVino<T extends CamposVinoValores>({
  control,
  categorias,
  denominaciones,
  regiones,
  paises,
  bajoPrecio,
}: Props<T>) {
  const n = (k: keyof CamposVinoValores) => k as Path<T>;
  return (
    <>
      <FormField
        control={control}
        name={n("nombre")}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Nombre del vino</FormLabel>
            <FormControl>
              <Input placeholder="Ej.: Pago de Carraovejas Crianza 2021" autoComplete="off" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          control={control}
          name={n("categoria")}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Categoría</FormLabel>
              <FormControl>
                <ComboboxCreatable
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  options={categorias}
                  placeholder="Tinto, Blanco, Espumoso…"
                  emptyText="No hay categorías"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={n("precio_eur")}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Precio en carta (€)</FormLabel>
              <FormControl>
                <Input type="number" inputMode="decimal" step="0.01" min="0" placeholder="Ej.: 24,50" {...field} />
              </FormControl>
              {bajoPrecio}
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Origen: el país y la región sitúan el vino en el mapa de la carta.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField
            control={control}
            name={n("denominacion_origen")}
            render={({ field }) => (
              <FormItem>
                <FormLabel>D.O.</FormLabel>
                <FormControl>
                  <ComboboxCreatable
                    value={field.value || ""}
                    onChange={field.onChange}
                    options={denominaciones}
                    placeholder="Rioja, Ribera del Duero…"
                    emptyText="No hay denominaciones"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={n("ubicacion_region")}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Región</FormLabel>
                <FormControl>
                  <ComboboxCreatable
                    value={field.value || ""}
                    onChange={field.onChange}
                    options={regiones}
                    placeholder="La Rioja, Castilla y León…"
                    emptyText="No hay regiones"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={n("ubicacion_pais")}
            render={({ field }) => (
              <FormItem>
                <FormLabel>País</FormLabel>
                <FormControl>
                  <ComboboxCreatable
                    value={field.value || ""}
                    onChange={field.onChange}
                    options={paises}
                    placeholder="España, Francia…"
                    emptyText="No hay países"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </div>

      {/* Columna `ingredientes` en BD: para un vino es la uva. */}
      <FormField
        control={control}
        name={n("ingredientes")}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Uva / variedad</FormLabel>
            <FormControl>
              <Input placeholder="Tempranillo, Garnacha…" autoComplete="off" {...field} value={field.value ?? ""} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name={n("descripcion")}
        render={({ field }) => {
          const largo = String(field.value ?? "").length;
          return (
            <FormItem>
              <FormLabel>Descripción</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Notas de cata y maridaje. Ej.: Afrutado, con notas de roble; ideal con carnes rojas."
                  className="min-h-[9rem] resize-y sm:min-h-[8rem]"
                  rows={6}
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
              <FormDescription
                className={largo > DESCRIPCION_RECOMENDADA ? "text-right text-amber-600" : "text-right"}
              >
                {largo}/{DESCRIPCION_RECOMENDADA} caracteres recomendados
              </FormDescription>
              <FormMessage />
            </FormItem>
          );
        }}
      />
    </>
  );
}
