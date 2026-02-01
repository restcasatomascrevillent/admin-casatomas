import { DashboardLayout } from "@/components/DashboardLayout";
import { SubidaFacturas } from "@/components/facturas/SubidaFacturas";
import { ChatFacturas } from "@/components/facturas/ChatFacturas";

const Facturas = () => {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Facturas</h1>
          <p className="text-muted-foreground">
            Sube facturas y albaranes, y consulta información con el asistente
          </p>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SubidaFacturas />
          <ChatFacturas />
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Facturas;
