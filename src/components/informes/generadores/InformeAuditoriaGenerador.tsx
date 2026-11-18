/**
 * Super Admin › Informes › «Informe mensual de auditoría» (18/11/2026): persona a persona y, al final, lo que
 * hace el sistema solo, explicado. Diapositivas propias (src/components/informes/auditoria/Diapositivas.tsx),
 * descarga en PDF y en CSV para Excel. El mes es el de la página de Informes.
 */
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DiapositivaEscalada } from "@/components/trafico-web/informe/DiapositivaEscalada";
import { descargarBlob } from "@/components/trafico-web/informe/pdf";
import { modeloInformeAuditoria, tablaCsvAuditoria, type InformeAuditoria, type InformeAuditoriaVacio } from "@/lib/informes/auditoria/modelo";
import { obtenerDatosAuditoria } from "@/lib/informes/fuentes/auditoria";
import type { PropsGeneradorInforme } from "@/lib/informes/registro";
import { csvInformeTabla } from "@/lib/informes/tabla";
import { DiapositivasAuditoria } from "../auditoria/Diapositivas";
import { BotonDescargarPdf, EstadoVistaPrevia } from "../MarcoInforme";
import { useExportarDiapositivas } from "../useExportarDiapositivas";

const fechaGenerado = (ms: number) =>
  new Date(ms).toLocaleString("es-ES", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function InformeAuditoriaGenerador({ periodo, hoy, Marco }: PropsGeneradorInforme) {
  const mes = periodo.tipo === "mes" ? periodo.mes : hoy.slice(0, 7);
  const consulta = useQuery({
    queryKey: ["informes", "auditoria", mes],
    queryFn: () => obtenerDatosAuditoria(mes),
    staleTime: 60_000,
    retry: false,
  });
  const resultado = consulta.data ? modeloInformeAuditoria(consulta.data, mes, hoy) : null;
  // Casts explícitos: sin strictNullChecks, comprobar `vacio` no estrecha la unión.
  const informe = resultado && resultado.vacio === false ? (resultado as InformeAuditoria) : null;
  const motivoVacio = resultado && resultado.vacio === true ? (resultado as InformeAuditoriaVacio).motivo : null;
  const generado = fechaGenerado(consulta.dataUpdatedAt || Date.now());
  const pdf = useExportarDiapositivas(
    informe ? { titulo: informe.titulo, nombreArchivo: `${informe.nombreArchivo}.pdf`, asunto: informe.titulo, diapositivas: <DiapositivasAuditoria informe={informe} generado={generado} /> } : null,
  );
  const descargarCsv = () => {
    if (!informe || !consulta.data) return;
    descargarBlob(new Blob([csvInformeTabla(tablaCsvAuditoria(informe, consulta.data))], { type: "text/csv;charset=utf-8" }), `${informe.nombreArchivo}.csv`);
  };

  return (
    <Marco
      acciones={
        <>
          <Button variant="outline" className="h-11 w-full gap-2 sm:w-auto" disabled={!informe || pdf.exportando} onClick={descargarCsv}>
            <FileSpreadsheet className="h-4 w-4" aria-hidden />
            Descargar CSV
          </Button>
          <BotonDescargarPdf disabled={!informe} exportando={pdf.exportando} texto={pdf.textoBoton} onClick={pdf.exportar} />
        </>
      }
    >
      <EstadoVistaPrevia error={consulta.error} onReintentar={() => void consulta.refetch()} cargando={consulta.isLoading} motivoVacio={motivoVacio}>
        {informe && <DiapositivasAuditoria informe={informe} generado={generado} Envoltorio={DiapositivaEscalada} />}
      </EstadoVistaPrevia>
      {pdf.portal}
    </Marco>
  );
}
