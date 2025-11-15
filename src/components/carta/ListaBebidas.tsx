import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Wine, CheckCircle2, XCircle } from "lucide-react";
import { Bebida, useBebidas } from "@/hooks/useBebidas";
import { toast } from "sonner";

interface ListaBebidasProps {
  bebidas: Bebida[];
}

export function ListaBebidas({ bebidas }: ListaBebidasProps) {
  const { toggleActivado } = useBebidas();

  const handleToggle = (bebida: Bebida, checked: boolean) => {
    toggleActivado.mutate(
      { id: bebida.id, activado: checked },
      {
        onSuccess: () => {
          toast.success(
            checked 
              ? `${bebida.nombre} está ahora activo` 
              : `${bebida.nombre} está ahora inactivo`
          );
        },
      }
    );
  };

  if (bebidas.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 border-2 border-dashed rounded-lg">
        <div className="text-center">
          <Wine className="mx-auto h-12 w-12 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">
            No hay bebidas en esta categoría. Haz clic en "Añadir" para comenzar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {bebidas.map((bebida) => (
        <Card 
          key={bebida.id} 
          className={`relative transition-all duration-500 ease-in-out ${
            !bebida.activado 
              ? "opacity-60 bg-muted/50 scale-[0.98]" 
              : "hover:shadow-md hover:scale-[1.02]"
          }`}
        >
          <CardContent className="p-4">
            {/* Toggle en la esquina superior derecha */}
            <div className="absolute top-3 right-3 z-10 flex items-center gap-2 bg-background/95 backdrop-blur-sm rounded-full px-3 py-1.5 shadow-sm border transition-all duration-300 hover:shadow-md">
              {bebida.activado ? (
                <CheckCircle2 className="h-4 w-4 text-green-600 animate-scale-in" />
              ) : (
                <XCircle className="h-4 w-4 text-muted-foreground animate-scale-in" />
              )}
              <Switch
                checked={bebida.activado || false}
                onCheckedChange={(checked) => handleToggle(bebida, checked)}
                disabled={toggleActivado.isPending}
              />
            </div>

            {bebida.imagen_url && (
              <div className="mb-3 rounded-md overflow-hidden">
                <img 
                  src={bebida.imagen_url} 
                  alt={bebida.nombre || "Bebida"} 
                  className="w-full h-48 object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
            )}
            
            <div className="pr-12">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="font-semibold text-lg truncate">
                  {bebida.nombre}
                </h3>
              </div>
              
              {bebida.descripcion && (
                <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                  {bebida.descripcion}
                </p>
              )}

              <div className="flex items-center justify-between mt-3">
                <div className="flex flex-col gap-1">
                  <span className="text-xl font-bold text-primary">
                    {bebida.precio_eur ? `${bebida.precio_eur.toFixed(2)}€` : "N/A"}
                  </span>
                  {bebida.tamano && (
                    <span className="text-xs text-muted-foreground">
                      {bebida.tamano}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
