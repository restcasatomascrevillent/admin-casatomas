/**
 * Cheques › Stripe › «Generar informe»: informe de cheques regalo en diapositivas, con vista previa (escala al ancho
 * de la pantalla) y descarga en PDF. Mismo funcionamiento y estilo que el informe de tráfico web
 * (src/components/trafico-web/informe/InformeTraficoDialog.tsx), con el que comparte piezas, fuente y exportación.
 *
 * Los datos y las cifras salen de `generarInformeCheques` (src/lib/informes/cheques), que no depende de esta
 * pantalla: el módulo «Informes» del Super Admin puede llamarla igual.
 *
 * Se carga con `lazy()` desde la pestaña: ni las diapositivas ni la fuente entran en el bundle de Cheques hasta que
 * se abre, y html2canvas/jsPDF solo al pulsar «Descargar PDF».
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { Download, FileBarChart2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { DiapositivaEscalada } from "@/components/trafico-web/informe/DiapositivaEscalada";
import { prepararFuenteInforme } from "@/components/trafico-web/informe/fuente";
import { descargarPdfInforme } from "@/components/trafico-web/informe/pdf";
import { ANCHO_DIAPOSITIVA } from "@/components/trafico-web/informe/tema";
import { generarInformeCheques, periodoInforme, periodoPorDefecto, periodosSeleccionables, type InformeCheques } from "@/lib/informes/cheques";
import { DiapositivasInformeCheques } from "./Diapositivas";

const ISO = "yyyy-MM-dd";

interface InformeChequesDialogProps {
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
}

export default function InformeChequesDialog({ abierto, onAbiertoChange }: InformeChequesDialogProps) {
  const hoy = format(new Date(), ISO);
  const opciones = useMemo(() => periodosSeleccionables(hoy), [hoy]);
  const [clave, setClave] = useState(() => periodoPorDefecto(hoy));
  const [fuenteLista, setFuenteLista] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [progreso, setProgreso] = useState<{ hechas: number; total: number } | null>(null);
  const [contenedorExport, setContenedorExport] = useState<HTMLDivElement | null>(null);

  const periodo = useMemo(() => periodoInforme(clave, hoy), [clave, hoy]);
  const consulta = useQuery({
    queryKey: ["informe-cheques", periodo.desdeAnterior, periodo.hasta, periodo.clave],
    queryFn: () => generarInformeCheques(periodo),
    enabled: abierto,
    staleTime: 60_000,
  });
  const informe = consulta.data;
  const informeListo: InformeCheques | null = informe && informe.vacio === false ? informe : null;
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
          asunto: "Informe de cheques regalo",
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

  const meses = opciones.filter((o) => o.tipo === "mes");
  const anios = opciones.filter((o) => o.tipo === "anio");

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
              Informe de cheques regalo
            </DialogTitle>
            <DialogDescription className="text-xs">
              Ventas, cobros por Stripe, canjes y lo pendiente de canjear del periodo, comparado con el anterior.
            </DialogDescription>
          </div>
          <Select value={clave} onValueChange={setClave} disabled={exportando}>
            <SelectTrigger aria-label="Periodo del informe" className="h-11 w-full sm:w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Meses</SelectLabel>
                {meses.map((m) => (
                  <SelectItem key={m.clave} value={m.clave}>
                    {m.etiqueta}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Años</SelectLabel>
                {anios.map((a) => (
                  <SelectItem key={a.clave} value={a.clave}>
                    {a.etiqueta}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button className="h-11 w-full gap-2 sm:w-auto" disabled={!informeListo || exportando} onClick={() => setExportando(true)}>
            {exportando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
            {exportando ? (progreso ? `Creando PDF… ${progreso.hechas}/${progreso.total}` : "Creando PDF…") : "Descargar PDF"}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-muted/60 px-3 py-4 sm:px-6 sm:py-6">
          <div className="mx-auto flex max-w-[1100px] flex-col gap-4 sm:gap-6" data-fuente-lista={fuenteLista || undefined}>
            {consulta.error ? (
              <EstadoErrorCarga titulo="los datos del informe" error={consulta.error} onReintentar={() => void consulta.refetch()} />
            ) : consulta.isLoading || !informe ? (
              Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="aspect-video w-full rounded-md" />)
            ) : informeListo ? (
              <DiapositivasInformeCheques informe={informeListo} Envoltorio={DiapositivaEscalada} />
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-md border bg-background px-6 py-14 text-center">
                <FileBarChart2 className="h-8 w-8 text-muted-foreground" aria-hidden />
                <p className="font-medium">No hay datos para este informe</p>
                <p className="max-w-md text-sm text-muted-foreground">{motivoVacio} Prueba con otro periodo.</p>
              </div>
            )}
          </div>
        </div>

        {exportando &&
          informeListo &&
          createPortal(
            <div ref={setContenedorExport} aria-hidden style={{ position: "fixed", left: -20000, top: 0, width: ANCHO_DIAPOSITIVA, pointerEvents: "none" }}>
              <DiapositivasInformeCheques informe={informeListo} />
            </div>,
            document.body,
          )}
      </DialogContent>
    </Dialog>
  );
}
