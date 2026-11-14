/**
 * Informe mensual de Servicios, sin pantalla: recibe el mes y devuelve el
 * informe ya calculado, con su CSV y su PDF. Lo usa la pestaña Costes y sirve
 * para el módulo Super Admin › Informes (registro de informes).
 *
 *   const r = await generarInformeServicios("2026-10-01");
 *   if (r.disponible) descargarBlob(await r.pdf(), `${r.nombreArchivo}.pdf`);
 *
 * Carga los servicios, el tipo de cambio y el resumen del mes y del anterior
 * (`servicios_resumen_mes`, 20261122153000). Sin esa migración, `disponible: false`.
 */
import { cargarConfigServicios, cargarResumenMes, cargarServicios } from "@/hooks/useServicios";
import { type InformeMes, informeCsv, informeMes, mesAnterior, nombreArchivoInforme, textoMesCorto } from "@/lib/informeServicios";
import { type ServicioContratado, ordenarServicios } from "@/lib/servicios";

export type ResultadoInformeServicios =
  | {
      disponible: true;
      informe: InformeMes;
      /** Los servicios (todos, en orden), por si el informe quiere más que el gasto (precios por confirmar…). */
      servicios: ServicioContratado[];
      eurPorUsd: number;
      titulo: string;
      nombreArchivo: string;
      csv: () => Blob;
      pdf: () => Promise<Blob>;
    }
  | { disponible: false; motivo: string };

/** CSV del informe como fichero (con BOM, para que Excel lea bien los acentos). */
export const csvInformeServicios = (informe: InformeMes) => new Blob(["\ufeff" + informeCsv(informe)], { type: "text/csv;charset=utf-8" });

/** `mes`: «AAAA-MM-01» (o cualquier día de ese mes). */
export async function generarInformeServicios(mes: string, opciones: { hoy?: Date } = {}): Promise<ResultadoInformeServicios> {
  const primero = `${mes.slice(0, 7)}-01`;
  const [servicios, config, actual, anterior] = await Promise.all([
    cargarServicios(),
    cargarConfigServicios(),
    cargarResumenMes(primero),
    cargarResumenMes(mesAnterior(primero)),
  ]);
  if (!servicios.disponible) return { disponible: false, motivo: "Falta aplicar en Supabase la migración de Servicios (20261103120000_servicios_contratados)." };
  if (!actual.disponible) return { disponible: false, motivo: "Falta aplicar en Supabase la migración 20261122153000_servicios_costes_mes." };
  const ordenados = ordenarServicios(servicios.servicios);
  const informe = informeMes({
    mes: primero,
    servicios: ordenados,
    resumen: actual.filas,
    resumenAnterior: anterior.disponible ? anterior.filas : null,
    eurPorUsd: config.eurPorUsd,
    hoy: opciones.hoy,
  });
  return {
    disponible: true,
    informe,
    servicios: ordenados,
    eurPorUsd: config.eurPorUsd,
    titulo: `Informe de servicios · ${textoMesCorto(primero)}`,
    nombreArchivo: nombreArchivoInforme(primero),
    csv: () => csvInformeServicios(informe),
    pdf: async () => (await import("./informePdf")).crearPdfInformeServicios(informe),
  };
}
