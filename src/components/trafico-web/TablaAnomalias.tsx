import { AlertTriangle, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FilaSerie } from "@/hooks/useTraficoWeb";
import { esNulo, fmtDecimal1, fmtDecimal2, fmtFechaLarga, fmtNumero, fmtPct, menosTipografico } from "./formato";

export function TablaAnomalias({ serie }: { serie: FilaSerie[] }) {
  const anomalias = serie.filter((f) => f.es_anomalia === true).reverse();

  return (
    <Card variante="plana">
      <CardHeader className="px-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium sm:text-base">
          <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
          Anomalías del periodo
          {anomalias.length > 0 && (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium tabular-nums text-destructive">
              {anomalias.length}
            </span>
          )}
        </CardTitle>
        <CardDescription className="text-xs">
          Días cuyo tráfico se aleja más de 2 desviaciones de la media de los 8 mismos días de la semana anteriores.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {anomalias.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Ninguna anomalía en este periodo.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="[&_td]:px-2 [&_td]:py-2 [&_th]:h-9 [&_th]:px-2 [&_th]:text-xs">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Visitas</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Media mismo día</TableHead>
                  {/* z: dato técnico; en el móvil queda en el tooltip de la gráfica para que la tabla quepa. */}
                  <TableHead className="hidden text-right sm:table-cell">z</TableHead>
                  <TableHead className="text-right">Desviación</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {anomalias.map((f) => {
                  const sube = !esNulo(f.desviacion_pct) && f.desviacion_pct > 0;
                  const Flecha = sube ? ArrowUpRight : ArrowDownRight;
                  return (
                    <TableRow key={f.fecha}>
                      <TableCell className="whitespace-nowrap first-letter:uppercase">{fmtFechaLarga(f.fecha)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{fmtNumero(f.visitas)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{fmtDecimal1(f.media_dow)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{menosTipografico(fmtDecimal2(f.z_dow))}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">
                        <span className="inline-flex items-center justify-end gap-1">
                          {!esNulo(f.desviacion_pct) && (
                            <>
                              <Flecha className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                              <span className="sr-only">{sube ? "Pico:" : "Caída:"}</span>
                            </>
                          )}
                          {menosTipografico(fmtPct(f.desviacion_pct, true))}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
