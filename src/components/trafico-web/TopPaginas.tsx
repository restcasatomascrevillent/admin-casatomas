import { useState } from "react";
import { FileText } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
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

export function TopPaginas({ proyecto, desde, hasta }: TopPaginasProps) {
  const [orden, setOrden] = useState<OrdenTopPaginas>("visitas");
  const { data, isLoading, isError, error, refetch } = useTopPaginas(proyecto, desde, hasta, orden);
  const mostrarProyecto = proyecto === "ambos";

  if (isError) return <EstadoErrorCarga titulo="las páginas más vistas" error={error} onReintentar={() => refetch()} />;

  return (
    <Card variante="plana">
      <CardHeader className="px-0 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium sm:text-base">
            <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
            Páginas
          </CardTitle>
          <Tabs value={orden} onValueChange={(v) => setOrden(v as OrdenTopPaginas)}>
            <TabsList className="h-auto">
              <TabsTrigger value="visitas" className="min-h-11 px-3 text-sm">
                Por visitas
              </TabsTrigger>
              <TabsTrigger value="bytes" className="min-h-11 px-3 text-sm">
                Por transferencia
              </TabsTrigger>
            </TabsList>
          </Tabs>
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ruta</TableHead>
                  <TableHead className="text-right">Visitas</TableHead>
                  <TableHead className="text-right">% visitas</TableHead>
                  <TableHead className="text-right">Transf. estimada</TableHead>
                  <TableHead className="text-right">% transf.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((f) => {
                  const pctBarra = orden === "bytes" ? f.pct_bytes : f.pct_visitas;
                  return (
                    <TableRow key={`${f.proyecto}|${f.ruta}`}>
                      <TableCell className="max-w-[260px]">
                        <div className="flex items-center gap-2">
                          {mostrarProyecto && (
                            <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
                              {NOMBRE_PROYECTO[f.proyecto as ProyectoTrafico] ?? f.proyecto}
                            </Badge>
                          )}
                          <span className="truncate font-mono text-xs" title={f.ruta}>
                            {f.ruta}
                          </span>
                        </div>
                        {!esNulo(pctBarra) && (
                          <div className="mt-1 h-1 w-full rounded-full bg-muted" aria-hidden>
                            <div
                              className="h-1 rounded-full"
                              style={{ width: `${Math.min(100, pctBarra)}%`, background: "var(--viz-1)" }}
                            />
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNumero(f.visitas)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtPct(f.pct_visitas)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtBytes(f.bytes_estimados)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtPct(f.pct_bytes)}</TableCell>
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
