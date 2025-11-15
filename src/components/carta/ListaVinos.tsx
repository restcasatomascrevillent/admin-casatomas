import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Wine } from "lucide-react";
import { Vino, useVinos } from "@/hooks/useVinos";

interface ListaVinosProps {
  vinos: Vino[];
}

export function ListaVinos({ vinos }: ListaVinosProps) {
  const { toggleActivado } = useVinos();

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
        <Card key={vino.id} className={!vino.activado ? "opacity-60" : ""}>
          <CardContent className="p-4">
            {vino.imagen_url && (
              <div className="mb-3 rounded-md overflow-hidden">
                <img 
                  src={vino.imagen_url} 
                  alt={vino.nombre || "Vino"} 
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
                    {vino.nombre}
                  </h3>
                  {!vino.activado && (
                    <Badge variant="secondary" className="text-xs">
                      Inactivo
                    </Badge>
                  )}
                </div>
                
                {vino.descripcion && (
                  <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                    {vino.descripcion}
                  </p>
                )}

                {(vino.denominacion_origen || vino.ubicacion_region || vino.ubicacion_pais) && (
                  <p className="text-xs text-muted-foreground mb-2">
                    {[vino.denominacion_origen, vino.ubicacion_region, vino.ubicacion_pais]
                      .filter(Boolean)
                      .join(" • ")}
                  </p>
                )}

                <div className="flex items-center justify-between mt-3">
                  <span className="text-xl font-bold text-primary">
                    {vino.precio_eur ? `${vino.precio_eur.toFixed(2)}€` : "N/A"}
                  </span>

                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {vino.activado ? "Activo" : "Inactivo"}
                    </span>
                    <Switch
                      checked={vino.activado || false}
                      onCheckedChange={(checked) =>
                        toggleActivado.mutate({ id: vino.id, activado: checked })
                      }
                    />
                  </div>
                </div>

                {vino.alergenos_notas && (
                  <p className="text-xs text-muted-foreground mt-2 italic">
                    {vino.alergenos_notas}
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
