/**
 * Datos y modelo del informe mensual de redes sociales para un mes: lo usan el
 * diálogo de RRSS › Métricas (./InformeRrssDialog.tsx) y Super Admin › Informes.
 */
import { useMemo } from "react";
import { useDatosInformeRrss } from "../datos";
import { construirInformeRrss, rangoDatosRrss, type InformeRrss } from "./modelo";

export function useInformeRrss(mes: string, hoy: string, conWeb: boolean) {
  const rango = useMemo(() => rangoDatosRrss(mes, hoy), [mes, hoy]);
  const datosQ = useDatosInformeRrss(rango, conWeb);
  const informe = useMemo(
    () =>
      rango === null
        ? construirInformeRrss({ cuentas: [], publicaciones: [], web: null }, { mes, hoy })
        : datosQ.data
          ? construirInformeRrss(datosQ.data, { mes, hoy })
          : null,
    [rango, datosQ.data, mes, hoy],
  );
  const informeListo: InformeRrss | null = informe && informe.vacio === false ? informe : null;
  const motivoVacio = informe && informe.vacio === true ? informe.motivo : null;
  const cargando = (rango !== null && datosQ.isLoading) || !informe;
  return { informe, informeListo, motivoVacio, cargando, error: datosQ.error, reintentar: () => void datosQ.refetch() };
}
