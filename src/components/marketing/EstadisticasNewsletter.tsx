import { useId, type ReactNode } from "react";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AyudaPopover } from "@/components/AyudaPopover";
import { useEstadisticasCorreos } from "@/hooks/useEmailEventos";
import { cn } from "@/lib/utils";
import { Send, CheckCircle, Mail, MousePointerClick, AlertTriangle, RefreshCw, TrendingUp } from "lucide-react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

// Todas las cifras de esta pestaña salen de UNA cuenta (`resumirEventosCorreo`,
// lib/newsletter/estadisticasCorreos.ts): cada correo cuenta una vez en cada
// estado y los porcentajes son siempre sobre los enviados. Antes las tarjetas
// sumaban conjuntos que se solapan (39 «entregados» de 30 enviados) y no
// cuadraban con el desglose. Ver la cabecera de ese fichero.
//
// TODO A LA VISTA, SIN SCROLL (petición del dueño, 2026-10-06): la pestaña
// cabe en el alto que le da Marketing (`useAlturaDisponible`) desde 768 px de
// ancho. Cabecera en una fila (la explicación larga va en la ayuda «i»),
// tarjetas bajas en una fila y la gráfica ocupa el resto del alto. Desde `lg`
// el desglose y el historial van a la derecha de la gráfica; entre `md` y `lg`
// (tablet vertical), debajo. Si el historial es largo, solo su lista hace
// scroll. En móvil (< md) todo va en columna y desplaza la pestaña entera.

const ESTILO_TOOLTIP = {
  backgroundColor: "hsl(var(--background))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
} as const;

/** Las cuatro líneas de la tendencia: mismo nombre y color en la gráfica y en su leyenda. */
const SERIES = [
  { clave: "enviados", nombre: "Enviados", color: "#64748b" },
  { clave: "entregados", nombre: "Entregados", color: "#22c55e" },
  { clave: "abiertos", nombre: "Abiertos", color: "#3b82f6" },
  { clave: "clics", nombre: "Con clic", color: "#a855f7" },
] as const;

const TEXTO_AYUDA =
  "Cuenta todos los correos que envía el restaurante: los de las reservas y los de la newsletter. Cada correo cuenta una sola vez y los porcentajes son sobre los enviados. Se actualizan solas cada minuto.";

interface TarjetaCifraProps {
  titulo: string;
  icono: ReactNode;
  cifra: ReactNode;
  detalle: string;
  claseCifra?: string;
}

/**
 * Tarjeta baja: etiqueta e icono arriba y, debajo, la cifra con su «n de N correos». Desde `lg` los dos
 * van en la misma línea; por debajo (tarjetas estrechas) el detalle va debajo en las cuatro por igual.
 */
function TarjetaCifra({ titulo, icono, cifra, detalle, claseCifra }: TarjetaCifraProps) {
  const idTitulo = useId();
  return (
    <Card role="group" aria-labelledby={idTitulo} className="p-3">
      <div className="flex items-center justify-between gap-2">
        <CardTitle id={idTitulo} className="truncate text-sm font-medium">
          {titulo}
        </CardTitle>
        {icono}
      </div>
      <div className="mt-1 flex flex-col lg:flex-row lg:flex-wrap lg:items-baseline lg:gap-x-2">
        <span className={cn("text-2xl font-bold leading-8", claseCifra)}>{cifra}</span>
        <span className="text-xs text-muted-foreground">{detalle}</span>
      </div>
    </Card>
  );
}

interface EstadisticasNewsletterProps {
  /** Lo que va junto al desglose: en Marketing, el historial de envíos (se le da el alto que queda). */
  historial?: ReactNode;
}

