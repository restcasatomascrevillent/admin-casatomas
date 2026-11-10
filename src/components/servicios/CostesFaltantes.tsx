import { AlertTriangle, CheckCircle2, Clock, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type CosteFaltante, TEXTO_FALTA, cuentaFaltantes, textoMes } from "@/lib/informeServicios";
import { cn } from "@/lib/utils";
import { Bloque } from "./Bloque";

interface Props {
  faltantes: CosteFaltante[];
  cargando: boolean;
  /** false si falta la migración 20261122153000: se avisa y no se puede meter nada. */
  disponible: boolean;
  /** «Poner el precio»: abre la ficha del servicio. */
  onPonerPrecio: (proveedor: string) => void;
  /** «Meter coste» de un mes. */
  onMeterCoste: (proveedor: string, mes: string) => void;
}

/**
 * Servicios › Costes › «Costes por meter» (10/11/2026): los servicios de pago
 * de los que no se sabe lo que cuestan un mes, con el botón para completarlo:
 * sin precio → su ficha; de pago por uso sin coste medido ese mes → meter el
 * importe de la factura. Lo del mes en curso sale aparte (aún sin factura).
 */
export function CostesFaltantes({ faltantes, cargando, disponible, onPonerPrecio, onMeterCoste }: Props) {
  const pendientes = cuentaFaltantes(faltantes);
  const titulo = cargando
    ? "Costes por meter"
    : pendientes === 0
      ? "Costes por meter: nada pendiente"
      : `Costes por meter: ${pendientes} ${pendientes === 1 ? "pendiente" : "pendientes"}`;
  return (
    <Bloque
      id="costes-faltantes"
      icono={pendientes > 0 ? <AlertTriangle /> : <CheckCircle2 />}
      titulo={titulo}
      descripcion="Servicios de pago de los que no se sabe lo que cuestan algún mes de los tres últimos. Complétalos para que el informe mensual sea exacto."
      className={cn(pendientes > 0 && "border-amber-300 dark:border-amber-800")}
    >
      {!disponible ? (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          Falta aplicar en Supabase la migración 20261122153000_servicios_costes_mes. Hasta entonces solo se avisa de los servicios sin precio.
        </p>
      ) : null}
      {cargando ? (
        <p className="text-sm text-muted-foreground" role="status">Revisando los costes de los últimos meses…</p>
      ) : faltantes.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="costes-faltantes-vacio">Todos los servicios de pago tienen su coste de los últimos meses.</p>
      ) : (
        <ul className="min-w-0 divide-y divide-border/60 overflow-hidden rounded-md border" aria-label="Costes que faltan por meter">
          {faltantes.map((f) => (
            <li
              key={`${f.proveedor}:${f.motivo}`}
              className="flex min-w-0 flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
              data-faltante={f.proveedor}
              data-motivo={f.motivo}
            >
              <div className="flex min-w-0 items-start gap-2">
                {f.soloMesEnCurso
                  ? <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />}
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium text-foreground">{f.nombre}</p>
                  <p className="break-words text-xs text-muted-foreground">
                    {f.motivo === "sin_precio"
                      ? `${TEXTO_FALTA.sin_precio}: ponlo en su ficha (cuota al mes o al año).`
                      : f.soloMesEnCurso
                        ? `De pago por uso: mete el coste de ${textoMes(f.meses[0])} cuando llegue su factura.`
                        : `De pago por uso sin coste medido: ${f.meses.map(textoMes).join(", ")}.`}
                  </p>
                </div>
              </div>
              <div className="flex min-w-0 flex-wrap gap-2 sm:shrink-0 sm:justify-end">
                {f.motivo === "sin_precio" ? (
                  <Button type="button" variant="outline" size="sm" className="h-10 gap-1.5" onClick={() => onPonerPrecio(f.proveedor)}>
                    <Pencil className="h-4 w-4" aria-hidden="true" /> Poner el precio
                    <span className="sr-only"> de {f.nombre}</span>
                  </Button>
                ) : (
                  f.meses.map((m) => (
                    <Button
                      key={m}
                      type="button"
                      variant={f.soloMesEnCurso ? "ghost" : "outline"}
                      size="sm"
                      className="h-10 gap-1.5"
                      disabled={!disponible}
                      onClick={() => onMeterCoste(f.proveedor, m)}
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      <span>Meter {textoMes(m).replace(/ de \d{4}$/, "")}</span>
                      <span className="sr-only"> ({textoMes(m)}) de {f.nombre}</span>
                    </Button>
                  ))
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Bloque>
  );
}
