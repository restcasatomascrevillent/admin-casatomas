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
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {filtradas.map((comida) => {
        const ganancia = comida.precio_coste != null && comida.precio_eur != null 
          ? comida.precio_eur - comida.precio_coste 
          : null;
        const rentabilidad = comida.precio_coste != null && comida.precio_coste > 0 && ganancia != null
          ? ((ganancia / comida.precio_coste) * 100)
          : null;

        return (
          <Card key={comida.id} className={`group overflow-hidden transition-all duration-200 hover:shadow-lg hover:border-primary/30 ${!comida.activado ? "opacity-50 grayscale" : ""}`}>
            <div className="relative aspect-[4/3] overflow-hidden bg-muted">
              {comida.imagen_url ? (
                <img
                  src={comida.imagen_url}
                  alt={comida.nombre}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Package className="h-16 w-16 text-muted-foreground/40" />
                </div>
              )}
              {comida.featured && (
                <Badge className="absolute top-2 right-2 bg-amber-500/90 text-white shadow-md">
                  <Star className="h-3 w-3 mr-1 fill-current" />
                  Destacado
                </Badge>
              )}
              {!comida.activado && (
                <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                  <Badge variant="secondary">Desactivado</Badge>
                </div>
              )}
            </div>
            
            <CardContent className="p-4 space-y-3">
              <div>
                <h3 className="font-semibold text-base line-clamp-1">{comida.nombre}</h3>
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  {comida.categoria && (
                    <Badge variant="outline" className="text-xs">{comida.categoria}</Badge>
                  )}
                  {comida.peso && (
                    <Badge variant="secondary" className="text-xs">{comida.peso}</Badge>
                  )}
                </div>
              </div>

              {comida.descripcion && (
                <p className="text-xs text-muted-foreground line-clamp-2">{comida.descripcion}</p>
              )}

              {/* Precios y rentabilidad */}
              <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Coste</span>
                  <span className="font-medium">{comida.precio_coste != null ? formatPrice(comida.precio_coste) : "-"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-sm">Venta</span>
                  <span className="font-bold text-lg text-primary">{formatPrice(comida.precio_eur)}</span>
                </div>
                {ganancia != null && (
                  <div className="pt-2 border-t border-border/50 grid grid-cols-2 gap-2">
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">Ganancia</p>
                      <p className="font-semibold text-green-600">{formatPrice(ganancia)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">Rentabilidad</p>
                      <p className="font-semibold text-blue-600">{rentabilidad != null ? `${rentabilidad.toFixed(0)}%` : "-"}</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Stock</span>
                <Badge variant={comida.stock && comida.stock > 5 ? "secondary" : "destructive"} className="font-mono">
                  {comida.stock ?? 0} uds
                </Badge>
              </div>

              {comida.origen && (
                <p className="text-xs text-muted-foreground truncate">
                  Origen: {comida.origen}
                </p>
              )}

              <div className="flex items-center justify-between pt-3 border-t">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <Switch
                      checked={comida.activado ?? false}
                      onCheckedChange={(checked) => toggleActivado(comida.id, checked)}
                      className="scale-90"
                    />
                    <span className="text-xs text-muted-foreground">Activo</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Switch
                      checked={comida.featured ?? false}
                      onCheckedChange={(checked) => toggleFeatured(comida.id, checked)}
                      className="scale-90"
                    />
                    <span className="text-xs text-muted-foreground">★</span>
                  </div>
                </div>

                <div className="flex items-center gap-0.5">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => onEdit?.(comida)}
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
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
        );
      })}
    </div>
  );
}
