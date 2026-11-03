import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { type AvisoConsumo, TEXTO_SEMAFORO, UMBRAL_AVISO, formatearPorcentaje } from "@/lib/servicios";
import { ChipSemaforo } from "./BarraConsumo";

/**
 * Aviso destacado arriba de Super Admin › Servicios: lo que pasa del 80 % de
 * su límite, de más a menos, con enlace a la tarjeta del servicio. El color va
 * siempre acompañado del % y de la palabra («Cerca del límite», «Al límite»).
 */
export function AvisosConsumo({ avisos }: { avisos: AvisoConsumo[] }) {
  if (avisos.length === 0) return null;
  const rojo = avisos.some((a) => a.semaforo === "rojo");
  return (
    <section
      aria-labelledby="servicios-avisos"
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-lg border-2 p-3 sm:p-4",
        rojo
          ? "border-red-300 bg-red-50 text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
          : "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
      )}
    >
      <h2 id="servicios-avisos" className="flex items-start gap-2 text-base font-semibold">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <span>
          {avisos.length === 1 ? "Un consumo pasa" : `${avisos.length} consumos pasan`} del {UMBRAL_AVISO}{"\u00a0"}% de su límite
        </span>
      </h2>
      <ul className="min-w-0 space-y-1.5 text-sm">
        {avisos.map((a) => (
          <li key={`${a.proveedor}-${a.clave}`} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <a href={`#tarjeta-${a.proveedor}`} className="inline-flex min-h-11 min-w-0 items-center break-words font-medium underline underline-offset-2">
              {a.nombre} · {a.etiqueta}
            </a>
            <ChipSemaforo estado={a.semaforo}>
              {formatearPorcentaje(a.porcentaje)} · {TEXTO_SEMAFORO[a.semaforo]}
            </ChipSemaforo>
            {a.textoValor && a.textoLimite && (
              <span className="tabular-nums">
                ({a.textoValor} de {a.textoLimite})
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
