import { useState, type ReactNode } from "react";
import { useUpdateProductoFactura, useCrearProductoFactura, type ProductoFactura } from "@/hooks/useFacturas";
import { Input } from "@/components/ui/input";
import { TableRow, TableCell } from "@/components/ui/table";
import { AyudaPopover } from "@/components/AyudaPopover";
import { Button } from "@/components/ui/button";
import { Pencil, AlertCircle, Check, X } from "lucide-react";
import { formatCantidadLinea, formatImporte, formatNumero, precioAnomalo, valorSinDescuento } from "./formatters";
import { normalizarUnidadFactura } from "./unidad";
import { esLineaRegalo } from "@/lib/facturas/resumenCompras";

/** «Regalo»: la línea no se cobró (importe 0) pero vale algo (`importe_bruto`). */
const InsigniaRegalo = () => (
  <span className="inline-flex h-6 shrink-0 items-center rounded-md border border-emerald-300 bg-emerald-50 px-1.5 text-xs font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
    Regalo
  </span>
);

/** «Valor sin descuento …» a la vista y su explicación en un popover táctil (no en `title`). */
const ValorSinDescuento = ({ v, className = "" }: { v: { texto: string; titulo: string }; className?: string }) => (
  <span className={`inline-flex items-center gap-1 ${className}`}>
    <span>{v.texto}</span>
    <AyudaPopover etiqueta="Qué es el valor sin descuento" className="-my-3.5 ml-0 mr-0 h-11 w-11">
      {v.titulo}
    </AyudaPopover>
  </span>
);

/**
 * Categoría del producto de la línea (catálogo de Facturas › Productos). Solo
 * lectura: se cambia en la pestaña Productos, no aquí.
 */
export const EtiquetaCategoria = ({ p }: { p: ProductoFactura }) =>
  p.categoria ? (
    <span
      className="inline-flex max-w-[11rem] shrink-0 items-center truncate rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-xs font-normal leading-none text-muted-foreground"
      title={`${p.categoria.ruta}${p.producto_canonico ? ` · ${p.producto_canonico}` : ""}`}
    >
      {p.categoria.nombre}
    </span>
  ) : null;

/**
 * Nombre de la línea. Con `onAbrirProducto` y un producto canónico asignado es
 * un enlace a su ficha (Compras › Productos); si no, texto plano como siempre.
 */
const NombreLinea = ({
  p,
  onAbrirProducto,
  className = "",
  compacto = false,
}: {
  p: ProductoFactura;
  onAbrirProducto?: (productoId: number) => void;
  className?: string;
  /** Fila plana de dos líneas: el botón no fuerza 44 px de alto, la zona táctil se amplía con un ::before. */
  compacto?: boolean;
}) =>
  onAbrirProducto && p.producto_id != null ? (
    <button
      type="button"
      onClick={() => onAbrirProducto(p.producto_id as number)}
      className={`${compacto ? "relative before:absolute before:-inset-x-1 before:-inset-y-3 before:content-['']" : "min-h-11"} min-w-0 rounded-md text-left font-medium underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${className}`}
      aria-label={`Ver el producto ${p.producto_canonico ?? p.producto_nombre}`}
      title="Ver el producto: evolución del precio y dónde más aparece"
    >
      {p.producto_nombre}
    </button>
  ) : (
    <span className={className} title={p.producto_nombre}>
      {p.producto_nombre}
    </span>
  );

