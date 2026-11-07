import { cn } from "@/lib/utils";
import { type FilaMetrica, type Semaforo, TEXTO_SEMAFORO, formatearPorcentaje, sinAclaracion } from "@/lib/servicios";

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

const TONO_TEXTO: Record<Semaforo, string> = {
  verde: "text-emerald-800 dark:text-emerald-300",
  ambar: "text-amber-900 dark:text-amber-300",
  rojo: "text-red-800 dark:text-red-300",
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

/**
 * Una métrica: cifra frente al límite, barra con % y semáforo, periodo y nota.
 * `compacto` (tarjetas de Servicios, 06/11/2026): sin la nota ni «dato informativo»;
 * la nota va en «Más detalles» de la tarjeta.
 */
export function BarraConsumo({ fila, compacto = false }: { fila: FilaMetrica; compacto?: boolean }) {
  const { porcentaje, semaforo: estado } = fila;
  const sinDato = fila.textoValor == null;
  if (compacto) {
    // Una línea: nombre corto y cifra; debajo, barra fina con el %. El nombre entero y el
    // periodo, al pasar el ratón (y para el lector de pantalla, en la barra).
    const nombre = sinAclaracion(fila.etiqueta);
    const ayuda = [fila.etiqueta, fila.periodo].filter(Boolean).join(" · ");
    return (
      <li className="min-w-0 py-2" data-metrica={fila.clave}>
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
          <span className="min-w-0 break-words font-medium text-foreground" title={ayuda}>{nombre}</span>
          <span className="ml-auto tabular-nums text-muted-foreground">
            <span className="text-foreground">{fila.textoValor ?? "sin dato"}</span>
            {fila.textoLimite && ` / ${fila.textoLimite}`}
          </span>
        </div>
        {porcentaje != null && estado && (
          <div className="mt-1.5 flex min-w-0 items-center gap-2">
            <BarraPorcentaje porcentaje={porcentaje} estado={estado} etiqueta={fila.etiqueta} className="h-2" />
            <span className={cn("w-12 shrink-0 text-right text-xs font-semibold tabular-nums", TONO_TEXTO[estado])}>
              {porcentaje > 0 && porcentaje < 1 ? "<1 %" : `${Math.round(porcentaje)} %`}
            </span>
          </div>
        )}
      </li>
    );
  }
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
        {!compacto && fila.limite == null && !sinDato && <span>· dato informativo, sin límite en el plan</span>}
      </div>
      {!compacto && fila.nota && <p className="break-words text-xs text-muted-foreground">{fila.nota}</p>}
    </li>
  );
}
