/**
 * RRSS › Métricas › «Generar informe»: informe mensual de redes sociales en
 * diapositivas, con vista previa (escala al ancho de la pantalla) y descarga en
 * PDF. Mismo funcionamiento que el informe de tráfico web
 * (src/components/trafico-web/informe/InformeTraficoDialog.tsx), con el que
 * comparte piezas, fuente, marco (`MarcoInforme`) y exportación
 * (`useExportarDiapositivas`). Super Admin › Informes lo genera igual.
 *
 * Se carga con `lazy()` desde el panel: ni las diapositivas ni la fuente entran
 * en el bundle de RRSS hasta que se abre, y html2canvas/jsPDF solo al pulsar
 * «Descargar PDF».
 */
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { BotonDescargarPdf, EstadoVistaPrevia, MarcoInforme, SelectorMes } from "@/components/informes/MarcoInforme";
import { useExportarDiapositivas } from "@/components/informes/useExportarDiapositivas";
import { DiapositivaEscalada } from "@/components/trafico-web/informe/DiapositivaEscalada";
import { useFuenteInforme } from "@/components/informes/useFuenteInforme";
import { DiapositivasInformeRrss } from "./Diapositivas";
import { mesesSeleccionables, mesPorDefecto } from "./modelo";
import { useInformeRrss } from "./useInformeRrss";
import { ASUNTO_INFORME_RRSS, descripcionInformeRrss, TITULO_INFORME_RRSS } from "./textos";

const ISO = "yyyy-MM-dd";

interface InformeRrssDialogProps {
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Con permiso de Tráfico web: añade la diapositiva de visitas a la web desde redes. */
  conWeb: boolean;
}

export default function InformeRrssDialog({ abierto, onAbiertoChange, conWeb }: InformeRrssDialogProps) {
  const hoy = format(new Date(), ISO);
  const meses = useMemo(() => mesesSeleccionables(hoy), [hoy]);
  const [mes, setMes] = useState(() => mesPorDefecto(hoy));
  const fuenteLista = useFuenteInforme(abierto);
  const { informeListo, motivoVacio, cargando, error, reintentar } = useInformeRrss(mes, hoy, conWeb);
  const pdf = useExportarDiapositivas(
    informeListo
      ? { titulo: informeListo.titulo, nombreArchivo: informeListo.nombreArchivo, asunto: ASUNTO_INFORME_RRSS, diapositivas: <DiapositivasInformeRrss informe={informeListo} /> }
      : null,
  );

  return (
    <Dialog open={abierto} onOpenChange={(o) => !pdf.exportando && onAbiertoChange(o)}>
      <DialogContent
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="h-[96dvh] max-h-[96dvh] w-[96vw] max-w-[96vw] gap-0 overflow-hidden p-0 pointer-coarse:max-h-[96dvh] max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:w-screen max-sm:max-w-none max-sm:rounded-none"
      >
        <MarcoInforme
          enDialogo
          titulo={TITULO_INFORME_RRSS}
          descripcion={descripcionInformeRrss(conWeb)}
          fuenteLista={fuenteLista}
          testId="informe-rrss"
          controles={
            <>
              <SelectorMes valor={mes} onCambio={setMes} meses={meses} disabled={pdf.exportando} />
              <BotonDescargarPdf disabled={!informeListo} exportando={pdf.exportando} texto={pdf.textoBoton} onClick={pdf.exportar} />
            </>
          }
        >
          <EstadoVistaPrevia error={error} onReintentar={reintentar} cargando={cargando} motivoVacio={informeListo ? null : motivoVacio}>
            {informeListo && <DiapositivasInformeRrss informe={informeListo} Envoltorio={DiapositivaEscalada} />}
          </EstadoVistaPrevia>
        </MarcoInforme>
        {pdf.portal}
      </DialogContent>
    </Dialog>
  );
}
