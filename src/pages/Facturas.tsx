import { useRef, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { SubidaFacturas } from "@/components/facturas/SubidaFacturas";
import { ChatFacturas, ChatFacturasRef } from "@/components/facturas/ChatFacturas";
import { TablaFacturas } from "@/components/facturas/TablaFacturas";
import { TablaAlbaranes } from "@/components/facturas/TablaAlbaranes";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, ClipboardList, MessageSquare, Upload, FolderOpen } from "lucide-react";
import { Factura } from "@/hooks/useFacturas";

const Facturas = () => {
  const chatRef = useRef<ChatFacturasRef>(null);
  const [activeTab, setActiveTab] = useState<string>("documentos");

  const handlePreguntarIA = (doc: Factura, tipo: 'factura' | 'albarán') => {
    // 1. Cambiamos a la pestaña del chat
    setActiveTab("chat");

    // 2. Construir el prompt natural
    const provTexto = doc.proveedor ? `del proveedor ${doc.proveedor}` : "sin proveedor especificado";
    const prompt = `Hola, quiero hacerte una consulta sobre el ${tipo} número ${doc.numero_documento} ${provTexto}.`;

    // 3. Forzar scroll al top de la página de forma fluida
    window.scrollTo({ top: 0, behavior: "smooth" });

    // 4. Enviar consulta al chat (con setTimeout mínimo para darle tiempo a montar el DOM si estaba oculto)
    setTimeout(() => {
      if (chatRef.current) {
        chatRef.current.enviarConsulta(prompt);
      }
    }, 100);
  };

  return (
    <DashboardLayout>
      {/* Contenedor Flex para que crezca y ocupe toda la altura de la página si es necesario */}
      <div className="flex flex-col h-[calc(100vh-6rem)] space-y-4">

        {/* Sistema Principal de Pestañas */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 flex flex-col min-h-0"
        >
          {/* Botonera de navegación superior */}
          <div className="shrink-0 mb-4 bg-card rounded-lg border border-border/50 shadow-sm p-1 inline-block w-full max-w-3xl">
            <TabsList className="grid w-full grid-cols-3 bg-muted/40 h-11">
              <TabsTrigger
                value="documentos"
                className="flex items-center gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary transition-all rounded-md"
              >
                <FolderOpen className="h-[18px] w-[18px]" />
                <span className="font-medium text-[15px]">Ver Documentos</span>
              </TabsTrigger>
              <TabsTrigger
                value="chat"
                className="flex items-center gap-2 data-[state=active]:bg-[hsl(38,59%,45%)/0.08] data-[state=active]:text-[hsl(38,65%,40%)] data-[state=active]:shadow-sm transition-all rounded-md"
              >
                <MessageSquare className="h-[18px] w-[18px]" />
                <span className="font-medium text-[15px]">Asistente IA</span>
              </TabsTrigger>
              <TabsTrigger
                value="cargar"
                className="flex items-center gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary transition-all rounded-md"
              >
                <Upload className="h-[18px] w-[18px]" />
                <span className="font-medium text-[15px]">Cargar Datos</span>
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Área de Visualización (crece llenando el hueco restante) */}
          <div className="flex-1 min-h-0 relative">

            {/* PESTAÑA 1: DOCUMENTOS (Contiene mini-tabs de Facturas/Albaranes) */}
            <TabsContent value="documentos" className="h-full m-0 outline-none flex flex-col data-[state=inactive]:hidden">
              <div className="flex-1 bg-card rounded-xl border border-border/50 shadow-sm overflow-hidden flex flex-col">
                <Tabs defaultValue="facturas" className="w-full flex-1 flex flex-col">
                  {/* Punteros secundarios */}
                  <div className="shrink-0 px-4 pt-4 pb-0 bg-muted/5 border-b border-border/30">
                    <TabsList className="flex h-10 w-full justify-start rounded-none bg-transparent p-0">
                      <TabsTrigger
                        value="facturas"
                        className="relative h-10 rounded-none border-b-2 border-transparent bg-transparent px-4 pb-3 pt-2 font-semibold text-muted-foreground shadow-none transition-none data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
                      >
                        <FileText className="mr-2 h-4 w-4" />
                        Listado de Facturas
                      </TabsTrigger>
                      <TabsTrigger
                        value="albaranes"
                        className="relative h-10 rounded-none border-b-2 border-transparent bg-transparent px-4 pb-3 pt-2 font-semibold text-muted-foreground shadow-none transition-none data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
                      >
                        <ClipboardList className="mr-2 h-4 w-4" />
                        Listado de Albaranes
                      </TabsTrigger>
                    </TabsList>
                  </div>

                  {/* Vistas Listas */}
                  <div className="flex-1 overflow-hidden p-4 md:p-6 bg-background flex flex-col min-h-0">
                    <TabsContent value="facturas" className="m-0 h-full flex-col min-h-0 focus-visible:outline-none data-[state=inactive]:hidden data-[state=active]:flex">
                      <TablaFacturas onPreguntarIA={(doc) => handlePreguntarIA(doc, 'factura')} />
                    </TabsContent>

                    <TabsContent value="albaranes" className="m-0 h-full flex-col min-h-0 focus-visible:outline-none data-[state=inactive]:hidden data-[state=active]:flex">
                      <TablaAlbaranes onPreguntarIA={(doc) => handlePreguntarIA(doc, 'albarán')} />
                    </TabsContent>
                  </div>
                </Tabs>
              </div>
            </TabsContent>

            {/* PESTAÑA 2: ASISTENTE IA (Ocupa el 100% de la zona) */}
            <TabsContent value="chat" className="h-full m-0 outline-none data-[state=inactive]:hidden">
              {/* Le pasamos un wrapper para que el ChatFacturas pueda extenderse hasta el final sin restricciones de la Card */}
              <div className="h-full max-h-none rounded-xl overflow-hidden shadow-md">
                <ChatFacturas ref={chatRef} />
              </div>
            </TabsContent>

            {/* PESTAÑA 3: CARGAR DATOS */}
            <TabsContent value="cargar" className="h-full m-0 outline-none data-[state=inactive]:hidden overflow-y-auto">
              {/* Centramos visualmente la subida en pantallas grandes para que respire */}
              <div className="max-w-4xl mx-auto rounded-xl overflow-hidden border border-border/50 shadow-sm bg-card mt-2">
                <SubidaFacturas />
              </div>
            </TabsContent>

          </div>
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

export default Facturas;
