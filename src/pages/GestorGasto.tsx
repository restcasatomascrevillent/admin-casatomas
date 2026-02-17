import { DashboardLayout } from "@/components/DashboardLayout";
import { GestorGasto as GestorGastoWidget } from "@/components/dashboard/widgets/GestorGasto";

export default function GestorGasto() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Gestor de Gasto</h1>
          <p className="text-muted-foreground">Previsualización de tu facturación con OficiososIA</p>
        </div>
        <GestorGastoWidget />
      </div>
    </DashboardLayout>
  );
}
