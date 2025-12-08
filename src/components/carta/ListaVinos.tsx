import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Wine } from "lucide-react";
import { Vino, useVinos } from "@/hooks/useVinos";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ListaVinosProps {
  vinos: Vino[];
}

export function ListaVinos({ vinos }: ListaVinosProps) {
  const { toggleActivado } = useVinos();

  const handleToggle = (vino: Vino, checked: boolean) => {
    toggleActivado.mutate(
      { id: vino.id, activado: checked },
      {
        onSuccess: () => {
          toast.success(
            checked 
              ? `${vino.nombre} está ahora activo` 
              : `${vino.nombre} está ahora inactivo`
          );
        },
      }
    );
  };

  if (vinos.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 border-2 border-dashed rounded-lg">
        <div className="text-center">
          <Wine className="mx-auto h-12 w-12 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">
            No hay vinos en esta categoría. Haz clic en "Añadir" para comenzar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {vinos.map((vino) => (
        <Card 
          key={vino.id} 
          className={cn(
            "overflow-hidden transition-all duration-300",
            !vino.activado 
              ? "opacity-60 bg-muted/30" 
              : "hover:shadow-lg"
          )}
        >
          {vino.imagen_url && (
            <div className="relative h-40 bg-muted">
              <img 
                src={vino.imagen_url} 
                alt={vino.nombre || "Vino"} 
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            </div>
          )}
          
          <CardContent className="p-4 space-y-3">
            {/* Header con nombre y toggle */}
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-semibold text-base leading-tight flex-1 min-w-0">
                {vino.nombre}
              </h3>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={cn(
                  "text-xs font-medium",
                  vino.activado ? "text-green-600" : "text-muted-foreground"
                )}>
                  {vino.activado ? "Activo" : "Inactivo"}
                </span>
                <Switch
                  checked={vino.activado || false}
                  onCheckedChange={(checked) => handleToggle(vino, checked)}
                  disabled={toggleActivado.isPending}
                  className="data-[state=checked]:bg-green-600"
                />
              </div>
            </div>
            
            {vino.descripcion && (
              <p className="text-sm text-muted-foreground line-clamp-2">
                {vino.descripcion}
              </p>
            )}

            {/* Origen */}
            {(vino.denominacion_origen || vino.ubicacion_region || vino.ubicacion_pais) && (
              <p className="text-xs text-muted-foreground">
                {[vino.denominacion_origen, vino.ubicacion_region, vino.ubicacion_pais]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}

            {/* Precio */}
            <div className="flex items-end justify-between pt-2 border-t">
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-primary">
                  {vino.precio_eur ? `${vino.precio_eur.toFixed(2)}` : "—"}
                </span>
                <span className="text-lg font-medium text-primary">€</span>
              </div>
            </div>

            {vino.alergenos_notas && (
              <p className="text-xs text-muted-foreground italic pt-2 border-t">
                {vino.alergenos_notas}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
