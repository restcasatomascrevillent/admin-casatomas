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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronRight, Search, FileText, Package, ExternalLink } from "lucide-react";
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
            {factura.drive_url && (
              <a
                href={factura.drive_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 mt-1"
              >
                <ExternalLink className="h-3 w-3" />
                Ver Doc
              </a>
            )}
          </div>
        </div>
      </CardHeader>
      {isOpen && (
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
      )}
    </Card>
  );
};

const FilaFacturaDesktop = ({ factura }: { factura: Factura }) => {
  const [isOpen, setIsOpen] = useState(false);
  const tieneProductos = factura.productos.length > 0;

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        onClick={() => tieneProductos && setIsOpen(!isOpen)}
      >
        <TableCell className="w-[40px]">
          {tieneProductos ? (
            isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
          ) : null}
        </TableCell>
        <TableCell className="w-[120px] font-medium">{factura.numero_documento}</TableCell>
        <TableCell className="w-[180px]">{factura.proveedor || "-"}</TableCell>
        <TableCell className="w-[110px] hidden md:table-cell">{factura.cif || "-"}</TableCell>
        <TableCell className="w-[100px]">{formatDate(factura.fecha)}</TableCell>
        <TableCell className="w-[100px] hidden lg:table-cell text-right">
          {formatCurrency(factura.subtotal)}
        </TableCell>
        <TableCell className="w-[90px] hidden lg:table-cell text-right">
          {formatCurrency(factura.iva)}
        </TableCell>
        <TableCell className="w-[100px] text-right font-semibold">
          {formatCurrency(factura.total)}
        </TableCell>
        <TableCell className="w-[60px] text-center">
          {tieneProductos && (
            <Badge variant="secondary" className="text-xs">
              {factura.productos.length}
            </Badge>
          )}
        </TableCell>
        <TableCell className="w-[80px] text-center">
          {factura.drive_url && (
            <a
              href={factura.drive_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm"
              title="Ver documento en Google Drive"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </TableCell>
      </TableRow>
      {isOpen && tieneProductos && (
        <TableRow className="bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={10} className="p-0">
            <div className="p-4 pl-10">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="h-8">Producto</TableHead>
                    <TableHead className="w-[120px] h-8 text-right">Precio</TableHead>
                    <TableHead className="w-[150px] h-8 text-right">Proveedor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {factura.productos.map((p) => (
                    <TableRow key={p.id} className="hover:bg-muted/10">
                      <TableCell className="py-2">{p.producto_nombre}</TableCell>
                      <TableCell className="py-2 text-right font-medium">{formatCurrency(p.precio)}</TableCell>
                      <TableCell className="py-2 text-right text-muted-foreground">{p.proveedor || "-"}</TableCell>
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

const FilaFactura = ({ factura, isMobile }: FilaFacturaProps) => {
  if (isMobile) {
    return <FilaFacturaMobile factura={factura} />;
  }
  return <FilaFacturaDesktop factura={factura} />;
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
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="w-[40px]"></TableHead>
                <TableHead className="w-[120px]">Número</TableHead>
                <TableHead className="w-[180px]">Proveedor</TableHead>
                <TableHead className="w-[110px] hidden md:table-cell">CIF</TableHead>
                <TableHead className="w-[100px]">Fecha</TableHead>
                <TableHead className="w-[100px] hidden lg:table-cell text-right">Subtotal</TableHead>
                <TableHead className="w-[90px] hidden lg:table-cell text-right">IVA</TableHead>
                <TableHead className="w-[100px] text-right">Total</TableHead>
                <TableHead className="w-[60px] text-center">Items</TableHead>
                <TableHead className="w-[80px] text-center">Doc</TableHead>
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
