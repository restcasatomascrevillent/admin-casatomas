import { useEffect, useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { useCosteMes, useCostePorFuncion, useCostePorModelo, useCostesFijos, useFuncionesSinRegistro } from "@/hooks/useCostes";
import { useGastoIaRealMes, useSincronizarCostes, useTopeIaMes } from "@/hooks/useGastoIa";
import { primerDiaMesIso, TOPE_IA_POR_DEFECTO, ultimoDiaDe } from "@/lib/facturas/gastoIa";
import { contrasteLectura as calcularContrasteLectura, DIAS_SIN_REGISTRO } from "@/components/costes/calculos";
import { construirResumenMes } from "@/components/costes/resumenMes";
import { ResumenCostesMesFila } from "@/components/costes/ResumenCostesMes";
import { TablaPartidas } from "@/components/costes/TablaPartidas";
import { DetallesCostes } from "@/components/costes/DetallesCostes";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { mensajeUsuario } from "@/lib/mensaje-usuario";

const ISO = "yyyy-MM-dd";

/** Suelo (px) del alto de la página: por debajo deja de encoger y vuelve el scroll de página. */
const ALTURA_MINIMA_COSTES = 360;

/** La API de costes de OpenAI admite 30 peticiones por minuto: el servidor deja pasar una por minuto. */
const ESPERA_SINCRONIZAR_MS = 60_000;

/** Ventana (días) del contraste de modelos sin tarifa que aparece en «Detalles». */
const DIAS_MODELOS = 30;

/**
 * «Sincronizar ahora»: lanza ya la misma sincronización que el cron de 6 h.
 * Se apaga un minuto tras pulsarlo (el servidor también lo limita).
 */
function BotonSincronizar() {
  const sincronizar = useSincronizarCostes();
  const [hasta, setHasta] = useState(0);
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (hasta <= Date.now()) return;
    const id = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasta]);
  const espera = Math.max(0, Math.ceil((hasta - ahora) / 1000));

  return (
    <Button
      type="button"
      variant="outline"
      className="min-h-11 gap-1.5"
      data-testid="boton-sincronizar"
      disabled={sincronizar.isPending || espera > 0}
      onClick={() => {
        const t = Date.now();
        setAhora(t);
        setHasta(t + ESPERA_SINCRONIZAR_MS);
        sincronizar.mutate(undefined, {
          onSuccess: (lanzada) =>
            lanzada
              ? toast.success("Sincronizando con OpenAI: las cifras se actualizan en unos segundos")
              : toast.info("Ya se sincronizó hace menos de un minuto"),
          onError: (e) => {
            setHasta(0);
            toast.error(mensajeUsuario(e, "No se ha podido sincronizar"));
          },
        });
      }}
    >
      <RefreshCw className={`h-4 w-4 ${sincronizar.isPending ? "animate-spin" : ""}`} aria-hidden />
      {espera > 0 ? `Sincronizar (${espera} s)` : "Sincronizar ahora"}
    </Button>
  );
}

export default function Costes() {
  // Fechas en calendario local para el contraste de modelos sin tarifa.
  const hoyStr = format(new Date(), ISO);
  const { desde, hasta } = useMemo(() => {
    const base = new Date(`${hoyStr}T00:00:00`);
    return { hasta: hoyStr, desde: format(subDays(base, DIAS_MODELOS - 1), ISO) };
  }, [hoyStr]);

  const fijosQ = useCostesFijos();
  const realQ = useGastoIaRealMes(true);
  const mesQ = useCosteMes();
  const topeQ = useTopeIaMes();
  const sinRegistroQ = useFuncionesSinRegistro(DIAS_SIN_REGISTRO);
  const porModeloQ = useCostePorModelo(desde, hasta);

  const resumen = useMemo(
    () => construirResumenMes({ fijos: fijosQ.data, real: realQ.data, mes: mesQ.data }),
    [fijosQ.data, realQ.data, mesQ.data],
  );

  // Lectura de facturas: lo estimado por la app (ia_uso) frente a lo que ha facturado OpenAI, en la MISMA
  // ventana (1 del mes → último día cerrado con datos reales). Si cuadra, la contabilidad es fiable.
  const ultimoDiaReal = realQ.data ? ultimoDiaDe(realQ.data.actual) : null;
  const primeroMes = primerDiaMesIso(new Date());
  const hayVentanaLectura = !!ultimoDiaReal && ultimoDiaReal >= primeroMes;
  const porFuncionQ = useCostePorFuncion(primeroMes, ultimoDiaReal ?? primeroMes, hayVentanaLectura);
  const contrasteLectura = useMemo(
    () =>
      hayVentanaLectura
        ? calcularContrasteLectura({
            porFuncion: porFuncionQ.data,
            realOcrEur: resumen.real?.lineas.find((l) => l.clave === "ocr")?.realEur,
            eurPorUsd: resumen.real?.tipo.eurPorUsd ?? 0,
          })
        : null,
    [hayVentanaLectura, porFuncionQ.data, resumen.real],
  );
  const topeEur = topeQ.data ?? TOPE_IA_POR_DEFECTO;
  const cargando = fijosQ.isLoading || realQ.isLoading || mesQ.isLoading;

  // Alto de la pantalla (regla del dueño, 2026-10-07: sin scroll de página).
  // Cabecera y fila de cifras fijas arriba; la tabla de partidas hace scroll
  // por dentro. Sin medida (jsdom, primer pintado) cae al layout de siempre.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_COSTES);

  return (
    <SuperAdminLayout>
      <div ref={setRaiz} className="flex flex-col gap-3" style={alto ? { height: alto } : undefined}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            Lo que cuesta mantener el sistema este mes: servicios fijos (declarados a mano) e IA (gasto real de
            OpenAI, sin IVA).
          </p>
          <div className="flex shrink-0 gap-2">
            <BotonSincronizar />
            <DetallesCostes
              resumen={resumen}
              mes={mesQ.data}
              sinRegistro={sinRegistroQ.data}
              modelos={porModeloQ.data}
              fijos={fijosQ.data}
              contrasteLectura={contrasteLectura}
            />
          </div>
        </div>

        {fijosQ.isError ? (
          <EstadoErrorCarga titulo="los costes fijos" error={fijosQ.error} onReintentar={() => fijosQ.refetch()} />
        ) : cargando ? (
          <div className="space-y-3">
            <Skeleton className="h-[104px]" />
            <Skeleton className="h-[260px]" />
          </div>
        ) : (
          <>
            <ResumenCostesMesFila resumen={resumen} topeEur={topeEur} />
            {mesQ.isError && (
              <EstadoErrorCarga titulo="el resumen del mes" error={mesQ.error} onReintentar={() => mesQ.refetch()} />
            )}
            <div className="min-h-48 flex-1 overflow-y-auto overscroll-contain">
              <TablaPartidas partidas={resumen.partidas} />
            </div>
          </>
        )}
      </div>
    </SuperAdminLayout>
  );
}
