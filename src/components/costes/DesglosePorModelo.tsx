import { Brain, Cpu } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FilaCostePorModelo } from "@/hooks/useCostes";
import { esNulo, fmtNumero, fmtPct, fmtTokens, fmtUsd, fmtUsdPreciso, SIN_DATOS } from "./formato";

/**
 * El desglose por modelo es el motivo de esta pantalla: aquí se ve si un modelo
 * de razonamiento compensa. Por eso la columna de razonamiento va destacada —
 * esos tokens se facturan como salida (los más caros) y no se ven en la
 * respuesta, así que es el gasto que más fácil se cuela.
 */
export function DesglosePorModelo({ filas }: { filas: FilaCostePorModelo[] }) {
  const hayRazonamiento = filas.some((f) => f.razonamiento_tokens > 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium sm:text-base">
          <Cpu className="h-4 w-4 text-muted-foreground" aria-hidden />
          Coste por modelo
        </CardTitle>
        <CardDescription className="text-xs">
          Los <strong>tokens de razonamiento</strong> se facturan al precio de salida aunque el usuario nunca los lea:
          un modelo que «piensa» mucho puede costar varias veces lo que aparenta. La columna «% razon.» es la parte de
          la salida que se ha ido en pensar.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        {filas.length === 0 ? (
          <p className="py-4 text-center text-sm italic text-muted-foreground">{SIN_DATOS}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Modelo</TableHead>
                  <TableHead scope="col" className="text-right">
                    Peticiones
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Entrada
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Cacheados
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Salida
                  </TableHead>
                  <TableHead scope="col" className="whitespace-nowrap text-right text-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Brain className="h-3.5 w-3.5" aria-hidden />
                      Razonamiento
                    </span>
                  </TableHead>
                  <TableHead scope="col" className="text-right text-foreground">
                    % razon.
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Coste
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    % del total
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Por petición
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.map((f) => (
                  <TableRow key={f.modelo}>
                    <TableCell>
                      <span className="font-medium">{f.modelo}</span>
                      {!f.tarifado && (
                        <Badge
                          variant="outline"
                          className="ml-2 border-amber-500/60 px-1.5 py-0 text-[10px] text-amber-700 dark:text-amber-400"
                        >
                          sin tarifa
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNumero(f.peticiones)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {fmtTokens(f.prompt_tokens)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {fmtTokens(f.cached_tokens)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {fmtTokens(f.completion_tokens)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {fmtTokens(f.razonamiento_tokens)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {esNulo(f.pct_razonamiento) ? SIN_DATOS : fmtPct(f.pct_razonamiento)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{fmtUsd(f.coste_usd)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {esNulo(f.pct) ? SIN_DATOS : fmtPct(f.pct)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {fmtUsdPreciso(f.usd_por_peticion)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {!hayRazonamiento && filas.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Ningún modelo del periodo ha usado tokens de razonamiento.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
