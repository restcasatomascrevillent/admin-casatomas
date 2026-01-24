import { Wine, Trash2, CheckCircle, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { useCocteles, Coctel } from "@/hooks/useCocteles";
import { cn } from "@/lib/utils";
import { VisibilidadToggles } from "./VisibilidadToggles";

interface ListaCoctelesProps {
  cocteles: Coctel[];
}

export function ListaCocteles({ cocteles }: ListaCoctelesProps) {
  const { toggleActivado, eliminarCoctel, toggleRestaurante, toggleTouza } = useCocteles();

  const handleToggle = (coctel: Coctel, checked: boolean) => {
    toggleActivado.mutate({ id: coctel.id, activado: checked });
  };

  if (cocteles.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Wine className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>No hay cócteles para mostrar</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {cocteles.map((coctel) => (
        <Card 
          key={coctel.id}
          className={cn(
            "overflow-hidden transition-opacity duration-300 hover:shadow-lg",
            !coctel.activado && "opacity-60"
          )}
        >
          {coctel.imagen_url && (
            <div className="aspect-video w-full overflow-hidden">
              <img
                src={coctel.imagen_url}
                alt={coctel.nombre || "Cóctel"}
                className="w-full h-full object-cover"
              />
            </div>
          )}
          
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <CardTitle className="text-lg truncate">{coctel.nombre}</CardTitle>
                {coctel.categoria && (
                  <Badge variant="secondary" className="mt-1">
                    {coctel.categoria}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {coctel.activado ? (
                  <CheckCircle className="h-4 w-4 text-primary" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                <Switch
                  checked={coctel.activado ?? false}
                  onCheckedChange={(checked) => handleToggle(coctel, checked)}
                />
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-3">
            {coctel.descripcion && (
              <p className="text-sm text-muted-foreground line-clamp-2">
                {coctel.descripcion}
              </p>
            )}

            {coctel.ingredientes && (
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">Ingredientes: </span>
                {coctel.ingredientes}
              </div>
            )}

            {/* Visibilidad Web */}
            <VisibilidadToggles
              restaurante={coctel.restaurante ?? false}
              touza={coctel.touza ?? false}
              onRestauranteChange={(checked) => toggleRestaurante.mutate({ id: coctel.id, restaurante: checked })}
              onTouzaChange={(checked) => toggleTouza.mutate({ id: coctel.id, touza: checked })}
              isPending={toggleRestaurante.isPending || toggleTouza.isPending}
              compact
            />

            <div className="flex items-center justify-between pt-2">
              <span className="text-lg font-bold text-primary">
                {coctel.precio_eur?.toFixed(2)} €
              </span>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>¿Eliminar cóctel?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esta acción no se puede deshacer. Se eliminará permanentemente "{coctel.nombre}".
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => eliminarCoctel.mutate(coctel.id)}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Eliminar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
