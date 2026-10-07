import { useState, type ReactNode } from "react";
import { useUpdateProductoFactura, type ProductoFactura, type Factura } from "@/hooks/useFacturas";
import { Input } from "@/components/ui/input";
import { TableRow, TableCell } from "@/components/ui/table";
import { AyudaPopover } from "@/components/AyudaPopover";
import { Button } from "@/components/ui/button";
import { Pencil, AlertCircle, Check, X } from "lucide-react";
import { formatCantidadLinea, formatCurrency, formatNumero } from "./formatters";
import { normalizarUnidadFactura } from "./unidad";

/**
 * Categoría del producto de la línea (catálogo de Facturas › Productos). Solo
 * lectura: se cambia en la pestaña Productos, no aquí.
 */
export const EtiquetaCategoria = ({ p }: { p: ProductoFactura }) =>
  p.categoria ? (
    <span
      className="inline-flex max-w-[11rem] shrink-0 items-center truncate rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-[11px] font-normal leading-none text-muted-foreground"
      title={`${p.categoria.ruta}${p.producto_canonico ? ` · ${p.producto_canonico}` : ""}`}
    >
      {p.categoria.nombre}
    </span>
  ) : null;

export const FilaProducto = ({ p, isMobile, allDocs }: { p: ProductoFactura, isMobile?: boolean, allDocs: Factura[] }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [nombre, setNombre] = useState(p.producto_nombre);
  const [cantidad, setCantidad] = useState(String(p.cantidad ?? ""));
  const [unidad, setUnidad] = useState(p.unidad || "");
  const [precioUnitario, setPrecioUnitario] = useState(String(p.precio_unitario ?? ""));
  const [total, setTotal] = useState(String(p.precio ?? ""));

  const updateMutation = useUpdateProductoFactura();

  const handleSave = async () => {
    // Misma regla que el OCR y que el trigger de la base (ud / kg / l; lo demás se deja).
    const unidadNormalizada = normalizarUnidadFactura(unidad);
    try {
      await updateMutation.mutateAsync({
        id: p.id,
        producto_nombre: nombre,
        cantidad: cantidad !== "" ? Number(cantidad) : undefined,
        unidad: unidadNormalizada,
        precio_unitario: precioUnitario !== "" ? Number(precioUnitario) : undefined,
        precio: total !== "" ? Number(total) : undefined,
      });
      setUnidad(unidadNormalizada);
      setIsEditing(false);
    } catch (err) {
      console.error("Error guardando producto:", err);
    }
  };

  const pastPrices = allDocs
    .flatMap(f => f.productos)
    .filter(past => past.id !== p.id && past.producto_nombre.toLowerCase() === p.producto_nombre.toLowerCase() && typeof past.precio_unitario === 'number')
    .map(past => past.precio_unitario as number);

  const avgPrice = pastPrices.length > 0 ? pastPrices.reduce((a, b) => a + b, 0) / pastPrices.length : undefined;

  // Warning si el precio unitario cambia drásticamente respecto al último histórico (+100%)
  const hasAnomaly = avgPrice && p.precio_unitario && (p.precio_unitario > avgPrice * 2);
  const showAnomalyWarning = isEditing ? (avgPrice && Number(precioUnitario) > avgPrice * 2) : hasAnomaly;

  if (isMobile) {
    if (isEditing) {
      return (
        <div className="flex flex-col gap-2 text-xs bg-muted/30 p-2 rounded-md border border-border/40 shadow-sm relative">
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
            <Button size="sm" variant="ghost" className="h-11 px-4 text-sm" onClick={() => setIsEditing(false)}>Cancelar</Button>
            <Button size="sm" variant="default" className="h-11 px-4 text-sm" onClick={handleSave} disabled={updateMutation.isPending}>Guardar</Button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col text-xs bg-white p-2 rounded-md border border-border/40 shadow-sm relative group/prod hover:border-[hsl(38,59%,45%)/0.3] transition-colors">
        {/* Siempre visible: antes solo aparecía al pasar el ratón y con el dedo no había forma de editar. */}
        <Button variant="ghost" size="icon" className="absolute top-0 right-0 h-11 w-11" onClick={() => setIsEditing(true)} aria-label={`Editar ${p.producto_nombre}`}>
          <Pencil className="h-4 w-4 text-muted-foreground" />
        </Button>
        <span className="font-medium text-foreground mb-1 min-h-6 pr-11">{p.producto_nombre}</span>
        {p.categoria && <span className="mb-1 -mt-0.5"><EtiquetaCategoria p={p} /></span>}
        <div className="flex justify-between text-muted-foreground items-center">
          <span>{formatCantidadLinea(p)} × {formatCurrency(p.precio_unitario ?? null)}</span>
          <div className="flex items-center gap-1.5">
            {hasAnomaly && <AyudaPopover etiqueta="Anomalía de precio" icono={<AlertCircle className="h-4 w-4 text-orange-500" aria-hidden="true" />}>Anomalía: media histórica {formatCurrency(avgPrice!)}</AyudaPopover>}
            <span className="font-semibold text-foreground">{formatCurrency(p.precio)}</span>
          </div>
        </div>
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
              <Button size="icon" className="h-11 w-11 shrink-0" variant="default" onClick={handleSave} disabled={updateMutation.isPending} aria-label="Guardar producto"><Check className="h-4 w-4" /></Button>
              <Button size="icon" className="h-11 w-11 shrink-0" variant="ghost" onClick={() => setIsEditing(false)} aria-label="Cancelar edición"><X className="h-4 w-4" /></Button>
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
          <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" onClick={() => setIsEditing(true)} aria-label={`Editar ${p.producto_nombre}`}>
            <Pencil className="h-4 w-4" />
          </Button>
          <span className="truncate" title={p.producto_nombre}>{p.producto_nombre}</span>
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
          {hasAnomaly && <AyudaPopover etiqueta="Anomalía de precio" icono={<AlertCircle className="h-4 w-4 text-orange-500" aria-hidden="true" />}>Anomalía: media histórica {formatCurrency(avgPrice!)}</AyudaPopover>}
          <span>{formatCurrency(p.precio_unitario ?? null)}</span>
        </div>
      </TableCell>
      <TableCell className="py-2.5 text-right font-semibold tabular-nums whitespace-nowrap text-foreground">{formatCurrency(p.precio)}</TableCell>
    </TableRow>
  );
};
