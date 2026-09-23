import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FilaSerie } from "@/hooks/useTraficoWeb";
import { fmtDecimal1, fmtFechaLarga, fmtNumero, fmtPct, esNulo, SIN_DATOS } from "./formato";

export function TablaAnomalias({ serie }: { serie: FilaSerie[] }) {
  const anomalias = serie.filter((f) => f.es_anomalia === true).reverse();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium sm:text-base">
          <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
          Anomalías del periodo
        </CardTitle>
        <CardDescription className="text-xs">
          Días cuyo tráfico se aleja más de 2 desviaciones de la media de los 8 mismos días de la semana anteriores.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        {anomalias.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Ninguna anomalía en este periodo.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Visitas</TableHead>
                  <TableHead className="text-right">Media mismo día</TableHead>
                  <TableHead className="text-right">z</TableHead>
                  <TableHead className="text-right">Desviación</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {anomalias.map((f) => (
                  <TableRow key={f.fecha}>
                    <TableCell className="whitespace-nowrap capitalize">{fmtFechaLarga(f.fecha)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNumero(f.visitas)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtDecimal1(f.media_dow)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {esNulo(f.z_dow) ? SIN_DATOS : f.z_dow.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtPct(f.desviacion_pct, true)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