export const FilaProducto = ({
  p,
  isMobile,
  mediaReferencia,
  onAbrirProducto,
  nuevaEnFacturaId,
  onCerrarNueva,
  editable = false,
}: {
  p: ProductoFactura;
  isMobile?: boolean;
  /**
   * Media de referencia del precio unitario (otras líneas del mismo producto y
   * proveedor; ver `indicePreciosLinea`). Sin ella no se avisa de nada.
   */
  mediaReferencia?: number;
  /** Si se pasa, el nombre de la línea enlaza con la ficha de su producto. */
  onAbrirProducto?: (productoId: number) => void;
  /** Modo «línea nueva»: `p` va vacío, se abre el formulario y Guardar crea la línea en ese documento. */
  nuevaEnFacturaId?: number;
  /** En modo «línea nueva»: se llama al guardar o cancelar. */
  onCerrarNueva?: () => void;
  /**
   * Se puede corregir (el lápiz): «Editar» en Facturas, o «Facturas · Subida» si el
   * documento es suyo (06/11/2026). Sin él, el lápiz no sale. Por defecto, no.
   */
  editable?: boolean;
}) => {
  const esNueva = nuevaEnFacturaId != null;
  const [isEditing, setIsEditing] = useState(esNueva);
  const [nombre, setNombre] = useState(p.producto_nombre);
  const [cantidad, setCantidad] = useState(String(p.cantidad ?? ""));
  const [unidad, setUnidad] = useState(p.unidad || "");
  const [precioUnitario, setPrecioUnitario] = useState(String(p.precio_unitario ?? ""));
  const [total, setTotal] = useState(String(p.precio ?? ""));

  const updateMutation = useUpdateProductoFactura();
  const crearMutation = useCrearProductoFactura();
  const guardando = updateMutation.isPending || crearMutation.isPending;

  const cancelar = () => {
    setIsEditing(false);
    if (esNueva) onCerrarNueva?.();
  };

  const handleSave = async () => {
    if (esNueva && nombre.trim() === "") return;
    // Misma regla que el OCR y que el trigger de la base (ud / kg / l; lo demás se deja).
    const unidadNormalizada = normalizarUnidadFactura(unidad);
    const campos = {
      producto_nombre: nombre,
      cantidad: cantidad !== "" ? Number(cantidad) : undefined,
      unidad: unidadNormalizada,
      precio_unitario: precioUnitario !== "" ? Number(precioUnitario) : undefined,
      precio: total !== "" ? Number(total) : undefined,
    };
    try {
      if (esNueva) {
        await crearMutation.mutateAsync({ factura_id: nuevaEnFacturaId, ...campos });
        setIsEditing(false);
        onCerrarNueva?.();
        return;
      }
      await updateMutation.mutateAsync({ id: p.id, ...campos });
      setUnidad(unidadNormalizada);
      setIsEditing(false);
    } catch (err) {
      console.error("Error guardando producto:", err);
    }
  };

  // Aviso si el precio unitario pasa del doble de la media de referencia (mismo
  // proveedor y nombre, sin precios a 0; la calcula quien monta la fila con
  // `indicePreciosLinea`, una sola vez para todas las líneas).
  const avgPrice = mediaReferencia;
  const hasAnomaly = precioAnomalo(p.precio_unitario, avgPrice);
  const sinDescuento = valorSinDescuento(p);
  const regalo = esLineaRegalo(p);
  const showAnomalyWarning = isEditing ? precioAnomalo(precioUnitario === "" ? null : Number(precioUnitario), avgPrice) : hasAnomaly;

  if (isMobile) {
    if (isEditing) {
      return (
        <div className="relative my-1 flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs">
          <Input className="h-11 text-base md:text-base" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del producto" aria-label="Nombre del producto" />
          <div className="flex gap-2">
            <Input className="h-11 w-full text-base md:text-base" type="number" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="Cant" aria-label="Cantidad" />
            <Input className="h-11 w-full text-base md:text-base" value={unidad} onChange={(e) => setUnidad(e.target.value)} placeholder="Unidad" aria-label="Unidad" />
          </div>
          <div className="flex gap-2 items-center">
            <span className="w-14 shrink-0 text-sm text-muted-foreground">P. Unit:</span>
            <Input className="h-11 w-full text-base md:text-base" type="number" inputMode="decimal" step="0.01" value={precioUnitario} onChange={(e) => setPrecioUnitario(e.target.value)} aria-label="Precio unitario" />
          </div>
          <div className="flex gap-2 items-center">
            <span className="w-14 shrink-0 text-sm font-medium">Total:</span>
            <Input className="h-11 w-full text-base md:text-base" type="number" inputMode="decimal" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} aria-label="Total" />
          </div>
          {showAnomalyWarning && <p className="text-xs text-red-500 font-medium">⚠️ Anomalía: Precio disparado respecto al original</p>}
          <div className="flex gap-2 mt-1 justify-end">
            <Button size="sm" variant="ghost" className="h-11 px-4 text-sm" onClick={cancelar}>Cancelar</Button>
            <Button size="sm" variant="default" className="h-11 px-4 text-sm" onClick={handleSave} disabled={guardando}>Guardar</Button>
          </div>
        </div>
      );
    }

    // Columnas (dentro de un contenedor con `container-type: inline-size`, la sección
    // «Líneas» de la ficha): desde 30rem, Producto · Cantidad · Precio · Importe · lápiz,
    // alineadas con la cabecera de la tabla; por debajo, nombre + importe y en gris
    // «cantidad × precio · categoría». El lápiz va a la derecha: con puntero solo
    // aparece al pasar por encima (o con el foco); en táctil se ve siempre.
    return (
      <div
        className={`group/prod grid grid-cols-[minmax(0,1fr)_auto_2.75rem] items-center gap-x-3 border-b border-border/50 py-1.5 text-xs last:border-b-0 hover:bg-muted/20 [@container(min-width:30rem)]:grid-cols-[minmax(0,1fr)_5.5rem_6.5rem_7rem_2.75rem]`}
      >
        <div className="min-w-0">
          <NombreLinea p={p} onAbrirProducto={onAbrirProducto} compacto className="min-w-0 break-words text-sm font-medium text-foreground" />
          <p className="text-muted-foreground">
            <span className={`[@container(min-width:30rem)]:hidden`}>
              {formatCantidadLinea(p)} × {formatImporte(p.precio_unitario ?? null)}
              {p.categoria && " · "}
            </span>
            {p.categoria && <span title={`${p.categoria.ruta}${p.producto_canonico ? ` · ${p.producto_canonico}` : ""}`}>{p.categoria.nombre}</span>}
          </p>
          {sinDescuento && (
            <p className="text-muted-foreground">
              <ValorSinDescuento v={sinDescuento} />
            </p>
          )}
        </div>
        <span className={`hidden text-right text-sm tabular-nums text-muted-foreground [@container(min-width:30rem)]:block`}>{formatCantidadLinea(p)}</span>
        <span className={`hidden text-right text-sm tabular-nums text-muted-foreground [@container(min-width:30rem)]:block`}>{formatImporte(p.precio_unitario ?? null)}</span>
        <span className="flex items-center justify-end gap-1.5 whitespace-nowrap text-sm font-semibold tabular-nums text-foreground">
          {regalo && <InsigniaRegalo />}
          {hasAnomaly && <AyudaPopover etiqueta="Anomalía de precio" icono={<AlertCircle className="h-4 w-4 text-orange-600" aria-hidden="true" />}>Más del doble de lo que suele cobrar este proveedor (media {formatImporte(avgPrice ?? null)})</AyudaPopover>}
          {formatImporte(p.precio)}
        </span>
        {editable ? (
          <Button
            variant="ghost"
            size="icon"
            className="-my-1.5 h-11 w-11 shrink-0 text-muted-foreground [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/prod:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
            onClick={() => setIsEditing(true)}
            aria-label={`Editar ${p.producto_nombre}`}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          // Sin lápiz el hueco se queda: las columnas siguen alineadas con la cabecera.
          <span aria-hidden="true" />
        )}
      </div>
    );
  }

  // Desktop View
  if (isEditing) {
    // Una sola celda a todo el ancho con los campos en línea (y saltando de línea
    // si no caben): la tabla del desglose es `table-fixed` y meter ahí inputs de
    // 44 px de alto más dos botones en columnas de ~100 px los desbordaba.
    const campo = (etiqueta: string, control: ReactNode, clases = "") => (
      <label className={`flex flex-col gap-1 text-xs text-muted-foreground ${clases}`}>
        {etiqueta}
        {control}
      </label>
    );
    return (
      <TableRow className="bg-muted/30">
        <TableCell colSpan={4} className="py-2">
          <div className="flex flex-wrap items-end gap-2">
            {campo(
              "Producto",
              <Input className="h-11 text-base md:text-base" value={nombre} onChange={(e) => setNombre(e.target.value)} />,
              "min-w-[10rem] flex-1",
            )}
            {campo(
              "Cant.",
              <Input className="h-11 w-20 text-right text-base md:text-base" type="number" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />,
            )}
            {campo(
              "Unidad",
              <Input className="h-11 w-24 text-base md:text-base" value={unidad} onChange={(e) => setUnidad(e.target.value)} />,
            )}
            {campo(
              "P. unitario",
              <Input className="h-11 w-28 text-right text-base md:text-base" type="number" inputMode="decimal" step="0.01" value={precioUnitario} onChange={(e) => setPrecioUnitario(e.target.value)} />,
            )}
            {campo(
              "Total",
              <Input className="h-11 w-28 text-right text-base md:text-base" type="number" inputMode="decimal" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} />,
            )}
            <div className="flex gap-1">
              <Button size="icon" className="h-11 w-11 shrink-0" variant="default" onClick={handleSave} disabled={guardando} aria-label="Guardar producto"><Check className="h-4 w-4" /></Button>
              <Button size="icon" className="h-11 w-11 shrink-0" variant="ghost" onClick={cancelar} aria-label="Cancelar edición"><X className="h-4 w-4" /></Button>
            </div>
          </div>
          {showAnomalyWarning && <p className="text-xs text-red-500 font-medium mt-1">⚠️ Precio anómalo vs historial</p>}
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow className="hover:bg-muted/20 group/prod">
      {/* El desglose va en una tabla `table-fixed`: el nombre del producto lleva
          `truncate`, o sea `nowrap`, y en un reparto automatico eso hace que la
          columna reclame el ancho del nombre mas largo ("LOMO DE BACALAO
          DESALADO CONGELADO IQF 400/600G CAJA 5KG" son ~360 px) y aparezca un
          segundo scroll horizontal dentro de la fila desplegada. */}
      <TableCell className="py-2.5 font-medium">
        <div className="flex min-w-0 items-center gap-2">
          {editable && (
            <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" onClick={() => setIsEditing(true)} aria-label={`Editar ${p.producto_nombre}`}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          <NombreLinea p={p} onAbrirProducto={onAbrirProducto} className="truncate" />
          <EtiquetaCategoria p={p} />
        </div>
      </TableCell>
      <TableCell className="py-2.5 text-right text-muted-foreground whitespace-nowrap" title={formatCantidadLinea(p)}>
        {/* Línea por peso: las unidades encima («12 ud ·») y los kilos, que son
            lo que multiplica el precio, en la línea principal. La columna mide
            92-120 px y «12 ud · 75,48 kg» no cabe en una sola línea. */}
        {p.bultos != null && p.bultos !== 0 && (
          <span className="block text-xs">{formatNumero(p.bultos)} ud ·</span>
        )}
        <span className="font-semibold text-foreground mr-1">{p.cantidad != null ? formatNumero(p.cantidad) : "-"}</span>
        <span className="text-xs">{p.unidad || ""}</span>
      </TableCell>
      <TableCell className="py-2.5 text-right text-muted-foreground tabular-nums whitespace-nowrap">
        <div className="flex items-center justify-end gap-1.5">
          {hasAnomaly && <AyudaPopover etiqueta="Anomalía de precio" icono={<AlertCircle className="h-4 w-4 text-orange-500" aria-hidden="true" />}>Más del doble de lo que suele cobrar este proveedor (media {formatImporte(avgPrice ?? null)})</AyudaPopover>}
          <span>{formatImporte(p.precio_unitario ?? null)}</span>
        </div>
      </TableCell>
      <TableCell className="py-2.5 text-right font-semibold tabular-nums whitespace-nowrap text-foreground">
        <span className="inline-flex items-center justify-end gap-1.5">
          {regalo && <InsigniaRegalo />}
          {formatImporte(p.precio)}
        </span>
        {sinDescuento && (
          <span className="block whitespace-normal text-xs font-normal text-muted-foreground">
            <ValorSinDescuento v={sinDescuento} className="justify-end" />
          </span>
        )}
      </TableCell>
    </TableRow>
  );
};
