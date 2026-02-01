import { useState } from "react";
import { useFacturas, Factura } from "@/hooks/useFacturas";
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

interface FilaFacturaProps {
  factura: Factura;
  isMobile: boolean;
}

const FilaFactura = ({ factura, isMobile }: FilaFacturaProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const tieneProductos = factura.productos.length > 0;

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
                      {factura.numero_documento}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {factura.proveedor || "Sin proveedor"}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-sm">{formatCurrency(factura.total)}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(factura.fecha)}</p>
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 pb-3">
              <div className="space-y-2 text-sm">
                {factura.cif && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">CIF:</span>
                    <span>{factura.cif}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal:</span>
                  <span>{formatCurrency(factura.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">IVA:</span>
                  <span>{formatCurrency(factura.iva)}</span>
                </div>
                {tieneProductos && (
                  <div className="mt-3 pt-3 border-t">
                    <p className="font-medium mb-2 flex items-center gap-1">
                      <Package className="h-3 w-3" />
                      Productos ({factura.productos.length})
                    </p>
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
          </CollapsibleContent>
        </Card>
      </Collapsible>
    );
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <TableRow className="cursor-pointer hover:bg-muted/50">
          <TableCell className="w-8">
            {tieneProductos ? (
              isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
            ) : null}
          </TableCell>
          <TableCell className="font-medium">{factura.numero_documento}</TableCell>
          <TableCell>{factura.proveedor || "-"}</TableCell>
          <TableCell className="hidden md:table-cell">{factura.cif || "-"}</TableCell>
          <TableCell>{formatDate(factura.fecha)}</TableCell>
          <TableCell className="hidden lg:table-cell text-right">
            {formatCurrency(factura.subtotal)}
          </TableCell>
          <TableCell className="hidden lg:table-cell text-right">
            {formatCurrency(factura.iva)}
          </TableCell>
          <TableCell className="text-right font-semibold">
            {formatCurrency(factura.total)}
          </TableCell>
          <TableCell className="text-center">
            {tieneProductos && (
              <Badge variant="secondary" className="text-xs">
                {factura.productos.length}
              </Badge>
            )}
          </TableCell>
        </TableRow>
      </CollapsibleTrigger>
      {tieneProductos && (
        <CollapsibleContent asChild>
          <TableRow className="bg-muted/30 hover:bg-muted/30">
            <TableCell colSpan={9} className="p-4">
              <div className="pl-6">
                <p className="font-medium text-sm mb-2 flex items-center gap-1">
                  <Package className="h-4 w-4" />
                  Productos
                </p>
                <div className="grid gap-1">
                  {factura.productos.map((p) => (
                    <div
                      key={p.id}
                      className="flex justify-between items-center text-sm py-1 border-b border-border/50 last:border-0"
                    >
                      <span>{p.producto_nombre}</span>
                      <span className="font-medium">{formatCurrency(p.precio)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </TableCell>
          </TableRow>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
};

export const TablaFacturas = () => {
  const { data: facturas, isLoading, error } = useFacturas();
  const [busqueda, setBusqueda] = useState("");
  const isMobile = useIsMobile();

  const facturasFiltradas = (facturas || []).filter((f) => {
    const termino = busqueda.toLowerCase();
    return (
      f.numero_documento.toLowerCase().includes(termino) ||
      (f.proveedor?.toLowerCase().includes(termino) ?? false) ||
      (f.cif?.toLowerCase().includes(termino) ?? false)
    );
  });

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-destructive">Error al cargar facturas: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por número, proveedor o CIF..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="pl-10"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : facturasFiltradas.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            {busqueda ? "No se encontraron facturas" : "No hay facturas registradas"}
          </CardContent>
        </Card>
      ) : isMobile ? (
        <div>
          {facturasFiltradas.map((factura) => (
            <FilaFactura key={factura.id} factura={factura} isMobile={true} />
          ))}
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Número</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead className="hidden md:table-cell">CIF</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead className="hidden lg:table-cell text-right">Subtotal</TableHead>
                <TableHead className="hidden lg:table-cell text-right">IVA</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-center">Items</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {facturasFiltradas.map((factura) => (
                <FilaFactura key={factura.id} factura={factura} isMobile={false} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-sm text-muted-foreground text-right">
        {facturasFiltradas.length} factura(s) encontrada(s)
      </p>
    </div>
  );
};