export function EstadisticasNewsletter({ historial }: EstadisticasNewsletterProps) {
  const { data, isLoading, isError, refetch, isFetching } = useEstadisticasCorreos();
  const idGrafica = useId();

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div role="status" aria-label="Cargando las estadísticas" className="flex items-center justify-center py-12">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
        {historial}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-3">
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-muted-foreground">
              <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-destructive" />
              <p className="font-medium">No se pudieron cargar las estadísticas</p>
              <Button onClick={() => refetch()} className="mt-4 min-h-11" variant="outline">
                <RefreshCw className="h-4 w-4 mr-2" />
                Reintentar
              </Button>
            </div>
          </CardContent>
        </Card>
        {historial}
      </div>
    );
  }

  const { cifras, tasas, porDia, truncado } = data;
  const deEnviados = (n: number) => `${n} de ${cifras.enviados} correos`;
  const hayTendencia = porDia.some((d) => d.enviados || d.entregados || d.abiertos || d.clics);

  return (
    <div data-testid="estadisticas-correos" className="flex flex-col gap-3 md:h-full">
      <div className="flex shrink-0 flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <h3 className="text-base font-semibold">Estadísticas de los correos</h3>
            <AyudaPopover etiqueta="Qué cuentan estas estadísticas">{TEXTO_AYUDA}</AyudaPopover>
          </div>
          <Button onClick={() => refetch()} variant="outline" size="sm" className="shrink-0" disabled={isFetching}>
            <RefreshCw className={isFetching ? "animate-spin" : undefined} aria-hidden="true" />
            Actualizar
          </Button>
        </div>
        {truncado && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Hay tantos datos que solo se cuentan los más recientes; los correos más antiguos pueden faltar.
          </p>
        )}
      </div>

      <div data-testid="tarjetas-correos" className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-4">
        <TarjetaCifra
          titulo="Enviados"
          icono={<Send className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
          cifra={cifras.enviados}
          detalle="correos enviados"
        />
        <TarjetaCifra
          titulo="Entregados"
          icono={<CheckCircle className="h-4 w-4 shrink-0 text-green-500" aria-hidden="true" />}
          cifra={`${tasas.entrega}%`}
          detalle={deEnviados(cifras.entregados)}
          claseCifra="text-green-600"
        />
        <TarjetaCifra
          titulo="Abiertos"
          icono={<Mail className="h-4 w-4 shrink-0 text-blue-500" aria-hidden="true" />}
          cifra={`${tasas.apertura}%`}
          detalle={deEnviados(cifras.abiertos)}
          claseCifra="text-blue-600"
        />
        <TarjetaCifra
          titulo="Con clic"
          icono={<MousePointerClick className="h-4 w-4 shrink-0 text-purple-500" aria-hidden="true" />}
          cifra={`${tasas.clics}%`}
          detalle={deEnviados(cifras.clics)}
          claseCifra="text-purple-600"
        />
      </div>

      {/* Gráfica (el resto del alto) y, a su lado desde `lg` o debajo, desglose + historial. Entre `md`
          y `lg` la fila de la gráfica mide al menos 15rem (lienzo de ~185 px) y el desglose y el
          historial se quedan lo suyo; si el historial no cabe, solo su lista hace scroll. El suelo del
          bloque (32rem / 20rem) hace que, en ventanas más bajas, desplace la pestaña antes que aplastarlo. */}
      <div
        data-testid="zona-grafica"
        className={cn(
          "grid gap-3 md:min-h-[32rem] md:flex-1 md:grid-rows-[minmax(15rem,1fr)_minmax(0,auto)] lg:min-h-[20rem]",
          hayTendencia && "lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:grid-rows-[minmax(0,1fr)]",
        )}
      >
        {hayTendencia && (
          <Card className="flex h-64 flex-col p-3 md:h-auto">
            <figure aria-labelledby={idGrafica} className="flex min-h-0 flex-1 flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <CardTitle id={idGrafica} className="flex items-center gap-1.5 text-sm font-medium">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  Últimos 7 días
                </CardTitle>
                <ul aria-label="Leyenda" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {SERIES.map((s) => (
                    <li key={s.clave} className="flex items-center gap-1.5">
                      <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
                      {s.nombre}
                    </li>
                  ))}
                </ul>
              </div>
              <div data-testid="lienzo-grafica" className="relative min-h-0 flex-1">
                <div className="absolute inset-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={porDia}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis
                        dataKey="fecha"
                        tickFormatter={(value) => format(parseISO(value), "d MMM", { locale: es })}
                        className="text-xs"
                      />
                      <YAxis className="text-xs" allowDecimals={false} />
                      <Tooltip
                        labelFormatter={(value) => format(parseISO(String(value)), "d MMMM yyyy", { locale: es })}
                        contentStyle={ESTILO_TOOLTIP}
                      />
                      {SERIES.map((s) => (
                        <Line key={s.clave} type="monotone" dataKey={s.clave} name={s.nombre} stroke={s.color} strokeWidth={2} dot={false} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              {/* Los mismos datos en una tabla para el lector de pantalla (el SVG no se puede leer). El
                  `sr-only` va en un <div>: una <table> no respeta el ancho de 1 px y desbordaba el móvil. */}
              <div className="sr-only">
                <table>
                  <caption>Correos de cada día de los últimos 7 días</caption>
                  <thead>
                    <tr>
                      <th scope="col">Día</th>
                      {SERIES.map((s) => (
                        <th key={s.clave} scope="col">
                          {s.nombre}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {porDia.map((d) => (
                      <tr key={d.fecha}>
                        <th scope="row">{format(parseISO(d.fecha), "d MMMM", { locale: es })}</th>
                        {SERIES.map((s) => (
                          <td key={s.clave}>{d[s.clave]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </figure>
          </Card>
        )}

        <div className="flex min-h-0 flex-col gap-3">
          <Card className="shrink-0 p-3">
            <CardTitle className="mb-2 text-sm font-medium">Desglose</CardTitle>
            <div className={cn("grid grid-cols-3 gap-2 sm:grid-cols-6", hayTendencia && "lg:grid-cols-3")}>
              <div className="text-center px-2 py-1.5 rounded-md bg-muted/50">
                <div className="text-lg font-bold leading-6">{cifras.enviados}</div>
                <div className="text-xs text-muted-foreground">Enviados</div>
              </div>
              <div className="text-center px-2 py-1.5 rounded-md bg-green-50 dark:bg-green-950">
                <div className="text-lg font-bold leading-6 text-green-600">{cifras.entregados}</div>
                <div className="text-xs text-muted-foreground">Entregados</div>
              </div>
              <div className="text-center px-2 py-1.5 rounded-md bg-blue-50 dark:bg-blue-950">
                <div className="text-lg font-bold leading-6 text-blue-600">{cifras.abiertos}</div>
                <div className="text-xs text-muted-foreground">Abiertos</div>
              </div>
              <div className="text-center px-2 py-1.5 rounded-md bg-purple-50 dark:bg-purple-950">
                <div className="text-lg font-bold leading-6 text-purple-600">{cifras.clics}</div>
                <div className="text-xs text-muted-foreground">Con clic</div>
              </div>
              <div className="text-center px-2 py-1.5 rounded-md bg-orange-50 dark:bg-orange-950">
                <div className="text-lg font-bold leading-6 text-orange-600">{cifras.noEntregados}</div>
                <div className="text-xs text-muted-foreground">No entregados</div>
              </div>
              <div className="text-center px-2 py-1.5 rounded-md bg-red-50 dark:bg-red-950">
                <div className="text-lg font-bold leading-6 text-red-600">{cifras.spam}</div>
                <div className="text-xs text-muted-foreground">Marcados como spam</div>
              </div>
            </div>
          </Card>
          {historial && <div className="flex min-h-0 flex-1 flex-col">{historial}</div>}
        </div>
      </div>
    </div>
  );
}
