import { useState, useDeferredValue } from "react";
import { useFacturas, Factura } from "@/hooks/useFacturas";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Search, FileText, Package, ExternalLink, Sparkles, Pencil } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { EditarFacturaDialog } from "./EditarFacturaDialog";
import { formatCurrency, formatDate, formatDateTime, truncateText, getAnomaliaBadge } from "./shared/formatters";
import { SelectorColumnas, type ColumnaType } from "./shared/SelectorColumnas";
import { FilaProducto } from "./shared/FilaProducto";

// Re-export FilaProducto for consumers that import from TablaFacturas
export { FilaProducto } from "./shared/FilaProducto";

const COLUMNAS_FACTURAS: ColumnaType[] = [
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

const FilaFacturaMobile = ({
  factura,
  todasFacturas,
  onPreguntarIA,
  onEdit
}: {
  factura: Factura;
  todasFacturas: Factura[];
  onPreguntarIA?: (doc: Factura) => void;
  onEdit: (doc: Factura) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const tieneProductos = factura.productos.length > 0;

  return (
    <Card className="mb-3 border-border/50 shadow-sm overflow-hidden">
      <CardHeader
        className="cursor-pointer hover:bg-muted/30 transition-colors py-3"
        onClick={() => tieneProductos && setIsOpen(!isOpen)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {tieneProductos ? (
              isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />
            ) : (
              <FileText className="h-4 w-4 text-muted-foreground" />
            )}
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm font-semibold text-foreground">{factura.numero_documento}</CardTitle>
                {getAnomaliaBadge(factura, todasFacturas)}
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                {factura.proveedor || "Sin proveedor"}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-semibold text-sm tracking-tight">{formatCurrency(factura.total)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{formatDate(factura.fecha)}</p>
          </div>
        </div>
      </CardHeader>

      {/* Botonera de acciones rápida unida al Header en mobile */}
      <div className="grid grid-cols-2 gap-1.5 bg-muted/20 border-t border-border/30 px-3 py-2">
        {factura.drive_url && (
          <a href={factura.drive_url} target="_blank" rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex h-8 w-full min-w-0 items-center justify-center gap-1 rounded-md bg-blue-50 px-2 text-[11px] font-medium text-blue-600 transition-colors hover:bg-blue-100 hover:text-blue-800">
            <ExternalLink className="h-3 w-3" /> Escaneo
          </a>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-full min-w-0 justify-center gap-1 border border-border/40 px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/50"
          onClick={(e) => { e.stopPropagation(); onEdit(factura); }}
        >
          <Pencil className="h-3 w-3" /> Editar
        </Button>
        {onPreguntarIA && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-full min-w-0 justify-center gap-1 border border-[hsl(38,59%,45%)/0.2] bg-[hsl(38,59%,45%)/0.05] px-2 text-[11px] font-medium text-[hsl(38,59%,45%)] transition-colors hover:bg-[hsl(38,59%,45%)/0.15] hover:text-[hsl(38,59%,45%)]"
            onClick={(e) => { e.stopPropagation(); onPreguntarIA(factura); }}
          >
            <Sparkles className="h-3 w-3" /> IA
          </Button>
        )}
      </div>

      {isOpen && (
        <CardContent className="pt-3 pb-4 bg-muted/5">
          <div className="space-y-2.5 text-sm">
            {factura.cif && (
              <div className="flex justify-between border-b border-border/30 pb-1.5"><span className="text-muted-foreground">CIF</span><span className="font-medium">{factura.cif}</span></div>
            )}
            <div className="flex justify-between border-b border-border/30 pb-1.5"><span className="text-muted-foreground">Subtotal</span><span className="font-medium">{formatCurrency(factura.subtotal)}</span></div>
            <div className="flex justify-between border-b border-border/30 pb-1.5"><span className="text-muted-foreground">IVA</span><span className="font-medium">{formatCurrency(factura.iva)}</span></div>
            {factura.observaciones && (
              <div className="py-1"><span className="text-muted-foreground text-xs block mb-1 uppercase tracking-wider">Observaciones</span><p className="text-sm bg-muted/30 p-2 rounded-md border border-border/50">{factura.observaciones}</p></div>
            )}

            {tieneProductos && (
              <div className="mt-4">
                <p className="text-xs font-semibold mb-2 flex items-center gap-1.5 uppercase tracking-wider text-muted-foreground">
                  <Package className="h-3.5 w-3.5" /> Desglose ({factura.productos.length})
                </p>
                <div className="space-y-1.5">
                  {factura.productos.map((p) => (
                    <FilaProducto key={p.id} p={p} isMobile={true} allDocs={todasFacturas} />
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

const FilaFacturaDesktop = ({
  factura,
  visibles,
  todasFacturas,
  onPreguntarIA,
  onEdit
}: {
  factura: Factura;
  visibles: Record<string, boolean>;
  todasFacturas: Factura[];
  onPreguntarIA?: (doc: Factura) => void;
  onEdit: (doc: Factura) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const tieneProductos = factura.productos.length > 0;
  // +1 para acciones IA
  const colSpan = 2 + Object.values(visibles).filter(Boolean).length;


  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/30 transition-colors group" onClick={() => tieneProductos && setIsOpen(!isOpen)}>
        <TableCell className="w-[40px] pl-4">
          {tieneProductos ? (isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />) : null}
        </TableCell>
        {visibles.numero && <TableCell className="font-semibold text-foreground">{factura.numero_documento} {getAnomaliaBadge(factura, todasFacturas)}</TableCell>}
        {visibles.proveedor && <TableCell className="font-medium">{factura.proveedor || "-"}</TableCell>}
        {visibles.cif && <TableCell className="text-muted-foreground">{factura.cif || "-"}</TableCell>}
        {visibles.fecha && <TableCell className="text-muted-foreground">{formatDate(factura.fecha)}</TableCell>}
        {visibles.subtotal && <TableCell className="text-right tabular-nums">{formatCurrency(factura.subtotal)}</TableCell>}
        {visibles.iva && <TableCell className="text-right tabular-nums">{formatCurrency(factura.iva)}</TableCell>}
        {visibles.total && <TableCell className="text-right font-bold tabular-nums text-foreground">{formatCurrency(factura.total)}</TableCell>}
        {visibles.observaciones && (
          <TableCell className="max-w-[150px]">
            {factura.observaciones && factura.observaciones.length > 30 ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild><span className="cursor-help text-sm text-muted-foreground">{truncateText(factura.observaciones, 30)}</span></TooltipTrigger>
                  <TooltipContent className="max-w-sm"><p className="text-sm">{factura.observaciones}</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <span className="text-sm text-muted-foreground">{factura.observaciones || "-"}</span>
            )}
          </TableCell>
        )}
        {visibles.items && (
          <TableCell className="text-center">
            {tieneProductos ? <Badge variant="secondary" className="text-xs font-mono">{factura.productos.length}</Badge> : "-"}
          </TableCell>
        )}
        {visibles.doc && (
          <TableCell className="text-center">
            {factura.drive_url && (
              <a href={factura.drive_url} target="_blank" rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 p-1.5 rounded-md transition-colors"
                title="Ver Escaneo original">
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </TableCell>
        )}
        {visibles.procesado_en && <TableCell className="text-xs text-muted-foreground">{formatDateTime(factura.procesado_en)}</TableCell>}
        {visibles.creado && <TableCell className="text-xs text-muted-foreground">{formatDateTime(factura.created_at)}</TableCell>}

        {/* Acciones Rápidas (IA) */}
        <TableCell className="text-right pr-4">
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs font-medium border-border/40 hover:bg-muted/50 transition-all shadow-sm"
              onClick={(e) => { e.stopPropagation(); onEdit(factura); }}
              title="Editar Factura"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            {onPreguntarIA && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs font-medium text-[hsl(38,59%,45%)] border-[hsl(38,59%,45%)/0.3] hover:border-[hsl(38,59%,45%)] hover:bg-[hsl(38,59%,45%)/0.1] hover:text-[hsl(38,59%,45%)] transition-all shadow-sm"
                onClick={(e) => { e.stopPropagation(); onPreguntarIA(factura); }}
                title="Analizar esta factura con IA"
              >
                <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Asistente IA
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>
      {isOpen && tieneProductos && (
        <TableRow className="bg-muted/10 hover:bg-muted/10">
          <TableCell colSpan={colSpan} className="p-0 border-b">
            <div className="p-4 pl-12 pr-6">
              <div className="rounded-md border border-border/40 bg-background shadow-sm max-h-[300px] overflow-auto custom-scrollbar">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/80 shadow-sm border-b border-border/40">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-9 text-xs uppercase tracking-wider font-semibold">Producto</TableHead>
                      <TableHead className="h-9 w-[120px] text-right text-xs uppercase tracking-wider font-semibold">Cant. / U.</TableHead>
                      <TableHead className="h-9 w-[120px] text-right text-xs uppercase tracking-wider font-semibold">P. Unitario</TableHead>
                      <TableHead className="h-9 w-[120px] text-right text-xs uppercase tracking-wider font-semibold">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {factura.productos.map((p) => (
                      <FilaProducto key={p.id} p={p} allDocs={todasFacturas} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
};

export const TablaFacturas = ({ onPreguntarIA }: { onPreguntarIA?: (doc: Factura) => void }) => {
  const { data: facturas, isLoading, error } = useFacturas();
  const [busqueda, setBusqueda] = useState("");
  const busquedaDeferida = useDeferredValue(busqueda); // No bloquea el thread durante escritura rápida
  const isMobile = useIsMobile();
  const [columnasVisibles, setColumnasVisibles] = useState<Record<string, boolean>>(DEFAULTS_FACTURAS);
  const [facturaEditando, setFacturaEditando] = useState<Factura | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const handleEditFactura = (factura: Factura) => {
    setFacturaEditando(factura);
    setIsEditDialogOpen(true);
  };

  const toggleColumna = (key: string, checked: boolean) => {
    setColumnasVisibles((prev) => ({ ...prev, [key]: checked }));
  };

  const facturasFiltradas = (facturas || []).filter((f) => {
    const termino = busquedaDeferida.toLowerCase();
    return (
      f.numero_documento.toLowerCase().includes(termino) ||
      (f.proveedor?.toLowerCase().includes(termino) ?? false) ||
      (f.cif?.toLowerCase().includes(termino) ?? false) ||
      (f.observaciones?.toLowerCase().includes(termino) ?? false)
    );
  });

  const isFiltrandoBusqueda = busqueda !== busquedaDeferida;

  if (error) {
    return <Card className="border-destructive/50"><CardContent className="pt-6"><p className="text-destructive font-medium flex items-center gap-2">⚠️ Error al cargar facturas: {error.message}</p></CardContent></Card>;
  }

  return (
    <div className="flex flex-col gap-4 h-full min-h-0 pb-2">
      <div className="flex flex-col sm:flex-row gap-3 shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por número, proveedor, CIF u observaciones..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className={[
              "pl-9 bg-background shadow-sm border-border/60 transition-colors focus-visible:border-primary",
              isFiltrandoBusqueda ? "opacity-70" : "",
            ].join(" ")}
          />
        </div>
        {!isMobile && (
          <SelectorColumnas columnas={COLUMNAS_FACTURAS} visibles={columnasVisibles} onChange={toggleColumna} />
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-[60px] w-full rounded-xl" />)}
        </div>
      ) : facturasFiltradas.length === 0 ? (
        <Card className="border-border/50 bg-muted/10 shadow-none"><CardContent className="pt-8 pb-8 text-center"><FileText className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" /><p className="text-muted-foreground font-medium">{busqueda ? "No se encontraron facturas" : "No hay facturas registradas"}</p></CardContent></Card>
      ) : isMobile ? (
        <div className="space-y-1 overflow-auto custom-scrollbar flex-1 min-h-0 pr-1">{facturasFiltradas.map((f) => <FilaFacturaMobile key={f.id} factura={f} todasFacturas={facturas || []} onPreguntarIA={onPreguntarIA} onEdit={handleEditFactura} />)}</div>
      ) : (
        <div className="rounded-xl border border-border/60 bg-background shadow-sm overflow-auto custom-scrollbar flex-1 min-h-0 relative">
          <Table className="min-w-[1220px] lg:min-w-[1400px]">
            <TableHeader className="sticky top-0 z-20 bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/80 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
              <TableRow className="border-b-border/60 hover:bg-transparent">
                <TableHead className="w-[40px] pl-4"></TableHead>
                {columnasVisibles.numero && <TableHead className="font-semibold px-2">Nº Factura</TableHead>}
                {columnasVisibles.proveedor && <TableHead className="font-semibold">Proveedor</TableHead>}
                {columnasVisibles.cif && <TableHead className="font-semibold">CIF</TableHead>}
                {columnasVisibles.fecha && <TableHead className="font-semibold">Fecha</TableHead>}
                {columnasVisibles.subtotal && <TableHead className="text-right font-semibold">Subtotal</TableHead>}
                {columnasVisibles.iva && <TableHead className="text-right font-semibold">IVA</TableHead>}
                {columnasVisibles.total && <TableHead className="text-right font-bold text-foreground">Total</TableHead>}
                {columnasVisibles.observaciones && <TableHead className="font-semibold">Obs.</TableHead>}
                {columnasVisibles.items && <TableHead className="text-center font-semibold">Items</TableHead>}
                {columnasVisibles.doc && <TableHead className="text-center font-semibold">Escaneo</TableHead>}
                {columnasVisibles.procesado_en && <TableHead className="font-semibold">Procesado</TableHead>}
                {columnasVisibles.creado && <TableHead className="font-semibold">Creado</TableHead>}
                <TableHead className="text-right pr-4 font-semibold w-[190px]">
                  Acciones
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {facturasFiltradas.map((f) => <FilaFacturaDesktop key={f.id} factura={f} visibles={columnasVisibles} todasFacturas={facturas || []} onPreguntarIA={onPreguntarIA} onEdit={handleEditFactura} />)}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-[12px] font-medium text-muted-foreground text-right shrink-0">{facturasFiltradas.length} total</p>

      <EditarFacturaDialog
        factura={facturaEditando}
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
      />
    </div>
  );
};
