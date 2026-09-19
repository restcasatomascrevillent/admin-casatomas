import { AlertTriangle, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EstadoErrorCargaProps {
  /** Qué no se ha podido cargar, en lenguaje del usuario. Ej: "las reservas de hoy". */
  titulo: string;
  error?: unknown;
  onReintentar?: () => void;
  className?: string;
}

const mensajeDeError = (error: unknown): string | null => {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
};

/**
 * Estado de error para widgets y listados.
 *
 * Existe para que un fallo de red o de permisos NO se pinte como un dato válido:
 * antes muchas consultas devolvían `[]` al fallar y la pantalla mostraba
 * "0 reservas · 0% de ocupación" en verde, como si el servicio estuviera vacío.
 */
export function EstadoErrorCarga({ titulo, error, onReintentar, className }: EstadoErrorCargaProps) {
  const detalle = mensajeDeError(error);

  return (
    <Card className={cn("border-destructive/40 bg-destructive/5", className)}>
      <CardContent className="p-4 sm:p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-full bg-destructive/10 shrink-0">
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </div>
          <div className="space-y-1">
            <p className="font-medium text-sm">No se han podido cargar {titulo}</p>
            <p className="text-xs text-muted-foreground">
              Los datos que ves pueden estar incompletos. No los tomes como buenos.
            </p>
            {detalle && (
              <p className="text-xs text-muted-foreground/80 break-words">{detalle}</p>
            )}
          </div>
        </div>
        {onReintentar && (
          <Button variant="outline" size="sm" className="gap-2" onClick={onReintentar}>
            <RefreshCw className="h-3.5 w-3.5" />
            Reintentar
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
