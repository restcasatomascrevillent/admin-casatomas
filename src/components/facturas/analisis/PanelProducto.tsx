// Panel al lado del visor en «Comparar facturas» (15/11/2026, aviso de GAMBA
// ROJA N1): las líneas del documento con las del producto ARRIBA y marcadas
// (con su hoja), y todas las compras del producto, facturas y albaranes aún
// sin facturar, cada una con su enlace al documento.
import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency, formatDateCorta, formatNumero, plural } from "@/components/facturas/shared/formatters";
import { ETIQUETA_TIPO, type DocumentoCifra } from "@/lib/facturas/documentosCifra";
import { comprasQueCuentan, lineasConProductoArriba, type LineaDocumento, type ProductoBuscado } from "@/lib/facturas/comprasProducto";
import { useComprasProducto } from "@/hooks/useComprasProducto";
import { FOCO } from "./piezas";

const PESTANA =
  "min-h-11 flex-1 rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm";

const precioUd = (precio: number | null, unidad: string | null) => (precio === null ? "sin precio" : `${formatCurrency(precio)}/${unidad || "ud"}`);
const cantidadUd = (cantidad: number | null, unidad: string | null) => (cantidad === null ? "—" : `${formatNumero(cantidad)} ${unidad || "ud"}`);

function Estado({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export function PanelProducto({
  doc,
  producto,
  lineas,
  cargandoLineas,
  errorLineas,
  onAbrirDocumento,
}: {
  doc: DocumentoCifra;
  producto: ProductoBuscado;
  lineas: LineaDocumento[];
  cargandoLineas: boolean;
  errorLineas: boolean;
  onAbrirDocumento?: (doc: DocumentoCifra) => void;
}) {
  const [pestana, setPestana] = useState<"lineas" | "compras">("lineas");
  const comprasQ = useComprasProducto(producto);
  const compras = comprasQueCuentan(comprasQ.data ?? []);
  const { lineas: ordenadas, delProducto } = lineasConProductoArriba(lineas, producto);

  return (
    <aside
      aria-label={`Líneas y compras de ${producto.nombre}`}
      className="flex max-h-[40dvh] min-h-0 shrink-0 flex-col border-t border-border/70 bg-background md:max-h-none md:w-[22rem] md:border-l md:border-t-0"
      data-testid="panel-producto"
    >
      <div role="group" aria-label="Qué ver" className="m-2 flex shrink-0 gap-1 rounded-lg bg-muted p-1">
        <button type="button" aria-pressed={pestana === "lineas"} className={cn(PESTANA, FOCO)} onClick={() => setPestana("lineas")}>
          Líneas del documento{lineas.length ? ` (${lineas.length})` : ""}
        </button>
        <button type="button" aria-pressed={pestana === "compras"} className={cn(PESTANA, FOCO)} onClick={() => setPestana("compras")}>
          Todas las compras{comprasQ.data ? ` (${compras.length})` : ""}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {pestana === "lineas" ? (
          cargandoLineas ? (
            <Estado>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando las líneas…
            </Estado>
          ) : errorLineas ? (
            <Estado>No se han podido cargar las líneas de este documento.</Estado>
          ) : (
            <>
              {delProducto.size === 0 && <Estado>No se ha encontrado {producto.nombre} en las líneas de este documento.</Estado>}
              <ul aria-label="Líneas del documento" data-testid="lineas-documento" className="space-y-1">
                {ordenadas.map((l) => {
                  const suya = delProducto.has(l.id);
                  return (
                    <li
                      key={l.id}
                      data-del-producto={suya || undefined}
                      className={cn(
                        "rounded-md border px-2 py-1.5 text-xs",
                        suya ? "border-amber-500/70 bg-amber-200/60 text-amber-950 dark:bg-amber-500/20 dark:text-amber-100" : "border-border/60",
                      )}
                    >
                      <p className="flex items-baseline justify-between gap-2">
                        <span className={cn("min-w-0 [overflow-wrap:anywhere]", suya && "font-semibold")}>{l.nombre}</span>
                        {l.pagina !== null && <span className="shrink-0 text-[0.6875rem] opacity-80">hoja {l.pagina}</span>}
                      </p>
                      <p className="tabular-nums opacity-90">
                        {cantidadUd(l.cantidad, l.unidad)} · {precioUd(l.precio, l.unidad)}
                        {l.total !== null ? ` · ${formatCurrency(l.total)}` : ""}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </>
          )
        ) : comprasQ.isLoading ? (
          <Estado>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando las compras…
          </Estado>
        ) : comprasQ.isError ? (
          <Estado>No se han podido cargar las compras de {producto.nombre}.</Estado>
        ) : (
          <>
            <p className="px-1 pb-1 text-[0.6875rem] text-muted-foreground">
              {plural(compras.length, "compra", "compras")} de {producto.nombre}: facturas y albaranes aún sin facturar (los ya facturados están dentro de su factura). Sin IVA.
            </p>
            <ul aria-label={`Compras de ${producto.nombre}`} data-testid="compras-producto" className="space-y-1">
              {compras.map((c) => {
                const este = c.doc.id === doc.id;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      disabled={!onAbrirDocumento || este}
                      onClick={() => onAbrirDocumento?.(c.doc)}
                      aria-label={`${ETIQUETA_TIPO[c.doc.tipo]} ${c.doc.numero ?? "sin número"} de ${c.doc.proveedor}, ${formatDateCorta(c.doc.fecha)}: ${precioUd(c.precio, c.unidad)}${este ? " (abierto)" : ". Abrir"}`}
                      className={cn(
                        "grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2 rounded-md border px-2 py-1.5 text-left text-xs hover:bg-muted/50 disabled:cursor-default",
                        este ? "border-primary/60 bg-muted" : "border-border/60",
                        FOCO,
                      )}
                    >
                      <span className="min-w-0 truncate font-medium">
                        {formatDateCorta(c.doc.fecha)} · {ETIQUETA_TIPO[c.doc.tipo]} {c.doc.numero ?? "s/n"}
                      </span>
                      <span className="font-semibold tabular-nums">{precioUd(c.precio, c.unidad)}</span>
                      <span className="min-w-0 truncate text-muted-foreground">{c.doc.proveedor}</span>
                      <span className="tabular-nums text-muted-foreground">{cantidadUd(c.cantidad, c.unidad)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </aside>
  );
}
