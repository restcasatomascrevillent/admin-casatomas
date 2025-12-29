import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { ChefHat, Maximize2 } from "lucide-react";
import { Plato, usePlatos } from "@/hooks/usePlatos";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ListaPlatosProps {
  platos: Plato[];
}

export function ListaPlatos({ platos }: ListaPlatosProps) {
  const { toggleActivado, toggleExpanded } = usePlatos();

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

  const handleToggleExpanded = (plato: Plato, checked: boolean) => {
    toggleExpanded.mutate(
      { id: plato.id, expanded: checked },
      {
        onSuccess: () => {
          toast.success(
            checked 
              ? `${plato.nombre} se mostrará expandido` 
              : `${plato.nombre} se mostrará normal`
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
            No hay platos en esta categoría. Haz clic en "Añadir" para comenzar.
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
          className={cn(
            "overflow-hidden transition-all duration-300",
            !plato.activado 
              ? "opacity-60 bg-muted/30" 
              : "hover:shadow-lg"
          )}
        >
          {plato.imagen_url && (
            <div className="relative h-40 bg-muted">
              <img 
                src={plato.imagen_url} 
                alt={plato.nombre || "Plato"} 
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            </div>
          )}
          
          <CardContent className="p-4 space-y-3">
            {/* Header con nombre y toggle expandido */}
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-semibold text-base leading-tight flex-1 min-w-0">
                {plato.nombre}
              </h3>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={cn(
                  "text-xs font-medium",
                  plato.expanded ? "text-blue-600" : "text-muted-foreground"
                )}>
                  {plato.expanded ? "Expandido" : "Normal"}
                </span>
                <Switch
                  checked={plato.expanded || false}
                  onCheckedChange={(checked) => handleToggleExpanded(plato, checked)}
                  disabled={toggleExpanded.isPending}
                  className="data-[state=checked]:bg-blue-600"
                />
              </div>
            </div>

            {/* Toggle Activo */}
            <div className={cn(
              "flex items-center justify-between py-2 px-3 rounded-md",
              plato.activado ? "bg-green-100 dark:bg-green-950/30" : "bg-red-100 dark:bg-red-950/30"
            )}>
              <div className="flex items-center gap-2">
                <ChefHat className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Activo</span>
              </div>
              <Switch
                checked={plato.activado || false}
                onCheckedChange={(checked) => handleToggle(plato, checked)}
                disabled={toggleActivado.isPending}
                className="data-[state=checked]:bg-green-600"
              />
            </div>
            
            {plato.descripcion && (
              <p className="text-sm text-muted-foreground line-clamp-2">
                {plato.descripcion}
              </p>
            )}

            {/* Precio y unidad */}
            <div className="flex items-end justify-between pt-2 border-t">
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-primary">
                  {plato.precio_eur ? `${plato.precio_eur.toFixed(2)}` : "—"}
                </span>
                <span className="text-lg font-medium text-primary">€</span>
              </div>
              {plato.unidad && (
                <span className="text-xs text-muted-foreground">
                  por {plato.unidad}
                </span>
              )}
            </div>

            {plato.alergenos_notas && (
              <p className="text-xs text-muted-foreground italic pt-2 border-t">
                {plato.alergenos_notas}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
