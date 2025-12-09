import { DashboardLayout } from "@/components/DashboardLayout";
import { SubidaFacturas } from "@/components/facturas/SubidaFacturas";

const Facturas = () => {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Facturas</h1>
          <p className="text-muted-foreground">
            Sube y envía tus facturas para procesamiento automático
          </p>
        </div>
        
        <SubidaFacturas />
      </div>
    </DashboardLayout>
  );
};

export default Facturas;
