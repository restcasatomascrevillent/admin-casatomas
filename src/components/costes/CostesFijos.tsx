import { Fragment } from "react";
import { AlertTriangle, Server } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CosteFijo } from "@/hooks/useCostes";
import { esNulo, fmtEur, fmtFecha, SIN_DATOS } from "./formato";
import { agruparCostesFijos, diasDesde, DIAS_VERIFICACION_CADUCA, etiquetaCategoria } from "./calculos";

interface CostesFijosProps {
  filas: CosteFijo[];
  /** `now` inyectable para tests. */
  ahora?: Date;
}

/**
 * Lo que se paga todos los meses pase lo que pase. Se declara a mano en SQL, así
 * que lo importante no es solo el importe sino CUÁNDO se comprobó: un precio de
 * hace seis meses ya no vale para poner un precio de venta hoy.
 *
 * De solo lectura en esta pasada: aún no hay editor.
 */
export function CostesFijos({ filas, ahora = new Date() }: CostesFijosProps) {
  const { grupos, totalEur, sinDato, conDato } = agruparCostesFijos(filas);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium sm:text-base">
          <Server className="h-4 w-4 text-muted-foreground" aria-hidden />
          Costes fijos mensuales (EUR)
        </CardTitle>
        <CardDescription className="text-xs">
          Declarados a mano: no hay ninguna sincronización con los proveedores. Un importe «sin datos» es uno que nadie
          ha verificado todavía, y no cuenta en el total — nunca se toma como 0 €.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        {grupos.length === 0 ? (
          <p className="py-4 text-center text-sm italic text-muted-foreground">
            No hay ningún coste fijo declarado.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Concepto</TableHead>
                  <TableHead scope="col">Proveedor</TableHead>
                  <TableHead scope="col">Naturaleza</TableHead>
                  <TableHead scope="col" className="text-right">
                    €/mes
                  </TableHead>
                  <TableHead scope="col">Verificado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grupos.map((g) => (
                  <Fragment key={g.categoria}>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableCell colSpan={3} className="py-1.5 text-xs font-semibold uppercase tracking-wide">
                        {etiquetaCategoria(g.categoria)}
                      </TableCell>
                      <TableCell className="py-1.5 text-right text-xs font-semibold tabular-nums">
                        {fmtEur(g.totalEur)}
                      </TableCell>
                      <TableCell className="py-1.5 text-xs text-muted-foreground">
                        {g.sinDato > 0 ? `${g.sinDato} sin verificar` : ""}
                      </TableCell>
                    </TableRow>
                    {g.filas.map((f) => {
                      const dias = diasDesde(f.verificado_en, ahora);
                      const caducado = !esNulo(f.eur_mes) && (dias === null || dias > DIAS_VERIFICACION_CADUCA);
                      return (
                        <TableRow key={f.id}>
                          <TableCell>
                            <span className="font-medium">{f.concepto}</span>
                            {f.notas && <p className="text-xs text-muted-foreground">{f.notas}</p>}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{f.proveedor}</TableCell>
                          <TableCell>
                            <Badge variant={f.naturaleza === "variable" ? "outline" : "secondary"} className="text-[10px]">
                              {f.naturaleza}
                            </Badge>
                          </TableCell>
                          <TableCell
                            className={
                              esNulo(f.eur_mes)
                                ? "text-right text-sm italic text-muted-foreground"
                                : "text-right font-medium tabular-nums"
                            }
                          >
                            {fmtEur(f.eur_mes)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {fmtFecha(f.verificado_en)}
                            {caducado && (
                              <span className="ml-1.5 inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                                <AlertTriangle className="h-3 w-3" aria-hidden />
                                {dias === null ? "sin verificar" : `hace ${dias} días`}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </Fragment>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3}>{sinDato > 0 ? "Total conocido (mínimo)" : "Total"}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{fmtEur(totalEur)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {conDato} verificado{conDato === 1 ? "" : "s"}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
        {sinDato > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            {sinDato} {sinDato === 1 ? "concepto está" : "conceptos están"} sin verificar, así que el total de arriba
            es un mínimo: el coste fijo real es mayor.
          </p>
        )}
        {grupos.length > 0 && sinDato === 0 && totalEur === null && (
          <p className="mt-2 text-xs text-muted-foreground">{SIN_DATOS}</p>
        )}
      </CardContent>
    </Card>
  );
}
