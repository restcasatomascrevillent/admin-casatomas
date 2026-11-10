/**
 * Super Admin › Informes: generador de los informes de TABLA del registro
 * (`generador.tipo === "tabla"`). Pide los datos con `obtener(periodo)`, los
 * enseña en diapositivas (mismo formato que Tráfico web) y los descarga en PDF
 * o en CSV para Excel.
 */
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DiapositivaEscalada } from "@/components/trafico-web/informe/DiapositivaEscalada";
import { descargarBlob } from "@/components/trafico-web/informe/pdf";
import { clavePeriodo } from "@/lib/informes/periodo";
import type { DefinicionInforme, PropsGeneradorInforme } from "@/lib/informes/registro";
import { csvInformeTabla } from "@/lib/informes/tabla";
import { DiapositivasTabla } from "./DiapositivasTabla";
import { BotonDescargarPdf, EstadoVistaPrevia } from "./MarcoInforme";
import { useExportarDiapositivas } from "./useExportarDiapositivas";

const fechaGenerado = (ms: number) =>
  new Date(ms).toLocaleString("es-ES", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function GeneradorTabla({ definicion, periodo, hoy, Marco }: PropsGeneradorInforme & { definicion: DefinicionInforme }) {
  const generador = definicion.generador;
  const q = useQuery({
    queryKey: ["super-admin-informe", definicion.id, clavePeriodo(periodo), hoy],
    enabled: generador.tipo === "tabla",
    staleTime: 60_000,
    queryFn: () => (generador.tipo === "tabla" ? generador.obtener(periodo, { hoy }) : Promise.reject(new Error("Este informe no es una tabla."))),
  });
  const informe = q.data && q.data.vacio === false ? q.data : null;
  const motivoVacio = q.data && q.data.vacio === true ? q.data.motivo : null;
  const generado = fechaGenerado(q.dataUpdatedAt || Date.now());
  const pdf = useExportarDiapositivas(
    informe ? { titulo: informe.titulo, nombreArchivo: `${informe.nombreArchivo}.pdf`, asunto: definicion.titulo, diapositivas: <DiapositivasTabla informe={informe} generado={generado} /> } : null,
  );
  const csv = definicion.formatos.includes("csv");
  const descargarCsv = () => {
    if (!informe) return;
    descargarBlob(new Blob([csvInformeTabla(informe)], { type: "text/csv;charset=utf-8" }), `${informe.nombreArchivo}.csv`);
  };

  return (
    <Marco
      acciones={
        <>
          {csv && (
            <Button variant="outline" className="h-11 w-full gap-2 sm:w-auto" disabled={!informe || pdf.exportando} onClick={descargarCsv}>
              <FileSpreadsheet className="h-4 w-4" aria-hidden />
              Descargar CSV
            </Button>
          )}
          {definicion.formatos.includes("pdf") && (
            <BotonDescargarPdf disabled={!informe} exportando={pdf.exportando} texto={pdf.textoBoton} onClick={pdf.exportar} />
          )}
        </>
      }
    >
      <EstadoVistaPrevia
        error={q.error}
        onReintentar={() => void q.refetch()}
        cargando={q.isLoading}
        motivoVacio={informe ? null : motivoVacio}
        pista={periodo.tipo === "ninguno" ? "" : "Prueba con otro periodo."}
      >
        {informe && <DiapositivasTabla informe={informe} generado={generado} Envoltorio={DiapositivaEscalada} />}
      </EstadoVistaPrevia>
      {pdf.portal}
    </Marco>
  );
}
