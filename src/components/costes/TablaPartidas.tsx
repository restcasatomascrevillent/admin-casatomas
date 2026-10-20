import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { esNulo, fmtEur, SIN_DATOS } from "./formato";
import { fmtEurIa } from "@/lib/facturas/gastoIa";
import { totalColumna, type PartidaCoste } from "./resumenMes";

const fmt = (p: PartidaCoste, v: number | null): string => {
  if (esNulo(v)) return SIN_DATOS;
  // La IA se mueve en céntimos y milésimas: decimales que crecen al bajar el importe.
  return p.tipo === "ia" ? fmtEurIa(v) : fmtEur(v);
};

/**
 * Una sola tabla de partidas, ordenada por gasto: fijos (Supabase, Vercel,
 * dominio…) e IA por proceso, con los € del mes y los del mes anterior.
 */
export function TablaPartidas({ partidas }: { partidas: PartidaCoste[] }) {
  const totalMes = totalColumna(partidas, "mesEur");
  const totalAnt = totalColumna(partidas, "anteriorEur");

  if (partidas.length === 0) {
    return (
      <p className="rounded-md border py-8 text-center text-sm italic text-muted-foreground">
        Todavía no hay ningún coste declarado ni consumo de IA registrado. Un coste vacío no significa que no se esté
        gastando.
      </p>
    );
  }

  return (
    <div className="rounded-md border">
      <Table data-testid="tabla-partidas">
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            <TableHead scope="col">Partida</TableHead>
            <TableHead scope="col" className="text-right">
              Este mes
            </TableHead>
            <TableHead scope="col" className="text-right">
              Mes anterior
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {partidas.map((p) => (
            <TableRow key={p.clave} data-testid={`partida-${p.clave}`}>
              <TableCell className="py-2">
                <span className="font-medium">{p.etiqueta}</span>
                <Badge variant="outline" className="ml-2 px-1.5 py-0 text-[10px] font-normal">
                  {p.tipo === "ia" ? "IA" : "fijo"}
                </Badge>
                {p.nota && <p className="text-xs text-muted-foreground">{p.nota}</p>}
              </TableCell>
              <TableCell
                className={
                  esNulo(p.mesEur)
                    ? "py-2 text-right text-sm italic text-muted-foreground"
                    : "py-2 text-right font-medium tabular-nums"
                }
              >
                {fmt(p, p.mesEur)}
              </TableCell>
              <TableCell
                className={
                  esNulo(p.anteriorEur)
                    ? "py-2 text-right text-sm italic text-muted-foreground"
                    : "py-2 text-right tabular-nums text-muted-foreground"
                }
              >
                {p.anteriorAprox && !esNulo(p.anteriorEur) && "≈ "}
                {fmt(p, p.anteriorEur)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="py-2">Total</TableCell>
            <TableCell className="py-2 text-right font-semibold tabular-nums">{fmtEur(totalMes)}</TableCell>
            <TableCell className="py-2 text-right font-semibold tabular-nums">{fmtEur(totalAnt)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
