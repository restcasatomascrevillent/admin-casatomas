import type { ComponentType, ReactNode, SVGProps } from "react";
import { AlertOctagon, AlertTriangle, ArrowRight, BellRing, CalendarClock, CalendarRange, CheckCircle2, Gauge, Info, Loader2, TrendingUp, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  type AvisoConsumo,
  type DestinoPendiente,
  type GravedadPendiente,
  type Pendiente,
  type Renovacion,
  type ResumenCostes,
  formatearEur,
  formatearPorcentaje,
} from "@/lib/servicios";
import { BarraPorcentaje, ChipSemaforo } from "./BarraConsumo";
import { Bloque } from "./Bloque";
import { ListaRenovaciones } from "./ListaRenovaciones";

interface CifraProps {
  titulo: string;
  icono: ComponentType<SVGProps<SVGSVGElement>>;
  valor: ReactNode;
  children?: ReactNode;
  className?: string;
  testId: string;
}

function Cifra({ titulo, icono: Icono, valor, children, className, testId }: CifraProps) {
  return (
    <div data-testid={testId} className={cn("flex min-w-0 flex-col gap-1 rounded-lg border bg-card p-3 sm:p-4", className)}>
      <p className="flex items-start justify-between gap-2 text-xs font-medium text-muted-foreground sm:text-sm">
        <span className="min-w-0">{titulo}</span>
        <Icono className="h-4 w-4 shrink-0" aria-hidden="true" />
      </p>
      <p className="break-words text-xl font-semibold leading-tight tabular-nums text-foreground sm:text-2xl">{valor}</p>
      {children && <div className="min-w-0 break-words text-xs text-muted-foreground">{children}</div>}
    </div>
  );
}

const ICONO_GRAVEDAD: Record<GravedadPendiente, { icono: ComponentType<SVGProps<SVGSVGElement>>; clase: string; texto: string }> = {
  rojo: { icono: AlertOctagon, clase: "text-red-700 dark:text-red-400", texto: "Urgente" },
  ambar: { icono: AlertTriangle, clase: "text-amber-700 dark:text-amber-400", texto: "Aviso" },
  info: { icono: Info, clase: "text-sky-700 dark:text-sky-400", texto: "Para revisar" },
};

function FilaPendiente({ p, onIr }: { p: Pendiente; onIr: (d: DestinoPendiente) => void }) {
  const g = ICONO_GRAVEDAD[p.gravedad];
  const Icono = g.icono;
  return (
    <li className="flex min-w-0 items-start gap-3 py-2.5 first:pt-0 last:pb-0" data-pendiente={p.clave} data-gravedad={p.gravedad}>
      <Icono className={cn("mt-0.5 h-5 w-5 shrink-0", g.clase)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-medium text-foreground">
          <span className="sr-only">{g.texto}: </span>
          {p.titulo}
        </p>
        {p.detalle && <p className="break-words text-xs text-muted-foreground">{p.detalle}</p>}
      </div>
      <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => onIr(p.destino)} aria-label={`${p.accion}: ${p.titulo}`}>
        {p.accion}
      </Button>
    </li>
  );
}

function FilaCercana({ a }: { a: AvisoConsumo }) {
  const etiqueta = `${a.nombre} · ${a.etiqueta}`;
  return (
    <li className="min-w-0 space-y-1.5 py-2.5 first:pt-0 last:pb-0" data-cercano={`${a.proveedor}:${a.clave}`}>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <span className="min-w-0 break-words text-sm">
          <span className="font-medium text-foreground">{a.nombre}</span>
          <span className="text-muted-foreground"> · {a.etiqueta}</span>
        </span>
        <ChipSemaforo estado={a.semaforo} className="shrink-0 tabular-nums">{formatearPorcentaje(a.porcentaje)}</ChipSemaforo>
      </div>
      <BarraPorcentaje porcentaje={a.porcentaje} estado={a.semaforo} etiqueta={etiqueta} className="h-2" />
      {a.textoValor && a.textoLimite && <p className="text-xs tabular-nums text-muted-foreground">{a.textoValor} de {a.textoLimite}</p>}
    </li>
  );
}

