import { Layers } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FilaCostePorFuncion } from "@/hooks/useCostes";
import { esNulo, fmtNumero, fmtPct, fmtTokens, fmtUsd, fmtUsdPreciso, SIN_DATOS } from "./formato";

/**
 * Qué parte del sistema se lleva el dinero. Las funciones sin instrumentar
 * salen igualmente (con el badge), porque una función que no aparece se lee
 * como "no gasta" y lo cierto es "no lo sabemos".
 */
export function DesglosePorFuncion({ filas }: { filas: FilaCostePorFuncion[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium sm:text-base">
          <Layers className="h-4 w-4 text-muted-foreground" aria-hidden />
          Coste por función
        </CardTitle>
        <CardDescription className="text-xs">
          Lo que cuesta cada parte del sistema en el periodo elegido. «Sin registro» significa que esa función todavía
          no apunta su consumo: su coste real no está contado aquí.
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
                  <TableHead scope="col">Función</TableHead>
                  <TableHead scope="col" className="text-right">
                    Peticiones
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Errores
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Tokens entrada
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Tokens salida
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
                  <TableRow key={f.funcion}>
                    <TableCell>
                      <span className="font-medium">{f.funcion}</span>
                      {!f.instrumentada && (
                        <Badge
                          variant="outline"
                          className="ml-2 border-amber-500/60 px-1.5 py-0 text-[10px] text-amber-700 dark:text-amber-400"
                        >
                          sin registro
                        </Badge>
                      )}
                      {f.descripcion && <p className="text-xs text-muted-foreground">{f.descripcion}</p>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNumero(f.peticiones)}</TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${f.errores > 0 ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {fmtNumero(f.errores)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {fmtTokens(f.prompt_tokens)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {fmtTokens(f.completion_tokens + f.razonamiento_tokens)}
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
      </CardContent>
    </Card>
  );
}
