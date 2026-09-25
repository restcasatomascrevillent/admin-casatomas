import { useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { BarChart3 } from "lucide-react";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import {
  useEstadoSyncTrafico,
  useFdtMes,
  useSerieTrafico,
  useTendenciaTrafico,
  type FiltroProyecto,
} from "@/hooks/useTraficoWeb";
import { FiltrosTrafico } from "@/components/trafico-web/FiltrosTrafico";
import { resumirSerie, type RangoDias } from "@/components/trafico-web/calculos";
import { AvisosTrafico } from "@/components/trafico-web/AvisosTrafico";
import { KpisTrafico } from "@/components/trafico-web/KpisTrafico";
import { GraficoSerieVisitas } from "@/components/trafico-web/GraficoSerieVisitas";
import { TablaAnomalias } from "@/components/trafico-web/TablaAnomalias";
import { FdtMes } from "@/components/trafico-web/FdtMes";
import { TopPaginas } from "@/components/trafico-web/TopPaginas";
import { Desgloses } from "@/components/trafico-web/Desgloses";
import { EditorPesoPaginas } from "@/components/trafico-web/EditorPesoPaginas";

const ISO = "yyyy-MM-dd";

function EstadoVacio() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
        <div className="rounded-full bg-muted p-3">
          <BarChart3 className="h-6 w-6 text-muted-foreground" aria-hidden />
        </div>
        <p className="font-medium">Aún no hay datos: la primera sincronización se ejecuta a las 03:30 UTC</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Cada noche se copian las visitas del día anterior desde Vercel Web Analytics. En cuanto llegue la primera
          sincronización aparecerán aquí las gráficas, la tendencia y la estimación de transferencia.
        </p>
      </CardContent>
    </Card>
  );
}

function CargandoPagina() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[104px]" />
        ))}
      </div>
      <Skeleton className="h-[420px]" />
    </div>
  );
}

export default function TraficoWeb() {
  const [proyecto, setProyecto] = useState<FiltroProyecto>("ambos");
  const [dias, setDias] = useState<RangoDias>(30);

  // Fechas en calendario local; la RPC trabaja con días cerrados (< hoy).
  const hoyStr = format(new Date(), ISO);
  const { hoy, desde, hasta, desdeAnterior } = useMemo(() => {
    const base = new Date(`${hoyStr}T00:00:00`);
    return {
      hoy: hoyStr,
      hasta: format(subDays(base, 1), ISO),
      desde: format(subDays(base, dias), ISO),
      // Se pide también el periodo anterior (misma duración) para el Δ% del KPI.
      desdeAnterior: format(subDays(base, 2 * dias), ISO),
    };
  }, [hoyStr, dias]);

  const serieQ = useSerieTrafico(proyecto, desdeAnterior, hasta);
  const tendenciaQ = useTendenciaTrafico(proyecto, dias);
  const fdtQ = useFdtMes();
  const syncQ = useEstadoSyncTrafico();

  const { serieActual, actual, anterior } = useMemo(() => {
    const filas = serieQ.data ?? [];
    const act = filas.filter((f) => f.fecha >= desde);
    const ant = filas.filter((f) => f.fecha < desde);
    return { serieActual: act, actual: resumirSerie(act), anterior: resumirSerie(ant) };
  }, [serieQ.data, desde]);

  const sinDatos = serieQ.isSuccess && actual.diasConDato === 0 && anterior.diasConDato === 0;

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        {/* Sin título "Tráfico web" (2026-09-25): ya lo dice la pestaña activa
            del menú lateral. Se conserva el subtítulo — no es relleno: dice de
            dónde salen los datos (Vercel Web Analytics) y que incluye una
            estimación de transferencia, algo que nadie esperaría solo por el
            nombre — y el editor de peso de páginas, que es una acción. */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <p className="text-muted-foreground">
            Visitas de Casa Tomás y Touza (Vercel Web Analytics) y estimación de la transferencia de datos.
          </p>
          <EditorPesoPaginas />
        </div>

        <FiltrosTrafico proyecto={proyecto} onProyectoChange={setProyecto} dias={dias} onDiasChange={setDias} />

        {serieQ.isError ? (
          <EstadoErrorCarga titulo="las visitas" error={serieQ.error} onReintentar={() => serieQ.refetch()} />
        ) : serieQ.isLoading ? (
          <CargandoPagina />
        ) : sinDatos ? (
          <>
            <AvisosTrafico proyecto={proyecto} estados={syncQ.data} diasConDato={0} />
            <EstadoVacio />
          </>
        ) : (
          <>
            <AvisosTrafico proyecto={proyecto} estados={syncQ.data} diasConDato={actual.diasConDato} />

            {tendenciaQ.isError && (
              <EstadoErrorCarga titulo="la tendencia" error={tendenciaQ.error} onReintentar={() => tendenciaQ.refetch()} />
            )}
            <KpisTrafico actual={actual} anterior={anterior} tendencia={tendenciaQ.data} dias={dias} />

            <GraficoSerieVisitas serie={serieActual} tendencia={tendenciaQ.data} hoy={hoy} />

            <div className="grid gap-6 xl:grid-cols-2">
              {fdtQ.isError ? (
                <EstadoErrorCarga titulo="la estimación de transferencia" error={fdtQ.error} onReintentar={() => fdtQ.refetch()} />
              ) : fdtQ.isLoading ? (
                <Skeleton className="h-[320px]" />
              ) : (
                <FdtMes filas={fdtQ.data ?? []} proyectoSeleccionado={proyecto === "ambos" ? null : proyecto} />
              )}
              <TablaAnomalias serie={serieActual} />
            </div>

            <TopPaginas proyecto={proyecto} desde={desde} hasta={hasta} />
            <Desgloses proyecto={proyecto} desde={desde} hasta={hasta} />
          </>
        )}
      </div>
    </SuperAdminLayout>
  );
}
