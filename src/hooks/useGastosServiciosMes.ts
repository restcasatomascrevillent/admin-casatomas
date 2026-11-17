import { useMemo } from "react";
import type { GastoServicio } from "@/components/facturacion/catalogo";
import { useConfigServicios, useResumenesMes, useServiciosContratados } from "@/hooks/useServicios";
import { informeMes } from "@/lib/informeServicios";
import { CAMBIO_POR_DEFECTO, TEXTO_CATEGORIA } from "@/lib/servicios";

export interface GastosServiciosMes {
  /** null mientras carga, si hay error o si Servicios › Costes no está disponible. */
  gastos: GastoServicio[] | null;
  cargando: boolean;
  error: boolean;
  /** false: falta alguna migración de Servicios (no hay de dónde sacar los gastos). */
  disponible: boolean;
}

const SIN_MESES: string[] = [];

/**
 * Los gastos de un mes («AAAA-MM») tal como se ven en Super Admin › Servicios › Costes
 * (mismo cálculo que su informe mensual: lo metido a mano manda; si no, cuota + uso leído),
 * para ponerlos en el recibo del pago mensual. Sin mes no consulta nada.
 */
export function useGastosServiciosMes(mes: string | undefined): GastosServiciosMes {
  const activo = !!mes && /^\d{4}-\d{2}$/.test(mes);
  const servicios = useServiciosContratados(activo);
  const conCostes = servicios.data?.disponible === true && servicios.data.costes;
  const config = useConfigServicios(activo && conCostes);
  const meses = useMemo(() => (activo ? [`${mes}-01`] : SIN_MESES), [activo, mes]);
  const [resumen] = useResumenesMes(meses, activo && conCostes);
  const eurPorUsd = config.data?.eurPorUsd ?? CAMBIO_POR_DEFECTO;

  const gastos = useMemo<GastoServicio[] | null>(() => {
    if (!activo || servicios.data?.disponible !== true || !resumen?.data?.disponible) return null;
    const informe = informeMes({ mes: `${mes}-01`, servicios: servicios.data.servicios, resumen: resumen.data.filas, resumenAnterior: null, eurPorUsd });
    return informe.filas
      .filter((f) => f.totalEur > 0 || f.origen === "falta")
      .map((f) => ({ proveedor: f.proveedor, nombre: f.nombre, categoria: TEXTO_CATEGORIA[f.categoria] ?? null, importe: f.totalEur, origen: f.origen }));
  }, [activo, mes, servicios.data, resumen?.data, eurPorUsd]);

  const sinMigracion = servicios.data?.disponible === false || (servicios.data?.disponible === true && !servicios.data.costes) || resumen?.data?.disponible === false;
  return {
    gastos,
    cargando: activo && (servicios.isLoading || config.isLoading || !!resumen?.isLoading),
    error: activo && (servicios.isError || !!resumen?.isError),
    disponible: !sinMigracion,
  };
}
