import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency, formatDateCorta, formatNumero } from "@/components/facturas/shared/formatters";
import type { LineaProducto } from "@/hooks/useProductosCatalogo";

/** Líneas de factura con su documento; con casillas si se pueden mover. */
export function ListaLineas({
  lineas,
  seleccion,
  onAlternar,
  conCasillas,
}: {
  lineas: LineaProducto[];
  seleccion: Set<number>;
  onAlternar: (id: number) => void;
  conCasillas: boolean;
}) {
  if (lineas.length === 0) return <p className="px-1 py-4 text-sm text-muted-foreground">No hay líneas.</p>;
  return (
    <ul className="divide-y rounded-md border" aria-label="Líneas de factura">
      {lineas.map((l) => (
        <li key={l.id} className="flex items-start gap-3 px-3 py-2 text-sm">
          {conCasillas && (
            <Checkbox
              className="mt-1"
              checked={seleccion.has(l.id)}
              onCheckedChange={() => onAlternar(l.id)}
              aria-label={`Seleccionar la línea «${l.nombre}»`}
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="break-words font-medium">{l.nombre}</p>
            <p className="truncate text-xs text-muted-foreground">
              {formatDateCorta(l.fecha)} · {l.proveedor ?? "Sin proveedor"} · {l.tipo === "albaran" ? "Albarán" : "Factura"}{" "}
              {l.numero_documento}
            </p>
          </div>
          <div className="shrink-0 text-right tabular-nums">
            <p className="font-semibold">{l.total === null ? "—" : formatCurrency(l.total)}</p>
            <p className="text-xs text-muted-foreground">
              {l.cantidad === null ? "—" : formatNumero(l.cantidad)} {l.unidad ?? ""}
              {l.precio_unitario !== null && ` × ${formatCurrency(l.precio_unitario)}`}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
