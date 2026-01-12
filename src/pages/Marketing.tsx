import { DashboardLayout } from "@/components/DashboardLayout";
import { GestionCorreos } from "@/components/marketing/GestionCorreos";

export default function Marketing() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Newsletter</h2>
          <p className="text-muted-foreground">
            Gestiona tus campañas de email
          </p>
        </div>

        <GestionCorreos />
      </div>
    </DashboardLayout>
  );
}
