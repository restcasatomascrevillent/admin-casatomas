/** Super Admin › Informes › «Informe mensual de tráfico web»: el mismo que Tráfico web › «Generar informe». */
import type { PropsGeneradorInforme } from "@/lib/informes/registro";
import { DiapositivasInforme } from "@/components/trafico-web/informe/Diapositivas";
import { DiapositivaEscalada } from "@/components/trafico-web/informe/DiapositivaEscalada";
import { useInformeTrafico } from "@/components/trafico-web/informe/useInformeTrafico";
import { BotonDescargarPdf, EstadoVistaPrevia } from "../MarcoInforme";
import { useExportarDiapositivas } from "../useExportarDiapositivas";

export default function InformeTraficoGenerador({ periodo, hoy, Marco }: PropsGeneradorInforme) {
  const mes = periodo.tipo === "mes" ? periodo.mes : hoy.slice(0, 7);
  const { informeListo, motivoVacio, cargando, error, reintentar } = useInformeTrafico(mes, hoy);
  const pdf = useExportarDiapositivas(
    informeListo ? { titulo: informeListo.titulo, nombreArchivo: informeListo.nombreArchivo, diapositivas: <DiapositivasInforme informe={informeListo} /> } : null,
  );
  return (
    <Marco acciones={<BotonDescargarPdf disabled={!informeListo} exportando={pdf.exportando} texto={pdf.textoBoton} onClick={pdf.exportar} />}>
      <EstadoVistaPrevia error={error} onReintentar={reintentar} cargando={cargando} motivoVacio={informeListo ? null : motivoVacio}>
        {informeListo && <DiapositivasInforme informe={informeListo} Envoltorio={DiapositivaEscalada} />}
      </EstadoVistaPrevia>
      {pdf.portal}
    </Marco>
  );
}
