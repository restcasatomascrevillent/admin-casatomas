import { Clock } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  MENSAJE_SESION_CADUCADA,
  useAvisoSesionCaducada,
} from "@/lib/aviso-sesion";

/**
 * Aviso en la pantalla de entrada cuando el panel vuelve al login porque la
 * sesión ha caducado. El texto se parte en líneas: se lee entero a 390 px.
 */
export function AvisoSesionCaducada() {
  const caducada = useAvisoSesionCaducada();
  if (!caducada) return null;
  return (
    <Alert role="alert" className="mb-4 border-amber-500/50 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100 [&>svg]:text-amber-600">
      <Clock className="h-4 w-4" />
      <AlertDescription className="whitespace-normal break-words">
        {MENSAJE_SESION_CADUCADA}
      </AlertDescription>
    </Alert>
  );
}
