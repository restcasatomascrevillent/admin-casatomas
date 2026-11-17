import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { rutaServicios } from "@/components/servicios/pestanas";
import type { GastosServiciosMes } from "@/hooks/useGastosServiciosMes";
import type { GastoServicio } from "./catalogo";
import { euros, redondear, textoMesRecibo, type LineaFactura } from "./modelo";

const TEXTO_ORIGEN: Record<GastoServicio["origen"], string> = {
  manual: "Metido a mano",
  estimado: "Estimado",
  falta: "Falta meterlo",
  gratis: "Gratis",
};
const TONO_ORIGEN: Record<GastoServicio["origen"], string> = {
  manual: "bg-green-100 text-green-800",
  estimado: "bg-muted text-muted-foreground",
  falta: "bg-amber-100 text-amber-900",
  gratis: "bg-muted text-muted-foreground",
};

/**
 * Pago mensual › paso «Conceptos»: los gastos del mes tal como se ven en Super Admin ›
 * Servicios › Costes (IA, hosting, dominio…). Se ponen solos al crear el recibo o cambiar de
 * mes; aquí se ve de dónde sale cada importe y se pueden volver a traer. En el recibo cada
 * uno es un concepto normal: su precio y su descuento se editan debajo.
 */
export function GastosServiciosRecibo({ mes, gastos: q, enRecibo, poner }: {
  mes: string | undefined;
  gastos: GastosServiciosMes;
  /** Las líneas del recibo que vienen de Servicios. */
  enRecibo: LineaFactura[];
  poner: () => void;
}) {
  const textoMes = textoMesRecibo(mes);
  const gastos = q.gastos ?? [];
  const conImporte = gastos.filter((g) => g.importe > 0);
  const total = redondear(conImporte.reduce((s, g) => s + g.importe, 0));
  const faltan = gastos.filter((g) => g.origen === "falta");
  const porProveedor = new Map(enRecibo.map((l) => [l.proveedor, l]));
  const alDia = conImporte.length === enRecibo.length && conImporte.every((g) => porProveedor.get(g.proveedor)?.precio === redondear(g.importe));
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Gastos de Servicios{textoMes ? ` · ${textoMes}` : ""}</CardTitle>
        <p className="text-xs text-muted-foreground">
          Lo que se ve en <a className="underline underline-offset-2" href={rutaServicios("costes")}>Servicios › Costes</a> para ese mes. En el recibo son conceptos normales: cambia su precio o ponles descuento abajo.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!textoMes ? (
          <p className="text-sm text-muted-foreground">Elige en el paso 1 el mes que se paga.</p>
        ) : q.cargando ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Leyendo los gastos de {textoMes}…</p>
        ) : q.error ? (
          <p role="alert" className="text-sm text-destructive">No se han podido leer los gastos de Servicios. Puedes añadir los conceptos a mano.</p>
        ) : !q.disponible || !q.gastos ? (
          <p className="text-sm text-muted-foreground">Los costes de Servicios no están disponibles en este entorno. Añade los conceptos a mano.</p>
        ) : !gastos.length ? (
          <p className="text-sm text-muted-foreground">No hay gastos apuntados en Servicios para {textoMes}.</p>
        ) : (
          <>
            <ul aria-label={`Gastos de ${textoMes}`} className="divide-y rounded-lg border">
              {gastos.map((g) => (
                <li key={g.proveedor} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 break-words">{g.nombre}{g.categoria && <span className="text-xs text-muted-foreground"> · {g.categoria}</span>}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${TONO_ORIGEN[g.origen]}`}>{TEXTO_ORIGEN[g.origen]}</span>
                  <span className="w-20 text-right font-medium tabular-nums">{g.origen === "falta" && !g.importe ? "—" : euros(g.importe)}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm">Total de Servicios: <strong>{euros(total)}</strong></p>
            {faltan.length > 0 && (
              <p className="text-xs text-amber-900">Falta meter en Servicios › Costes el importe de: {faltan.map((g) => g.nombre).join(", ")}. Hasta entonces no entra en el recibo (o añádelo a mano).</p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" className="h-11 gap-2" onClick={poner} disabled={!conImporte.length}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                {enRecibo.length ? "Volver a traer los importes" : "Añadir al recibo"}
              </Button>
              <span className="text-xs text-muted-foreground">
                {!enRecibo.length ? "Todavía no están en el recibo." : alDia ? "El recibo lleva estos mismos importes." : "El recibo lleva importes distintos (editados a mano o de otro momento). «Volver a traer» los sustituye; los descuentos se conservan."}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
