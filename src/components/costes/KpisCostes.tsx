import { Bot, Receipt, Scale, Server } from "lucide-react";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useMensualFacturado } from "@/hooks/useFacturacionOficiososia";
import type { FilaCosteMes } from "@/hooks/useCostes";
import { esNulo, fmtEur, fmtNumero, fmtPct, fmtUsd, fmtUsdEnEur, SIN_DATOS, TEXTO_TIPO_CAMBIO } from "./formato";
import { calcularTotalMensual, iaUsdMes, TEXTO_ORIGEN, type ResumenCoste } from "./calculos";

interface KpiProps {
  titulo: string;
  valor: string;
  icono: ComponentType<SVGProps<SVGSVGElement>>;
  pie?: ReactNode;
  /** Un valor negativo en el margen se pinta en rojo: se está perdiendo dinero. */
  alerta?: boolean;
}

function Kpi({ titulo, valor, icono: Icono, pie, alerta }: KpiProps) {
  const sinDatos = valor === SIN_DATOS;
  return (
    <Card className={alerta ? "border-destructive/50" : undefined}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground sm:text-sm">{titulo}</p>
          <Icono className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </div>
        <p
          className={
            sinDatos
              ? "mt-2 text-lg font-medium italic text-muted-foreground"
              : `mt-2 text-2xl font-semibold tabular-nums ${alerta ? "text-destructive" : "text-foreground"}`
          }
        >
          {valor}
        </p>
        {pie && <div className="mt-1 text-xs text-muted-foreground">{pie}</div>}
      </CardContent>
    </Card>
  );
}

interface KpisCostesProps {
  /** Resumen del periodo filtrado (IA, en USD). */
  resumen: ResumenCoste;
  /** Mes en curso: de aquí salen los fijos y la proyección de IA. */
  mes: FilaCosteMes | null | undefined;
  dias: number;
}

/**
 * Los cuatro números que el dueño necesita para poner precio: lo que le cuesta
 * la IA, lo que le cuestan los servicios, el total al mes y cuánto le queda de
 * la cuota recurrente guardada en facturación.
 */
export function KpisCostes({ resumen, mes, dias }: KpisCostesProps) {
  const facturado = useMensualFacturado();
  const ia = iaUsdMes(mes);
  const total = calcularTotalMensual(ia.usd, mes?.fijos_eur_mes ?? null, facturado);
  const margenNegativo = !esNulo(total.margenEur) && total.margenEur < 0;

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <Kpi
        titulo={`Coste de IA (${dias} días)`}
        valor={fmtUsd(resumen.costeUsd)}
        icono={Bot}
        pie={
          <>
            {resumen.diasConDato} {resumen.diasConDato === 1 ? "día" : "días"} con datos ·{" "}
            {fmtNumero(resumen.peticiones)} peticiones
            {resumen.anomalias > 0 && ` · ${resumen.anomalias} anomalía${resumen.anomalias === 1 ? "" : "s"}`}
          </>
        }
      />
      <Kpi
        titulo="Coste fijo mensual"
        valor={fmtEur(mes?.fijos_eur_mes ?? null)}
        icono={Server}
        pie={
          <>
            Supabase, Vercel, Resend, VAPI y dominio
            {(mes?.fijos_sin_verificar ?? 0) > 0 && (
              <Badge
                variant="outline"
                className="ml-1.5 border-amber-500/60 px-1.5 py-0 text-[10px] text-amber-700 dark:text-amber-400"
              >
                {mes?.fijos_sin_verificar} sin verificar
              </Badge>
            )}
          </>
        }
      />
      <Kpi
        titulo="Total estimado al mes"
        valor={esNulo(total.totalEurAprox) ? SIN_DATOS : `≈ ${fmtEur(total.totalEurAprox)}`}
        icono={Receipt}
        pie={
          <>
            IA {fmtUsd(ia.usd)} ({fmtUsdEnEur(ia.usd)}) + fijos {fmtEur(total.fijosEur)}
            <br />
            <span className="opacity-80">
              IA por {TEXTO_ORIGEN[ia.origen]} · {TEXTO_TIPO_CAMBIO}
            </span>
          </>
        }
      />
      <Kpi
        titulo="Margen vs lo facturado"
        valor={esNulo(total.margenEur) ? SIN_DATOS : `≈ ${fmtEur(total.margenEur)}`}
        icono={Scale}
        alerta={margenNegativo}
        pie={
          <>
            Se factura {fmtEur(facturado)}/mes (último borrador guardado, sin impuestos) ·{" "}
            {esNulo(total.margenPct) ? SIN_DATOS : fmtPct(total.margenPct)} de margen
          </>
        }
      />
    </div>
  );
}

