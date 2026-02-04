import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Trash2, Star, Package, Pencil } from "lucide-react";
import { useBebidasVenta, BebidaVenta } from "@/hooks/useBebidasVenta";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Props {
  bebidas: BebidaVenta[];
  busqueda: string;
  categoriaFiltro: string;
  onEdit?: (bebida: BebidaVenta) => void;
}

export function ListaBebidasVenta({ bebidas, busqueda, categoriaFiltro, onEdit }: Props) {
  const { deleteBebida, toggleActivado, toggleFeatured } = useBebidasVenta();

  const filtradas = bebidas.filter((bebida) => {
    const matchBusqueda = !busqueda || 
      bebida.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
      bebida.descripcion?.toLowerCase().includes(busqueda.toLowerCase());
    const matchCategoria = !categoriaFiltro || bebida.categoria === categoriaFiltro;
    return matchBusqueda && matchCategoria;
  });

  const formatPrice = (price: number | null) => {
    if (price === null) return "-";
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(price);
  };

  if (filtradas.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No hay bebidas que coincidan con los filtros
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {filtradas.map((bebida) => (
        <Card key={bebida.id} className={`overflow-hidden ${!bebida.activado ? "opacity-60" : ""}`}>
          <div className="relative">
            {bebida.imagen_url ? (
              <img
                src={bebida.imagen_url}
                alt={bebida.nombre}
                className="w-full h-40 object-cover"
              />
            ) : (
              <div className="w-full h-40 bg-muted flex items-center justify-center">
                <Package className="h-12 w-12 text-muted-foreground" />
              </div>
            )}
            {bebida.featured && (
              <Badge className="absolute top-2 right-2 bg-amber-500 text-amber-50">
                <Star className="h-3 w-3 mr-1" />
                Destacado
              </Badge>
            )}
          </div>
          
          <CardContent className="p-4 space-y-3">
            <div>
              <h3 className="font-semibold text-lg line-clamp-1">{bebida.nombre}</h3>
              {bebida.categoria && (
                <Badge variant="secondary" className="mt-1">{bebida.categoria}</Badge>
              )}
            </div>

            {bebida.descripcion && (
              <p className="text-sm text-muted-foreground line-clamp-2">{bebida.descripcion}</p>
            )}

            {/* Precios y rentabilidad */}
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">P. Coste:</span>
                <span>{bebida.precio_coste != null ? formatPrice(bebida.precio_coste) : "-"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">P. Venta:</span>
                <span className="font-bold text-primary">{formatPrice(bebida.precio_eur)}</span>
              </div>
              {bebida.precio_coste != null && bebida.precio_eur != null && (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Ganancia:</span>
                    <span className="text-green-600 font-medium">
                      {formatPrice(bebida.precio_eur - bebida.precio_coste)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Rentabilidad:</span>
                    <span className="text-green-600 font-medium">
                      {bebida.precio_coste > 0 
                        ? `${(((bebida.precio_eur - bebida.precio_coste) / bebida.precio_coste) * 100).toFixed(1)}%`
                        : "-"}
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center justify-end">
              <span className="text-sm text-muted-foreground">Stock: {bebida.stock ?? 0}</span>
            </div>

            {(bebida.denominacion_origen || bebida.ubicacion_region) && (
              <div className="text-xs text-muted-foreground">
                {bebida.denominacion_origen && <span>{bebida.denominacion_origen}</span>}
                {bebida.denominacion_origen && bebida.ubicacion_region && " · "}
                {bebida.ubicacion_region && <span>{bebida.ubicacion_region}</span>}
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={bebida.activado ?? false}
                    onCheckedChange={(checked) => toggleActivado(bebida.id, checked)}
                  />
                  <span className="text-xs">Activo</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={bebida.featured ?? false}
                    onCheckedChange={(checked) => toggleFeatured(bebida.id, checked)}
                  />
                  <span className="text-xs">Destacar</span>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => onEdit?.(bebida)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Eliminar bebida?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Esta acción eliminará "{bebida.nombre}" permanentemente.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteBebida.mutate(bebida.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Eliminar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
