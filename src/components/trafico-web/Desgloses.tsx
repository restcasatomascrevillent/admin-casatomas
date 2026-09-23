import { Globe2, Link2, Smartphone } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { useDesgloseTrafico, type DimensionDesglose, type FiltroProyecto } from "@/hooks/useTraficoWeb";
import { esNulo, fmtNumero, fmtPct, SIN_DATOS } from "./formato";

const DISPOSITIVOS: Record<string, string> = {
  desktop: "Ordenador",
  mobile: "Móvil",
  tablet: "Tablet",
};

let nombresPaises: Intl.DisplayNames | null = null;
const nombrePais = (codigo: string): string => {
  if (!/^[A-Za-z]{2}$/.test(codigo)) return codigo;
  try {
    nombresPaises ??= new Intl.DisplayNames(["es"], { type: "region" });
    return nombresPaises.of(codigo.toUpperCase()) ?? codigo;
  } catch {
    return codigo;
  }
};

const etiqueta = (dimension: DimensionDesglose, valor: string): string => {
  if (dimension === "device") return DISPOSITIVOS[valor.toLowerCase()] ?? valor;
  if (dimension === "country") return nombrePais(valor);
  return valor;
};

const CONFIG: { dimension: DimensionDesglose; titulo: string; icono: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { dimension: "device", titulo: "Dispositivo", icono: Smartphone },
  { dimension: "country", titulo: "País", icono: Globe2 },
  { dimension: "referrer", titulo: "Procedencia", icono: Link2 },
];

interface DesgloseProps {
  proyecto: FiltroProyecto;
  dimension: DimensionDesglose;
  titulo: string;
  icono: ComponentType<SVGProps<SVGSVGElement>>;
  desde: string;
  hasta: string;
}

function Desglose({ proyecto, dimension, titulo, icono: Icono, desde, hasta }: DesgloseProps) {
  const { data, isLoading, isError, error, refetch } = useDesgloseTrafico(proyecto, dimension, desde, hasta);

  if (isError) return <EstadoErrorCarga titulo={`el desglose por ${titulo.toLowerCase()}`} error={error} onReintentar={() => refetch()} />;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Icono className="h-4 w-4 text-muted-foreground" aria-hidden />
          {titulo}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : !data || data.length === 0 ? (
          <p className="py-4 text-center text-sm italic text-muted-foreground">{SIN_DATOS}</p>
        ) : (
          <ul className="space-y-2.5">
            {data.map((f) => (
              <li key={f.valor} className="text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate" title={f.valor}>
                    {etiqueta(dimension, f.valor)}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    <span className="text-foreground">{fmtNumero(f.visitas)}</span> · {fmtPct(f.pct)}
                  </span>
                </div>
                {!esNulo(f.pct) && (
                  <div className="mt-1 h-1.5 w-full rounded-full bg-muted" aria-hidden>
                    <div
                      className="h-1.5 rounded-full"
                      style={{ width: `${Math.min(100, f.pct)}%`, background: "var(--viz-1)" }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function Desgloses({ proyecto, desde, hasta }: { proyecto: FiltroProyecto; desde: string; hasta: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {CONFIG.map((c) => (
        <Desglose key={c.dimension} proyecto={proyecto} desde={desde} hasta={hasta} {...c} />
      ))}
    </div>
  );
}
