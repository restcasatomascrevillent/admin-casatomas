import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreadorNewsletter } from "@/components/marketing/CreadorNewsletter";
import { GestionCorreos } from "@/components/marketing/GestionCorreos";
import { EstadisticasNewsletter } from "@/components/marketing/EstadisticasNewsletter";
import { Send, Users, BarChart3 } from "lucide-react";

export default function Marketing() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Sin título de página (2026-09-25): la pestaña "Newsletter" activa
            en el menú lateral ya dice dónde estás; el subtítulo era relleno. */}

        <Tabs defaultValue="crear" className="space-y-6">
          <TabsList>
            <TabsTrigger value="crear" className="gap-2">
              <Send className="h-4 w-4" />
              Enviar Newsletter
            </TabsTrigger>
            <TabsTrigger value="suscriptores" className="gap-2">
              <Users className="h-4 w-4" />
              Suscriptores
            </TabsTrigger>
            <TabsTrigger value="estadisticas" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              Estadísticas
            </TabsTrigger>
          </TabsList>

          <TabsContent value="crear">
            <CreadorNewsletter />
          </TabsContent>

          <TabsContent value="suscriptores">
            <GestionCorreos />
          </TabsContent>

          <TabsContent value="estadisticas">
            <EstadisticasNewsletter />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