interface Props {
  resumen: ResumenCostes;
  pendientes: Pendiente[];
  cercanos: AvisoConsumo[];
  renovaciones: Renovacion[];
  cargandoLecturas: boolean;
  onIr: (destino: DestinoPendiente) => void;
}

/**
 * Super Admin › Servicios › Resumen: lo esencial de un vistazo. Arriba, cuánto
 * se gasta (el mes, la previsión a fin de mes y la del año); debajo, lo que
 * requiere atención (con un botón que lleva a donde se arregla) y, al lado,
 * lo más cerca del límite y las próximas renovaciones.
 */
export function PestanaResumen({ resumen, pendientes, cercanos, renovaciones, cargandoLecturas, onIr }: Props) {
  const urgentes = pendientes.filter((p) => p.gravedad === "rojo").length;
  return (
    <div className="flex min-w-0 flex-col gap-4 pb-2">
      <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-3">
        <Cifra testId="cifra-mes" className="col-span-2 lg:col-span-1" titulo="Gasto este mes" icono={Wallet} valor={formatearEur(resumen.totalMesEur)}>
          {formatearEur(resumen.fijoMesEur)} de cuotas + {formatearEur(resumen.variableMesEur)} por uso, hasta hoy.
          {resumen.sinPrecio.length > 0 && (
            <span className="block text-amber-900 dark:text-amber-200">
              No incluye {resumen.sinPrecio.length === 1 ? resumen.sinPrecio[0] : `${resumen.sinPrecio.length} servicios`}: falta su precio.
            </span>
          )}
        </Cifra>
        <Cifra testId="cifra-fin-mes" titulo="Previsión a fin de mes" icono={TrendingUp} valor={`≈ ${formatearEur(resumen.previsionMesEur)}`}>
          El uso, al ritmo de estos días.
        </Cifra>
        <Cifra testId="cifra-anio" titulo="Previsión del año" icono={CalendarRange} valor={`≈ ${formatearEur(resumen.previsionAnioEur)}`}>
          Cuotas: {formatearEur(resumen.fijoAnioEur)} al año.
        </Cifra>
      </div>

      <Bloque
        id="servicios-atencion"
        icono={<BellRing />}
        titulo={pendientes.length > 0 ? `Requiere atención (${pendientes.length})` : "Requiere atención"}
        descripcion={pendientes.length > 0 ? (urgentes > 0 ? `${urgentes === 1 ? "Una es urgente" : `${urgentes} son urgentes`}: van primero.` : "De lo más importante a lo menos.") : undefined}
        className={cn(urgentes > 0 && "border-red-300 dark:border-red-800")}
      >
        {pendientes.length > 0 ? (
          <ul className="min-w-0 divide-y divide-border/60" aria-labelledby="servicios-atencion">
            {pendientes.map((p) => <FilaPendiente key={p.clave} p={p} onIr={onIr} />)}
          </ul>
        ) : cargandoLecturas ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Leyendo el consumo de los servicios…
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
            Nada pendiente: todo dentro de sus límites, sin claves que falten ni renovaciones cerca.
          </p>
        )}
      </Bloque>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <Bloque
          id="servicios-cerca"
          icono={<Gauge />}
          titulo="Lo más cerca del límite"
          acciones={
            <Button type="button" variant="ghost" size="sm" className="gap-1 px-2" onClick={() => onIr({ pestana: "servicios" })}>
              Ver todo el consumo
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          }
        >
          {cercanos.length > 0 ? (
            <ul className="min-w-0 divide-y divide-border/60" aria-labelledby="servicios-cerca">
              {cercanos.map((a) => <FilaCercana key={`${a.proveedor}-${a.clave}`} a={a} />)}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {cargandoLecturas ? "Leyendo el consumo…" : "Todavía no hay lecturas con límite: cuando las haya, aquí sale lo que más se acerca a su tope."}
            </p>
          )}
        </Bloque>
        <Bloque id="servicios-renovaciones" icono={<CalendarClock />} titulo="Próximas renovaciones">
          <ListaRenovaciones renovaciones={renovaciones} idTitulo="servicios-renovaciones" max={5} />
        </Bloque>
      </div>
    </div>
  );
}
