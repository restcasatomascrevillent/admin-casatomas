/**
 * Super Admin › Tráfico web › «Generar informe»: informe mensual en
 * diapositivas para el dueño, con vista previa (escala al ancho de la
 * pantalla: ordenador, tablet o móvil) y descarga en PDF.
 *
 * El informe es de la web principal (Casa Tomás), con sus datos solos, y lleva
 * al final un apartado de Touza (una o dos diapositivas): no depende de la web
 * elegida en la página ni tiene selector de web.
 *
 * Se carga con `lazy()` desde la página: ni las diapositivas ni la fuente
 * entran en el bundle de Tráfico web hasta que se abre el informe, y
 * html2canvas/jsPDF solo al pulsar «Descargar PDF».
 *
 * Los datos (`useInformeTrafico`), la exportación (`useExportarDiapositivas`)
 * y el marco (`MarcoInforme`) son los mismos que usa Super Admin › Informes.
 */
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { BotonDescargarPdf, EstadoVistaPrevia, MarcoInforme, SelectorMes } from "@/components/informes/MarcoInforme";
import { useExportarDiapositivas } from "@/components/informes/useExportarDiapositivas";
import { DiapositivasInforme } from "./Diapositivas";
import { mesesSeleccionables, mesPorDefecto } from "./modelo";
import { useFuenteInforme } from "@/components/informes/useFuenteInforme";
import { DiapositivaEscalada } from "./DiapositivaEscalada";
import { useInformeTrafico } from "./useInformeTrafico";

const ISO = "yyyy-MM-dd";

/** Título y descripción del informe (los mismos en el diálogo y en Super Admin › Informes). */
export const TITULO_INFORME_TRAFICO = "Informe mensual de tráfico web";
export const DESCRIPCION_INFORME_TRAFICO =
  "Para el dueño: la web de Casa Tomás (cifras clave, gráficas y conclusiones del mes, comparado con el anterior) y, al final, un apartado para Touza.";

interface InformeTraficoDialogProps {
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
}

export default function InformeTraficoDialog({ abierto, onAbiertoChange }: InformeTraficoDialogProps) {
  const hoy = format(new Date(), ISO);
  const meses = useMemo(() => mesesSeleccionables(hoy), [hoy]);
  const [mes, setMes] = useState(() => mesPorDefecto(hoy));
  const fuenteLista = useFuenteInforme(abierto);
  const { informeListo, motivoVacio, cargando, error, reintentar } = useInformeTrafico(mes, hoy);
  const pdf = useExportarDiapositivas(
    informeListo ? { titulo: informeListo.titulo, nombreArchivo: informeListo.nombreArchivo, diapositivas: <DiapositivasInforme informe={informeListo} /> } : null,
  );

  return (
    <Dialog open={abierto} onOpenChange={(o) => !pdf.exportando && onAbiertoChange(o)}>
      <DialogContent
        // Sin foco automático en el selector de mes: es una vista previa, no un formulario.
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="h-[96dvh] max-h-[96dvh] w-[96vw] max-w-[96vw] gap-0 overflow-hidden p-0 pointer-coarse:max-h-[96dvh] max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:w-screen max-sm:max-w-none max-sm:rounded-none">
        <MarcoInforme
          enDialogo
          titulo={TITULO_INFORME_TRAFICO}
          descripcion={DESCRIPCION_INFORME_TRAFICO}
          fuenteLista={fuenteLista}
          controles={
            <>
              <SelectorMes valor={mes} onCambio={setMes} meses={meses} disabled={pdf.exportando} />
              <BotonDescargarPdf disabled={!informeListo} exportando={pdf.exportando} texto={pdf.textoBoton} onClick={pdf.exportar} />
            </>
          }
        >
          <EstadoVistaPrevia error={error} onReintentar={reintentar} cargando={cargando} motivoVacio={informeListo ? null : motivoVacio}>
            {informeListo && <DiapositivasInforme informe={informeListo} Envoltorio={DiapositivaEscalada} />}
          </EstadoVistaPrevia>
        </MarcoInforme>
        {pdf.portal}
      </DialogContent>
    </Dialog>
  );
}
