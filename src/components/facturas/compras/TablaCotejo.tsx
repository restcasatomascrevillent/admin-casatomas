import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { formatImporte } from "@/components/facturas/shared/formatters";
import {
  CLASE_TONO,
  ETIQUETA_ESTADO,
  separarProductos,
  textoDiferencia,
  textoLado,
  tonoDiferencia,
  tonoEstado,
  type ProductoCotejo,
  type Tono,
} from "@/lib/facturas/cotejo";

// Barra de color a la izquierda de la fila (sombra interior: no ensancha la tabla).
const BARRA_TONO: Record<Tono, string> = {
  ok: "",
  aviso: "shadow-[inset_3px_0_0_0_#f59e0b]",
  alerta: "shadow-[inset_3px_0_0_0_#ef4444]",
};

/** «Albaranes 1.272,65 € · Factura 3.787,53 € · Diferencia +2.514,88 €» con la diferencia en color. */
export function ResumenImportes({
  etiquetaAlbaranes,
  sumaAlbaranes,
  etiquetaFactura,
  baseFactura,
  diferencia,
  tono,
}: {
  etiquetaAlbaranes: string;
  sumaAlbaranes: number | null;
  etiquetaFactura: string;
  baseFactura: number | null;
  diferencia: number | null;
  /** null = sin color (la diferencia se explica en otra línea). */
  tono: Tono | null;
}) {
  const signo = diferencia !== null && diferencia > 0 ? "+" : "";
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-sm tabular-nums">
      <span className="text-muted-foreground">{etiquetaAlbaranes}</span>
      <span className="font-medium">{formatImporte(sumaAlbaranes)}</span>
      <span aria-hidden="true" className="text-muted-foreground">·</span>
      <span className="text-muted-foreground">{etiquetaFactura}</span>
      <span className="font-medium">{formatImporte(baseFactura)}</span>
      <span aria-hidden="true" className="text-muted-foreground">·</span>
      <span className="text-muted-foreground">Diferencia</span>
      <span className={`font-semibold ${tono ? CLASE_TONO[tono] : ""}`} data-tono={tono ?? undefined}>
        {diferencia === null ? "—" : `${signo}${formatImporte(diferencia)}`}
      </span>
    </p>
  );
}

function Fila({ p, apagada }: { p: ProductoCotejo; apagada?: boolean }) {
  const tono = tonoEstado(p.estado);
  return (
    <tr className={`border-b last:border-b-0 ${apagada ? "text-muted-foreground" : ""}`}>
      <th scope="row" className={`break-words py-1.5 pl-2.5 pr-2 text-left font-normal ${BARRA_TONO[tono]}`}>
        {p.producto}
      </th>
      <td className="whitespace-nowrap px-1 py-1.5 text-right tabular-nums">{textoLado(p.en_albaranes, p.unidad)}</td>
      <td className="whitespace-nowrap px-1 py-1.5 text-right tabular-nums">{textoLado(p.en_factura, p.unidad)}</td>
      <td className={`px-1 py-1.5 text-right font-medium ${apagada ? "" : CLASE_TONO[tono]}`} title={ETIQUETA_ESTADO[p.estado]}>
        {apagada ? "Cuadra" : textoDiferencia(p)}
        {!apagada && p.diferencia_importe !== null && p.diferencia_importe !== 0 && (
          <span className={`block text-xs font-normal tabular-nums ${CLASE_TONO[tonoDiferencia(p.diferencia_importe, p.en_albaranes?.importe ?? null)]}`}>
            {p.diferencia_importe > 0 ? "+" : ""}
            {formatImporte(p.diferencia_importe)}
          </span>
        )}
      </td>
    </tr>
  );
}

/**
 * Cotejo por producto en una tabla plana: primero lo que no cuadra (ámbar o
 * rojo, lo más caro arriba) y, plegadas, las líneas que cuadran
 * («23 líneas cuadran»).
 */
export function TablaCotejo({
  productos,
  etiquetaAlbaranes = "Albaranes",
}: {
  productos: ProductoCotejo[];
  etiquetaAlbaranes?: string;
}) {
  const [verOk, setVerOk] = useState(false);
  const { discrepancias, ok } = separarProductos(productos);
  if (productos.length === 0) return null;
  return (
    <div className="space-y-1">
      {discrepancias.length === 0 ? (
        <p className={`text-sm font-medium ${CLASE_TONO.ok}`}>Todos los productos cuadran.</p>
      ) : null}
      {(discrepancias.length > 0 || verOk) && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] border-collapse text-xs">
            <caption className="sr-only">Cotejo por producto: {etiquetaAlbaranes.toLowerCase()} frente a la factura</caption>
            <thead>
              <tr className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                <th scope="col" className="py-1 pl-2 pr-2 text-left font-medium">Producto</th>
                <th scope="col" className="px-1 py-1 text-right font-medium">{etiquetaAlbaranes}</th>
                <th scope="col" className="px-1 py-1 text-right font-medium">Factura</th>
                <th scope="col" className="px-1 py-1 text-right font-medium">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {discrepancias.map((p) => (
                <Fila key={p.clave} p={p} />
              ))}
              {verOk && ok.map((p) => <Fila key={p.clave} p={p} apagada />)}
            </tbody>
          </table>
        </div>
      )}
      {ok.length > 0 && (
        <button
          type="button"
          onClick={() => setVerOk((v) => !v)}
          aria-expanded={verOk}
          className="flex min-h-11 w-full items-center gap-1.5 rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        >
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${verOk ? "rotate-180" : ""}`} aria-hidden="true" />
          <span className={CLASE_TONO.ok}>
            {ok.length} {ok.length === 1 ? "línea cuadra" : "líneas cuadran"}
          </span>
          <span>{verOk ? "· ocultar" : "· ver"}</span>
        </button>
      )}
    </div>
  );
}
