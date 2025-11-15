import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ChefHat, CheckCircle2, XCircle } from "lucide-react";
import { Plato, usePlatos } from "@/hooks/usePlatos";
import { toast } from "sonner";

interface ListaPlatosProps {
  platos: Plato[];
}

export function ListaPlatos({ platos }: ListaPlatosProps) {
  const { toggleActivado } = usePlatos();

  const handleToggle = (plato: Plato, checked: boolean) => {
    toggleActivado.mutate(
      { id: plato.id, activado: checked },
      {
        onSuccess: () => {
          toast.success(
            checked 
              ? `${plato.nombre} está ahora activo` 
              : `${plato.nombre} está ahora inactivo`
          );
        },
      }
    );
  };

  if (platos.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 border-2 border-dashed rounded-lg">
        <div className="text-center">
          <ChefHat className="mx-auto h-12 w-12 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">
            No hay platos en esta categoría. Haz clic en "Añadir Plato" para comenzar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {platos.map((plato) => (
        <Card 
          key={plato.id} 
          className={`relative transition-all duration-500 ease-in-out ${
            !plato.activado 
              ? "opacity-60 bg-muted/50 scale-[0.98]" 
              : "hover:shadow-md hover:scale-[1.02]"
          }`}
        >
          <CardContent className="p-4">
            {/* Toggle en la esquina superior derecha */}
            <div className="absolute top-3 right-3 z-10 flex items-center gap-2 bg-background/95 backdrop-blur-sm rounded-full px-3 py-1.5 shadow-sm border transition-all duration-300 hover:shadow-md">
              {plato.activado ? (
                <CheckCircle2 className="h-4 w-4 text-green-600 animate-scale-in" />
              ) : (
                <XCircle className="h-4 w-4 text-muted-foreground animate-scale-in" />
              )}
              <Switch
                checked={plato.activado || false}
                onCheckedChange={(checked) => handleToggle(plato, checked)}
                disabled={toggleActivado.isPending}
              />
            </div>

            {plato.imagen_url && (
              <div className="mb-3 rounded-md overflow-hidden">
                <img 
                  src={plato.imagen_url} 
                  alt={plato.nombre || "Plato"} 
                  className="w-full h-48 object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
            )}
            
            <div className="space-y-3">
              <div className="pr-20">
                <h3 className="font-semibold text-lg leading-tight line-clamp-2 break-words">
                  {plato.nombre}
                </h3>
              </div>
              
              {plato.descripcion && (
                <p className="text-sm text-muted-foreground line-clamp-2 break-words">
                  {plato.descripcion}
                </p>
              )}

              <div className="flex items-end justify-between gap-3">
                <div className="flex flex-col gap-1 min-w-0">
                  <span className="text-xl font-bold text-primary">
                    {plato.precio_eur ? `${plato.precio_eur.toFixed(2)}€` : "N/A"}
                  </span>
                  {plato.unidad && (
                    <span className="text-xs text-muted-foreground truncate">
                      por {plato.unidad}
                    </span>
                  )}
                </div>
              </div>

              {plato.alergenos_notas && (
                <p className="text-xs text-muted-foreground italic line-clamp-2 break-words pt-2 border-t">
                  {plato.alergenos_notas}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
