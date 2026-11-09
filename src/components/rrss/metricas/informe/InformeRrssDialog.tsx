/**
 * RRSS › Métricas › «Generar informe»: informe mensual de redes sociales en
 * diapositivas, con vista previa (escala al ancho de la pantalla) y descarga en
 * PDF. Mismo funcionamiento que el informe de tráfico web
 * (src/components/trafico-web/informe/InformeTraficoDialog.tsx), con el que
 * comparte piezas, fuente y exportación.
 *
 * Se carga con `lazy()` desde el panel: ni las diapositivas ni la fuente entran
 * en el bundle de RRSS hasta que se abre, y html2canvas/jsPDF solo al pulsar
 * «Descargar PDF».
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import { Download, FileBarChart2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { DiapositivaEscalada } from "@/components/trafico-web/informe/DiapositivaEscalada";
import { prepararFuenteInforme } from "@/components/trafico-web/informe/fuente";
import { descargarPdfInforme } from "@/components/trafico-web/informe/pdf";
import { ANCHO_DIAPOSITIVA } from "@/components/trafico-web/informe/tema";
import { useDatosInformeRrss } from "../datos";
import { DiapositivasInformeRrss } from "./Diapositivas";
import { construirInformeRrss, mesesSeleccionables, mesPorDefecto, rangoDatosRrss, type InformeRrss } from "./modelo";

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
  const [fuenteLista, setFuenteLista] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [progreso, setProgreso] = useState<{ hechas: number; total: number } | null>(null);
  const [contenedorExport, setContenedorExport] = useState<HTMLDivElement | null>(null);

  const rango = useMemo(() => rangoDatosRrss(mes, hoy), [mes, hoy]);
  const datosQ = useDatosInformeRrss(rango, conWeb);
  const informe = useMemo(
    () =>
      rango === null
        ? construirInformeRrss({ cuentas: [], publicaciones: [], web: null }, { mes, hoy })
        : datosQ.data
          ? construirInformeRrss(datosQ.data, { mes, hoy })
          : null,
    [rango, datosQ.data, mes, hoy],
  );
  const informeListo: InformeRrss | null = informe && informe.vacio === false ? informe : null;
  const motivoVacio = informe && informe.vacio === true ? informe.motivo : null;

  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    prepararFuenteInforme().finally(() => vivo && setFuenteLista(true));
    return () => {
      vivo = false;
    };
  }, [abierto]);

  // Exportación: las diapositivas se montan sin escalar fuera de la pantalla y, con la maqueta hecha, se capturan una a una.
  useEffect(() => {
    if (!exportando || !contenedorExport || !informeListo) return;
    let cancelado = false;
    (async () => {
      try {
        await prepararFuenteInforme();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        if (cancelado) return;
        const nodos = Array.from(contenedorExport.querySelectorAll<HTMLElement>("[data-diapositiva]"));
        await descargarPdfInforme(nodos, {
          titulo: informeListo.titulo,
          nombreArchivo: informeListo.nombreArchivo,
          asunto: "Informe mensual de redes sociales",
          alAvanzar: (hechas, total) => !cancelado && setProgreso({ hechas, total }),
        });
        toast.success("Informe descargado");
      } catch (e) {
        toast.error(e instanceof Error ? `No se ha podido crear el PDF: ${e.message}` : "No se ha podido crear el PDF.");
      } finally {
        if (!cancelado) {
          setExportando(false);
          setProgreso(null);
        }
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [exportando, contenedorExport, informeListo]);

  const cargando = rango !== null && datosQ.isLoading;

  return (
    <Dialog open={abierto} onOpenChange={(o) => !exportando && onAbiertoChange(o)}>
      <DialogContent
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="h-[96dvh] max-h-[96dvh] w-[96vw] max-w-[96vw] gap-0 overflow-hidden p-0 pointer-coarse:max-h-[96dvh] max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:w-screen max-sm:max-w-none max-sm:rounded-none"
      >
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b py-3 pl-4 pr-14 sm:pl-5 pointer-coarse:pr-16">
          <div className="mr-auto min-w-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileBarChart2 className="h-5 w-5 text-muted-foreground" aria-hidden />
              Informe mensual de redes sociales
            </DialogTitle>
            <DialogDescription className="text-xs">
              Instagram (alcance, publicaciones y seguidores del mes, comparado con el anterior)
              {conWeb ? " y las visitas que las redes llevan a la web" : ""}. Facebook no está conectado: no sale ninguna cifra suya.
            </DialogDescription>
          </div>
          <Select value={mes} onValueChange={setMes} disabled={exportando}>
            <SelectTrigger aria-label="Mes del informe" className="h-11 w-full sm:w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {meses.map((m) => (
                <SelectItem key={m.clave} value={m.clave}>
                  {m.etiqueta}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button className="h-11 w-full gap-2 sm:w-auto" disabled={!informeListo || exportando} onClick={() => setExportando(true)}>
            {exportando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
            {exportando ? (progreso ? `Creando PDF… ${progreso.hechas}/${progreso.total}` : "Creando PDF…") : "Descargar PDF"}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-muted/60 px-3 py-4 sm:px-6 sm:py-6">
          <div className="mx-auto flex max-w-[1100px] flex-col gap-4 sm:gap-6" data-fuente-lista={fuenteLista || undefined} data-testid="informe-rrss">
            {datosQ.error ? (
              <EstadoErrorCarga titulo="los datos del informe" error={datosQ.error} onReintentar={() => datosQ.refetch()} />
            ) : cargando || !informe ? (
              Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="aspect-video w-full rounded-md" />)
            ) : informeListo ? (
              <DiapositivasInformeRrss informe={informeListo} Envoltorio={DiapositivaEscalada} />
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-md border bg-background px-6 py-14 text-center">
                <FileBarChart2 className="h-8 w-8 text-muted-foreground" aria-hidden />
                <p className="font-medium">No hay datos para este informe</p>
                <p className="max-w-md text-sm text-muted-foreground">{motivoVacio} Prueba con otro mes.</p>
              </div>
            )}
          </div>
        </div>

        {exportando &&
          informeListo &&
          createPortal(
            <div ref={setContenedorExport} aria-hidden style={{ position: "fixed", left: -20000, top: 0, width: ANCHO_DIAPOSITIVA, pointerEvents: "none" }}>
              <DiapositivasInformeRrss informe={informeListo} />
            </div>,
            document.body,
          )}
      </DialogContent>
    </Dialog>
  );
}
