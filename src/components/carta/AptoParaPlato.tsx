import { Check, X } from "lucide-react";
import { useWatch, type Control, type FieldValues, type Path } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import { FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { aptitudesPlato, type DietaPlato, type EstadoDieta } from "@/lib/aptitudes-plato";

export interface CamposAptoPara extends FieldValues {
  nombre?: string;
  descripcion?: string;
  ingredientes?: string;
  sin_gluten_disponible?: boolean;
  vegetariano?: boolean;
}

interface Props<T extends CamposAptoPara> {
  control: Control<T>;
  /** Alérgenos que hay ahora en el formulario (o «sin alérgenos declarados»). */
  alergenos: string[];
  /** Al editar: los inferidos y la nota guardados, que también cuentan en la web. */
  inferidos?: unknown;
  notas?: string | null;
}

const ETIQUETA: Record<DietaPlato, string> = {
  celiaquia: "Celíacos",
  vegetariano: "Vegetarianos",
  lactosa: "Sin lactosa",
};

/**
 * «Apto para» en el alta y la edición de un plato (04/11/2026, petición del dueño): celíacos,
 * vegetarianos y sin lactosa, con el motivo, calculado en vivo con las mismas reglas que los filtros
 * de la carta de la web (`aptitudesPlato`). Aquí van también las dos casillas que lo deciden a mano:
 * «Se puede hacer sin gluten» (solo si lleva gluten) y «Vegetariano».
 */
export function AptoParaPlato<T extends CamposAptoPara>({ control, alergenos, inferidos, notas }: Props<T>) {
  const n = (k: keyof CamposAptoPara) => k as Path<T>;
  const [nombre, descripcion, ingredientes, sinGluten, vegetariano] = useWatch({
    control,
    name: [n("nombre"), n("descripcion"), n("ingredientes"), n("sin_gluten_disponible"), n("vegetariano")],
  }) as [string | undefined, string | undefined, string | undefined, boolean | undefined, boolean | undefined];
  const estado = aptitudesPlato({ alergenos, inferidos, notas, nombre, descripcion, ingredientes, sinGluten, vegetariano });
  const tieneGluten = alergenos.some((a) => a.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase() === "gluten");

  return (
    <section aria-labelledby="apto-para-titulo" className="space-y-2 rounded-lg border p-3" data-testid="apto-para">
      <h3 id="apto-para-titulo" className="text-sm font-medium">Apto para</h3>
      <p className="text-xs text-muted-foreground">Lo que verá la web en sus filtros. Se calcula con los alérgenos y estas casillas.</p>
      <ul className="space-y-2">
        <Fila dieta="celiaquia" estado={estado.celiaquia}>
          {tieneGluten && (
            <FormField
              control={control}
              name={n("sin_gluten_disponible")}
              render={({ field }) => (
                <FormItem className="flex min-h-11 items-center gap-3 space-y-0">
                  <FormControl>
                    <Checkbox checked={field.value === true} onCheckedChange={(v) => field.onChange(v === true)} />
                  </FormControl>
                  <FormLabel className="cursor-pointer font-normal leading-relaxed">Se puede hacer sin gluten</FormLabel>
                </FormItem>
              )}
            />
          )}
        </Fila>
        <Fila dieta="vegetariano" estado={estado.vegetariano}>
          <FormField
            control={control}
            name={n("vegetariano")}
            render={({ field }) => (
              <FormItem className="flex min-h-11 items-center gap-3 space-y-0">
                <FormControl>
                  <Checkbox checked={field.value === true} onCheckedChange={(v) => field.onChange(v === true)} />
                </FormControl>
                <FormLabel className="cursor-pointer font-normal leading-relaxed">Vegetariano (sin carne, pescado ni marisco)</FormLabel>
              </FormItem>
            )}
          />
        </Fila>
        <Fila dieta="lactosa" estado={estado.lactosa} />
      </ul>
    </section>
  );
}

function Fila({ dieta, estado, children }: { dieta: DietaPlato; estado: EstadoDieta; children?: React.ReactNode }) {
  return (
    <li className="rounded-md bg-muted/40 px-3 py-2" data-dieta={dieta} data-apto={estado.apto}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
        <span
          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${estado.apto ? "bg-emerald-600 text-white" : "bg-muted-foreground/20 text-muted-foreground"}`}
          aria-hidden="true"
        >
          {estado.apto ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
        </span>
        <span className="font-medium">{ETIQUETA[dieta]}:</span>
        <span className={estado.apto ? "text-emerald-800" : "text-muted-foreground"}>
          {estado.apto ? "Sí" : "No"} <span className="text-xs">· {estado.motivo}</span>
        </span>
      </p>
      {children}
    </li>
  );
}
