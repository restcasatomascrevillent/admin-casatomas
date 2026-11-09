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
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import { Download, FileBarChart2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { useDatosInformeTrafico, type DatosInformeTrafico } from "@/hooks/useTraficoWeb";
import { useComportamiento, useConfigLogs } from "@/hooks/useLogsWeb";
import { construirApartadoComportamiento } from "./comportamiento";
import { DiapositivasInforme } from "./Diapositivas";
import {
  construirInformeMensual,
  mesesSeleccionables,
  mesPorDefecto,
  PROYECTO_PRINCIPAL,
  PROYECTO_TOUZA,
  rangoDatos,
  rangoInforme,
  type InformeTrafico,
} from "./modelo";
import { prepararFuenteInforme } from "./fuente";
import { descargarPdfInforme } from "./pdf";
import { ALTO_DIAPOSITIVA, ANCHO_DIAPOSITIVA } from "./tema";

const ISO = "yyyy-MM-dd";
const SIN_DATOS: DatosInformeTrafico = { serie: [], paginas: [], dispositivos: [], paises: [], procedencias: [], primerDiaConVisitas: null };

/** Escala una diapositiva de 1280 × 720 al ancho disponible, manteniendo el 16:9. */
function DiapositivaEscalada({ children, indice }: { children: ReactNode; indice: number }) {
  const [caja, setCaja] = useState<HTMLDivElement | null>(null);
  const [ancho, setAncho] = useState(0);
  useEffect(() => {
    if (!caja) return;
    const medir = () => setAncho(caja.clientWidth);
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(caja);
    return () => observador.disconnect();
  }, [caja]);
  const escala = ancho > 0 ? ancho / ANCHO_DIAPOSITIVA : 1;
  return (
    <div
      ref={setCaja}
      data-testid={`diapositiva-${indice + 1}`}
      className="relative w-full overflow-hidden rounded-md shadow-md ring-1 ring-black/5"
      style={{ aspectRatio: `${ANCHO_DIAPOSITIVA} / ${ALTO_DIAPOSITIVA}` }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ width: ANCHO_DIAPOSITIVA, height: ALTO_DIAPOSITIVA, transform: `scale(${escala})` }}
      >
        {children}
      </div>
    </div>
  );
}

interface InformeTraficoDialogProps {
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
}

export default function InformeTraficoDialog({ abierto, onAbiertoChange }: InformeTraficoDialogProps) {
  const hoy = format(new Date(), ISO);
  const meses = useMemo(() => mesesSeleccionables(hoy), [hoy]);
  const [mes, setMes] = useState(() => mesPorDefecto(hoy));
  const [fuenteLista, setFuenteLista] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [progreso, setProgreso] = useState<{ hechas: number; total: number } | null>(null);
  const [contenedorExport, setContenedorExport] = useState<HTMLDivElement | null>(null);

  const rango = useMemo(() => rangoInforme(mes, hoy), [mes, hoy]);
  // Cada web por separado: la principal no lleva sumadas las visitas de Touza.
  const principalQ = useDatosInformeTrafico(PROYECTO_PRINCIPAL, rangoDatos(rango));
  const touzaQ = useDatosInformeTrafico(PROYECTO_TOUZA, rangoDatos(rango));
  const informe = useMemo(
    () =>
      rango.diasCerrados === 0
        ? construirInformeMensual({ principal: SIN_DATOS, touza: SIN_DATOS }, { mes, hoy })
        : principalQ.data && touzaQ.data
          ? construirInformeMensual({ principal: principalQ.data, touza: touzaQ.data }, { mes, hoy })
          : null,
    [principalQ.data, touzaQ.data, rango.diasCerrados, mes, hoy],
  );
  // «Qué hacen los visitantes»: mismas cifras que Tráfico web › Comportamiento, del entorno de esta base de datos.
  const configLogs = useConfigLogs();
  const comportamientoQ = useComportamiento(rango.diasCerrados > 0 ? rango.desde : null, rango.hasta, configLogs.data?.entorno_bd ?? null);
  const informeListo: InformeTrafico | null = useMemo(() => {
    if (!informe || informe.vacio !== false) return null;
    return { ...informe, comportamiento: construirApartadoComportamiento(comportamientoQ.data, informe.resumen.paginasVistas.valor, informe.mes.nombre) };
  }, [informe, comportamientoQ.data]);
  const motivoVacio = informe && informe.vacio === true ? informe.motivo : null;

  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    prepararFuenteInforme().finally(() => vivo && setFuenteLista(true));
    return () => {
      vivo = false;
    };
  }, [abierto]);

  // Exportación: las diapositivas se montan sin escalar fuera de la pantalla y,
  // con la maqueta ya hecha, se capturan una a una.
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

  const cargando = rango.diasCerrados > 0 && (principalQ.isLoading || touzaQ.isLoading);
  const errorCarga = principalQ.error ?? touzaQ.error;
  const reintentar = () => {
    if (principalQ.isError) principalQ.refetch();
    if (touzaQ.isError) touzaQ.refetch();
  };

  return (
    <Dialog open={abierto} onOpenChange={(o) => !exportando && onAbiertoChange(o)}>
      <DialogContent
        // Sin foco automático en el selector de mes: es una vista previa, no un formulario.
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="h-[96dvh] max-h-[96dvh] w-[96vw] max-w-[96vw] gap-0 overflow-hidden p-0 pointer-coarse:max-h-[96dvh] max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:w-screen max-sm:max-w-none max-sm:rounded-none">
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b py-3 pl-4 pr-14 sm:pl-5 pointer-coarse:pr-16">
          <div className="mr-auto min-w-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileBarChart2 className="h-5 w-5 text-muted-foreground" aria-hidden />
              Informe mensual de tráfico web
            </DialogTitle>
            <DialogDescription className="text-xs">
              Para el dueño: la web de Casa Tomás (cifras clave, gráficas y conclusiones del mes, comparado con el anterior) y, al
              final, un apartado para Touza.
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
          <Button
            className="h-11 w-full gap-2 sm:w-auto"
            disabled={!informeListo || exportando}
            onClick={() => setExportando(true)}
          >
            {exportando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
            {exportando ? (progreso ? `Creando PDF… ${progreso.hechas}/${progreso.total}` : "Creando PDF…") : "Descargar PDF"}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-muted/60 px-3 py-4 sm:px-6 sm:py-6">
          <div className="mx-auto flex max-w-[1100px] flex-col gap-4 sm:gap-6" data-fuente-lista={fuenteLista || undefined}>
            {errorCarga ? (
              <EstadoErrorCarga titulo="los datos del informe" error={errorCarga} onReintentar={reintentar} />
            ) : cargando || !informe ? (
              Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="aspect-video w-full rounded-md" />)
            ) : informeListo ? (
              <DiapositivasInforme informe={informeListo} Envoltorio={DiapositivaEscalada} />
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
            <div
              ref={setContenedorExport}
              aria-hidden
              style={{ position: "fixed", left: -20000, top: 0, width: ANCHO_DIAPOSITIVA, pointerEvents: "none" }}
            >
              <DiapositivasInforme informe={informeListo} />
            </div>,
            document.body,
          )}
      </DialogContent>
    </Dialog>
  );
}
