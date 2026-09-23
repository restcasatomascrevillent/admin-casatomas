import { AlertTriangle, Clock, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  NOMBRE_PROYECTO,
  PROYECTOS_TRAFICO,
  type EstadoSync,
  type FiltroProyecto,
} from "@/hooks/useTraficoWeb";
import { fmtFechaHora } from "./formato";
import { DIAS_MINIMOS_TENDENCIA, detectarProblemasSync } from "./calculos";

interface AvisosTraficoProps {
  proyecto: FiltroProyecto;
  estados: EstadoSync[] | undefined;
  /** Días del periodo con dato (visitas no NULL). */
  diasConDato: number;
  /** `now` inyectable para tests. */
  ahora?: Date;
}

export function AvisosTrafico({ proyecto, estados, diasConDato, ahora = new Date() }: AvisosTraficoProps) {
  const proyectos = proyecto === "ambos" ? PROYECTOS_TRAFICO : [proyecto];
  const problemas = estados ? detectarProblemasSync(proyectos, estados, ahora) : [];
  const pocosDatos = diasConDato > 0 && diasConDato < DIAS_MINIMOS_TENDENCIA;

  return (
    <div className="space-y-3">
      {problemas.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Sincronización con Vercel con problemas</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 space-y-0.5 text-sm">
              {problemas.map((p) => (
                <li key={p.proyecto}>
                  <strong>{NOMBRE_PROYECTO[p.proyecto]}</strong>: {p.motivo}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs opacity-80">Los datos de los últimos días pueden faltar o estar incompletos.</p>
          </AlertDescription>
        </Alert>
      )}

      {pocosDatos && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Pocos datos todavía</AlertTitle>
          <AlertDescription className="text-sm">
            Solo hay {diasConDato} {diasConDato === 1 ? "día" : "días"} con datos en este periodo. Con menos de{" "}
            {DIAS_MINIMOS_TENDENCIA} días la tendencia, la proyección y las anomalías no son fiables.
          </AlertDescription>
        </Alert>
      )}

      {estados && estados.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" aria-hidden />
          {proyectos.map((p) => {
            const e = estados.find((x) => x.proyecto === p);
            return (
              <span key={p}>
                {NOMBRE_PROYECTO[p]}: último sync correcto {fmtFechaHora(e?.ultimo_ok_en)}
              </span>
            );
          })}
        </p>
      )}
    </div>
  );
}
