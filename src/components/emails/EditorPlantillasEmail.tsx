// ============================================================================
// EditorPlantillasEmail — la pantalla que junta el editor de plantillas de
// correo de reserva: pestañas por tipo (los 5 de TIPOS_PLANTILLA) y, dentro
// de cada una, PlantillaTipoEditor (formulario + vista previa + historial +
// envío de prueba).
//
// Lo único que vive aquí (y no en PlantillaTipoEditor) es lo común a las 5
// pestañas: el permiso de la sección 'reservas' — el MISMO que exige el
// backend (RLS de plantillas_email_reserva y el chequeo `can_write_section`
// dentro de fn_restaurar_version_plantilla, ver la migración) — y el email
// del usuario logueado, que se usa como destinatario por defecto del envío
// de prueba. Se calculan una sola vez aquí y se pasan hacia abajo, en vez de
// que cada pestaña vuelva a pedir permisos al cambiar de tipo.
// ============================================================================
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Lock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { TIPOS_PLANTILLA } from "@/hooks/usePlantillasEmail";
import { ETIQUETA_TIPO } from "./catalogoTokens";
import { PlantillaTipoEditor } from "./PlantillaTipoEditor";

export function EditorPlantillasEmail() {
  const { user } = useAuth();
  const { isAdmin, permissions, loading } = useUserRole();

  if (loading) {
    return <div className="p-4 text-sm text-muted-foreground">Comprobando permisos...</div>;
  }

  const permisoReservas = permissions.find((p) => p.section_key === "reservas");
  const puedeEditar = isAdmin || permisoReservas?.can_edit === true;

  return (
    <div className="space-y-4">
      {!puedeEditar && (
        <Alert>
          <Lock className="h-4 w-4" />
          <AlertTitle>Solo lectura</AlertTitle>
          <AlertDescription>
            Puedes ver las plantillas de correo, pero tu usuario no tiene permiso de edición en Reservas: esta
            pantalla no te ofrece guardar cambios, restaurar versiones ni enviar pruebas.
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue={TIPOS_PLANTILLA[0]}>
        <TabsList className="h-auto flex-wrap justify-start gap-1">
          {TIPOS_PLANTILLA.map((tipo) => (
            <TabsTrigger key={tipo} value={tipo}>
              {ETIQUETA_TIPO[tipo]}
            </TabsTrigger>
          ))}
        </TabsList>
        {TIPOS_PLANTILLA.map((tipo) => (
          <TabsContent key={tipo} value={tipo} className="mt-4">
            <PlantillaTipoEditor tipo={tipo} puedeEditar={puedeEditar} emailUsuario={user?.email ?? ""} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
