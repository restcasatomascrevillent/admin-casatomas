import { cn } from "@/lib/utils";
import { veces } from "@/lib/analisis/margenesCarta";
import { detalleCompra, explicacionCompra, multiplicadorCompra, textoCompra, type PrecioCompraVino as Precio } from "./precioCompraVino";

/**
 * Bajo el precio de carta de la tarjeta: «Compra: 13,85 € (IVA incl.) · 2,09×» y de qué factura
 * sale (25/11/2026, dueño). Solo se monta para quien edita la carta y si el vino tiene precio de
 * factura. El multiplicador sale en rojo por debajo del mínimo de Márgenes.
 */
export function PrecioCompraVino({ precio, precioCarta }: { precio: Precio; precioCarta: number | null | undefined }) {
  const multiplicador = multiplicadorCompra(precioCarta, precio);
  const bajo = multiplicador !== null && multiplicador < precio.multiplicadorMin;
  const detalle = detalleCompra(precio, new Date().toISOString().slice(0, 10));
  const explicacion = explicacionCompra(precio, multiplicador);
  return (
    <div className="w-full min-w-0 text-xs leading-snug text-muted-foreground" title={explicacion} data-testid="precio-compra-vino">
      <p className="break-words">
        <span className="font-medium text-foreground">{textoCompra(precio)}</span>
        {multiplicador !== null && (
          <span className={cn("tabular-nums", bajo && "font-medium text-destructive")} data-testid="multiplicador-compra">
            {" · "}
            {veces(multiplicador)}
          </span>
        )}
      </p>
      {detalle && <p className="truncate">{detalle}</p>}
      <span className="sr-only">{explicacion}</span>
    </div>
  );
}
