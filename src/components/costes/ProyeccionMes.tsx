import { CalendarClock } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TOTAL_MENSUAL_FACTURADO_EUR } from "@/components/dashboard/widgets/GestorGasto";
import type { FilaCosteMes } from "@/hooks/useCostes";
import { esNulo, fmtEur, fmtMes, fmtNumero, fmtPct, fmtUsd, fmtUsdEnEur, SIN_DATOS, TEXTO_TIPO_CAMBIO } from "./formato";
import { calcularTotalMensual, iaUsdMes, TEXTO_ORIGEN } from "./calculos";

interface FilaDatoProps {
  etiqueta: string;
  valor: string;
  detalle?: string;
}

function FilaDato({ etiqueta, valor, detalle }: FilaDatoProps) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-border/60 py-2 last:border-0">
      <span className="text-sm text-muted-foreground">{etiqueta}</span>
      <span className="text-right">
        <span className={valor === SIN_DATOS ? "text-sm italic text-muted-foreground" : "font-semibold tabular-nums"}>
          {valor}
        </span>
        {detalle && <span className="ml-2 text-xs text-muted-foreground">{detalle}</span>}
      </span>
    </div>
  );
}

/**
 * Cierre del mes en curso: cuánto llevamos, a cuánto va a terminar y cuánto
 * será el recibo total (IA + fijos). Es el número con el que se decide el
 * precio de venta, así que se dice de dónde sale cada parte.
 */
export function ProyeccionMes({ mes }: { mes: FilaCosteMes | null | undefined }) {
  const ia = iaUsdMes(mes);
  const total = calcularTotalMensual(ia.usd, mes?.fijos_eur_mes ?? null, TOTAL_MENSUAL_FACTURADO_EUR);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium sm:text-base">
            <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden />
            Mes en curso · {fmtMes(mes?.mes)}
          </CardTitle>
          <Badge
            variant="outline"
            className="border-amber-500/60 font-semibold tracking-wide text-amber-700 dark:text-amber-400"
          >
            PROYECCIÓN
          </Badge>
        </div>
        <CardDescription className="text-xs">
          {mes ? (
            <>
              {mes.dias_con_dato} de {mes.dias_mes} días con datos · quedan {mes.dias_restantes}. La proyección supone
              que el resto del mes se parece a lo ya medido.
            </>
          ) : (
            "Todavía no hay ningún dato de este mes."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="text-sm">
          <FilaDato
            etiqueta="IA acumulada este mes"
            valor={fmtUsd(mes?.coste_acumulado_usd ?? null)}
            detalle={`${fmtNumero(mes?.peticiones ?? null)} peticiones`}
          />
          <FilaDato
            etiqueta="Media por día"
            valor={fmtUsd(mes?.usd_medio_dia ?? null)}
            detalle="solo días con registro"
          />
          <FilaDato etiqueta="Proyección lineal a fin de mes" valor={fmtUsd(mes?.proy_lineal_usd ?? null)} />
          <FilaDato etiqueta="Proyección por media de 7 días" valor={fmtUsd(mes?.proy_media7_usd ?? null)} />
          <FilaDato
            etiqueta="Estimación medida a mano"
            valor={fmtUsd(mes?.estimado_ia_usd_mes ?? null)}
            detalle="incluye funciones que aún no registran"
          />
          <FilaDato
            etiqueta="Coste fijo del mes"
            valor={fmtEur(mes?.fijos_eur_mes ?? null)}
            detalle={
              (mes?.fijos_sin_verificar ?? 0) > 0 ? `${mes?.fijos_sin_verificar} sin verificar, fuera del total` : undefined
            }
          />
        </dl>

        <div className="mt-4 rounded-md border border-primary/40 bg-primary/5 p-3">
          <p className="text-sm text-muted-foreground">Coste total del mes (IA proyectada + fijos)</p>
          <p
            className={
              esNulo(total.totalEurAprox)
                ? "mt-0.5 text-lg font-medium italic text-muted-foreground"
                : "mt-0.5 text-2xl font-semibold tabular-nums"
            }
          >
            {esNulo(total.totalEurAprox) ? SIN_DATOS : `≈ ${fmtEur(total.totalEurAprox)}`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            IA {fmtUsd(ia.usd)} ({fmtUsdEnEur(ia.usd)}, por {TEXTO_ORIGEN[ia.origen]}) + fijos {fmtEur(total.fijosEur)}.
            Total aproximado: mezcla dólares y euros con {TEXTO_TIPO_CAMBIO}.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Frente a los {fmtEur(TOTAL_MENSUAL_FACTURADO_EUR)}/mes que se facturan, el margen es{" "}
            <span className="font-medium tabular-nums text-foreground">
              {esNulo(total.margenEur) ? SIN_DATOS : `≈ ${fmtEur(total.margenEur)}`}
            </span>{" "}
            ({esNulo(total.margenPct) ? SIN_DATOS : fmtPct(total.margenPct)}).
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
