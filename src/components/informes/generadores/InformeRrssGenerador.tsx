/**
 * Super Admin › Informes › «Informe mensual de redes sociales»: el mismo que RRSS › Métricas ›
 * «Generar informe». Desde el Super Admin siempre lleva la diapositiva de visitas a la web
 * (como en RRSS para un super admin).
 */
import type { PropsGeneradorInforme } from "@/lib/informes/registro";
import { DiapositivaEscalada } from "@/components/trafico-web/informe/DiapositivaEscalada";
import { DiapositivasInformeRrss } from "@/components/rrss/metricas/informe/Diapositivas";
import { ASUNTO_INFORME_RRSS } from "@/components/rrss/metricas/informe/textos";
import { useInformeRrss } from "@/components/rrss/metricas/informe/useInformeRrss";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { BotonDescargarPdf, EstadoVistaPrevia } from "../MarcoInforme";
import { useExportarDiapositivas } from "../useExportarDiapositivas";

export default function InformeRrssGenerador({ periodo, hoy, Marco }: PropsGeneradorInforme) {
  const { isSuperAdmin } = useSuperAdmin();
  const mes = periodo.tipo === "mes" ? periodo.mes : hoy.slice(0, 7);
  const { informeListo, motivoVacio, cargando, error, reintentar } = useInformeRrss(mes, hoy, isSuperAdmin);
  const pdf = useExportarDiapositivas(
    informeListo
      ? { titulo: informeListo.titulo, nombreArchivo: informeListo.nombreArchivo, asunto: ASUNTO_INFORME_RRSS, diapositivas: <DiapositivasInformeRrss informe={informeListo} /> }
      : null,
  );
  return (
    <Marco acciones={<BotonDescargarPdf disabled={!informeListo} exportando={pdf.exportando} texto={pdf.textoBoton} onClick={pdf.exportar} />}>
      <EstadoVistaPrevia error={error} onReintentar={reintentar} cargando={cargando} motivoVacio={informeListo ? null : motivoVacio}>
        {informeListo && <DiapositivasInformeRrss informe={informeListo} Envoltorio={DiapositivaEscalada} />}
      </EstadoVistaPrevia>
      {pdf.portal}
    </Marco>
  );
}
