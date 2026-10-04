import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreadorNewsletter } from "@/components/marketing/CreadorNewsletter";
import { GestionCorreos } from "@/components/marketing/GestionCorreos";
import { EstadisticasNewsletter } from "@/components/marketing/EstadisticasNewsletter";
import { HistorialEnvios } from "@/components/marketing/HistorialEnvios";
import { Send, Users, BarChart3 } from "lucide-react";

export default function Marketing() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Sin título de página (2026-09-25): la pestaña "Newsletter" activa
            en el menú lateral ya dice dónde estás; el subtítulo era relleno. */}

        <Tabs defaultValue="crear" className="space-y-6">
          <TabsList className="h-auto flex-wrap justify-start">
            <TabsTrigger value="crear" className="min-h-11 gap-2 px-4">
              <Send className="h-4 w-4" />
              Enviar Newsletter
            </TabsTrigger>
            <TabsTrigger value="suscriptores" className="min-h-11 gap-2 px-4">
              <Users className="h-4 w-4" />
              Suscriptores
            </TabsTrigger>
            <TabsTrigger value="estadisticas" className="min-h-11 gap-2 px-4">
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

          <TabsContent value="estadisticas" className="space-y-6">
            <EstadisticasNewsletter />
            <HistorialEnvios />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
