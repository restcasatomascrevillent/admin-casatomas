import { useMemo, useState } from "react";
import { Pencil, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GraficoSeriePrecio } from "@/components/facturas/GraficoSeriePrecio";
import { formatCurrency, formatDateCorta, formatNumero } from "@/components/facturas/shared/formatters";
import { DetalleProductoDialog } from "@/components/facturas/productos/DetalleProductoDialog";
import { ContenidoProducto } from "./ContenidoProducto";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useCategoriasProducto, useLineasProducto, useResumenProductos, type LineaProducto } from "@/hooks/useProductosCatalogo";
import { useSeriePrecioProducto } from "@/hooks/useCompras";
import { formatCantidades, indexarCategorias, rutaCategoria } from "@/lib/facturas/productos";

const TODO = { desde: null, hasta: null, tipo: null } as const;

interface DocumentoDelProducto {
  id: number;
  numero: string | null;
  tipo: string | null;
  fecha: string | null;
  proveedor: string | null;
  lineas: LineaProducto[];
}

/** Las líneas del producto agrupadas por documento (más reciente primero). */
function agruparPorDocumento(lineas: LineaProducto[]): DocumentoDelProducto[] {
  const mapa = new Map<number, DocumentoDelProducto>();
  for (const l of lineas) {
    const d = mapa.get(l.factura_id) ?? {
      id: l.factura_id,
      numero: l.numero_documento,
      tipo: l.tipo,
      fecha: l.fecha,
      proveedor: l.proveedor,
      lineas: [],
    };
    d.lineas.push(l);
    mapa.set(l.factura_id, d);
  }
  return [...mapa.values()].sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? "") || b.id - a.id);
}

/**
 * Compras › Productos › ficha: la evolución del precio (una línea por
 * proveedor) y los documentos en los que aparece; al tocar uno se salta a él.
 * «Editar producto» abre el diálogo de siempre (nombre, categoría, mover líneas).
 * Debajo, el contenido por caja o unidad (para comparar precios en €/kg o €/l).
 */
export function FichaProducto({
  productoId,
  onAbrirDocumento,
}: {
  productoId: number;
  onAbrirDocumento: (id: number) => void;
}) {
  const { canAccess: puedeEditar } = useCanAccessSection("facturas", "edit");
  const resumenQ = useResumenProductos(TODO);
  const categoriasQ = useCategoriasProducto();
  const lineasQ = useLineasProducto(productoId);
  const [editando, setEditando] = useState(false);

  const catalogo = useMemo(() => resumenQ.data ?? [], [resumenQ.data]);
  const categorias = useMemo(() => categoriasQ.data ?? [], [categoriasQ.data]);
  const mapa = useMemo(() => indexarCategorias(categorias), [categorias]);
  const producto = catalogo.find((p) => p.producto_id === productoId) ?? null;
  const serieQ = useSeriePrecioProducto(producto?.nombre ?? null);
  const documentos = useMemo(() => agruparPorDocumento(lineasQ.data ?? []), [lineasQ.data]);

  if (!producto) {
    return (
      <p className="p-4 text-sm text-muted-foreground" role="status">
        {resumenQ.isLoading ? "Cargando el producto…" : "No se ha encontrado este producto."}
      </p>
    );
  }

  return (
    <div className="space-y-4 p-3 sm:p-4">
      <header className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Producto</p>
        <h2 className="flex flex-wrap items-center gap-2 break-words text-lg font-semibold leading-tight">
          {producto.nombre}
          {producto.origen === "ia" && (
            <Badge variant="secondary" className="gap-1" title="Lo clasificó la IA y nadie lo ha corregido todavía">
              <Sparkles className="h-3 w-3" aria-hidden="true" /> IA
            </Badge>
          )}
        </h2>
        <p className="text-sm text-muted-foreground">
          {rutaCategoria(mapa, producto.categoria_id) ?? "Sin categoría"} · {producto.compras} compra(s) ·{" "}
          {formatCantidades(producto.cantidades)} · {formatCurrency(producto.gasto)} (base sin IVA)
          {producto.ultimo_precio !== null && ` · último precio ${formatCurrency(producto.ultimo_precio)}`}
        </p>
        <Button variant="outline" className="h-11 gap-1.5" onClick={() => setEditando(true)}>
          <Pencil className="h-4 w-4" aria-hidden="true" /> {puedeEditar ? "Editar producto" : "Ver líneas del producto"}
        </Button>
      </header>

      <ContenidoProducto productoId={productoId} puedeEditar={puedeEditar} />

      <section aria-label="Evolución del precio">
        {serieQ.isLoading ? (
          <p className="text-sm text-muted-foreground" role="status">
            Cargando la evolución del precio…
          </p>
        ) : serieQ.isError ? (
          <p className="text-sm text-muted-foreground" role="status">
            No se ha podido leer la evolución del precio: {(serieQ.error as { message?: string })?.message ?? "error desconocido"}.
          </p>
        ) : (
          <GraficoSeriePrecio datos={serieQ.data} />
        )}
      </section>

      <section aria-label="Documentos en los que aparece" className="space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Aparece en {lineasQ.isLoading ? "…" : `${documentos.length} ${documentos.length === 1 ? "documento" : "documentos"}`}
        </h3>
        {!lineasQ.isLoading && documentos.length === 0 && <p className="text-sm text-muted-foreground">Ningún documento todavía.</p>}
        <ul className="divide-y rounded-lg border">
          {documentos.map((d) => {
            const resumen = d.lineas
              .map((l) => {
                const cant = l.cantidad !== null ? `${formatNumero(l.cantidad)}${l.unidad ? ` ${l.unidad}` : ""}` : null;
                const precio = l.precio_unitario !== null ? formatCurrency(l.precio_unitario) : null;
                return [cant, precio].filter(Boolean).join(" × ");
              })
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => onAbrirDocumento(d.id)}
                  className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/40"
                  aria-label={`Abrir ${d.tipo === "albaran" ? "el albarán" : "la factura"} ${d.numero ?? d.id}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {d.numero ?? `Documento ${d.id}`}{" "}
                      <span className="font-normal text-muted-foreground">· {d.tipo === "albaran" ? "Albarán" : "Factura"}</span>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {d.proveedor || "Sin proveedor"} · {formatDateCorta(d.fecha)}
                    </span>
                  </span>
                  <span className="max-w-[45%] shrink-0 truncate text-right text-xs tabular-nums text-muted-foreground">{resumen}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {editando && (
        <DetalleProductoDialog
          producto={producto}
          catalogo={catalogo}
          categorias={categorias}
          puedeEditar={puedeEditar}
          onCerrar={() => setEditando(false)}
        />
      )}
    </div>
  );
}
