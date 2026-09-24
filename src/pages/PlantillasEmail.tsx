import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { Mail } from "lucide-react";
import { EditorPlantillasEmail } from "@/components/emails/EditorPlantillasEmail";

export default function PlantillasEmail() {
  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <div>
          <h2 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <Mail className="h-7 w-7" />
            Plantillas de Correo
          </h2>
          <p className="text-muted-foreground">
            Asunto, saludo, cuerpo, botones, pie y colores de los 5 correos de reserva. El diseño del correo es
            fijo — aquí solo se edita el texto y la marca.
          </p>
        </div>

        <EditorPlantillasEmail />
      </div>
    </SuperAdminLayout>
  );
}
