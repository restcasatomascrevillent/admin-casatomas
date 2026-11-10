import { PenLine } from "lucide-react";
import { useGastoLecturaManuscrita } from "@/hooks/useGastoLecturaManuscrita";
import { formatearEurPequeno, type ResumenLecturaManuscrita } from "@/lib/reservas/gastoLecturaManuscrita";
import { Bloque } from "./Bloque";

function Cifra({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{valor}</dd>
    </div>
  );
}

function Periodo({ titulo, r }: { titulo: string; r: ResumenLecturaManuscrita }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{titulo}</h3>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cifra etiqueta="Lecturas" valor={String(r.lecturas)} />
        <Cifra etiqueta="Gasto" valor={formatearEurPequeno(r.eur)} />
        <Cifra etiqueta="Por lectura" valor={r.eurPorLectura == null ? "—" : formatearEurPequeno(r.eurPorLectura)} />
        <Cifra etiqueta="100 lecturas costarían" valor={r.eurPorLectura == null ? "—" : formatearEurPequeno(r.eurPorLectura * 100)} />
      </dl>
      {r.errores > 0 && <p className="mt-1 text-xs text-amber-700">{r.errores} lecturas fallaron (no se cobran o cuestan muy poco).</p>}
    </div>
  );
}

/** Super Admin › Servicios › Costes: lo que cuesta leer las reservas escritas a mano en el libro. */
export function GastoLecturaManuscrita({ eurPorUsd }: { eurPorUsd: number }) {
  const { data, isLoading, isError } = useGastoLecturaManuscrita(eurPorUsd);
  return (
    <Bloque
      id="costes-lectura-manuscrita"
      icono={<PenLine />}
      titulo="Leer reservas escritas a mano"
      descripcion="Cada «Interpretar» del libro de reservas manda la foto de lo escrito a la IA (OpenAI con visión). Importes en euros al cambio del día."
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : isError || !data ? (
        <p className="text-sm text-muted-foreground">No se pudo leer el gasto ahora mismo.</p>
      ) : (
        <div className="space-y-4">
          <Periodo titulo="Este mes" r={data.mes} />
          <Periodo titulo="Últimos 30 días" r={data.ultimos30} />
        </div>
      )}
    </Bloque>
  );
}
