import { useState } from "react";
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

/** Lo que el servicio suma al recibo: cantidad × precio, menos su descuento. */
const importeLinea = (l: LineaFactura) => {
  const bruto = redondear(l.cantidad * l.precio);
  return redondear(bruto - redondear((bruto * l.descuento) / 100));
};

/**
 * Pago mensual › paso «Conceptos»: los gastos del mes tal como se ven en Super Admin ›
 * Servicios › Costes (IA, hosting, dominio…), EDITABLES aquí mismo (dueño, 17/11/2026: «que se
 * puedan modificar los gastos de servicios aplicando descuentos»): cada gasto tiene su precio y
 * su descuento, se puede quitar o volver a añadir, y hay un descuento para todos a la vez. Lo
 * que se ve en la columna «En el recibo» es lo que suma al total y lo que sale en el PDF.
 * Se ponen solos al crear el recibo o cambiar de mes; «Volver a traer los importes» repone los
 * precios de Servicios conservando los descuentos.
 */
export function GastosServiciosRecibo({ mes, gastos: q, enRecibo, poner, cambiar, quitar, anadir, descuentoATodos }: {
  mes: string | undefined;
  gastos: GastosServiciosMes;
  /** Las líneas del recibo que vienen de Servicios. */
  enRecibo: LineaFactura[];
  /** Trae (o vuelve a traer) todos los importes de Servicios. */
  poner: () => void;
  cambiar: (id: string, cambio: Partial<Pick<LineaFactura, "precio" | "descuento">>) => void;
  quitar: (id: string) => void;
  anadir: (gasto: GastoServicio) => void;
  descuentoATodos: (porcentaje: number) => void;
}) {
  const [paraTodos, setParaTodos] = useState("");
  const textoMes = textoMesRecibo(mes);
  const gastos = q.gastos ?? [];
  const porProveedor = new Map(gastos.map((g) => [g.proveedor, g]));
  const conImporte = gastos.filter((g) => g.importe > 0);
  const totalServicios = redondear(conImporte.reduce((s, g) => s + g.importe, 0));
  const totalRecibo = redondear(enRecibo.reduce((s, l) => s + importeLinea(l), 0));
  const fuera = gastos.filter((g) => !enRecibo.some((l) => l.proveedor === g.proveedor));
  const faltan = fuera.filter((g) => g.origen === "falta" && g.importe <= 0);
  const sinAnadir = fuera.filter((g) => g.importe > 0);
  const alDia = conImporte.length === enRecibo.length && enRecibo.every((l) => redondear(porProveedor.get(l.proveedor ?? "")?.importe ?? NaN) === l.precio);
  const pct = Number(paraTodos);
  const pctValido = paraTodos.trim() !== "" && Number.isFinite(pct) && pct >= 0 && pct <= 100;
  const cargandoSinLineas = q.cargando && !enRecibo.length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Gastos de Servicios{textoMes ? ` · ${textoMes}` : ""}</CardTitle>
        <p className="text-xs text-muted-foreground">
          Lo que se ve en <a className="underline underline-offset-2" href={rutaServicios("costes")}>Servicios › Costes</a> para ese mes. Cambia aquí el precio o el descuento de cada gasto: lo que pone «En el recibo» es lo que se cobra.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!textoMes && <p className="text-sm text-muted-foreground">Elige en el paso 1 el mes que se paga.</p>}
        {textoMes && cargandoSinLineas && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Leyendo los gastos de {textoMes}…</p>
        )}
        {textoMes && !q.cargando && q.error && <p role="alert" className="text-sm text-destructive">No se han podido leer los gastos de Servicios. Puedes añadir los conceptos a mano.</p>}
        {textoMes && !q.cargando && !q.error && (!q.disponible || !q.gastos) && <p className="text-sm text-muted-foreground">Los costes de Servicios no están disponibles en este entorno. Añade los conceptos a mano.</p>}
        {textoMes && !q.cargando && !q.error && q.gastos && !gastos.length && !enRecibo.length && <p className="text-sm text-muted-foreground">No hay gastos apuntados en Servicios para {textoMes}.</p>}

        {enRecibo.length > 0 && (
          <ul aria-label={`Gastos de ${textoMes || "Servicios"} en el recibo`} className="divide-y rounded-lg border">
            {enRecibo.map((l) => {
              const g = porProveedor.get(l.proveedor ?? "");
              const nombre = g?.nombre ?? l.concepto;
              const distinto = g && redondear(g.importe) !== l.precio;
              return (
                <li key={l.id} className="grid min-w-0 gap-x-3 gap-y-2 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium">{nombre}{g?.categoria && <span className="text-xs font-normal text-muted-foreground"> · {g.categoria}</span>}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      {g && <span className={`rounded-full px-2 py-0.5 ${TONO_ORIGEN[g.origen]}`}>{TEXTO_ORIGEN[g.origen]}</span>}
                      {g ? <span>En Servicios: {euros(g.importe)}{distinto ? " (precio cambiado)" : ""}</span> : !q.cargando && q.gastos ? <span>Ya no está en Servicios para ese mes</span> : null}
                    </p>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-end gap-2">
                    <label className="block w-28 text-xs text-muted-foreground">Precio (€)
                      <Input aria-label={`Precio de ${nombre} (€)`} className="mt-1" type="number" inputMode="decimal" min={0} max={1000000} step="0.01" value={l.precio} onChange={(e) => cambiar(l.id, { precio: Number(e.target.value) })} />
                    </label>
                    <label className="block w-24 text-xs text-muted-foreground">Descuento (%)
                      <Input aria-label={`Descuento de ${nombre} (%)`} className="mt-1" type="number" inputMode="decimal" min={0} max={100} step="0.01" value={l.descuento} onChange={(e) => cambiar(l.id, { descuento: Number(e.target.value) })} />
                    </label>
                    <p className="w-24 pb-2 text-right text-sm"><span className="block text-xs text-muted-foreground">En el recibo</span><strong className="tabular-nums" data-testid={`importe-servicio-${l.proveedor}`}>{euros(importeLinea(l))}</strong></p>
                    <Button type="button" variant="ghost" size="icon" className="h-10 w-10 shrink-0 text-destructive hover:text-destructive pointer-coarse:h-11 pointer-coarse:w-11" aria-label={`Quitar ${nombre} del recibo`} onClick={() => quitar(l.id)}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {sinAnadir.length > 0 && (
          <ul aria-label="Gastos de Servicios que no están en el recibo" className="divide-y rounded-lg border border-dashed">
            {sinAnadir.map((g) => (
              <li key={g.proveedor} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 break-words text-muted-foreground">{g.nombre}{g.categoria && <span className="text-xs"> · {g.categoria}</span>} · {euros(g.importe)} · no está en el recibo</span>
                <Button type="button" variant="outline" size="sm" className="h-10 gap-1 pointer-coarse:h-11" aria-label={`Añadir ${g.nombre} al recibo`} onClick={() => anadir(g)}>
                  <Plus className="h-4 w-4" aria-hidden="true" /> Añadir
                </Button>
              </li>
            ))}
          </ul>
        )}

        {faltan.length > 0 && (
          <p className="text-xs text-amber-900">Falta meter en Servicios › Costes el importe de: {faltan.map((g) => g.nombre).join(", ")}. Hasta entonces no entra en el recibo (o añádelo abajo como concepto a mano).</p>
        )}

        {(enRecibo.length > 0 || conImporte.length > 0) && (
          <>
            <p className="text-sm">
              Servicios en el recibo: <strong>{euros(totalRecibo)}</strong>
              {q.gastos && <span className="text-muted-foreground"> · en Servicios: {euros(totalServicios)}{totalRecibo < totalServicios ? ` · se descuentan ${euros(redondear(totalServicios - totalRecibo))}` : ""}</span>}
            </p>
            <div className="flex flex-wrap items-end gap-3">
              {enRecibo.length > 0 && (
                <div className="flex items-end gap-2">
                  <label className="block w-36 text-xs text-muted-foreground">Descuento a todos (%)
                    <Input aria-label="Descuento a todos los servicios (%)" className="mt-1" type="number" inputMode="decimal" min={0} max={100} step="0.01" placeholder="0" value={paraTodos} onChange={(e) => setParaTodos(e.target.value)} />
                  </label>
                  <Button type="button" variant="outline" className="h-10 pointer-coarse:h-11" disabled={!pctValido} onClick={() => descuentoATodos(pct)}>Aplicar a todos</Button>
                </div>
              )}
              <Button type="button" variant="outline" className="h-10 gap-2 pointer-coarse:h-11" onClick={poner} disabled={!conImporte.length}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                {enRecibo.length ? "Volver a traer los importes" : "Añadir al recibo"}
              </Button>
            </div>
            {q.gastos && (
              <p className="text-xs text-muted-foreground">
                {!enRecibo.length ? "Todavía no están en el recibo." : alDia ? "Los precios son los de Servicios." : "Hay precios cambiados o gastos quitados. «Volver a traer los importes» repone los de Servicios; los descuentos se conservan."}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
