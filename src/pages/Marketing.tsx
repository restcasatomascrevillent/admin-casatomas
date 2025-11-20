import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GestionCorreos } from "@/components/marketing/GestionCorreos";
import { GestionRedesSociales } from "@/components/marketing/GestionRedesSociales";
import { EstadisticasMarketing } from "@/components/marketing/EstadisticasMarketing";
import { Mail, Share2, BarChart3 } from "lucide-react";

export default function Marketing() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Marketing</h2>
          <p className="text-muted-foreground">
            Gestiona tus campañas de email y redes sociales
          </p>
        </div>

        <Tabs defaultValue="correos" className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-3">
            <TabsTrigger value="correos" className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Correos
            </TabsTrigger>
            <TabsTrigger value="redes" className="flex items-center gap-2">
              <Share2 className="h-4 w-4" />
              Redes Sociales
            </TabsTrigger>
            <TabsTrigger value="estadisticas" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Estadísticas
            </TabsTrigger>
          </TabsList>

          <TabsContent value="correos" className="space-y-4">
            <GestionCorreos />
          </TabsContent>

          <TabsContent value="redes" className="space-y-4">
            <GestionRedesSociales />
          </TabsContent>

          <TabsContent value="estadisticas" className="space-y-4">
            <EstadisticasMarketing />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
