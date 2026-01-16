import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreadorNewsletter } from "@/components/marketing/CreadorNewsletter";
import { GestionCorreos } from "@/components/marketing/GestionCorreos";
import { Send, Users } from "lucide-react";

export default function Marketing() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Newsletter</h2>
          <p className="text-muted-foreground">
            Envía comunicaciones a tus clientes
          </p>
        </div>

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
          </TabsList>

          <TabsContent value="crear">
            <CreadorNewsletter />
          </TabsContent>

          <TabsContent value="suscriptores">
            <GestionCorreos />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
