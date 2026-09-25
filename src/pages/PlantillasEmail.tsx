import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { EditorPlantillasEmail } from "@/components/emails/EditorPlantillasEmail";

export default function PlantillasEmail() {
  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        {/* Sin título "Plantillas de Correo" (2026-09-25): ya lo dice la
            pestaña activa del menú lateral. Se conserva el subtítulo: no es
            relleno, explica una restricción real (el diseño es fijo, solo se
            edita texto y marca) que nadie adivinaría por el nombre. */}
        <p className="text-muted-foreground">
          Asunto, saludo, cuerpo, botones, pie y colores de los 5 correos de reserva. El diseño del correo es
          fijo — aquí solo se edita el texto y la marca.
        </p>

        <EditorPlantillasEmail />
      </div>
    </SuperAdminLayout>
  );
}
