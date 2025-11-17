import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SubidaImagenes } from "@/components/gestion-web/SubidaImagenes";
import { FormularioSugerencias } from "@/components/gestion-web/FormularioSugerencias";

export default function GestionWeb() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Gestión Web</h2>
          <p className="text-muted-foreground">
            Gestiona las imágenes de tu web y envía sugerencias al soporte
          </p>
        </div>

        <SubidaImagenes />
        
        <FormularioSugerencias />
      </div>
    </DashboardLayout>
  );
}
