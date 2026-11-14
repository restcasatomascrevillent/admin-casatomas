import { AlertOctagon, AlertTriangle, CheckCircle2, ExternalLink, Gauge } from "lucide-react";
import type { AvisoPlan } from "@/lib/costesServicios";
import { formatearPorcentaje } from "@/lib/servicios";
import { cn } from "@/lib/utils";
import { Bloque } from "./Bloque";

const TONO = {
  rojo: { borde: "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40", texto: "text-red-800 dark:text-red-300", Icono: AlertOctagon, palabra: "Urgente" },
  ambar: { borde: "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40", texto: "text-amber-900 dark:text-amber-300", Icono: AlertTriangle, palabra: "Aviso" },
} as const;

function Enlace({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-sm underline underline-offset-2 hover:text-foreground sm:min-h-0">
      {children}
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="sr-only">(se abre en otra pestaña)</span>
    </a>
  );
}

/**
 * Servicios › Costes › «Antes de pasar del plan gratis» (13/11/2026, paso 6
 * del encargo): cada límite de los planes gratis, a qué ritmo va, qué pasaría
 * si se pasa y cuánto cuesta el plan siguiente (todo editable en la ficha del
 * servicio). Lo que está cerca, arriba y con su explicación; lo que está
 * lejos, en una línea; lo que no se puede leer, con el enlace a su panel.
 */
export function AvisosPlanGratis({ avisos }: { avisos: AvisoPlan[] }) {
  if (avisos.length === 0) return null;
  const cerca = avisos.filter((a) => a.nivel === "rojo" || a.nivel === "ambar");
  const lejos = avisos.filter((a) => a.nivel === "verde");
  const sinDato = avisos.filter((a) => a.nivel === "sin_dato");
  const titulo = cerca.length === 0
    ? "Planes gratis: todo lejos del límite"
    : `Planes gratis: ${cerca.length} ${cerca.length === 1 ? "límite cerca" : "límites cerca"}`;
  return (
    <Bloque
      id="costes-plan-gratis"
      icono={cerca.length ? <AlertTriangle /> : <CheckCircle2 />}
      titulo={titulo}
      descripcion="Antes de pasar del plan gratis: cómo va cada límite, a qué ritmo, qué pasaría y cuánto cuesta el plan siguiente."
      className={cn(cerca.some((a) => a.nivel === "rojo") && "border-red-300 dark:border-red-900", cerca.length > 0 && !cerca.some((a) => a.nivel === "rojo") && "border-amber-300 dark:border-amber-800")}
    >
      {cerca.length > 0 && (
        <ul className="min-w-0 space-y-2" aria-label="Límites cerca">
          {cerca.map((a) => {
            const t = TONO[a.nivel as "rojo" | "ambar"];
            return (
              <li key={a.clave} className={cn("min-w-0 rounded-lg border p-3", t.borde)} data-aviso-plan={a.clave} data-nivel={a.nivel}>
                <div className="flex min-w-0 items-start gap-2">
                  <t.Icono className={cn("mt-0.5 h-4 w-4 shrink-0", t.texto)} aria-hidden="true" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="break-words text-sm font-semibold text-foreground">
                      <span className="sr-only">{t.palabra}: </span>
                      {a.servicio} · {a.etiqueta}
                    </p>
                    <p className={cn("break-words text-sm font-medium tabular-nums", t.texto)}>
                      {a.porcentaje != null && formatearPorcentaje(a.porcentaje)}
                      {a.textoValor && a.textoLimite ? ` (${a.textoValor} de ${a.textoLimite})` : ""}
                    </p>
                    {a.prevision && <p className="break-words text-sm text-foreground">{a.prevision}</p>}
                    {a.quePasaria && (
                      <p className="break-words text-sm text-foreground">
                        <span className="font-medium">Qué pasaría:</span> {a.quePasaria}
                      </p>
                    )}
                    {a.siguientePlan && (
                      <p className="break-words text-sm text-foreground">
                        <span className="font-medium">Plan siguiente:</span> {a.siguientePlan}
                      </p>
                    )}
                    {a.panelUrl && <Enlace href={a.panelUrl}>{`Abrir el panel de ${a.servicio}`}</Enlace>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {lejos.length > 0 && (
        <div className="min-w-0 text-sm" data-testid="plan-gratis-lejos">
          <p className="font-medium text-foreground">Lejos del límite</p>
          <ul className="mt-1 flex min-w-0 flex-wrap gap-1.5" aria-label="Límites lejos">
            {lejos.map((a) => (
              <li
                key={a.clave}
                className="rounded-full border bg-background px-2.5 py-1 text-xs text-foreground"
                title={[a.textoValor && a.textoLimite ? `${a.textoValor} de ${a.textoLimite}` : null, a.prevision].filter(Boolean).join(". ")}
                data-aviso-plan={a.clave}
              >
                {a.servicio} · {a.etiqueta}: <span className="tabular-nums">{a.porcentaje == null ? "—" : formatearPorcentaje(a.porcentaje)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {sinDato.length > 0 && (
        <details className="min-w-0 text-sm" data-testid="plan-gratis-sin-dato">
          <summary className="min-h-11 cursor-pointer py-2 font-medium text-foreground sm:min-h-0">
            Sin cifra automática ({sinDato.length}): se miran en su panel
          </summary>
          <ul className="mt-1 min-w-0 divide-y divide-border/60 rounded-md border" aria-label="Límites sin cifra automática">
            {sinDato.map((a) => (
              <li key={a.clave} className="flex min-w-0 flex-col gap-1 p-2 sm:flex-row sm:items-center sm:justify-between" data-aviso-plan={a.clave}>
                <div className="min-w-0">
                  <p className="break-words text-sm text-foreground">
                    {a.servicio} · {a.etiqueta}
                    {a.textoLimite && <span className="text-muted-foreground"> (límite {a.textoLimite})</span>}
                  </p>
                  <p className="break-words text-xs text-muted-foreground">{a.motivoSinDato}</p>
                </div>
                {a.panelUrl && <Enlace href={a.panelUrl}>Abrir su panel</Enlace>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Bloque>
  );
}
