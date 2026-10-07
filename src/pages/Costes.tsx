import { useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { Coins } from "lucide-react";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import {
  FUNCION_TODAS,
  useCosteMes,
  useCostePorFuncion,
  useCostePorModelo,
  useCosteSerie,
  useCostesFijos,
  useFuncionesSinRegistro,
  useIaCosteEstimado,
  useIaFunciones,
  type FiltroFuncion,
} from "@/hooks/useCostes";
import {
  DIAS_SIN_REGISTRO,
  RANGOS_DIAS,
  resumirSerieCoste,
  type RangoDias,
} from "@/components/costes/calculos";
import { AvisosCostes } from "@/components/costes/AvisosCostes";
import { KpisCostes } from "@/components/costes/KpisCostes";
import { GraficoSerieCoste } from "@/components/costes/GraficoSerieCoste";
import { ProyeccionMes } from "@/components/costes/ProyeccionMes";
import { DesglosePorFuncion } from "@/components/costes/DesglosePorFuncion";
import { DesglosePorModelo } from "@/components/costes/DesglosePorModelo";
import { EstimacionInicial } from "@/components/costes/EstimacionInicial";
import { CostesFijos } from "@/components/costes/CostesFijos";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";

const ISO = "yyyy-MM-dd";

/** Suelo (px) del alto de la página: por debajo deja de encoger y vuelve el scroll de página. */
const ALTURA_MINIMA_COSTES = 360;

interface FiltrosCostesProps {
  dias: RangoDias;
  onDiasChange: (d: RangoDias) => void;
  funcion: FiltroFuncion;
  onFuncionChange: (f: FiltroFuncion) => void;
  funciones: { funcion: string; descripcion: string }[];
}

/** Mismo patrón que `FiltrosTrafico`: periodo a la izquierda, dimensión al lado. */
function FiltrosCostes({ dias, onDiasChange, funcion, onFuncionChange, funciones }: FiltrosCostesProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-6">
      <div className="space-y-1.5">
        <span className="block text-xs text-muted-foreground" id="costes-rango">
          Periodo
        </span>
        <ToggleGroup
          type="single"
          variant="outline"
          aria-labelledby="costes-rango"
          value={String(dias)}
          onValueChange={(v) => {
            if (v) onDiasChange(Number(v) as RangoDias);
          }}
          className="justify-start"
        >
          {RANGOS_DIAS.map((d) => (
            <ToggleGroupItem key={d} value={String(d)} className="min-h-11 px-4 text-sm">
              {d} días
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="costes-funcion" className="text-xs text-muted-foreground">
          Función
        </Label>
        <Select value={funcion} onValueChange={onFuncionChange}>
          <SelectTrigger id="costes-funcion" className="h-11 w-full sm:w-[260px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={FUNCION_TODAS}>Todas las funciones</SelectItem>
            {funciones.map((f) => (
              <SelectItem key={f.funcion} value={f.funcion}>
                {f.descripcion || f.funcion}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function EstadoVacio() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
        <div className="rounded-full bg-muted p-3">
          <Coins className="h-6 w-6 text-muted-foreground" aria-hidden />
        </div>
        <p className="font-medium">Todavía no hay consumo de IA registrado en este periodo</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Cada llamada a un modelo debería dejar sus tokens apuntados. Mientras no lo haga, lo único que hay es la
          estimación medida a mano y los costes fijos, que están más abajo. Un coste vacío no significa que no se esté
          gastando.
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

export default function Costes() {
  const [dias, setDias] = useState<RangoDias>(30);
  const [funcion, setFuncion] = useState<FiltroFuncion>(FUNCION_TODAS);

  // Fechas en calendario local. A diferencia de Tráfico web sí se incluye HOY:
  // el consumo de IA se registra al momento, no en una sincronización nocturna.
  const hoyStr = format(new Date(), ISO);
  const { desde, hasta } = useMemo(() => {
    const base = new Date(`${hoyStr}T00:00:00`);
    return { hasta: hoyStr, desde: format(subDays(base, dias - 1), ISO) };
  }, [hoyStr, dias]);

  const serieQ = useCosteSerie(desde, hasta, funcion);
  const porFuncionQ = useCostePorFuncion(desde, hasta);
  const porModeloQ = useCostePorModelo(desde, hasta);
  const mesQ = useCosteMes();
  const sinRegistroQ = useFuncionesSinRegistro(DIAS_SIN_REGISTRO);
  const funcionesQ = useIaFunciones();
  const fijosQ = useCostesFijos();
  const estimadoQ = useIaCosteEstimado();

  const resumen = useMemo(() => resumirSerieCoste(serieQ.data ?? []), [serieQ.data]);
  const sinDatos = serieQ.isSuccess && resumen.diasConDato === 0 && resumen.peticiones === null;

  const opcionesFuncion = useMemo(
    () => (funcionesQ.data ?? []).filter((f) => f.activo).map((f) => ({ funcion: f.funcion, descripcion: f.descripcion })),
    [funcionesQ.data],
  );

  // Alto de la pantalla (regla del dueño, 2026-10-07: sin scroll de página).
  // Solución provisional de la auditoría para este informe (clase C): subtítulo,
  // filtros y KPIs fijos arriba; avisos, gráfica, desgloses y costes fijos en
  // una región con scroll propio. Sin medida (jsdom, primer pintado) cae al
  // layout de siempre, con scroll de página.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_COSTES);
  const kpisListos = !serieQ.isError && !serieQ.isLoading;

  return (
    <SuperAdminLayout>
      <div ref={setRaiz} className="flex flex-col gap-6" style={alto ? { height: alto } : undefined}>
        {/* Sin título "Costes del sistema": ya lo dice la pestaña activa del menú
            lateral. El subtítulo sí se queda, porque dice algo que nadie
            adivinaría solo por el nombre: de dónde sale cada mitad del número y
            que la mitad fija no la calcula nadie, se escribe a mano. */}
        <p className="text-muted-foreground">
          Lo que cuesta mantener el sistema: el consumo de IA (en dólares, a partir de los tokens registrados y del
          tarifario de precios) y los servicios fijos (en euros, declarados a mano). Es la otra cara del Gestor de
          Gasto, que es lo que se le factura al restaurante.
        </p>

        <FiltrosCostes
          dias={dias}
          onDiasChange={setDias}
          funcion={funcion}
          onFuncionChange={setFuncion}
          funciones={opcionesFuncion}
        />

        {/* KPIs fijos bajo los filtros. Mientras cargan, su esqueleto va en la región (CargandoPagina). */}
        {kpisListos && <KpisCostes resumen={resumen} mes={mesQ.data} dias={dias} />}

        {/* Región con scroll. Los avisos van aquí (y no fijos arriba) porque pueden
            ser varios párrafos y dejarían sin sitio al resto. `min-h-48`: suelo de la
            región; si lo fijo no deja sitio (móvil) vuelve el scroll de página. */}
        <div className="min-h-48 flex-1 space-y-6 overflow-y-auto overscroll-contain">
          <AvisosCostes
            sinRegistro={sinRegistroQ.data}
            modelos={porModeloQ.data}
            fijos={fijosQ.data}
            fijosSinVerificarRpc={mesQ.data?.fijos_sin_verificar ?? null}
          />

          {serieQ.isError ? (
            <EstadoErrorCarga titulo="el coste de IA" error={serieQ.error} onReintentar={() => serieQ.refetch()} />
          ) : serieQ.isLoading ? (
            <CargandoPagina />
          ) : (
            <>
              {mesQ.isError && (
                <EstadoErrorCarga titulo="el resumen del mes" error={mesQ.error} onReintentar={() => mesQ.refetch()} />
              )}

              {sinDatos ? <EstadoVacio /> : <GraficoSerieCoste serie={serieQ.data ?? []} />}

              <ProyeccionMes mes={mesQ.data} />

              {porFuncionQ.isError ? (
                <EstadoErrorCarga
                  titulo="el desglose por función"
                  error={porFuncionQ.error}
                  onReintentar={() => porFuncionQ.refetch()}
                />
              ) : porFuncionQ.isLoading ? (
                <Skeleton className="h-[260px]" />
              ) : (
                <DesglosePorFuncion filas={porFuncionQ.data ?? []} />
              )}

              {porModeloQ.isError ? (
                <EstadoErrorCarga
                  titulo="el desglose por modelo"
                  error={porModeloQ.error}
                  onReintentar={() => porModeloQ.refetch()}
                />
              ) : porModeloQ.isLoading ? (
                <Skeleton className="h-[260px]" />
              ) : (
                <DesglosePorModelo filas={porModeloQ.data ?? []} />
              )}
            </>
          )}

          {estimadoQ.isError ? (
            <EstadoErrorCarga
              titulo="la estimación inicial"
              error={estimadoQ.error}
              onReintentar={() => estimadoQ.refetch()}
            />
          ) : estimadoQ.isLoading ? (
            <Skeleton className="h-[220px]" />
          ) : (
            <EstimacionInicial filas={estimadoQ.data ?? []} />
          )}

          {fijosQ.isError ? (
            <EstadoErrorCarga titulo="los costes fijos" error={fijosQ.error} onReintentar={() => fijosQ.refetch()} />
          ) : fijosQ.isLoading ? (
            <Skeleton className="h-[260px]" />
          ) : (
            <CostesFijos filas={fijosQ.data ?? []} />
          )}
        </div>
      </div>
    </SuperAdminLayout>
  );
}
