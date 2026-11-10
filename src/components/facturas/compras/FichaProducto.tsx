import { useEffect, useMemo, useState } from "react";
import { Pencil, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GraficoSeriePrecio } from "@/components/facturas/GraficoSeriePrecio";
import { formatDateCorta, formatImporte, formatNumero, plural } from "@/components/facturas/shared/formatters";
import { DetalleProductoDialog } from "@/components/facturas/productos/DetalleProductoDialog";
import { ContenidoProducto } from "./ContenidoProducto";
import { EstadoError, FOCO, Hueso, Marca, TITULO_SECCION, filaEstado } from "./estilo";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useCategoriasProducto, useLineasProducto, useResumenProductos, type LineaProducto } from "@/hooks/useProductosCatalogo";
import { useProveedores } from "@/hooks/useProveedores";
import { crearResolverProveedor } from "@/lib/facturas/proveedores";
import { detalleError } from "@/lib/facturas/listaCompras";
import { formatCantidades, indexarCategorias, rutaCategoria, serieDesdeLineas } from "@/lib/facturas/productos";

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
 * La gráfica se calcula con las LÍNEAS DE ESTE PRODUCTO (las mismas que la
 * lista de documentos; QA 05/11/2026 C-04): la RPC por texto mezclaba
 * productos parecidos y no cuadraba con la cabecera.
 * «Editar producto» abre el diálogo de siempre (nombre, categoría, mover líneas).
 * La gráfica va arriba; el contenido por caja o unidad (para comparar precios
 * en €/kg o €/l) es una sola línea editable.
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
  // Unidad de la gráfica (null = la más comprada); vuelve a la de defecto al cambiar de producto.
  const [unidadSerie, setUnidadSerie] = useState<string | null>(null);
  useEffect(() => setUnidadSerie(null), [productoId]);

  const catalogo = useMemo(() => resumenQ.data ?? [], [resumenQ.data]);
  const categorias = useMemo(() => categoriasQ.data ?? [], [categoriasQ.data]);
  const mapa = useMemo(() => indexarCategorias(categorias), [categorias]);
  const producto = catalogo.find((p) => p.producto_id === productoId) ?? null;
  const documentos = useMemo(() => agruparPorDocumento(lineasQ.data ?? []), [lineasQ.data]);
  // Proveedor unificado de cada línea (por el `proveedor_id` del documento; si no, por su texto).
  const proveedoresQ = useProveedores();
  const serie = useMemo(() => {
    if (!producto || !lineasQ.data) return null;
    const lista = proveedoresQ.data?.proveedores ?? [];
    const porId = new Map(lista.map((p) => [p.id, p.nombre]));
    const resolver = crearResolverProveedor(lista);
    const lineas = lineasQ.data.map((l) => ({
      ...l,
      proveedor: (l.proveedor_id != null ? porId.get(l.proveedor_id) : undefined) ?? (l.proveedor ? resolver(l.proveedor).nombre : null),
    }));
    return serieDesdeLineas(producto.nombre, lineas, undefined, unidadSerie);
  }, [producto, lineasQ.data, proveedoresQ.data, unidadSerie]);

  if (!producto) {
    // Con error del catálogo no se dice «puede que se haya fusionado» (QA C-10).
    if (resumenQ.isError) {
      return (
        <EstadoError
          titulo="No se ha podido abrir el producto"
          detalle={detalleError(resumenQ.error)}
          onReintentar={() => void resumenQ.refetch()}
        />
      );
    }
    return (
      <p className="px-5 py-10 text-center text-sm text-muted-foreground" role="status">
        {resumenQ.isLoading || resumenQ.isFetching ? "Cargando el producto…" : "No se ha encontrado este producto: puede que se haya fusionado con otro."}
      </p>
    );
  }

  return (
    <div>
      {/* Bajo 640 px el nombre ocupa su fila y las acciones van debajo (QA M7). */}
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-border/60 px-4 py-3 sm:px-5">
        <div className="w-full min-w-0 space-y-1 sm:w-auto sm:flex-1">
          <h2 className="flex min-w-0 flex-wrap items-center gap-2.5 break-words text-xl font-semibold leading-tight tracking-tight">
            {producto.nombre}
            {producto.origen === "ia" && (
              // Popover y no `title` (QA M2): en la tablet no hay hover.
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="relative rounded before:absolute before:inset-x-0 before:-inset-y-2 before:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    aria-label="Clasificado por la IA: qué significa"
                  >
                    <Marca tono="sinFactura" icono={<Sparkles aria-hidden="true" />} grande>
                      Clasificado por la IA
                    </Marca>
                  </button>
                </PopoverTrigger>
                <PopoverContent collisionPadding={12} className="w-[min(18rem,calc(100vw-1.5rem))] text-sm font-normal tracking-normal">
                  Lo clasificó la IA y nadie lo ha corregido todavía. Si el nombre o la categoría no son correctos, cámbialos en «Editar».
                </PopoverContent>
              </Popover>
            )}
          </h2>
          <p className="text-sm text-muted-foreground">{rutaCategoria(mapa, producto.categoria_id) ?? "Sin categoría"}</p>
        </div>
        <div role="group" aria-label="Acciones del producto" className="flex shrink-0 items-center rounded-lg border border-border/70 bg-background p-0.5">
          <Button
            variant="ghost"
            className="h-11 shrink-0 gap-1.5 px-3 text-sm font-medium"
            onClick={() => setEditando(true)}
            aria-label={puedeEditar ? "Editar producto" : "Ver líneas del producto"}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" /> {puedeEditar ? "Editar" : "Líneas"}
          </Button>
        </div>
      </header>

      <div className="space-y-5 px-4 py-4 sm:px-5">
        {/* Cifras del producto en una franja, como los importes de un documento. */}
        <dl aria-label="Resumen del producto" className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] divide-x divide-border/60 border-y border-border/60">
          <div className="min-w-0 px-3 py-2">
            <dt className="text-xs font-medium text-muted-foreground">Compras</dt>{" "}
            <dd className="text-base font-medium leading-7 tabular-nums">{plural(producto.compras, "compra", "compras")}</dd>
          </div>
          <div className="min-w-0 px-3 py-2">
            <dt className="text-xs font-medium text-muted-foreground">Cantidad</dt>{" "}
            <dd className="truncate text-base font-medium leading-7 tabular-nums">{formatCantidades(producto.cantidades)}</dd>
          </div>
          <div className="min-w-0 px-3 py-2">
            <dt className="text-xs font-medium text-muted-foreground">Último precio</dt>{" "}
            <dd className="text-base font-medium leading-7 tabular-nums">{producto.ultimo_precio === null ? "—" : formatImporte(producto.ultimo_precio)}</dd>
          </div>
          <div className="min-w-0 bg-muted/25 px-3 py-2">
            <dt className="text-xs font-medium text-muted-foreground">Gasto sin IVA</dt>{" "}
            <dd className="text-lg font-semibold leading-7 tabular-nums">{formatImporte(producto.gasto)}</dd>
          </div>
        </dl>

        {/* La gráfica va arriba: es lo primero que se quiere ver de un producto. */}
        <section aria-label="Evolución del precio">
          {lineasQ.isLoading ? (
            <div role="status" aria-busy="true" className="space-y-2">
              <span className="sr-only">Cargando la evolución del precio…</span>
              <Hueso className="h-3.5 w-48" />
              <Hueso className="h-40 w-full rounded-md" />
            </div>
          ) : lineasQ.isError || !serie ? (
            <p className="text-sm text-muted-foreground" role="status">
              No se ha podido calcular la evolución del precio.
            </p>
          ) : (
            <GraficoSeriePrecio
              datos={serie}
              compacto
              unidades={"unidades" in serie ? serie.unidades : undefined}
              onElegirUnidad={setUnidadSerie}
            />
          )}
        </section>

        <div className="border-y border-border/60">
          <ContenidoProducto productoId={productoId} puedeEditar={puedeEditar} />
        </div>

        <section aria-label="Documentos en los que aparece" className="space-y-1">
          <h3 className={TITULO_SECCION}>
            {lineasQ.isError ? "Documentos en los que aparece" : `Aparece en ${lineasQ.isLoading ? "…" : plural(documentos.length, "documento", "documentos")}`}
          </h3>
          {/* Con error no se dice «0 documentos» (QA C-10): se dice que no se han podido leer. */}
          {lineasQ.isError ? (
            <EstadoError
              titulo="No se han podido leer los documentos de este producto"
              detalle={detalleError(lineasQ.error)}
              onReintentar={() => void lineasQ.refetch()}
            />
          ) : (
            !lineasQ.isLoading && documentos.length === 0 && <p className="py-2 text-sm text-muted-foreground">Ningún documento todavía.</p>
          )}
          <ul className="divide-y divide-border/50 border-y border-border/60 empty:border-0">
            {documentos.map((d) => {
              const resumen = d.lineas
                .map((l) => {
                  const cant = l.cantidad !== null ? `${formatNumero(l.cantidad)}${l.unidad ? ` ${l.unidad}` : ""}` : null;
                  const precio = l.precio_unitario !== null ? formatImporte(l.precio_unitario) : null;
                  return [cant, precio].filter(Boolean).join(" × ");
                })
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={d.id} className={filaEstado(false)}>
                  <button
                    type="button"
                    onClick={() => onAbrirDocumento(d.id)}
                    className={`flex min-h-12 w-full items-center gap-3 px-2 py-1.5 text-left active:bg-muted/50 ${FOCO}`}
                    aria-label={`Abrir ${d.tipo === "albaran" ? "el albarán" : "la factura"} ${d.numero ?? d.id}`}
                  >
                    <span className="w-[4.5rem] shrink-0 text-[13px] tabular-nums text-muted-foreground">{formatDateCorta(d.fecha)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{d.proveedor || "Sin proveedor"}</span>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="truncate tabular-nums">{d.numero ?? `Documento ${d.id}`}</span>
                        {d.tipo === "albaran" && <Marca tono="neutro">Albarán</Marca>}
                      </span>
                    </span>
                    <span className="max-w-[45%] shrink-0 truncate text-right text-[13px] tabular-nums text-foreground/80">{resumen}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

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
