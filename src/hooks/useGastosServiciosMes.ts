import { useMemo } from "react";
import { entraEnRecibo, type GastoServicio } from "@/components/facturacion/catalogo";
import { desgloseIa } from "@/components/facturacion/desgloseIa";
import { useCostePorUso } from "@/hooks/useCostePorUso";
import { useConfigServicios, useResumenesMes, useServiciosContratados } from "@/hooks/useServicios";
import { ventanaMes } from "@/lib/costesServicios";
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
/** El gasto de Servicios que se desglosa por funciones del panel (ver desgloseIa.ts). */
export const PROVEEDOR_IA = "openai";

/**
 * Los gastos de un mes («AAAA-MM») tal como se ven en Super Admin › Servicios › Costes
 * (mismo cálculo que su informe mensual: lo metido a mano manda; si no, cuota + uso leído),
 * para ponerlos en el recibo del pago mensual. Sin mes no consulta nada. Deja fuera lo que no
 * pagamos nosotros (Stripe): en Servicios › Costes sigue saliendo.
 *
 * 25/11/2026: la línea de OpenAI lleva su desglose por lo que se ha hecho en el panel (subir facturas,
 * chat, etiquetas de vino…), con lo apuntado en `ia_coste_por_uso` ese mes. Si eso no se puede leer, la
 * línea sale sola, como antes.
 */
export function useGastosServiciosMes(mes: string | undefined): GastosServiciosMes {
  const activo = !!mes && /^\d{4}-\d{2}$/.test(mes);
  const servicios = useServiciosContratados(activo);
  const conCostes = servicios.data?.disponible === true && servicios.data.costes;
  const config = useConfigServicios(activo && conCostes);
  const meses = useMemo(() => (activo ? [`${mes}-01`] : SIN_MESES), [activo, mes]);
  const [resumen] = useResumenesMes(meses, activo && conCostes);
  const eurPorUsd = config.data?.eurPorUsd ?? CAMBIO_POR_DEFECTO;
  const ventana = useMemo(() => (activo ? ventanaMes(mes) : { desde: "", hasta: "" }), [activo, mes]);
  const iaPorFuncion = useCostePorUso(ventana.desde, ventana.hasta, activo && !!conCostes);

  const filasIa = iaPorFuncion.data?.disponible ? iaPorFuncion.data.filas : null;
  const gastos = useMemo<GastoServicio[] | null>(() => {
    if (!activo || servicios.data?.disponible !== true || !resumen?.data?.disponible) return null;
    const informe = informeMes({ mes: `${mes}-01`, servicios: servicios.data.servicios, resumen: resumen.data.filas, resumenAnterior: null, eurPorUsd });
    return informe.filas
      .filter((f) => (f.totalEur > 0 || f.origen === "falta") && entraEnRecibo(f.proveedor))
      .map((f) => {
        const gasto: GastoServicio = { proveedor: f.proveedor, nombre: f.nombre, categoria: TEXTO_CATEGORIA[f.categoria] ?? null, importe: f.totalEur, origen: f.origen };
        const ia = f.proveedor === PROVEEDOR_IA && filasIa ? desgloseIa(filasIa, f.totalEur, eurPorUsd) : null;
        return ia ? { ...gasto, desglose: ia.desglose } : gasto;
      });
  }, [activo, mes, servicios.data, resumen?.data, eurPorUsd, filasIa]);

  const sinMigracion = servicios.data?.disponible === false || (servicios.data?.disponible === true && !servicios.data.costes) || resumen?.data?.disponible === false;
  return {
    gastos,
    // Se espera también al desglose de la IA (si falla, el recibo sale sin él).
    cargando: activo && (servicios.isLoading || config.isLoading || !!resumen?.isLoading || (!!conCostes && iaPorFuncion.isLoading)),
    error: activo && (servicios.isError || !!resumen?.isError),
    disponible: !sinMigracion,
  };
}
