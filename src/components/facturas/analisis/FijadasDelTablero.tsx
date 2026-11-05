// Gráficas fijadas al final del tablero:
//   · del EXPLORADOR: se guarda la configuración (no la imagen), así que se
//     recalculan con el periodo y el local del tablero;
//   · de la IA: una copia de la serie de precio que dio el copiloto.
import { useMemo } from "react";
import { BarChart3, PinOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { GraficoSeriePrecio } from "@/components/facturas/GraficoSeriePrecio";
import { useExplorarCompras } from "@/hooks/useExplorarCompras";
import { tituloSerie, type GraficaFijada } from "@/lib/facturas/graficasCopiloto";
import {
  formatoValor,
  graficaEfectiva,
  parametrosExplorar,
  resumenExploracion,
  type ConfigExplorador,
  type ExploracionFijada,
  type LocalRpc,
} from "@/lib/facturas/explorador";
import { GraficaExplorador, TablaExploracion } from "./GraficaExplorador";
import { FOCO, SinDatos, Tarjeta } from "./piezas";

const BOTON = cn(
  "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground",
  FOCO,
);

function TarjetaFijada({
  fijada,
  periodo,
  local,
  onQuitar,
  onAbrir,
}: {
  fijada: ExploracionFijada;
  periodo: { desde: string | null; hasta: string | null };
  local: LocalRpc;
  onQuitar: () => void;
  onAbrir: (c: ConfigExplorador) => void;
}) {
  const params = useMemo(() => parametrosExplorar(fijada.config, periodo, local), [fijada.config, periodo, local]);
  const q = useExplorarCompras(params, { retraso: 0 });
  const ex = q.data;
  const tipo = graficaEfectiva(fijada.config);
  return (
    <Tarjeta
      titulo={fijada.titulo}
      subtitulo={ex && !ex.sinDatos ? `Total ${formatoValor(ex.total.valor, ex.parametros.medida, ex.parametros.unidad)}` : "Del explorador"}
      resumen={ex ? resumenExploracion(ex) : undefined}
      accion={
        <span className="flex shrink-0">
          <button type="button" className={BOTON} onClick={() => onAbrir(fijada.config)} aria-label={`Abrir en el explorador: ${fijada.titulo}`}>
            <BarChart3 className="h-3.5 w-3.5" aria-hidden /> Abrir
          </button>
          <button type="button" className={BOTON} onClick={onQuitar} aria-label={`Quitar del tablero: ${fijada.titulo}`}>
            <PinOff className="h-3.5 w-3.5" aria-hidden /> Quitar
          </button>
        </span>
      }
    >
      {q.isLoading ? (
        <div className="h-44 animate-pulse rounded-lg bg-muted/50" role="status" aria-label="Calculando" />
      ) : q.isError ? (
        <p className="text-sm text-destructive" role="alert">
          No se ha podido calcular. {(q.error as Error)?.message}
        </p>
      ) : !ex || ex.sinDatos ? (
        <SinDatos>Sin datos en este periodo.</SinDatos>
      ) : tipo === "tabla" ? (
        <TablaExploracion exploracion={ex} maxAlto="max-h-52" apartarSinClasificar={ex.parametros.agrupar === "familia"} />
      ) : (
        <GraficaExplorador exploracion={ex} tipo={tipo} alto={190} compacta descripcion={`${fijada.titulo}. ${resumenExploracion(ex)}`} apartarSinClasificar={ex.parametros.agrupar === "familia"} />
      )}
    </Tarjeta>
  );
}

export function FijadasDelTablero({
  periodo,
  local,
  explorador,
  onQuitarExplorador,
  onAbrir,
  ia,
  onQuitarIa,
}: {
  periodo: { desde: string | null; hasta: string | null };
  local: LocalRpc;
  explorador: ExploracionFijada[];
  onQuitarExplorador: (id: string) => void;
  onAbrir: (c: ConfigExplorador) => void;
  ia: GraficaFijada[];
  onQuitarIa: (id: string) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2" role="group" aria-label="Gráficas fijadas">
      {explorador.map((f) => (
        <TarjetaFijada key={f.id} fijada={f} periodo={periodo} local={local} onQuitar={() => onQuitarExplorador(f.id)} onAbrir={onAbrir} />
      ))}
      {ia.map((g) => (
        <Tarjeta
          key={g.id}
          titulo={tituloSerie(g.serie)}
          subtitulo="Fijada desde la IA"
          accion={
            <button type="button" onClick={() => onQuitarIa(g.id)} className={BOTON} aria-label={`Quitar del tablero: ${tituloSerie(g.serie)}`}>
              <PinOff className="h-3.5 w-3.5" aria-hidden /> Quitar
            </button>
          }
        >
          <GraficoSeriePrecio datos={g.serie} compacto alto={180} />
        </Tarjeta>
      ))}
    </div>
  );
}
