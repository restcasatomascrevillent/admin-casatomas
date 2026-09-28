import { useState } from "react";
import { useUpdateProductoFactura, type ProductoFactura, type Factura } from "@/hooks/useFacturas";
import { Input } from "@/components/ui/input";
import { TableRow, TableCell } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Pencil, AlertCircle, Check } from "lucide-react";
import { formatCurrency } from "./formatters";

export const FilaProducto = ({ p, isMobile, allDocs }: { p: ProductoFactura, isMobile?: boolean, allDocs: Factura[] }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [nombre, setNombre] = useState(p.producto_nombre);
  const [cantidad, setCantidad] = useState(String(p.cantidad ?? ""));
  const [unidad, setUnidad] = useState(p.unidad || "");
  const [precioUnitario, setPrecioUnitario] = useState(String(p.precio_unitario ?? ""));
  const [total, setTotal] = useState(String(p.precio ?? ""));

  const updateMutation = useUpdateProductoFactura();

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({
        id: p.id,
        producto_nombre: nombre,
        cantidad: cantidad !== "" ? Number(cantidad) : undefined,
        unidad: unidad || null,
        precio_unitario: precioUnitario !== "" ? Number(precioUnitario) : undefined,
        precio: total !== "" ? Number(total) : undefined,
      });
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
          <Input className="h-7 text-xs" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del producto" />
          <div className="flex gap-2">
            <Input className="h-7 text-xs w-full" type="number" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="Cant" />
            <Input className="h-7 text-xs w-full" value={unidad} onChange={(e) => setUnidad(e.target.value)} placeholder="Unidad" />
          </div>
          <div className="flex gap-2 items-center">
            <span className="w-12 text-muted-foreground">P. Unit:</span>
            <Input className="h-7 text-xs w-full" type="number" step="0.01" value={precioUnitario} onChange={(e) => setPrecioUnitario(e.target.value)} />
          </div>
          <div className="flex gap-2 items-center">
            <span className="w-12 font-medium">Total:</span>
            <Input className="h-7 text-xs w-full" type="number" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} />
          </div>
          {showAnomalyWarning && <p className="text-[10px] text-red-500 font-medium">⚠️ Anomalía: Precio disparado respecto al original</p>}
          <div className="flex gap-2 mt-1 justify-end">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setIsEditing(false)}>Cancelar</Button>
            <Button size="sm" variant="default" className="h-7 text-xs" onClick={handleSave} disabled={updateMutation.isPending}>Guardar</Button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col text-xs bg-white p-2 rounded-md border border-border/40 shadow-sm relative group/prod hover:border-[hsl(38,59%,45%)/0.3] transition-colors">
        <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover/prod:opacity-100 bg-background/80 backdrop-blur-sm transition-opacity" onClick={() => setIsEditing(true)}>
          <Pencil className="h-3 w-3 text-muted-foreground" />
        </Button>
        <span className="font-medium text-foreground mb-1 pr-6">{p.producto_nombre}</span>
        <div className="flex justify-between text-muted-foreground items-center">
          <span>{p.cantidad ?? "-"} {p.unidad || ""} × {formatCurrency(p.precio_unitario ?? null)}</span>
          <div className="flex items-center gap-1.5">
            {hasAnomaly && <TooltipProvider><Tooltip><TooltipTrigger><AlertCircle className="h-3.5 w-3.5 text-orange-500" /></TooltipTrigger><TooltipContent>Anomalía: Media histórica {formatCurrency(avgPrice!)}</TooltipContent></Tooltip></TooltipProvider>}
            <span className="font-semibold text-foreground">{formatCurrency(p.precio)}</span>
          </div>
        </div>
      </div>
    );
  }

  // Desktop View
  if (isEditing) {
    return (
      <TableRow className="bg-muted/30">
        <TableCell className="py-2">
          <Input className="h-7 text-xs max-w-[200px]" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          {showAnomalyWarning && <p className="text-[10px] text-red-500 font-medium mt-1">⚠️ Precio anómalo vs historial</p>}
        </TableCell>
        <TableCell className="py-2 text-right opacity-100 flex justify-end gap-1">
          <Input className="h-7 text-xs w-16 text-right" type="number" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="Cant" />
          <Input className="h-7 text-xs w-16" value={unidad} onChange={(e) => setUnidad(e.target.value)} placeholder="Unidad" />
        </TableCell>
        <TableCell className="py-2 text-right">
          <Input className="h-7 text-xs text-right w-20 ml-auto" type="number" step="0.01" value={precioUnitario} onChange={(e) => setPrecioUnitario(e.target.value)} />
        </TableCell>
        <TableCell className="py-2 text-right flex justify-end gap-1 items-center">
          <Input className="h-7 text-xs text-right w-20" type="number" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} />
          <Button size="icon" className="h-7 w-7 shrink-0" variant="default" onClick={handleSave} disabled={updateMutation.isPending}><Check className="h-3.5 w-3.5" /></Button>
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
          <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 shrink-0 group-hover/prod:opacity-100 transition-opacity" onClick={() => setIsEditing(true)}>
            <Pencil className="h-3 w-3" />
          </Button>
          <span className="truncate" title={p.producto_nombre}>{p.producto_nombre}</span>
        </div>
      </TableCell>
      <TableCell className="py-2.5 text-right text-muted-foreground whitespace-nowrap">
        <span className="font-semibold text-foreground mr-1">{p.cantidad ?? "-"}</span>
        <span className="text-xs">{p.unidad || ""}</span>
      </TableCell>
      <TableCell className="py-2.5 text-right text-muted-foreground tabular-nums whitespace-nowrap">
        <div className="flex items-center justify-end gap-1.5">
          {hasAnomaly && <TooltipProvider><Tooltip><TooltipTrigger><AlertCircle className="h-3.5 w-3.5 text-orange-500" /></TooltipTrigger><TooltipContent>Anomalía: Media histórica {formatCurrency(avgPrice!)}</TooltipContent></Tooltip></TooltipProvider>}
          <span>{formatCurrency(p.precio_unitario ?? null)}</span>
        </div>
      </TableCell>
      <TableCell className="py-2.5 text-right font-semibold tabular-nums whitespace-nowrap text-foreground">{formatCurrency(p.precio)}</TableCell>
    </TableRow>
  );
};
