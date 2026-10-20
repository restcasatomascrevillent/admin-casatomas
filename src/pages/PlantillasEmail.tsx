import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { EditorPlantillasEmail } from "@/components/emails/EditorPlantillasEmail";

export default function PlantillasEmail() {
  return (
    <SuperAdminLayout>
      <div className="space-y-3">
        {/* Sin título "Plantillas de Correo" (2026-09-25): ya lo dice la pestaña activa del menú lateral. La ayuda
            (una restricción real: el diseño es fijo, solo se edita texto y marca) va en UNA línea. */}
        <p className="truncate text-sm text-muted-foreground" title="Asunto, saludo, cuerpo, botones, pie y colores de los 5 correos de reserva. El diseño del correo es fijo: aquí solo se edita el texto y la marca.">
          Asunto, saludo, cuerpo, botones, pie y colores de los 5 correos de reserva. El diseño es fijo: solo se edita texto y marca.
        </p>

        <EditorPlantillasEmail />
      </div>
    </SuperAdminLayout>
  );
}
