import { DashboardLayout } from "@/components/DashboardLayout";
import { FormularioSugerencias } from "@/components/gestion-web/FormularioSugerencias";

export default function GestionWeb() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Soporte y Sugerencias</h2>
          <p className="text-muted-foreground">
            Envía sugerencias, reporta errores o solicita nuevas funcionalidades
          </p>
        </div>
        
        <FormularioSugerencias />
      </div>
    </DashboardLayout>
  );
}
