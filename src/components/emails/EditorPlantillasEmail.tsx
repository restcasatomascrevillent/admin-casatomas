// ============================================================================
// EditorPlantillasEmail — la pantalla que junta el editor de plantillas de
// correo de reserva: pestañas por tipo (los de TIPOS_PLANTILLA) y, dentro
// de cada una, PlantillaTipoEditor (formulario + vista previa + historial +
// envío de prueba).
//
// Vive en Reservas › Configuración › «Plantillas email» desde el 04/11/2026
// (petición del dueño; antes era una página del Super Admin,
// /super-admin/plantillas-email, que ahora redirige allí).
//
// Lo único que vive aquí (y no en PlantillaTipoEditor) es lo común a todas
// las pestañas: el permiso de EDICIÓN de la sección 'reservas' y el email del
// usuario logueado, que se usa como destinatario por defecto del envío de
// prueba. Se calculan una sola vez aquí y se pasan hacia abajo, en vez de que
// cada pestaña vuelva a pedir permisos al cambiar de tipo.
//
// El permiso es `useCanAccessSection("reservas", "edit")`: la MISMA regla que
// `can_write_section('reservas')` del backend (super admin, o «Puede editar»
// en Reservas), que exigen la RLS de plantillas_email_reserva,
// fn_restaurar_version_plantilla y POST /emails-reserva/enviar-prueba (ver
// 20260920010000_sistema_emails_reserva.sql). Ser «admin» no basta: hasta el
// 04/11/2026 aquí se aceptaba también `isAdmin`, y a un admin sin «Puede
// editar» en Reservas le ofrecía guardar cambios que la base de datos
// rechazaba. Leerlas basta con «Ver» Reservas (la misma RLS), que es lo que
// ya exige entrar en /reservas.
// ============================================================================
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Lock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { TIPOS_PLANTILLA } from "@/hooks/usePlantillasEmail";
import { ETIQUETA_TIPO } from "./catalogoTokens";
import { PlantillaTipoEditor } from "./PlantillaTipoEditor";

/** Ayuda de UNA línea (una restricción real: el diseño es fijo, solo se edita texto y marca). */
const AYUDA = `Asunto, saludo, cuerpo, botones, pie y colores de los ${TIPOS_PLANTILLA.length} correos de reserva. El diseño es fijo: solo se edita texto y marca.`;

export function EditorPlantillasEmail() {
  const { user } = useAuth();
  const { canAccess: puedeEditar, loading } = useCanAccessSection("reservas", "edit");

  if (loading) {
    return <div className="p-4 text-sm text-muted-foreground">Comprobando permisos...</div>;
  }

  return (
    <div className="space-y-3">
      {/* Sin título: ya lo dicen la pestaña «Configuración» y el chip «Plantillas email». El texto completo,
          en el tooltip. */}
      <p className="truncate text-sm text-muted-foreground" title={AYUDA}>
        {AYUDA}
      </p>

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
        <PestanasPagina pestanas={TIPOS_PLANTILLA.map((tipo) => ({ valor: tipo, etiqueta: ETIQUETA_TIPO[tipo] }))} />
        {TIPOS_PLANTILLA.map((tipo) => (
          <TabsContent key={tipo} value={tipo} className="mt-3">
            <PlantillaTipoEditor tipo={tipo} puedeEditar={puedeEditar} emailUsuario={user?.email ?? ""} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
