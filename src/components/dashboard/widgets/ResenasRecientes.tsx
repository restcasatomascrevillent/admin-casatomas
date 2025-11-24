import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Star } from "lucide-react";
import { useResenasRecientes } from "@/hooks/useResenas";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export function ResenasRecientes() {
  const { data: resenas } = useResenasRecientes(5);

  const renderEstrellas = (valoracion: number) => {
    return (
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`h-3 w-3 ${
              star <= valoracion ? "fill-yellow-400 text-yellow-400" : "text-gray-300"
            }`}
          />
        ))}
      </div>
    );
  };

  return (
    <Card className="col-span-2">
      <CardHeader>
        <CardTitle className="text-base font-medium">Reseñas Recientes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {resenas && resenas.length > 0 ? (
          resenas.map((resena) => (
            <div key={resena.id} className="p-3 border border-border rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{resena.nombre_cliente}</span>
                {renderEstrellas(resena.valoracion)}
              </div>
              {resena.comentario && (
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {resena.comentario}
                </p>
              )}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{format(new Date(resena.fecha), "dd MMM yyyy", { locale: es })}</span>
                <span className="capitalize">{resena.fuente}</span>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center text-muted-foreground py-4">
            No hay reseñas disponibles
          </div>
        )}
      </CardContent>
    </Card>
  );
}
