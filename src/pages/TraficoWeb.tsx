import { lazy, Suspense, useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { BarChart3, FileBarChart2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { SeccionComportamiento } from "@/components/trafico-web/comportamiento/SeccionComportamiento";

// Informe mensual en diapositivas (y su PDF): solo se descarga al abrirlo.
const InformeTraficoDialog = lazy(() => import("@/components/trafico-web/informe/InformeTraficoDialog"));

const ISO = "yyyy-MM-dd";

/** Suelo (px) del alto de la página: por debajo deja de encoger y vuelve el scroll de página. */
const ALTURA_MINIMA_TRAFICO = 360;

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
  const [informeAbierto, setInformeAbierto] = useState(false);

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

  // Alto de la pantalla (regla del dueño, 2026-10-07: sin scroll de página).
  // Solución provisional de la auditoría para este informe (clase C): subtítulo,
  // filtros y KPIs fijos arriba; avisos, gráfica, transferencia, anomalías y
  // desgloses en una región con scroll propio. Sin medida (jsdom, primer
  // pintado) cae al layout de siempre, con scroll de página.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_TRAFICO);
  const kpisListos = !serieQ.isError && !serieQ.isLoading && !sinDatos;

  return (
    <SuperAdminLayout>
      <div ref={setRaiz} className="flex flex-col gap-3" style={alto ? { height: alto } : undefined}>
        {/* Sin título "Tráfico web" (2026-09-25): ya lo dice la pestaña activa del menú lateral. Filtros a la izquierda y
            las dos acciones a la derecha, en una sola fila; el origen de los datos (Vercel Web Analytics, con estimación
            de la transferencia) y la hora del último sync van en la línea discreta de debajo de las cifras. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <FiltrosTrafico proyecto={proyecto} onProyectoChange={setProyecto} dias={dias} onDiasChange={setDias} />
          {/* `flex-wrap` (Fase 3): a 320 px «Pesos por página» se salía de la pantalla. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" className="h-11 gap-2" onClick={() => setInformeAbierto(true)}>
              <FileBarChart2 className="h-4 w-4" aria-hidden />
              Generar informe
            </Button>
            <EditorPesoPaginas />
          </div>
        </div>

        {/* KPIs fijos bajo los filtros. Mientras cargan, su esqueleto va en la región (CargandoPagina). */}
        {kpisListos && (
          <KpisTrafico
            actual={actual}
            anterior={anterior}
            tendencia={tendenciaQ.data}
            dias={dias}
            proyecto={proyecto}
            estadosSync={syncQ.data}
          />
        )}

        {/* Región con scroll. Los avisos van aquí (y no fijos arriba) porque pueden
            ser varios y dejarían sin sitio al resto. `min-h-48`: suelo de la región;
            si lo fijo no deja sitio (móvil) vuelve el scroll de página. */}
        <div className="min-h-48 flex-1 space-y-5 overflow-y-auto overscroll-contain">
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
              <AvisosTrafico proyecto={proyecto} estados={syncQ.data} diasConDato={actual.diasConDato} mostrarUltimoSync={false} />

              {tendenciaQ.isError && (
                <EstadoErrorCarga titulo="la tendencia" error={tendenciaQ.error} onReintentar={() => tendenciaQ.refetch()} />
              )}

              <GraficoSerieVisitas serie={serieActual} tendencia={tendenciaQ.data} hoy={hoy} />

              <div className="grid gap-5 xl:grid-cols-2">
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
              {/* Comportamiento (eventos propios con consentimiento, Super Admin › Logs): mismo periodo y mismas
                  definiciones que Logs › Estadísticas. Solo la web de Casa Tomás lleva el rastreador. */}
              {proyecto !== "touza-restaurant-website" && <SeccionComportamiento desde={desde} hasta={hasta} />}
            </>
          )}
        </div>
      </div>
      {informeAbierto && (
        <Suspense fallback={null}>
          <InformeTraficoDialog abierto={informeAbierto} onAbiertoChange={setInformeAbierto} />
        </Suspense>
      )}
    </SuperAdminLayout>
  );
}
