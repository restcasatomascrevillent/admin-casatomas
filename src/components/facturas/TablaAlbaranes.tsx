import { useState } from "react";
import { useAlbaranes, Factura } from "@/hooks/useFacturas";
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

const formatCantidad = (cantidad: number | undefined): string => {
  if (cantidad === undefined || cantidad === null) return "-";
  return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: 3 }).format(cantidad);
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

type ColumnaAlbaran = { key: string; label: string };

const COLUMNAS_ALBARANES: ColumnaAlbaran[] = [
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

const DEFAULTS_ALBARANES: Record<string, boolean> = {
  numero: true, proveedor: true, cif: false, fecha: true,
  subtotal: false, iva: false, total: false, observaciones: true,
  items: true, doc: true, procesado_en: false, creado: false,
};

const SelectorColumnas = ({
  columnas, visibles, onChange,
}: {
  columnas: ColumnaAlbaran[];
  visibles: Record<string, boolean>;
  onChange: (key: string, checked: boolean) => void;
}) => (
  <Popover>
    <PopoverTrigger asChild>
      <Button variant="outline" size="sm" className="gap-1.5">
        <Settings2 className="h-4 w-4" /> Columnas
      </Button>
    </PopoverTrigger>
    <PopoverContent className="w-52" align="end">
      <p className="text-sm font-medium mb-3">Columnas visibles</p>
      <div className="space-y-2">
        {columnas.map((col) => (
          <label key={col.key} className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={visibles[col.key]} onCheckedChange={(checked) => onChange(col.key, !!checked)} />
            {col.label}
          </label>
        ))}
      </div>
    </PopoverContent>
  </Popover>
);

const FilaAlbaranMobile = ({ albaran }: { albaran: Factura }) => {
  const [isOpen, setIsOpen] = useState(false);
  const tieneProductos = albaran.productos.length > 0;

  return (
    <Card className="mb-3">
      <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3" onClick={() => tieneProductos && setIsOpen(!isOpen)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {tieneProductos ? (
              isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
            ) : (
              <FileText className="h-4 w-4 text-muted-foreground" />
            )}
            <div>
              <CardTitle className="text-sm font-medium">{albaran.numero_documento}</CardTitle>
              <p className="text-xs text-muted-foreground">{albaran.proveedor || "Sin proveedor"}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">{formatDate(albaran.fecha)}</p>
            {albaran.drive_url && (
              <a href={albaran.drive_url} target="_blank" rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 mt-1">
                <ExternalLink className="h-3 w-3" /> Ver Doc
              </a>
            )}
            {tieneProductos && <Badge variant="secondary" className="text-xs mt-1">{albaran.productos.length} items</Badge>}
          </div>
        </div>
      </CardHeader>
      {isOpen && (
        <CardContent className="pt-0 pb-3">
          <div className="space-y-2 text-sm">
            {albaran.cif && <div className="flex justify-between"><span className="text-muted-foreground">CIF:</span><span>{albaran.cif}</span></div>}
            {albaran.subtotal != null && <div className="flex justify-between"><span className="text-muted-foreground">Subtotal:</span><span>{formatCurrency(albaran.subtotal)}</span></div>}
            {albaran.iva != null && <div className="flex justify-between"><span className="text-muted-foreground">IVA:</span><span>{formatCurrency(albaran.iva)}</span></div>}
            {albaran.total != null && <div className="flex justify-between"><span className="text-muted-foreground">Total:</span><span>{formatCurrency(albaran.total)}</span></div>}
            {albaran.observaciones && <div><span className="text-muted-foreground">Observaciones:</span><p className="mt-1">{albaran.observaciones}</p></div>}
            {albaran.procesado_en && <div className="flex justify-between"><span className="text-muted-foreground">Procesado:</span><span>{formatDateTime(albaran.procesado_en)}</span></div>}
            {albaran.created_at && <div className="flex justify-between"><span className="text-muted-foreground">Creado:</span><span>{formatDateTime(albaran.created_at)}</span></div>}
            {tieneProductos && (
              <div className="mt-3 pt-3 border-t">
                <p className="font-medium mb-2 flex items-center gap-1"><Package className="h-3 w-3" /> Productos ({albaran.productos.length})</p>
                <div className="space-y-1">
                  {albaran.productos.map((p) => (
                    <div key={p.id} className="flex justify-between text-xs">
                      <span className="truncate flex-1 mr-2">{p.producto_nombre}</span>
                      <span className="font-medium">{formatCantidad(p.cantidad)} {p.unidad || ""}</span>
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

const FilaAlbaranDesktop = ({ albaran, visibles }: { albaran: Factura; visibles: Record<string, boolean> }) => {
  const [isOpen, setIsOpen] = useState(false);
  const tieneProductos = albaran.productos.length > 0;
  const colSpan = 1 + Object.values(visibles).filter(Boolean).length;

  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => tieneProductos && setIsOpen(!isOpen)}>
        <TableCell className="w-[40px]">
          {tieneProductos ? (isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : null}
        </TableCell>
        {visibles.numero && <TableCell className="font-mono text-sm">{albaran.numero_documento}</TableCell>}
        {visibles.proveedor && <TableCell className="font-medium">{albaran.proveedor || "-"}</TableCell>}
        {visibles.cif && <TableCell>{albaran.cif || "-"}</TableCell>}
        {visibles.fecha && <TableCell className="text-center">{formatDate(albaran.fecha)}</TableCell>}
        {visibles.subtotal && <TableCell className="text-right">{formatCurrency(albaran.subtotal)}</TableCell>}
        {visibles.iva && <TableCell className="text-right">{formatCurrency(albaran.iva)}</TableCell>}
        {visibles.total && <TableCell className="text-right font-semibold">{formatCurrency(albaran.total)}</TableCell>}
        {visibles.observaciones && (
          <TableCell className="max-w-[200px]">
            {albaran.observaciones && albaran.observaciones.length > 40 ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild><span className="cursor-help text-sm">{truncateText(albaran.observaciones)}</span></TooltipTrigger>
                  <TooltipContent className="max-w-sm"><p className="text-sm">{albaran.observaciones}</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <span className="text-sm">{albaran.observaciones || "-"}</span>
            )}
          </TableCell>
        )}
        {visibles.items && (
          <TableCell className="text-center">
            {tieneProductos && <Badge variant="secondary" className="text-xs">{albaran.productos.length}</Badge>}
          </TableCell>
        )}
        {visibles.doc && (
          <TableCell className="text-center">
            {albaran.drive_url && (
              <a href={albaran.drive_url} target="_blank" rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm"
                title="Ver documento en Google Drive">
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </TableCell>
        )}
        {visibles.procesado_en && <TableCell className="text-sm text-muted-foreground">{formatDateTime(albaran.procesado_en)}</TableCell>}
        {visibles.creado && <TableCell className="text-sm text-muted-foreground">{formatDateTime(albaran.created_at)}</TableCell>}
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
                  {albaran.productos.map((p) => (
                    <TableRow key={p.id} className="hover:bg-muted/10">
                      <TableCell className="py-2">{p.producto_nombre}</TableCell>
                      <TableCell className="py-2 text-right">{formatCantidad(p.cantidad)}</TableCell>
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

export const TablaAlbaranes = () => {
  const { data: albaranes, isLoading, error } = useAlbaranes();
  const [busqueda, setBusqueda] = useState("");
  const isMobile = useIsMobile();
  const [columnasVisibles, setColumnasVisibles] = useState<Record<string, boolean>>(DEFAULTS_ALBARANES);

  const toggleColumna = (key: string, checked: boolean) => {
    setColumnasVisibles((prev) => ({ ...prev, [key]: checked }));
  };

  const albaranesFiltrados = (albaranes || []).filter((a) => {
    const termino = busqueda.toLowerCase();
    return (
      a.numero_documento.toLowerCase().includes(termino) ||
      (a.proveedor?.toLowerCase().includes(termino) ?? false) ||
      (a.observaciones?.toLowerCase().includes(termino) ?? false)
    );
  });

  if (error) {
    return <Card><CardContent className="pt-6"><p className="text-destructive">Error al cargar albaranes: {error.message}</p></CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por número, proveedor u observaciones..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className="pl-10" />
        </div>
        {!isMobile && (
          <SelectorColumnas columnas={COLUMNAS_ALBARANES} visibles={columnasVisibles} onChange={toggleColumna} />
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : albaranesFiltrados.length === 0 ? (
        <Card><CardContent className="pt-6 text-center text-muted-foreground">{busqueda ? "No se encontraron albaranes" : "No hay albaranes registrados"}</CardContent></Card>
      ) : isMobile ? (
        <div>{albaranesFiltrados.map((a) => <FilaAlbaranMobile key={a.id} albaran={a} />)}</div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="w-[40px]"></TableHead>
                {columnasVisibles.numero && <TableHead>Número</TableHead>}
                {columnasVisibles.proveedor && <TableHead>Proveedor</TableHead>}
                {columnasVisibles.cif && <TableHead>CIF</TableHead>}
                {columnasVisibles.fecha && <TableHead className="text-center">Fecha</TableHead>}
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
              {albaranesFiltrados.map((a) => <FilaAlbaranDesktop key={a.id} albaran={a} visibles={columnasVisibles} />)}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-sm text-muted-foreground text-right">{albaranesFiltrados.length} albarán(es) encontrado(s)</p>
    </div>
  );
};
