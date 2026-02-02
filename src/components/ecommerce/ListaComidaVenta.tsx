import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Trash2, Star, Package, Pencil } from "lucide-react";
import { useComidaVenta, ComidaVenta } from "@/hooks/useComidaVenta";
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
  comidas: ComidaVenta[];
  busqueda: string;
  categoriaFiltro: string;
  onEdit?: (comida: ComidaVenta) => void;
}

export function ListaComidaVenta({ comidas, busqueda, categoriaFiltro, onEdit }: Props) {
  const { deleteComida, toggleActivado, toggleFeatured } = useComidaVenta();

  const filtradas = comidas.filter((comida) => {
    const matchBusqueda = !busqueda || 
      comida.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
      comida.descripcion?.toLowerCase().includes(busqueda.toLowerCase());
    const matchCategoria = !categoriaFiltro || comida.categoria === categoriaFiltro;
    return matchBusqueda && matchCategoria;
  });

  const formatPrice = (price: number | null) => {
    if (price === null) return "-";
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(price);
  };

  if (filtradas.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No hay productos que coincidan con los filtros
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {filtradas.map((comida) => (
        <Card key={comida.id} className={`overflow-hidden ${!comida.activado ? "opacity-60" : ""}`}>
          <div className="relative">
            {comida.imagen_url ? (
              <img
                src={comida.imagen_url}
                alt={comida.nombre}
                className="w-full h-40 object-cover"
              />
            ) : (
              <div className="w-full h-40 bg-muted flex items-center justify-center">
                <Package className="h-12 w-12 text-muted-foreground" />
              </div>
            )}
            {comida.featured && (
              <Badge className="absolute top-2 right-2 bg-amber-500 text-amber-50">
                <Star className="h-3 w-3 mr-1" />
                Destacado
              </Badge>
            )}
          </div>
          
          <CardContent className="p-4 space-y-3">
            <div>
              <h3 className="font-semibold text-lg line-clamp-1">{comida.nombre}</h3>
              <div className="flex gap-2 mt-1">
                {comida.categoria && (
                  <Badge variant="secondary">{comida.categoria}</Badge>
                )}
                {comida.peso && (
                  <Badge variant="outline">{comida.peso}</Badge>
                )}
              </div>
            </div>

            {comida.descripcion && (
              <p className="text-sm text-muted-foreground line-clamp-2">{comida.descripcion}</p>
            )}

            <div className="flex items-center justify-between">
              <span className="text-xl font-bold text-primary">{formatPrice(comida.precio_eur)}</span>
              <span className="text-sm text-muted-foreground">Stock: {comida.stock ?? 0}</span>
            </div>

            {comida.origen && (
              <div className="text-xs text-muted-foreground">
                Origen: {comida.origen}
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={comida.activado ?? false}
                    onCheckedChange={(checked) => toggleActivado(comida.id, checked)}
                  />
                  <span className="text-xs">Activo</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={comida.featured ?? false}
                    onCheckedChange={(checked) => toggleFeatured(comida.id, checked)}
                  />
                  <span className="text-xs">Destacar</span>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => onEdit?.(comida)}
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
                      <AlertDialogTitle>¿Eliminar producto?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Esta acción eliminará "{comida.nombre}" permanentemente.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteComida.mutate(comida.id)}
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
