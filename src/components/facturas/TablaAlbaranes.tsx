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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronDown, ChevronRight, Search, FileText, Package } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useIsMobile } from "@/hooks/use-mobile";

const formatCantidad = (cantidad: number | undefined): string => {
  if (cantidad === undefined || cantidad === null) return "-";
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(cantidad);
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

const FilaAlbaranMobile = ({ albaran }: { albaran: Factura }) => {
  const [isOpen, setIsOpen] = useState(false);
  const tieneProductos = albaran.productos.length > 0;

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
      {isOpen && (
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
                      <span className="font-medium">
                        {formatCantidad(p.cantidad)} {p.unidad || ""}
                      </span>
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

const FilaAlbaranDesktop = ({ albaran }: { albaran: Factura }) => {
  const [isOpen, setIsOpen] = useState(false);
  const tieneProductos = albaran.productos.length > 0;

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
        <TableCell className="w-[130px] font-mono text-sm">{albaran.numero_documento}</TableCell>
        <TableCell className="w-[180px] font-medium">{albaran.proveedor || "-"}</TableCell>
        <TableCell className="w-[100px] text-center">{formatDate(albaran.fecha)}</TableCell>
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
        <TableCell className="w-[60px] text-center">
          {tieneProductos ? (
            <Badge variant="secondary" className="text-xs">
              {albaran.productos.length}
            </Badge>
          ) : null}
        </TableCell>
      </TableRow>
      {isOpen && tieneProductos && (
        <TableRow className="bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={6} className="p-0">
            <div className="p-4 pl-10">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="h-8">Producto</TableHead>
                    <TableHead className="w-[100px] h-8 text-right">Cantidad</TableHead>
                    <TableHead className="w-[100px] h-8">Unidad</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {albaran.productos.map((p) => (
                    <TableRow key={p.id} className="hover:bg-muted/10">
                      <TableCell className="py-2">{p.producto_nombre}</TableCell>
                      <TableCell className="py-2 text-right font-medium">{formatCantidad(p.cantidad)}</TableCell>
                      <TableCell className="py-2 text-muted-foreground">{p.unidad || "-"}</TableCell>
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

interface FilaAlbaranProps {
  albaran: Factura;
  isMobile: boolean;
}

const FilaAlbaran = ({ albaran, isMobile }: FilaAlbaranProps) => {
  if (isMobile) {
    return <FilaAlbaranMobile albaran={albaran} />;
  }
  return <FilaAlbaranDesktop albaran={albaran} />;
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
      <div className="relative">
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
        <div className="rounded-md border">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="w-[40px]"></TableHead>
                <TableHead className="w-[130px]">Número</TableHead>
                <TableHead className="w-[180px]">Proveedor</TableHead>
                <TableHead className="w-[100px] text-center">Fecha</TableHead>
                <TableHead>Observaciones</TableHead>
                <TableHead className="w-[60px] text-center">Items</TableHead>
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

      <p className="text-sm text-muted-foreground text-right">
        {albaranesFiltrados.length} albarán(es) encontrado(s)
      </p>
    </div>
  );
};
