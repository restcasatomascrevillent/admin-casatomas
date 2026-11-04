import { useEffect, useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { Bloque } from "@/components/servicios/Bloque";
import { useCosteMes, useCostePorFuncion, useCostePorModelo, useFuncionesSinRegistro } from "@/hooks/useCostes";
import { useGastoIaRealMes, useSincronizarCostes, useTopeIaMes } from "@/hooks/useGastoIa";
import { primerDiaMesIso, TOPE_IA_POR_DEFECTO, ultimoDiaDe } from "@/lib/facturas/gastoIa";
import { mensajeUsuario } from "@/lib/mensaje-usuario";
import { contrasteLectura as calcularContrasteLectura, DIAS_SIN_REGISTRO } from "./calculos";
import { construirResumenMes } from "./resumenMes";
import { ResumenIaFila } from "./ResumenCostesMes";
import { TablaPartidas } from "./TablaPartidas";
import { DetallesCostes } from "./DetallesCostes";

const ISO = "yyyy-MM-dd";

/** La API de costes de OpenAI admite 30 peticiones por minuto: el servidor deja pasar una por minuto. */
const ESPERA_SINCRONIZAR_MS = 60_000;

/** Ventana (días) del contraste de modelos sin tarifa que aparece en «Detalles». */
export const DIAS_MODELOS = 30;

/** Desde/hasta (calendario local) de la ventana de modelos: la misma clave de caché en el Resumen y aquí. */
export function useVentanaModelos() {
  const hoyStr = format(new Date(), ISO);
  return useMemo(() => {
    const base = new Date(`${hoyStr}T00:00:00`);
    return { hasta: hoyStr, desde: format(subDays(base, DIAS_MODELOS - 1), ISO) };
  }, [hoyStr]);
}

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

/**
 * Servicios › Costes › Inteligencia artificial (lo que era la pantalla
 * «Costes»): el gasto REAL de OpenAI por proceso (lectura de facturas,
 * chatbots, vinos…) con el mes anterior, frente al tope mensual, la previsión
 * a fin de mes, «Sincronizar ahora» y los «Detalles» (real frente a estimado,
 * tipo de cambio, margen y avisos de lo que no se está midiendo).
 *
 * Los costes fijos declarados a mano (`costes_fijos`) ya no se pintan aquí:
 * las cuotas de cada servicio están en `servicios_contratados` y salen en el
 * desglose por proveedor de la misma pestaña.
 */
export function CostesIa({ previsionTotalEur }: { previsionTotalEur?: number | null }) {
  const { desde, hasta } = useVentanaModelos();
  const realQ = useGastoIaRealMes(true);
  const mesQ = useCosteMes();
  const topeQ = useTopeIaMes();
  const sinRegistroQ = useFuncionesSinRegistro(DIAS_SIN_REGISTRO);
  const porModeloQ = useCostePorModelo(desde, hasta);

  const resumen = useMemo(() => construirResumenMes({ fijos: [], real: realQ.data, mes: mesQ.data }), [realQ.data, mesQ.data]);

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
  const cargando = realQ.isLoading || mesQ.isLoading;

  return (
    <Bloque
      id="costes-ia"
      icono={<Sparkles />}
      titulo="Inteligencia artificial (OpenAI)"
      descripcion="Lo que factura OpenAI por proceso, sin IVA, frente al tope del mes. Se sincroniza cada 6 horas."
      acciones={
        <>
          <BotonSincronizar />
          <DetallesCostes
            resumen={resumen}
            mes={mesQ.data}
            sinRegistro={sinRegistroQ.data}
            modelos={porModeloQ.data}
            fijos={[]}
            contrasteLectura={contrasteLectura}
            previsionTotalEur={previsionTotalEur}
          />
        </>
      }
    >
      {cargando ? (
        <div className="space-y-3">
          <Skeleton className="h-[104px]" />
          <Skeleton className="h-[200px]" />
        </div>
      ) : (
        <>
          <ResumenIaFila resumen={resumen} topeEur={topeEur} />
          {mesQ.isError && (
            <EstadoErrorCarga titulo="el gasto de IA del mes" error={mesQ.error} onReintentar={() => mesQ.refetch()} />
          )}
          <TablaPartidas
            partidas={resumen.partidas}
            mostrarTipo={false}
            etiquetaPartida="Proceso"
            textoVacio="Todavía no hay consumo de IA registrado este mes. Un coste vacío no significa que no se esté gastando."
          />
        </>
      )}
    </Bloque>
  );
}
