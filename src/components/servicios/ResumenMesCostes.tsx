import { CalendarClock } from "lucide-react";
import { compararConMesAnterior } from "@/lib/costesServicios";
import { textoDiferenciaEur, textoDiferenciaPct } from "@/lib/informeServicios";
import { type ResumenCostes, formatearEur } from "@/lib/servicios";
import { cn } from "@/lib/utils";
import { Bloque } from "./Bloque";
import { formatearCambio } from "./TipoCambio";

interface Props {
  resumen: ResumenCostes;
  /** Total del mes anterior (null: sin datos de ese mes). */
  anteriorEur: number | null;
  /** «Octubre 2026». */
  textoMesAnterior: string;
  /** «noviembre de 2026». */
  textoMes: string;
  cargandoAnterior: boolean;
  eurPorUsd: number;
}

function Cifra({ etiqueta, valor, detalle, tono, testId }: { etiqueta: string; valor: string; detalle?: string | null; tono?: "sube" | "baja" | null; testId?: string }) {
  return (
    <div className="min-w-0 rounded-lg border bg-background p-3" data-testid={testId}>
      <p className="text-xs font-medium text-muted-foreground">{etiqueta}</p>
      <p className={cn("text-xl font-bold tabular-nums leading-tight text-foreground", tono === "sube" && "text-amber-800 dark:text-amber-300", tono === "baja" && "text-emerald-800 dark:text-emerald-300")}>
        {valor}
      </p>
      {detalle && <p className="text-xs text-muted-foreground">{detalle}</p>}
    </div>
  );
}

/**
 * Servicios › Costes › «Este mes, en euros» (13/11/2026, paso 5 del encargo):
 * lo que llevamos, la previsión a fin de mes y el mes anterior. La IA ya va
 * dentro de OpenAI (no se suma otra vez) y lo metido a mano manda sobre la
 * estimación. Los dólares, al tipo de cambio de Configurar.
 */
export function ResumenMesCostes({ resumen, anteriorEur, textoMesAnterior, textoMes, cargandoAnterior, eurPorUsd }: Props) {
  const c = compararConMesAnterior(resumen, anteriorEur);
  const tono = c.diferenciaEur == null || c.diferenciaEur === 0 ? null : c.diferenciaEur > 0 ? "sube" : "baja";
  const partes = [`${formatearEur(resumen.fijoMesEur)} de cuotas`, `${formatearEur(resumen.variableMesEur)} por uso`];
  if (resumen.manualMesEur > 0) partes.push(`${formatearEur(resumen.manualMesEur)} metido a mano`);
  return (
    <Bloque
      id="costes-resumen-mes"
      icono={<CalendarClock />}
      titulo="Este mes, en euros"
      descripcion={`Lo que llevamos gastado en ${textoMes}, lo que costará a este ritmo y lo que costó el mes pasado.`}
    >
      <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3" data-testid="resumen-mes">
        <Cifra etiqueta="Llevamos" valor={formatearEur(c.llevamosEur)} detalle="hasta hoy" testId="resumen-llevamos" />
        <Cifra etiqueta="Previsión a fin de mes" valor={`≈ ${formatearEur(c.previsionEur)}`} detalle="cuotas + el uso al ritmo de estos días" testId="resumen-prevision" />
        <div className="col-span-2 sm:col-span-1">
          <Cifra
            etiqueta={textoMesAnterior}
            valor={cargandoAnterior ? "…" : c.anteriorEur == null ? "Sin datos" : formatearEur(c.anteriorEur)}
            detalle={c.diferenciaEur == null ? null : `Previsión: ${textoDiferenciaEur(c.diferenciaEur)}${c.diferenciaPct == null ? "" : ` (${textoDiferenciaPct(c.diferenciaPct)})`}`}
            tono={tono}
            testId="resumen-anterior"
          />
        </div>
      </div>
      <ul className="min-w-0 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
        <li>Hasta hoy: {partes.join(" + ")}.</li>
        <li>La inteligencia artificial ya va dentro de OpenAI: no se suma otra vez.</li>
        {resumen.sinPrecio.length > 0 && <li>Sin contar lo que no tiene precio apuntado: {resumen.sinPrecio.join(", ")}.</li>}
        {resumen.hayUsd && <li>Los dólares, a 1 US$ = {formatearCambio(eurPorUsd)} € (se cambia en «Configurar»).</li>}
      </ul>
    </Bloque>
  );
}
