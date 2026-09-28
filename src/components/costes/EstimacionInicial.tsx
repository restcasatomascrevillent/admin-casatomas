import { Ruler } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { IaCosteEstimado } from "@/hooks/useCostes";
import { fmtFecha, fmtNumero, fmtUsd, fmtUsdEnEur, fmtUsdPreciso, SIN_DATOS, TEXTO_TIPO_CAMBIO } from "./formato";
import { resumirEstimacion } from "./calculos";

/**
 * La estimación del día 1: se midió a mano lo que cuesta una pregunta, un
 * documento o un plato y se multiplicó por el volumen que se espera al mes.
 *
 * Va aparte y marcada como estimación a propósito. No es medición: es lo que se
 * supuso antes de tener registro, y es lo único que hay para las funciones que
 * todavía no apuntan su consumo. Mezclarla con lo medido sería mentir.
 */
export function EstimacionInicial({ filas }: { filas: IaCosteEstimado[] }) {
  const { filas: calculadas, totalUsdMes } = resumirEstimacion(filas);

  return (
    <Card className="border-dashed bg-muted/40">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium sm:text-base">
            <Ruler className="h-4 w-4 text-muted-foreground" aria-hidden />
            Estimación inicial del coste de IA
          </CardTitle>
          <Badge
            variant="outline"
            className="border-amber-500/60 font-semibold tracking-wide text-amber-700 dark:text-amber-400"
          >
            ESTIMACIÓN
          </Badge>
        </div>
        <CardDescription className="text-xs">
          Ninguna de estas cifras está medida por el sistema: se calcularon a mano multiplicando lo que costó una
          unidad por el volumen que se espera al mes. Sirven mientras las funciones no registren su consumo; en cuanto
          lo hagan, manda el coste real de arriba.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        {calculadas.length === 0 ? (
          <p className="py-4 text-center text-sm italic text-muted-foreground">
            No hay ninguna estimación declarada.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Función</TableHead>
                  <TableHead scope="col">Unidad</TableHead>
                  <TableHead scope="col" className="text-right">
                    Coste/unidad
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Unidades/mes
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Coste/mes
                  </TableHead>
                  <TableHead scope="col">Modelo</TableHead>
                  <TableHead scope="col">Medido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calculadas.map(({ fila, usdMes }) => (
                  <TableRow key={fila.funcion}>
                    <TableCell>
                      <span className="font-medium">{fila.funcion}</span>
                      {fila.nota && <p className="text-xs text-muted-foreground">{fila.nota}</p>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{fila.unidad}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtUsdPreciso(fila.usd_por_unidad)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNumero(fila.unidades_mes_estimadas)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{fmtUsd(usdMes)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fila.modelo ?? SIN_DATOS}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {fmtFecha(fila.medido_en)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4}>Total estimado al mes</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{fmtUsd(totalUsdMes)}</TableCell>
                  <TableCell colSpan={2} className="text-xs text-muted-foreground">
                    {fmtUsdEnEur(totalUsdMes)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">{TEXTO_TIPO_CAMBIO}</p>
      </CardContent>
    </Card>
  );
}
