/**
 * Datos y modelo del informe mensual de tráfico web para un mes: lo usan el
 * diálogo «Generar informe» de Tráfico web (./InformeTraficoDialog.tsx) y
 * Super Admin › Informes. Cada web por separado (la principal no lleva sumadas
 * las visitas de Touza) y el apartado «Qué hacen los visitantes» con las cifras
 * de Tráfico web › Comportamiento.
 */
import { useMemo } from "react";
import { useDatosInformeTrafico, type DatosInformeTrafico } from "@/hooks/useTraficoWeb";
import { useComportamiento, useConfigLogs } from "@/hooks/useLogsWeb";
import { construirApartadoComportamiento } from "./comportamiento";
import { construirInformeMensual, PROYECTO_PRINCIPAL, PROYECTO_TOUZA, rangoDatos, rangoInforme, type InformeTrafico } from "./modelo";

const SIN_DATOS: DatosInformeTrafico = { serie: [], paginas: [], dispositivos: [], paises: [], procedencias: [], primerDiaConVisitas: null };

export function useInformeTrafico(mes: string, hoy: string) {
  const rango = useMemo(() => rangoInforme(mes, hoy), [mes, hoy]);
  const principalQ = useDatosInformeTrafico(PROYECTO_PRINCIPAL, rangoDatos(rango));
  const touzaQ = useDatosInformeTrafico(PROYECTO_TOUZA, rangoDatos(rango));
  const informe = useMemo(
    () =>
      rango.diasCerrados === 0
        ? construirInformeMensual({ principal: SIN_DATOS, touza: SIN_DATOS }, { mes, hoy })
        : principalQ.data && touzaQ.data
          ? construirInformeMensual({ principal: principalQ.data, touza: touzaQ.data }, { mes, hoy })
          : null,
    [principalQ.data, touzaQ.data, rango.diasCerrados, mes, hoy],
  );
  // «Qué hacen los visitantes»: mismas cifras que Tráfico web › Comportamiento, del entorno de esta base de datos.
  const configLogs = useConfigLogs();
  const comportamientoQ = useComportamiento(rango.diasCerrados > 0 ? rango.desde : null, rango.hasta, configLogs.data?.entorno_bd ?? null);
  const informeListo: InformeTrafico | null = useMemo(() => {
    if (!informe || informe.vacio !== false) return null;
    return { ...informe, comportamiento: construirApartadoComportamiento(comportamientoQ.data, informe.resumen.paginasVistas.valor, informe.mes.nombre) };
  }, [informe, comportamientoQ.data]);
  const motivoVacio = informe && informe.vacio === true ? informe.motivo : null;

  const cargando = (rango.diasCerrados > 0 && (principalQ.isLoading || touzaQ.isLoading)) || !informe;
  const error = principalQ.error ?? touzaQ.error;
  const reintentar = () => {
    if (principalQ.isError) principalQ.refetch();
    if (touzaQ.isError) touzaQ.refetch();
  };
  return { informe, informeListo, motivoVacio, cargando, error, reintentar };
}
