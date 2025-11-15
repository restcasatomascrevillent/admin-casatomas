import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Wine } from "lucide-react";
import { Bebida, useBebidas } from "@/hooks/useBebidas";

interface ListaBebidasProps {
  bebidas: Bebida[];
}

export function ListaBebidas({ bebidas }: ListaBebidasProps) {
  const { toggleActivado } = useBebidas();

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
        <Card key={bebida.id} className={!bebida.activado ? "opacity-60" : ""}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-semibold text-lg truncate">
                    {bebida.nombre}
                  </h3>
                  {!bebida.activado && (
                    <Badge variant="secondary" className="text-xs">
                      Inactivo
                    </Badge>
                  )}
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

                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {bebida.activado ? "Activo" : "Inactivo"}
                    </span>
                    <Switch
                      checked={bebida.activado || false}
                      onCheckedChange={(checked) =>
                        toggleActivado.mutate({ id: bebida.id, activado: checked })
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
