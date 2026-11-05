import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Sparkles, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatImporte } from "@/components/facturas/shared/formatters";
import {
  useAsignarLineas,
  useBorrarProducto,
  useLineasProducto,
  useRecategorizarProductos,
  useRenombrarProducto,
} from "@/hooks/useProductosCatalogo";
import {
  formatCantidades,
  indexarCategorias,
  rutaCategoria,
  type CategoriaProducto,
  type ResumenProducto,
} from "@/lib/facturas/productos";
import { SelectorCategoria } from "./SelectorCategoria";
import { SelectorProducto } from "./SelectorProducto";
import { ListaLineas } from "./ListaLineas";

/**
 * Ficha de un producto: renombrar, cambiar categoría, ver sus líneas y mover
 * las que no son suyas a otro producto (o a uno nuevo). Lo que se cambia aquí
 * vale para todas sus líneas.
 */
export function DetalleProductoDialog({
  producto,
  catalogo,
  categorias,
  puedeEditar,
  onCerrar,
}: {
  producto: ResumenProducto | null;
  catalogo: ResumenProducto[];
  categorias: CategoriaProducto[];
  puedeEditar: boolean;
  onCerrar: () => void;
}) {
  const id = producto?.producto_id ?? null;
  const [nombre, setNombre] = useState(producto?.nombre ?? "");
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  const [moviendo, setMoviendo] = useState(false);
  useEffect(() => {
    setNombre(producto?.nombre ?? "");
    setSeleccion(new Set());
    setMoviendo(false);
  }, [producto?.producto_id, producto?.nombre]);

  const { data: lineas = [], isLoading } = useLineasProducto(id);
  const renombrar = useRenombrarProducto();
  const recategorizar = useRecategorizarProductos();
  const asignar = useAsignarLineas();
  const borrar = useBorrarProducto();
  const mapa = useMemo(() => indexarCategorias(categorias), [categorias]);

  if (!producto) return null;
  const nombreLimpio = nombre.replace(/\s+/g, " ").trim();
  const alternar = (l: number) =>
    setSeleccion((s) => {
      const n = new Set(s);
      if (n.has(l)) n.delete(l);
      else n.add(l);
      return n;
    });
  const mover = async (a: { productoId?: number; nombreNuevo?: string; categoriaId?: number | null }) => {
    await asignar.mutateAsync({ lineaIds: [...seleccion], ...a });
    setSeleccion(new Set());
    setMoviendo(false);
  };

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent className="flex max-h-[92dvh] max-w-2xl flex-col gap-3 overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8">
            <span className="break-words">{producto.nombre}</span>
            {producto.origen === "ia" && (
              <Badge variant="secondary" className="gap-1" title="Lo clasificó la IA y nadie lo ha corregido todavía">
                <Sparkles className="h-3 w-3" aria-hidden="true" /> IA
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {rutaCategoria(mapa, producto.categoria_id) ?? "Sin categoría"} · {producto.compras} compra(s) ·{" "}
            {formatCantidades(producto.cantidades)} · {formatImporte(producto.gasto)} (base sin IVA)
            {producto.ultimo_precio !== null && ` · último precio ${formatImporte(producto.ultimo_precio)}`}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {puedeEditar && (
            <div className="grid gap-3 sm:grid-cols-2">
              <form
                className="flex flex-col gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (nombreLimpio && nombreLimpio !== producto.nombre) renombrar.mutate({ id: producto.producto_id, nombre: nombreLimpio });
                }}
              >
                <label htmlFor="producto-nombre" className="text-xs text-muted-foreground">Nombre</label>
                <div className="flex gap-2">
                  <Input id="producto-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={200} />
                  <Button type="submit" disabled={!nombreLimpio || nombreLimpio === producto.nombre || renombrar.isPending}>
                    Guardar
                  </Button>
                </div>
              </form>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Categoría</span>
                <SelectorCategoria
                  categorias={categorias}
                  valor={producto.categoria_id}
                  disabled={recategorizar.isPending}
                  onCambiar={(c) => recategorizar.mutate({ ids: [producto.producto_id], categoriaId: c })}
                />
              </div>
            </div>
          )}

          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Líneas de factura ({lineas.length})</h3>
              {puedeEditar && seleccion.size > 0 && (
                <Button variant="outline" size="sm" onClick={() => setMoviendo((v) => !v)}>
                  <ArrowRightLeft className="mr-1 h-4 w-4" aria-hidden="true" />
                  Mover {seleccion.size} a otro producto
                </Button>
              )}
            </div>
            {moviendo && seleccion.size > 0 && (
              <SelectorProducto
                catalogo={catalogo}
                categorias={categorias}
                excluir={producto.producto_id}
                ocupado={asignar.isPending}
                onElegir={(p) => void mover({ productoId: p })}
                onCrear={(n, c) => void mover({ nombreNuevo: n, categoriaId: c })}
              />
            )}
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Cargando líneas…</p>
            ) : (
              <ListaLineas lineas={lineas} seleccion={seleccion} onAlternar={alternar} conCasillas={puedeEditar} />
            )}
          </section>

          {puedeEditar && !isLoading && lineas.length === 0 && (
            <Button
              variant="outline"
              className="text-destructive"
              disabled={borrar.isPending}
              onClick={() => borrar.mutate(producto.producto_id, { onSuccess: onCerrar })}
            >
              <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" /> Borrar este producto (no tiene líneas)
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
