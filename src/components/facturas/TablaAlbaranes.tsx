import { useState } from "react";
import { useAlbaranes, Factura } from "@/hooks/useFacturas";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronDown, ChevronRight, Search, FileText, Package } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useIsMobile } from "@/hooks/use-mobile";

const formatCurrency = (value: number | null): string => {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(value);
};

const formatDate = (dateString: string): string => {
  try {
    return format(new Date(dateString), "dd/MM/yyyy", { locale: es });
  } catch {
    return dateString;
  }
};

const truncateText = (text: string | null, maxLength: number = 40): string => {
  if (!text) return "-";
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
};

interface FilaAlbaranProps {
  albaran: Factura;
  isMobile: boolean;
}

const FilaAlbaran = ({ albaran, isMobile }: FilaAlbaranProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const tieneProductos = albaran.productos.length > 0;

  if (isMobile) {
    return (
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <Card className="mb-3">
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {tieneProductos ? (
                    isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
                  ) : (
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  )}
                  <div>
                    <CardTitle className="text-sm font-medium">
                      {albaran.numero_documento}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {albaran.proveedor || "Sin proveedor"}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">{formatDate(albaran.fecha)}</p>
                  {tieneProductos && (
                    <Badge variant="secondary" className="text-xs mt-1">
                      {albaran.productos.length} items
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 pb-3">
              <div className="space-y-2 text-sm">
                {albaran.observaciones && (
                  <div>
                    <span className="text-muted-foreground">Observaciones:</span>
                    <p className="mt-1">{albaran.observaciones}</p>
                  </div>
                )}
                {tieneProductos && (
                  <div className="mt-3 pt-3 border-t">
                    <p className="font-medium mb-2 flex items-center gap-1">
                      <Package className="h-3 w-3" />
                      Productos ({albaran.productos.length})
                    </p>
                    <div className="space-y-1">
                      {albaran.productos.map((p) => (
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
          </CollapsibleContent>
        </Card>
      </Collapsible>
    );
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <TableRow className={`cursor-pointer hover:bg-muted/50 ${tieneProductos ? '' : 'cursor-default'}`}>
          <TableCell className="w-10 text-center">
            {tieneProductos && (
              isOpen ? <ChevronDown className="h-4 w-4 mx-auto" /> : <ChevronRight className="h-4 w-4 mx-auto" />
            )}
          </TableCell>
          <TableCell className="font-mono text-sm">{albaran.numero_documento}</TableCell>
          <TableCell className="font-medium">{albaran.proveedor || "-"}</TableCell>
          <TableCell className="text-center whitespace-nowrap">{formatDate(albaran.fecha)}</TableCell>
          <TableCell>
            {albaran.observaciones && albaran.observaciones.length > 40 ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help text-sm">
                      {truncateText(albaran.observaciones)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-sm">
                    <p className="text-sm">{albaran.observaciones}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <span className="text-sm">{albaran.observaciones || "-"}</span>
            )}
          </TableCell>
          <TableCell className="text-center w-20">
            {tieneProductos ? (
              <Badge variant="secondary" className="text-xs">
                {albaran.productos.length}
              </Badge>
            ) : (
              <span className="text-muted-foreground text-sm">-</span>
            )}
          </TableCell>
        </TableRow>
      </CollapsibleTrigger>
      {tieneProductos && (
        <CollapsibleContent asChild>
          <TableRow className="bg-muted/30 hover:bg-muted/30">
            <TableCell colSpan={6} className="p-0">
              <div className="p-4 pl-12">
                <p className="font-medium text-sm mb-3 flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Productos del albarán
                </p>
                <div className="bg-background rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Producto</TableHead>
                        <TableHead className="text-xs text-right w-32">Precio</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {albaran.productos.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="text-sm py-2">{p.producto_nombre}</TableCell>
                          <TableCell className="text-sm py-2 text-right font-medium">
                            {formatCurrency(p.precio)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </TableCell>
          </TableRow>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
};

export const TablaAlbaranes = () => {
  const { data: albaranes, isLoading, error } = useAlbaranes();
  const [busqueda, setBusqueda] = useState("");
  const isMobile = useIsMobile();

  const albaranesFiltrados = (albaranes || []).filter((a) => {
    const termino = busqueda.toLowerCase();
    return (
      a.numero_documento.toLowerCase().includes(termino) ||
      (a.proveedor?.toLowerCase().includes(termino) ?? false) ||
      (a.observaciones?.toLowerCase().includes(termino) ?? false)
    );
  });

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-destructive">Error al cargar albaranes: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por número, proveedor u observaciones..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="pl-10"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : albaranesFiltrados.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            {busqueda ? "No se encontraron albaranes" : "No hay albaranes registrados"}
          </CardContent>
        </Card>
      ) : isMobile ? (
        <div>
          {albaranesFiltrados.map((albaran) => (
            <FilaAlbaran key={albaran.id} albaran={albaran} isMobile={true} />
          ))}
        </div>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-10"></TableHead>
                <TableHead className="w-32">Número</TableHead>
                <TableHead className="w-48">Proveedor</TableHead>
                <TableHead className="w-28 text-center">Fecha</TableHead>
                <TableHead>Observaciones</TableHead>
                <TableHead className="w-20 text-center">Items</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {albaranesFiltrados.map((albaran) => (
                <FilaAlbaran key={albaran.id} albaran={albaran} isMobile={false} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        {albaranesFiltrados.length} albarán(es) encontrado(s)
      </p>
    </div>
  );
};
