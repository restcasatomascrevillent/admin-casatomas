import { useState } from "react";
import { useFacturas, Factura } from "@/hooks/useFacturas";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Search, FileText, Package, ExternalLink, Settings2 } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useIsMobile } from "@/hooks/use-mobile";

const formatCurrency = (value: number | null): string => {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(value);
};

const formatDate = (dateString: string | null): string => {
  if (!dateString) return "-";
  try {
    return format(new Date(dateString), "dd/MM/yyyy", { locale: es });
  } catch {
    return dateString;
  }
};

const formatDateTime = (dateString: string | null): string => {
  if (!dateString) return "-";
  try {
    return format(new Date(dateString), "dd/MM/yyyy HH:mm", { locale: es });
  } catch {
    return dateString;
  }
};

const truncateText = (text: string | null, maxLength: number = 40): string => {
  if (!text) return "-";
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
};

type ColumnaFactura = {
  key: string;
  label: string;
};

const COLUMNAS_FACTURAS: ColumnaFactura[] = [
  { key: "numero", label: "Número" },
  { key: "proveedor", label: "Proveedor" },
  { key: "cif", label: "CIF" },
  { key: "fecha", label: "Fecha" },
  { key: "subtotal", label: "Subtotal" },
  { key: "iva", label: "IVA" },
  { key: "total", label: "Total" },
  { key: "observaciones", label: "Observaciones" },
  { key: "items", label: "Items" },
  { key: "doc", label: "Doc" },
  { key: "procesado_en", label: "Procesado en" },
  { key: "creado", label: "Creado" },
];

const DEFAULTS_FACTURAS: Record<string, boolean> = {
  numero: true, proveedor: true, cif: false, fecha: true,
  subtotal: false, iva: false, total: true, observaciones: false,
  items: true, doc: true, procesado_en: false, creado: false,
};

const SelectorColumnas = ({
  columnas,
  visibles,
  onChange,
}: {
  columnas: ColumnaFactura[];
  visibles: Record<string, boolean>;
  onChange: (key: string, checked: boolean) => void;
}) => (
  <Popover>
    <PopoverTrigger asChild>
      <Button variant="outline" size="sm" className="gap-1.5">
        <Settings2 className="h-4 w-4" />
        Columnas
      </Button>
    </PopoverTrigger>
    <PopoverContent className="w-52" align="end">
      <p className="text-sm font-medium mb-3">Columnas visibles</p>
      <div className="space-y-2">
        {columnas.map((col) => (
          <label key={col.key} className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={visibles[col.key]}
              onCheckedChange={(checked) => onChange(col.key, !!checked)}
            />
            {col.label}
          </label>
        ))}
      </div>
    </PopoverContent>
  </Popover>
);

