import { useState, useDeferredValue } from "react";
import { useAlbaranes, Factura } from "@/hooks/useFacturas";
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
import { BotonOriginal, BadgeAlertas, BadgeSinVerificar } from "./shared/BotonOriginal";

const COLUMNAS_ALBARANES: ColumnaType[] = [
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

const FilaAlbaranMobile = ({ albaran, onPreguntarIA, allDocs, onEdit }: { albaran: Factura; onPreguntarIA?: (doc: Factura) => void; allDocs: Factura[]; onEdit: (doc: Factura) => void }) => {
  const [isOpen, setIsOpen] = useState(false);
  const tieneProductos = albaran.productos.length > 0;

  return (
    <Card className="mb-3 border-border/50 shadow-sm overflow-hidden">
      <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors py-3" onClick={() => tieneProductos && setIsOpen(!isOpen)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {tieneProductos ? (
              isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />
            ) : (
              <FileText className="h-4 w-4 text-muted-foreground" />
            )}
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm font-semibold text-foreground">{albaran.numero_documento}</CardTitle>
                {getAnomaliaBadge(albaran, allDocs)}
                <BadgeAlertas alertas={albaran.alertas} />
                <BadgeSinVerificar verificada={albaran.verificada} />
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 flex items-center">{albaran.proveedor || "Sin proveedor"}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-semibold text-sm tracking-tight">{formatDate(albaran.fecha)}</p>
            {tieneProductos && <Badge variant="secondary" className="text-[10px] uppercase font-bold mt-1.5 bg-muted/80">{albaran.productos.length} items</Badge>}
          </div>
        </div>
      </CardHeader>

      {/* Botonera de acciones rápida unida al Header en mobile */}
      <div className="grid grid-cols-2 gap-1.5 bg-muted/20 border-t border-border/30 px-3 py-2">
        <BotonOriginal
          driveUrl={albaran.drive_url}
          archivoPath={albaran.archivo_path}
          variant="mobile"
          label="Doc"
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-full min-w-0 justify-center gap-1 border border-border/40 px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/50"
          onClick={(e) => { e.stopPropagation(); onEdit(albaran); }}
        >
          <Pencil className="h-3 w-3" /> Editar
        </Button>
        {onPreguntarIA && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-full min-w-0 justify-center gap-1 border border-[hsl(38,59%,45%)/0.2] bg-[hsl(38,59%,45%)/0.05] px-2 text-[11px] font-medium text-[hsl(38,59%,45%)] transition-colors hover:bg-[hsl(38,59%,45%)/0.15] hover:text-[hsl(38,59%,45%)]"
            onClick={(e) => { e.stopPropagation(); onPreguntarIA(albaran); }}
          >
            <Sparkles className="h-3 w-3" /> IA
          </Button>
        )}
      </div>

      {isOpen && (
        <CardContent className="pt-3 pb-4 bg-muted/5">
          <div className="space-y-2.5 text-sm">
            {albaran.cif && <div className="flex justify-between border-b border-border/30 pb-1.5"><span className="text-muted-foreground">CIF</span><span className="font-medium">{albaran.cif}</span></div>}
            {albaran.subtotal != null && <div className="flex justify-between border-b border-border/30 pb-1.5"><span className="text-muted-foreground">Subtotal</span><span className="font-medium">{formatCurrency(albaran.subtotal)}</span></div>}
            {albaran.iva != null && <div className="flex justify-between border-b border-border/30 pb-1.5"><span className="text-muted-foreground">IVA</span><span className="font-medium">{formatCurrency(albaran.iva)}</span></div>}
            {albaran.total != null && <div className="flex justify-between border-b border-border/30 pb-1.5"><span className="text-muted-foreground text-foreground font-semibold">Total</span><span className="font-bold text-foreground">{formatCurrency(albaran.total)}</span></div>}
            {albaran.observaciones && <div className="py-1"><span className="text-muted-foreground text-xs block mb-1 uppercase tracking-wider">Observaciones</span><p className="text-sm bg-muted/30 p-2 rounded-md border border-border/50">{albaran.observaciones}</p></div>}

            {tieneProductos && (
              <div className="mt-4">
                <p className="text-xs font-semibold mb-2 flex items-center gap-1.5 uppercase tracking-wider text-muted-foreground"><Package className="h-3.5 w-3.5" /> Desglose ({albaran.productos.length})</p>
                {albaran.productos.map((p) => (
                  <FilaProducto key={p.id} p={p} isMobile allDocs={allDocs} />
                ))}
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
};

const FilaAlbaranDesktop = ({ albaran, visibles, onPreguntarIA, allDocs, onEdit }: { albaran: Factura; visibles: Record<string, boolean>; onPreguntarIA?: (doc: Factura) => void; allDocs: Factura[]; onEdit: (doc: Factura) => void }) => {
  const [isOpen, setIsOpen] = useState(false);
  const tieneProductos = albaran.productos.length > 0;
  const colSpan = 2 + Object.values(visibles).filter(Boolean).length;

  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/30 transition-colors group" onClick={() => tieneProductos && setIsOpen(!isOpen)}>
        <TableCell className="w-[40px] pl-4">
          {tieneProductos ? (isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />) : null}
        </TableCell>
        {visibles.numero && <TableCell className="font-semibold text-foreground">{albaran.numero_documento} {getAnomaliaBadge(albaran, allDocs)} <BadgeAlertas alertas={albaran.alertas} /> <BadgeSinVerificar verificada={albaran.verificada} /></TableCell>}
        {visibles.proveedor && <TableCell className="font-medium">{albaran.proveedor || "-"}</TableCell>}
        {visibles.cif && <TableCell className="text-muted-foreground">{albaran.cif || "-"}</TableCell>}
        {visibles.fecha && <TableCell className="text-muted-foreground text-center">{formatDate(albaran.fecha)}</TableCell>}
        {visibles.subtotal && <TableCell className="text-right tabular-nums">{formatCurrency(albaran.subtotal)}</TableCell>}
        {visibles.iva && <TableCell className="text-right tabular-nums">{formatCurrency(albaran.iva)}</TableCell>}
        {visibles.total && <TableCell className="text-right font-bold tabular-nums text-foreground">{formatCurrency(albaran.total)}</TableCell>}
        {visibles.observaciones && (
          <TableCell className="max-w-[150px]">
            {albaran.observaciones && albaran.observaciones.length > 30 ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild><span className="cursor-help text-sm text-muted-foreground">{truncateText(albaran.observaciones, 30)}</span></TooltipTrigger>
                  <TooltipContent className="max-w-sm"><p className="text-sm">{albaran.observaciones}</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <span className="text-sm text-muted-foreground">{albaran.observaciones || "-"}</span>
            )}
          </TableCell>
        )}
        {visibles.items && (
          <TableCell className="text-center">
            {tieneProductos ? <Badge variant="secondary" className="text-xs font-mono">{albaran.productos.length}</Badge> : "-"}
          </TableCell>
        )}
        {visibles.doc && (
          <TableCell className="text-center">
            <BotonOriginal
              driveUrl={albaran.drive_url}
              archivoPath={albaran.archivo_path}
              variant="desktop"
            />
          </TableCell>
        )}
        {visibles.procesado_en && <TableCell className="text-xs text-muted-foreground">{formatDateTime(albaran.procesado_en)}</TableCell>}
        {visibles.creado && <TableCell className="text-xs text-muted-foreground">{formatDateTime(albaran.created_at)}</TableCell>}

        {/* Acciones Rápidas */}
        <TableCell className="text-right pr-4">
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs font-medium border-border/40 hover:bg-muted/50 transition-all shadow-sm"
              onClick={(e) => { e.stopPropagation(); onEdit(albaran); }}
              title="Editar Albarán"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            {onPreguntarIA && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs font-medium text-[hsl(38,59%,45%)] border-[hsl(38,59%,45%)/0.3] hover:border-[hsl(38,59%,45%)] hover:bg-[hsl(38,59%,45%)/0.1] hover:text-[hsl(38,59%,45%)] transition-all shadow-sm"
                onClick={(e) => { e.stopPropagation(); onPreguntarIA(albaran); }}
                title="Analizar este albarán con IA"
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
                    {albaran.productos.map((p) => (
                      <FilaProducto key={p.id} p={p} allDocs={allDocs} />
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

export const TablaAlbaranes = ({ onPreguntarIA }: { onPreguntarIA?: (doc: Factura) => void }) => {
  const { data: albaranes, isLoading, error } = useAlbaranes();
  const [busqueda, setBusqueda] = useState("");
  const busquedaDeferida = useDeferredValue(busqueda); // No bloquea el thread durante escritura rápida
  const isMobile = useIsMobile();
  const [columnasVisibles, setColumnasVisibles] = useState<Record<string, boolean>>(DEFAULTS_ALBARANES);
  const [facturaEditando, setFacturaEditando] = useState<Factura | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const handleEditAlbaran = (albaran: Factura) => {
    setFacturaEditando(albaran);
    setIsEditDialogOpen(true);
  };

  const toggleColumna = (key: string, checked: boolean) => {
    setColumnasVisibles((prev) => ({ ...prev, [key]: checked }));
  };

  const albaranesFiltrados = (albaranes || []).filter((a) => {
    const termino = busquedaDeferida.toLowerCase();
    return (
      a.numero_documento.toLowerCase().includes(termino) ||
      (a.proveedor?.toLowerCase().includes(termino) ?? false) ||
      (a.observaciones?.toLowerCase().includes(termino) ?? false)
    );
  });

  const isFiltrandoBusqueda = busqueda !== busquedaDeferida;

  if (error) {
    return <Card className="border-destructive/50"><CardContent className="pt-6"><p className="text-destructive font-medium flex items-center gap-2">⚠️ Error al cargar albaranes: {error.message}</p></CardContent></Card>;
  }

  return (
    <div className="flex flex-col gap-4 h-full min-h-0 pb-2">
      <div className="flex flex-col sm:flex-row gap-3 shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por número, proveedor u observaciones..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className={[
              "pl-9 bg-background shadow-sm border-border/60 transition-colors focus-visible:border-primary",
              isFiltrandoBusqueda ? "opacity-70" : "",
            ].join(" ")}
          />
        </div>
        {!isMobile && (
          <SelectorColumnas columnas={COLUMNAS_ALBARANES} visibles={columnasVisibles} onChange={toggleColumna} />
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-[60px] w-full rounded-xl" />)}
        </div>
      ) : albaranesFiltrados.length === 0 ? (
        <Card className="border-border/50 bg-muted/10 shadow-none"><CardContent className="pt-8 pb-8 text-center"><FileText className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" /><p className="text-muted-foreground font-medium">{busqueda ? "No se encontraron albaranes" : "No hay albaranes registrados"}</p></CardContent></Card>
      ) : isMobile ? (
        <div className="space-y-1 overflow-auto custom-scrollbar flex-1 min-h-0 pr-1">{albaranesFiltrados.map((a) => <FilaAlbaranMobile key={a.id} albaran={a} onPreguntarIA={onPreguntarIA} allDocs={albaranes || []} onEdit={handleEditAlbaran} />)}</div>
      ) : (
        <div className="rounded-xl border border-border/60 bg-background shadow-sm overflow-auto custom-scrollbar flex-1 min-h-0 relative">
          <Table className="min-w-[1080px] lg:min-w-[1260px]">
            <TableHeader className="sticky top-0 z-20 bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/80 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
              <TableRow className="border-b-border/60 hover:bg-transparent">
                <TableHead className="w-[40px] pl-4"></TableHead>
                {columnasVisibles.numero && <TableHead className="font-semibold px-2">Nº Albarán</TableHead>}
                {columnasVisibles.proveedor && <TableHead className="font-semibold">Proveedor</TableHead>}
                {columnasVisibles.cif && <TableHead className="font-semibold">CIF</TableHead>}
                {columnasVisibles.fecha && <TableHead className="font-semibold text-center">Fecha</TableHead>}
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
              {albaranesFiltrados.map((a) => <FilaAlbaranDesktop key={a.id} albaran={a} visibles={columnasVisibles} onPreguntarIA={onPreguntarIA} allDocs={albaranes || []} onEdit={handleEditAlbaran} />)}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-[12px] font-medium text-muted-foreground text-right shrink-0">{albaranesFiltrados.length} total</p>

      <EditarFacturaDialog
        factura={facturaEditando}
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
      />
    </div>
  );
};
