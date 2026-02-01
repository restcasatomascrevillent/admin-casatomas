import { DashboardLayout } from "@/components/DashboardLayout";
import { SubidaFacturas } from "@/components/facturas/SubidaFacturas";
import { ChatFacturas } from "@/components/facturas/ChatFacturas";
import { TablaFacturas } from "@/components/facturas/TablaFacturas";
import { TablaAlbaranes } from "@/components/facturas/TablaAlbaranes";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, FileText, ClipboardList, MessageSquare } from "lucide-react";

const Facturas = () => {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Facturas y Albaranes</h1>
          <p className="text-muted-foreground">
            Sube documentos, consulta información y gestiona tus facturas y albaranes
          </p>
        </div>

        <Tabs defaultValue="subir" className="space-y-4">
          <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid">
            <TabsTrigger value="subir" className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              <span className="hidden sm:inline">Subir</span>
            </TabsTrigger>
            <TabsTrigger value="facturas" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">Facturas</span>
            </TabsTrigger>
            <TabsTrigger value="albaranes" className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4" />
              <span className="hidden sm:inline">Albaranes</span>
            </TabsTrigger>
            <TabsTrigger value="chat" className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              <span className="hidden sm:inline">Chat</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="subir" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <SubidaFacturas />
              <ChatFacturas />
            </div>
          </TabsContent>

          <TabsContent value="facturas">
            <TablaFacturas />
          </TabsContent>

          <TabsContent value="albaranes">
            <TablaAlbaranes />
          </TabsContent>

          <TabsContent value="chat">
            <div className="max-w-2xl mx-auto">
              <ChatFacturas />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

export default Facturas;
