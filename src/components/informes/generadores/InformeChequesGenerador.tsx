/** Super Admin › Informes › «Informe de cheques regalo»: el mismo que Cheques › Stripe › «Generar informe». */
import { useQuery } from "@tanstack/react-query";
import type { PropsGeneradorInforme } from "@/lib/informes/registro";
import { generarInformeCheques, type InformeCheques, type InformeChequesVacio } from "@/lib/informes/cheques";
import { DiapositivasInformeCheques } from "@/components/cheques/informe/Diapositivas";
import { DiapositivaEscalada } from "@/components/trafico-web/informe/DiapositivaEscalada";
import { BotonDescargarPdf, EstadoVistaPrevia } from "../MarcoInforme";
import { useExportarDiapositivas } from "../useExportarDiapositivas";

export default function InformeChequesGenerador({ periodo, hoy, Marco }: PropsGeneradorInforme) {
  const mes = periodo.tipo === "mes" ? periodo.mes : hoy.slice(0, 7);
  const consulta = useQuery({
    queryKey: ["informes", "cheques", mes, hoy],
    queryFn: () => generarInformeCheques(mes, { hoy }),
    retry: false,
  });
  // Casts explícitos: sin strictNullChecks, comprobar `vacio` no estrecha la unión.
  const informe = consulta.data && consulta.data.vacio === false ? (consulta.data as InformeCheques) : null;
  const motivoVacio = consulta.data && consulta.data.vacio === true ? (consulta.data as InformeChequesVacio).motivo : null;
  const pdf = useExportarDiapositivas(
    informe ? { titulo: informe.titulo, nombreArchivo: informe.nombreArchivo, diapositivas: <DiapositivasInformeCheques informe={informe} /> } : null,
  );
  return (
    <Marco acciones={<BotonDescargarPdf disabled={!informe} exportando={pdf.exportando} texto={pdf.textoBoton} onClick={pdf.exportar} />}>
      <EstadoVistaPrevia error={consulta.error} onReintentar={() => void consulta.refetch()} cargando={consulta.isLoading} motivoVacio={motivoVacio}>
        {informe && <DiapositivasInformeCheques informe={informe} Envoltorio={DiapositivaEscalada} />}
      </EstadoVistaPrevia>
      {pdf.portal}
    </Marco>
  );
}