const FilaFacturaMobile = ({ factura }: { factura: Factura }) => {
  const [isOpen, setIsOpen] = useState(false);
  const tieneProductos = factura.productos.length > 0;

  return (
    <Card className="mb-3">
      <CardHeader
        className="cursor-pointer hover:bg-muted/50 transition-colors py-3"
        onClick={() => tieneProductos && setIsOpen(!isOpen)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {tieneProductos ? (
              isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
            ) : (
              <FileText className="h-4 w-4 text-muted-foreground" />
            )}
            <div>
              <CardTitle className="text-sm font-medium">{factura.numero_documento}</CardTitle>
              <p className="text-xs text-muted-foreground">{factura.proveedor || "Sin proveedor"}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-semibold text-sm">{formatCurrency(factura.total)}</p>
            <p className="text-xs text-muted-foreground">{formatDate(factura.fecha)}</p>
            {factura.drive_url && (
              <a href={factura.drive_url} target="_blank" rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 mt-1">
                <ExternalLink className="h-3 w-3" /> Ver Doc
              </a>
            )}
          </div>
        </div>
      </CardHeader>
      {isOpen && (
        <CardContent className="pt-0 pb-3">
          <div className="space-y-2 text-sm">
            {factura.cif && (
              <div className="flex justify-between"><span className="text-muted-foreground">CIF:</span><span>{factura.cif}</span></div>
            )}
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal:</span><span>{formatCurrency(factura.subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">IVA:</span><span>{formatCurrency(factura.iva)}</span></div>
            {factura.observaciones && (
              <div><span className="text-muted-foreground">Observaciones:</span><p className="mt-1">{factura.observaciones}</p></div>
            )}
            {factura.procesado_en && (
              <div className="flex justify-between"><span className="text-muted-foreground">Procesado:</span><span>{formatDateTime(factura.procesado_en)}</span></div>
            )}
            {factura.created_at && (
              <div className="flex justify-between"><span className="text-muted-foreground">Creado:</span><span>{formatDateTime(factura.created_at)}</span></div>
            )}
            {tieneProductos && (
              <div className="mt-3 pt-3 border-t">
                <p className="font-medium mb-2 flex items-center gap-1"><Package className="h-3 w-3" /> Productos ({factura.productos.length})</p>
                <div className="space-y-1">
                  {factura.productos.map((p) => (
                    <div key={p.id} className="flex justify-between text-xs">
                      <span className="truncate flex-1 mr-2">{p.producto_nombre}</span>
                      <span className="font-medium">{formatCurrency(p.precio)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
};

const FilaFacturaDesktop = ({ factura, visibles }: { factura: Factura; visibles: Record<string, boolean> }) => {
  const [isOpen, setIsOpen] = useState(false);
  const tieneProductos = factura.productos.length > 0;
  const colSpan = 1 + Object.values(visibles).filter(Boolean).length;

  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => tieneProductos && setIsOpen(!isOpen)}>
        <TableCell className="w-[40px]">
          {tieneProductos ? (isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : null}
        </TableCell>
        {visibles.numero && <TableCell className="font-medium">{factura.numero_documento}</TableCell>}
        {visibles.proveedor && <TableCell>{factura.proveedor || "-"}</TableCell>}
        {visibles.cif && <TableCell>{factura.cif || "-"}</TableCell>}
        {visibles.fecha && <TableCell>{formatDate(factura.fecha)}</TableCell>}
        {visibles.subtotal && <TableCell className="text-right">{formatCurrency(factura.subtotal)}</TableCell>}
        {visibles.iva && <TableCell className="text-right">{formatCurrency(factura.iva)}</TableCell>}
        {visibles.total && <TableCell className="text-right font-semibold">{formatCurrency(factura.total)}</TableCell>}
        {visibles.observaciones && (
          <TableCell className="max-w-[200px]">
            {factura.observaciones && factura.observaciones.length > 40 ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild><span className="cursor-help text-sm">{truncateText(factura.observaciones)}</span></TooltipTrigger>
                  <TooltipContent className="max-w-sm"><p className="text-sm">{factura.observaciones}</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <span className="text-sm">{factura.observaciones || "-"}</span>
            )}
          </TableCell>
        )}
        {visibles.items && (
          <TableCell className="text-center">
            {tieneProductos && <Badge variant="secondary" className="text-xs">{factura.productos.length}</Badge>}
          </TableCell>
        )}
        {visibles.doc && (
          <TableCell className="text-center">
            {factura.drive_url && (
              <a href={factura.drive_url} target="_blank" rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm"
                title="Ver documento en Google Drive">
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </TableCell>
        )}
        {visibles.procesado_en && <TableCell className="text-sm text-muted-foreground">{formatDateTime(factura.procesado_en)}</TableCell>}
        {visibles.creado && <TableCell className="text-sm text-muted-foreground">{formatDateTime(factura.created_at)}</TableCell>}
      </TableRow>
      {isOpen && tieneProductos && (
        <TableRow className="bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={colSpan} className="p-0">
            <div className="p-4 pl-10">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="h-8">Producto</TableHead>
                    <TableHead className="w-[100px] h-8 text-right">Cantidad</TableHead>
                    <TableHead className="w-[80px] h-8">Unidad</TableHead>
                    <TableHead className="w-[120px] h-8 text-right">P. Unitario</TableHead>
                    <TableHead className="w-[120px] h-8 text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {factura.productos.map((p) => (
                    <TableRow key={p.id} className="hover:bg-muted/10">
                      <TableCell className="py-2">{p.producto_nombre}</TableCell>
                      <TableCell className="py-2 text-right">{p.cantidad ?? "-"}</TableCell>
                      <TableCell className="py-2 text-muted-foreground">{p.unidad || "-"}</TableCell>
                      <TableCell className="py-2 text-right">{formatCurrency(p.precio_unitario ?? null)}</TableCell>
                      <TableCell className="py-2 text-right font-medium">{formatCurrency(p.precio)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
};

export const TablaFacturas = () => {
  const { data: facturas, isLoading, error } = useFacturas();
  const [busqueda, setBusqueda] = useState("");
  const isMobile = useIsMobile();
  const [columnasVisibles, setColumnasVisibles] = useState<Record<string, boolean>>(DEFAULTS_FACTURAS);

  const toggleColumna = (key: string, checked: boolean) => {
    setColumnasVisibles((prev) => ({ ...prev, [key]: checked }));
  };

  const facturasFiltradas = (facturas || []).filter((f) => {
    const termino = busqueda.toLowerCase();
    return (
      f.numero_documento.toLowerCase().includes(termino) ||
      (f.proveedor?.toLowerCase().includes(termino) ?? false) ||
      (f.cif?.toLowerCase().includes(termino) ?? false) ||
      (f.observaciones?.toLowerCase().includes(termino) ?? false)
    );
  });

  if (error) {
    return <Card><CardContent className="pt-6"><p className="text-destructive">Error al cargar facturas: {error.message}</p></CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por número, proveedor, CIF u observaciones..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className="pl-10" />
        </div>
        {!isMobile && (
          <SelectorColumnas columnas={COLUMNAS_FACTURAS} visibles={columnasVisibles} onChange={toggleColumna} />
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : facturasFiltradas.length === 0 ? (
        <Card><CardContent className="pt-6 text-center text-muted-foreground">{busqueda ? "No se encontraron facturas" : "No hay facturas registradas"}</CardContent></Card>
      ) : isMobile ? (
        <div>{facturasFiltradas.map((f) => <FilaFacturaMobile key={f.id} factura={f} />)}</div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="w-[40px]"></TableHead>
                {columnasVisibles.numero && <TableHead>Número</TableHead>}
                {columnasVisibles.proveedor && <TableHead>Proveedor</TableHead>}
                {columnasVisibles.cif && <TableHead>CIF</TableHead>}
                {columnasVisibles.fecha && <TableHead>Fecha</TableHead>}
                {columnasVisibles.subtotal && <TableHead className="text-right">Subtotal</TableHead>}
                {columnasVisibles.iva && <TableHead className="text-right">IVA</TableHead>}
                {columnasVisibles.total && <TableHead className="text-right">Total</TableHead>}
                {columnasVisibles.observaciones && <TableHead>Observaciones</TableHead>}
                {columnasVisibles.items && <TableHead className="text-center">Items</TableHead>}
                {columnasVisibles.doc && <TableHead className="text-center">Doc</TableHead>}
                {columnasVisibles.procesado_en && <TableHead>Procesado en</TableHead>}
                {columnasVisibles.creado && <TableHead>Creado</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {facturasFiltradas.map((f) => <FilaFacturaDesktop key={f.id} factura={f} visibles={columnasVisibles} />)}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-sm text-muted-foreground text-right">{facturasFiltradas.length} factura(s) encontrada(s)</p>
    </div>
  );
};
