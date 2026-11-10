import { useId } from "react";
import { Check, X } from "lucide-react";
import { useWatch, type Control, type FieldValues, type Path, type UseFormSetValue } from "react-hook-form";
import { Switch } from "@/components/ui/switch";
import { FormField } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { aptitudesPlato, type DietaPlato, type EstadoDieta } from "@/lib/aptitudes-plato";
import { aptitudTrasPulsar, type AptitudManual } from "@/lib/dietas-plato";

export interface CamposAptoPara extends FieldValues {
  nombre?: string;
  descripcion?: string;
  ingredientes?: string;
  sin_gluten_disponible?: boolean;
  vegetariano?: boolean;
  apto_celiacos?: AptitudManual;
  apto_sin_lactosa?: AptitudManual;
}

interface Props<T extends CamposAptoPara> {
  control: Control<T>;
  setValue: UseFormSetValue<T>;
  /** Alérgenos que hay ahora en el formulario (o «sin alérgenos declarados»). */
  alergenos: string[];
  /** Al editar: los inferidos y la nota guardados, que también cuentan en la web. */
  inferidos?: unknown;
  notas?: string | null;
  /**
   * ¿Existen ya Platos.apto_celiacos / apto_sin_lactosa (migración 20261122093000)? Si no, esos dos
   * interruptores se ven pero no se pueden cambiar (el guardado fallaría).
   */
  aptitudesManuales?: boolean;
  /** Sin permiso de edición: todo se ve pero nada se puede cambiar. */
  soloLectura?: boolean;
}

const ETIQUETA: Record<DietaPlato, string> = {
  celiaquia: "Celíacos",
  vegetariano: "Vegetarianos",
  lactosa: "Sin lactosa",
};

/**
 * «Apto para» en el alta y la edición de un plato. Celíacos, vegetarianos y sin lactosa, con el
 * motivo, calculado en vivo con las mismas reglas que los filtros de la carta de la web
 * (`aptitudesPlato`).
 *
 * Interruptores (10/11/2026, dueño: «que en editar cada plato sea modificable el toggle de se puede
 * hacer para celíaco y apto para celíaco, apto para vegetarianos, apto para sin lactosa»):
 *   · «Se puede hacer para celíacos» → Platos.sin_gluten_disponible (siempre visible).
 *   · «Apto para celíacos» → Platos.apto_celiacos (NULL = según alérgenos).
 *   · «Apto para vegetarianos» → Platos.etiquetas_dieteticas.
 *   · «Apto sin lactosa» → Platos.apto_sin_lactosa (NULL = según alérgenos).
 * Los dos «a mano» muestran lo que vale ahora; al pulsarlos quedan decididos a mano, salvo que el
 * valor coincida con el de los alérgenos (entonces siguen en automático).
 */
