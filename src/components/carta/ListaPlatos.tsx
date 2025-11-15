import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ChefHat } from "lucide-react";
import { Plato, usePlatos } from "@/hooks/usePlatos";

interface ListaPlatosProps {
  platos: Plato[];
}

export function ListaPlatos({ platos }: ListaPlatosProps) {
  const { toggleActivado } = usePlatos();

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
        <Card key={plato.id} className={!plato.activado ? "opacity-60" : ""}>
          <CardContent className="p-4">
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
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-semibold text-lg truncate">
                    {plato.nombre}
                  </h3>
                  {!plato.activado && (
                    <Badge variant="secondary" className="text-xs">
                      Inactivo
                    </Badge>
                  )}
                </div>
                
                {plato.descripcion && (
                  <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                    {plato.descripcion}
                  </p>
                )}

                <div className="flex items-center justify-between mt-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-xl font-bold text-primary">
                      {plato.precio_eur ? `${plato.precio_eur.toFixed(2)}€` : "N/A"}
                    </span>
                    {plato.unidad && (
                      <span className="text-xs text-muted-foreground">
                        por {plato.unidad}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {plato.activado ? "Activo" : "Inactivo"}
                    </span>
                    <Switch
                      checked={plato.activado || false}
                      onCheckedChange={(checked) =>
                        toggleActivado.mutate({ id: plato.id, activado: checked })
                      }
                    />
                  </div>
                </div>

                {plato.alergenos_notas && (
                  <p className="text-xs text-muted-foreground mt-2 italic">
                    {plato.alergenos_notas}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
