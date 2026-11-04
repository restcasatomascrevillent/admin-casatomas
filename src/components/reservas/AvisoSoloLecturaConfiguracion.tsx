import { Lock } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useCanAccessSection } from "@/hooks/useUserRole";

/**
 * «Solo lectura» de Reservas › Configuración: sale cuando el usuario tiene «Ver» pero no «Puede editar» en
 * «Reservas · Configuración», y no pinta nada si puede editar (ni mientras se leen los permisos).
 *
 * Hasta el 04/11/2026 lo ponía ConfiguracionTurnos, encima de todo lo que era el chip «General». Al
 * repartir ese chip en cuatro (petición del dueño: «el scroll es eterno») cada uno tiene que decirlo, así
 * que lo pone la página encima de cada chip. «Plantillas email» lleva el suyo propio.
 */
export function AvisoSoloLecturaConfiguracion() {
  const { canAccess: puedeEditar, loading } = useCanAccessSection("reservas_configuracion", "edit");
  // Mientras se leen los permisos, nada: si no, el aviso parpadea a quien sí puede editar.
  if (puedeEditar || loading) return null;
  return (
    <Alert>
      <Lock className="h-4 w-4" />
      <AlertTitle>Solo lectura</AlertTitle>
      <AlertDescription>
        Puedes ver la configuración de reservas, pero tu usuario no tiene «Puede editar» en «Reservas ·
        Configuración»: aquí no se pueden guardar cambios.
      </AlertDescription>
    </Alert>
  );
}