export function AptoParaPlato<T extends CamposAptoPara>({
  control,
  setValue,
  alergenos,
  inferidos,
  notas,
  aptitudesManuales = true,
  soloLectura = false,
}: Props<T>) {
  const n = (k: keyof CamposAptoPara) => k as Path<T>;
  const [nombre, descripcion, ingredientes, sinGluten, vegetariano, aptoCeliacos, aptoSinLactosa] = useWatch({
    control,
    name: [
      n("nombre"),
      n("descripcion"),
      n("ingredientes"),
      n("sin_gluten_disponible"),
      n("vegetariano"),
      n("apto_celiacos"),
      n("apto_sin_lactosa"),
    ],
  }) as [string | undefined, string | undefined, string | undefined, boolean | undefined, boolean | undefined, AptitudManual | undefined, AptitudManual | undefined];
  const base = { alergenos, inferidos, notas, nombre, descripcion, ingredientes, sinGluten, vegetariano };
  const automatico = aptitudesPlato(base);
  const estado = aptitudesPlato({ ...base, aptoCeliacos, aptoSinLactosa });
  const tieneGluten = alergenos.some((a) => a.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase() === "gluten");
  const bloqueoManual = soloLectura || !aptitudesManuales;

  const pulsar = (campo: "apto_celiacos" | "apto_sin_lactosa", nuevo: boolean, auto: boolean) =>
    setValue(n(campo), aptitudTrasPulsar(nuevo, auto) as never, { shouldDirty: true });
  const volverAuto = (campo: "apto_celiacos" | "apto_sin_lactosa") =>
    setValue(n(campo), null as never, { shouldDirty: true });

  return (
    <section aria-labelledby="apto-para-titulo" className="space-y-2 rounded-lg border p-3" data-testid="apto-para">
      <h3 id="apto-para-titulo" className="text-sm font-medium">Apto para</h3>
      <p className="text-xs text-muted-foreground">
        Lo que verá la web en sus filtros. Sale de los alérgenos; con los interruptores lo decides a mano.
      </p>
      <ul className="space-y-2">
        <Fila dieta="celiaquia" estado={estado.celiaquia}>
          <FormField
            control={control}
            name={n("sin_gluten_disponible")}
            render={({ field }) => (
              <Interruptor
                etiqueta="Se puede hacer para celíacos"
                ayuda={tieneGluten ? undefined : "Solo cambia algo si el plato lleva gluten."}
                checked={field.value === true}
                onChange={(v) => field.onChange(v)}
                disabled={soloLectura}
              />
            )}
          />
          <InterruptorManual
            etiqueta="Apto para celíacos"
            valor={estado.celiaquia.apto}
            manual={typeof aptoCeliacos === "boolean"}
            onChange={(v) => pulsar("apto_celiacos", v, automatico.celiaquia.apto)}
            onAuto={() => volverAuto("apto_celiacos")}
            disabled={bloqueoManual}
            sinMigracion={!aptitudesManuales}
          />
        </Fila>
        <Fila dieta="vegetariano" estado={estado.vegetariano}>
          <FormField
            control={control}
            name={n("vegetariano")}
            render={({ field }) => (
              <Interruptor
                etiqueta="Apto para vegetarianos"
                ayuda="Sin carne, pescado ni marisco."
                checked={field.value === true}
                onChange={(v) => field.onChange(v)}
                disabled={soloLectura}
              />
            )}
          />
        </Fila>
        <Fila dieta="lactosa" estado={estado.lactosa}>
          <InterruptorManual
            etiqueta="Apto sin lactosa"
            valor={estado.lactosa.apto}
            manual={typeof aptoSinLactosa === "boolean"}
            onChange={(v) => pulsar("apto_sin_lactosa", v, automatico.lactosa.apto)}
            onAuto={() => volverAuto("apto_sin_lactosa")}
            disabled={bloqueoManual}
            sinMigracion={!aptitudesManuales}
          />
        </Fila>
      </ul>
    </section>
  );
}

function Interruptor({
  etiqueta,
  ayuda,
  checked,
  onChange,
  disabled,
  children,
}: {
  etiqueta: string;
  ayuda?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 border-t border-border/60 pt-2 first:border-t-0">
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={id} className="cursor-pointer font-normal leading-snug">
          {etiqueta}
        </Label>
        {ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
        {children}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} disabled={disabled} />
    </div>
  );
}

function InterruptorManual({
  etiqueta,
  valor,
  manual,
  onChange,
  onAuto,
  disabled,
  sinMigracion,
}: {
  etiqueta: string;
  valor: boolean;
  manual: boolean;
  onChange: (v: boolean) => void;
  onAuto: () => void;
  disabled?: boolean;
  sinMigracion?: boolean;
}) {
  return (
    <Interruptor etiqueta={etiqueta} checked={valor} onChange={onChange} disabled={disabled}>
      {sinMigracion ? (
        <p className="text-xs text-muted-foreground">Aún no se puede cambiar: falta preparar la base de datos.</p>
      ) : manual ? (
        <p className="text-xs text-muted-foreground">
          Decidido a mano.{" "}
          {!disabled && (
            <button type="button" className="font-medium text-primary underline underline-offset-2" onClick={onAuto}>
              Volver a automático
            </button>
          )}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Automático, según los alérgenos.</p>
      )}
    </Interruptor>
  );
}

function Fila({ dieta, estado, children }: { dieta: DietaPlato; estado: EstadoDieta; children?: React.ReactNode }) {
  return (
    <li className="space-y-1 rounded-md bg-muted/40 px-3 py-2" data-dieta={dieta} data-apto={estado.apto}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
        <span
          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${estado.apto ? "bg-emerald-600 text-white" : "bg-muted-foreground/20 text-muted-foreground"}`}
          aria-hidden="true"
        >
          {estado.apto ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
        </span>
        <span className="font-medium">{ETIQUETA[dieta]}:</span>
        <span className={estado.apto ? "text-emerald-800 dark:text-emerald-300" : "text-muted-foreground"}>
          {estado.apto ? "Sí" : "No"} <span className="text-xs">· {estado.motivo}</span>
        </span>
      </p>
      {children}
    </li>
  );
}
