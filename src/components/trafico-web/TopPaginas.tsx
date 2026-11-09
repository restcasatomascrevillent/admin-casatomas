import { useState } from "react";
import { FileText } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { SelectorSubrayado } from "@/components/panel/SelectorSubrayado";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { cn } from "@/lib/utils";
import {
  NOMBRE_PROYECTO,
  useTopPaginas,
  type FiltroProyecto,
  type OrdenTopPaginas,
  type ProyectoTrafico,
} from "@/hooks/useTraficoWeb";
import { esNulo, fmtBytes, fmtNumero, fmtPct } from "./formato";

interface TopPaginasProps {
  proyecto: FiltroProyecto;
  desde: string;
  hasta: string;
}

const ORDENES: { valor: OrdenTopPaginas; etiqueta: string }[] = [
  { valor: "visitas", etiqueta: "Por visitas" },
  { valor: "bytes", etiqueta: "Por transferencia" },
];

export function TopPaginas({ proyecto, desde, hasta }: TopPaginasProps) {
  const [orden, setOrden] = useState<OrdenTopPaginas>("visitas");
  const { data, isLoading, isError, error, refetch } = useTopPaginas(proyecto, desde, hasta, orden);
  const mostrarProyecto = proyecto === "ambos";
  // La columna por la que se ordena se lee en el color del texto; las demás, en gris.
  const tonoVisitas = orden === "visitas" ? "text-foreground" : "text-muted-foreground";
  const tonoBytes = orden === "bytes" ? "text-foreground" : "text-muted-foreground";

  if (isError) return <EstadoErrorCarga titulo="las páginas más vistas" error={error} onReintentar={() => refetch()} />;

  return (
    <Card variante="plana">
      <CardHeader className="px-0 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <CardTitle className="flex items-center gap-2 text-sm font-medium sm:text-base">
            <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
            Páginas
          </CardTitle>
          <SelectorSubrayado
            aria-label="Ordenar páginas"
            valor={orden}
            onCambio={(v) => setOrden(v as OrdenTopPaginas)}
            opciones={ORDENES}
            className="-mr-3"
          />
        </div>
        <CardDescription className="text-xs">
          Transferencia = ESTIMACIÓN (visitas × peso de la página, o el peso medio de la web si no tiene uno propio).
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : !data || data.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Sin datos de páginas en este periodo.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="[&_td]:px-2 [&_td]:py-2 [&_th]:h-9 [&_th]:px-2 [&_th]:text-xs">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Ruta</TableHead>
                  <TableHead className={cn("text-right", orden === "visitas" && "text-foreground")}>Visitas</TableHead>
                  <TableHead className="text-right">% visitas</TableHead>
                  <TableHead className={cn("whitespace-nowrap text-right", orden === "bytes" && "text-foreground")}>Transf. estimada</TableHead>
                  <TableHead className="text-right">% transf.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((f) => {
                  const pctBarra = orden === "bytes" ? f.pct_bytes : f.pct_visitas;
                  return (
                    <TableRow key={`${f.proyecto}|${f.ruta}`}>
                      <TableCell className="w-1/2 max-w-[280px] sm:max-w-[420px]">
                        <div className="flex min-w-0 items-baseline gap-2">
                          <span className="truncate font-mono text-xs" title={f.ruta}>
                            {f.ruta}
                          </span>
                          {mostrarProyecto && (
                            <span className="shrink-0 text-[11px] text-muted-foreground pointer-coarse:text-xs">
                              {NOMBRE_PROYECTO[f.proyecto as ProyectoTrafico] ?? f.proyecto}
                            </span>
                          )}
                        </div>
                        {!esNulo(pctBarra) && (
                          <div className="mt-1.5 h-1 w-full rounded-full bg-muted/70" aria-hidden>
                            <div
                              className="h-1 rounded-full"
                              style={{ width: `${Math.min(100, pctBarra)}%`, background: "var(--viz-1)" }}
                            />
                          </div>
                        )}
                      </TableCell>
                      <TableCell className={cn("text-right tabular-nums", tonoVisitas, orden === "visitas" && "font-medium")}>
                        {fmtNumero(f.visitas)}
                      </TableCell>
                      <TableCell className={cn("text-right tabular-nums", tonoVisitas)}>{fmtPct(f.pct_visitas)}</TableCell>
                      <TableCell className={cn("whitespace-nowrap text-right tabular-nums", tonoBytes, orden === "bytes" && "font-medium")}>
                        {fmtBytes(f.bytes_estimados)}
                      </TableCell>
                      <TableCell className={cn("text-right tabular-nums", tonoBytes)}>{fmtPct(f.pct_bytes)}</TableCell>
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
