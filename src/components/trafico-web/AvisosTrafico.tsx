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
  /** La hora del último sync va aquí salvo cuando ya la enseña la línea de las cifras (KpisTrafico). */
  mostrarUltimoSync?: boolean;
}

/**
 * Hora del último sync correcto, en una línea discreta: una sola hora si las webs coinciden (lo normal, el sync es
 * el mismo para las dos) y «Casa Tomás … · Touza …» si no.
 */
export function UltimoSync({ proyecto, estados }: { proyecto: FiltroProyecto; estados: EstadoSync[] | undefined }) {
  if (!estados || estados.length === 0) return null;
  const proyectos = proyecto === "ambos" ? PROYECTOS_TRAFICO : [proyecto];
  const horas = proyectos.map((p) => ({ p, hora: fmtFechaHora(estados.find((x) => x.proyecto === p)?.ultimo_ok_en) }));
  const iguales = horas.every((h) => h.hora === horas[0].hora);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1" title="Último sync correcto con Vercel Web Analytics">
      <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        Último sync correcto{" "}
        {iguales
          ? horas[0].hora
          : horas.map((h, i) => (
              <span key={h.p}>
                {i > 0 && " · "}
                {NOMBRE_PROYECTO[h.p]} {h.hora}
              </span>
            ))}
      </span>
    </span>
  );
}

export function AvisosTrafico({ proyecto, estados, diasConDato, ahora = new Date(), mostrarUltimoSync = true }: AvisosTraficoProps) {
  const proyectos = proyecto === "ambos" ? PROYECTOS_TRAFICO : [proyecto];
  const problemas = estados ? detectarProblemasSync(proyectos, estados, ahora) : [];
  const pocosDatos = diasConDato > 0 && diasConDato < DIAS_MINIMOS_TENDENCIA;
  const conSync = mostrarUltimoSync && !!estados && estados.length > 0;
  // Sin nada que decir no deja un hueco en la región con scroll.
  if (problemas.length === 0 && !pocosDatos && !conSync) return null;

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

      {conSync && (
        <p className="text-xs text-muted-foreground">
          <UltimoSync proyecto={proyecto} estados={estados} />
        </p>
      )}
    </div>
  );
}
