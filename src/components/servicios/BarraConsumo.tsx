import { cn } from "@/lib/utils";
import { type FilaMetrica, type Semaforo, TEXTO_SEMAFORO, formatearPorcentaje } from "@/lib/servicios";

/**
 * Colores del semáforo. Relleno de la barra en tono 700 (contraste ≥ 3:1 con
 * la pista `bg-muted`) y texto 800/900 sobre fondo 50 (≥ 4,5:1). El estado
 * también se dice con palabras: nunca solo con color.
 */
const COLOR_SEMAFORO: Record<Semaforo, { barra: string; chip: string; punto: string }> = {
  verde: {
    barra: "bg-emerald-700",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    punto: "bg-emerald-700",
  },
  ambar: {
    barra: "bg-amber-700",
    chip: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
    punto: "bg-amber-700",
  },
  rojo: {
    barra: "bg-red-700",
    chip: "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
    punto: "bg-red-700",
  },
};

export function ChipSemaforo({ estado, children, className }: { estado: Semaforo; children?: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium", COLOR_SEMAFORO[estado].chip, className)}>
      <span className={cn("h-2 w-2 shrink-0 rounded-full", COLOR_SEMAFORO[estado].punto)} aria-hidden="true" />
      {children ?? TEXTO_SEMAFORO[estado]}
    </span>
  );
}

/** Barra de % con el color del semáforo; el % y el estado van también en texto (aria-valuetext). */
export function BarraPorcentaje({ porcentaje, estado, etiqueta, className }: { porcentaje: number; estado: Semaforo; etiqueta: string; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-label={etiqueta}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, Math.round(porcentaje))}
      aria-valuetext={`${formatearPorcentaje(porcentaje)} del límite: ${TEXTO_SEMAFORO[estado].toLowerCase()}`}
      className={cn("h-2.5 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width]", COLOR_SEMAFORO[estado].barra)}
        style={{ width: `${Math.min(100, Math.max(porcentaje, porcentaje > 0 ? 1.5 : 0))}%` }}
      />
    </div>
  );
}

/** Una métrica: cifra frente al límite, barra con % y semáforo, periodo y nota. */
export function BarraConsumo({ fila }: { fila: FilaMetrica }) {
  const { porcentaje, semaforo: estado } = fila;
  const sinDato = fila.textoValor == null;
  return (
    <li className="min-w-0 space-y-1.5 py-2.5" data-metrica={fila.clave}>
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="min-w-0 break-words text-sm font-medium text-foreground">{fila.etiqueta}</span>
        <span className={cn("text-sm tabular-nums", sinDato ? "text-muted-foreground" : "text-foreground")}>
          {sinDato ? "sin dato" : fila.textoValor}
          {fila.textoLimite && <span className="text-muted-foreground">{sinDato ? ` · límite ${fila.textoLimite}` : ` de ${fila.textoLimite}`}</span>}
        </span>
      </div>
      {porcentaje != null && estado && <BarraPorcentaje porcentaje={porcentaje} estado={estado} etiqueta={fila.etiqueta} />}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {porcentaje != null && estado && (
          <ChipSemaforo estado={estado}>
            {formatearPorcentaje(porcentaje)} · {TEXTO_SEMAFORO[estado]}
          </ChipSemaforo>
        )}
        {fila.periodo && <span>{fila.periodo}</span>}
        {fila.limite == null && !sinDato && <span>· dato informativo, sin límite en el plan</span>}
      </div>
      {fila.nota && <p className="break-words text-xs text-muted-foreground">{fila.nota}</p>}
    </li>
  );
}
