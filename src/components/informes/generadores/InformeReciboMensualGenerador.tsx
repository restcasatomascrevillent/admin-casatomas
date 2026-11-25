/**
 * Super Admin › Informes › «Recibo mensual (Gestor Gasto)»: el PDF del pago mensual del mes elegido,
 * el mismo que sale en Gestor Gasto (`components/facturacion/pdf.ts`). Qué recibo es (emitido, borrador
 * guardado o uno nuevo como «Nuevo pago mensual»): `lib/informes/reciboMensual.ts`. No guarda nada.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import type { PropsGeneradorInforme } from "@/lib/informes/registro";
import { nombreArchivoRecibo, reciboMensualDelMes } from "@/lib/informes/reciboMensual";
import { useFacturacionOficiososia } from "@/hooks/useFacturacionOficiososia";
import { useGastosServiciosMes } from "@/hooks/useGastosServiciosMes";
import { VisorPdf } from "@/components/facturas/shared/VisorPdf";
import { descargarBlob } from "@/components/trafico-web/informe/pdf";
import { euros, textoMesRecibo, totalesRecibo } from "@/components/facturacion/modelo";
import { mensajeUsuario } from "@/lib/mensaje-usuario";
import { BotonDescargarPdf, EstadoVistaPrevia } from "../MarcoInforme";

export default function InformeReciboMensualGenerador({ periodo, hoy, Marco }: PropsGeneradorInforme) {
  const mes = periodo.tipo === "mes" ? periodo.mes : hoy.slice(0, 7);
  const datos = useFacturacionOficiososia();
  const gastos = useGastosServiciosMes(mes);
  const recibo = useMemo(
    () => (datos.data && !gastos.cargando ? reciboMensualDelMes(datos.data, mes, gastos.gastos) : null),
    [datos.data, gastos.cargando, gastos.gastos, mes],
  );

  const [pdf, setPdf] = useState<Blob | null>(null);
  const [errorPdf, setErrorPdf] = useState<string | null>(null);
  useEffect(() => {
    setPdf(null);
    setErrorPdf(null);
    if (!recibo) return;
    let cancelado = false;
    void (async () => {
      try {
        const { blobPdfFactura } = await import("@/components/facturacion/pdf");
        const blob = await blobPdfFactura(recibo.documento, { borrador: recibo.borrador });
        if (!cancelado) setPdf(blob);
      } catch (e) {
        if (!cancelado) setErrorPdf(mensajeUsuario(e, "No se ha podido crear el PDF del recibo."));
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [recibo]);

  const descargar = () => {
    if (!pdf || !recibo) return;
    descargarBlob(pdf, nombreArchivoRecibo(recibo, mes));
    toast.success("Recibo descargado");
  };
  const textoMes = textoMesRecibo(mes);
  const faltan = recibo?.origen === "nuevo" ? (gastos.gastos ?? []).filter((g) => g.origen === "falta" && g.importe <= 0).map((g) => g.nombre) : [];

  return (
    <Marco acciones={<BotonDescargarPdf disabled={!pdf} exportando={false} texto="Descargar PDF" onClick={descargar} />}>
      <EstadoVistaPrevia
        error={datos.error ?? (errorPdf ? new Error(errorPdf) : null)}
        onReintentar={() => void datos.refetch()}
        cargando={datos.isLoading || gastos.cargando || (!!recibo && !pdf && !errorPdf)}
        motivoVacio={null}
      >
        {recibo && (
          <div className="rounded-md border bg-background px-4 py-3 text-sm" data-testid="origen-recibo" data-origen={recibo.origen}>
            <p className="font-medium">
              {recibo.origen === "emitido"
                ? `Recibo emitido ${recibo.documento.numero} · ${euros(totalesRecibo(recibo.documento).total)}`
                : recibo.origen === "borrador"
                  ? `Borrador guardado de ${textoMes}, sin emitir · ${euros(totalesRecibo(recibo.documento).total)}`
                  : `Todavía no hay recibo de ${textoMes} · así quedaría: ${euros(totalesRecibo(recibo.documento).total)}`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {recibo.origen === "emitido"
                ? "Es el mismo PDF que se descarga en Gestor Gasto."
                : recibo.origen === "borrador"
                  ? "El PDF sale marcado «BORRADOR · SIN EMITIR». Para emitirlo, ábrelo en "
                  : "Cuota mensual y gastos de Servicios del mes, como «Nuevo pago mensual». Sale marcado como borrador y no se guarda nada. Para emitirlo, hazlo en "}
              {recibo.origen !== "emitido" && (
                <>
                  <Link to="/super-admin/gestor-gasto" className="underline underline-offset-2 hover:text-foreground">
                    Gestor Gasto
                  </Link>
                  .
                </>
              )}
              {faltan.length > 0 && ` Falta meter en Servicios › Costes el importe de: ${faltan.join(", ")}.`}
              {recibo.origen === "nuevo" && !gastos.gastos && " No se han podido leer los gastos de Servicios: solo lleva la cuota."}
            </p>
          </div>
        )}
        {pdf && <VisorPdf fuente={pdf} titulo={`Recibo mensual de ${textoMes}`} className="min-h-[60vh]" />}
      </EstadoVistaPrevia>
    </Marco>
  );
}
