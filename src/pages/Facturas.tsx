import { useEffect, useRef, useState, useMemo } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { SubidaFacturas } from "@/components/facturas/SubidaFacturas";
import { ChatFacturas, ChatFacturasRef } from "@/components/facturas/ChatFacturas";
import { TablaFacturas } from "@/components/facturas/TablaFacturas";
import { TablaAlbaranes } from "@/components/facturas/TablaAlbaranes";
import { TabProductos } from "@/components/facturas/productos/TabProductos";
import { MonitorGastoIA } from "@/components/facturas/MonitorGastoIA";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, ClipboardList, MessageSquare, Upload, FolderOpen, BarChart3, Package, Zap, Tags } from "lucide-react";
import { Factura, useFacturas, useAlbaranes } from "@/hooks/useFacturas";
import { useChatFacturas } from "@/hooks/useChatFacturas";
import type { Sugerencia } from "@/components/facturas/ChatArea";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useColaSubidaOpcional } from "@/hooks/useColaSubida";
import { ALTURA_MINIMA_FACTURAS } from "@/lib/facturas/alturaCargar";

const PESTANAS = ["documentos", "productos", "chat", "cargar"] as const;
const pestanaDeUrl = (v: string | null) => (PESTANAS as readonly string[]).includes(v ?? "") ? (v as string) : null;

const Facturas = () => {
  const chatRef = useRef<ChatFacturasRef>(null);
  // `?tab=cargar`: el indicador global de subidas, los toasts y la campana
  // llevan directos a la pestaña «Cargar», también si ya estabas en Facturas.
  const [searchParams, setSearchParams] = useSearchParams();
  const { key: claveNavegacion } = useLocation();
  const tabUrl = pestanaDeUrl(searchParams.get("tab"));
  const [activeTab, setActiveTab] = useState<string>(tabUrl ?? "documentos");
  useEffect(() => {
    if (tabUrl) setActiveTab(tabUrl);
    // `claveNavegacion`: volver a tocar el indicador estando ya en esta URL
    // (pero en otra pestaña) también vuelve a «Cargar».
  }, [tabUrl, claveNavegacion]);
  // La pestaña va también a la URL (sin apilar historial): así la cola sabe si
  // estás mirando «Cargar» y no apunta en la campana lo que ya ves.
  const cambiarPestana = (v: string) => {
    setActiveTab(v);
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("tab", v);
      return p;
    }, { replace: true });
  };
  const subidas = useColaSubidaOpcional();
  const activosSubida = subidas?.activos ?? 0;
  // Alto de la pantalla, calculado solo (como Calendario y Newsletter): la
  // página ocupa justo lo visible y cada pestaña reparte ese alto por dentro.
  // Sin medida (jsdom, primer pintado) cae al `calc(100dvh-6rem)` de siempre.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_FACTURAS);
  const topTabClass =
    "flex min-h-11 items-center gap-1 sm:gap-2 rounded-md px-1.5 sm:px-3 transition-colors hover:bg-background/70 hover:text-foreground data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary";
  const docsTabClass =
    "relative h-11 rounded-none border-b-2 border-transparent bg-transparent px-3 sm:px-4 pb-2 sm:pb-3 pt-2 font-semibold text-xs sm:text-sm text-muted-foreground shadow-none transition-colors hover:bg-muted/30 hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none whitespace-nowrap";

  // Contadores para los badges de las pestañas
  const { data: facturas } = useFacturas();
  const { data: albaranes } = useAlbaranes();
  const { conversaciones } = useChatFacturas();
  const totalDocumentos = (facturas?.length ?? 0) + (albaranes?.length ?? 0);
  const totalConversaciones = conversaciones.length;

  // ─── Sugerencias dinámicas basadas en datos reales ─────────────────────────
  const sugerenciasDinamicas = useMemo((): Sugerencia[] => {
    const mesActual = new Date().toLocaleString("es-ES", { month: "long" });
    const mesCapitalizado = mesActual.charAt(0).toUpperCase() + mesActual.slice(1);

    // Proveedor más reciente de facturas
    const proveedorReciente = facturas?.find((f) => f.proveedor)?.proveedor ?? null;
    // Proveedor más reciente de albaranes
    const proveedorAlbaran = albaranes?.find((a) => a.proveedor)?.proveedor ?? null;

    const sugerencias: Sugerencia[] = [
      {
        icon: BarChart3,
        texto: `¿Cuánto hemos gastado en ${mesCapitalizado}?`,
      },
      {
        icon: FileText,
        texto: proveedorReciente
          ? `Muéstrame todas las facturas de ${proveedorReciente}`
          : "¿Cuáles son las últimas facturas recibidas?",
      },
      {
        icon: Package,
        texto: proveedorAlbaran
          ? `¿Qué albaranes de ${proveedorAlbaran} hay esta semana?`
          : "Resume los albaranes de esta semana",
      },
      {
        icon: Zap,
        texto: `¿Qué productos hemos comprado más veces este mes?`,
      },
    ];
    return sugerencias;
  }, [facturas, albaranes]);

  const handlePreguntarIA = (doc: Factura, tipo: 'factura' | 'albarán') => {
    // 1. Cambiamos a la pestaña del chat
    cambiarPestana("chat");

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
      <div
        ref={setRaiz}
        className={`flex flex-col space-y-2 sm:space-y-4 ${alto ? "" : "h-[calc(100vh-6rem)] supports-[height:100dvh]:h-[calc(100dvh-6rem)]"}`}
        style={alto ? { height: alto } : undefined}
      >

        <Tabs
          value={activeTab}
          onValueChange={cambiarPestana}
          className="flex-1 flex flex-col min-h-0"
        >
          {/* Botonera de navegación superior */}
          <div className="shrink-0 mb-2 sm:mb-4 bg-card rounded-lg border border-border/50 shadow-sm p-1 w-full sm:inline-block sm:max-w-3xl">
            <TabsList className="grid w-full grid-cols-4 bg-muted/40 h-11 sm:h-12">
              <TabsTrigger
                value="documentos"
                className={topTabClass}
              >
                <FolderOpen className="h-4 w-4 shrink-0" />
                <span className="font-medium text-xs sm:text-[15px] truncate">Documentos</span>
                {totalDocumentos > 0 && (
                  <span className="hidden sm:inline ml-1 rounded-full bg-primary/10 text-primary text-[11px] font-semibold px-1.5 py-0.5 leading-none">
                    {totalDocumentos}
                  </span>
                )}
              </TabsTrigger>
              {/* Productos (07-oct-2026): catálogo con categorías, gasto y correcciones. */}
              <TabsTrigger
                value="productos"
                className={topTabClass}
              >
                <Tags className="h-4 w-4 shrink-0" />
                <span className="font-medium text-xs sm:text-[15px] truncate">Productos</span>
              </TabsTrigger>
              <TabsTrigger
                value="chat"
                className={topTabClass}
              >
                <MessageSquare className="h-4 w-4 shrink-0" />
                <span className="font-medium text-xs sm:text-[15px] truncate">IA</span>
                {totalConversaciones > 0 && (
                  <span className="hidden sm:inline ml-1 rounded-full bg-[hsl(38,59%,45%)/0.12] text-[hsl(38,59%,45%)] text-[11px] font-semibold px-1.5 py-0.5 leading-none">
                    {totalConversaciones}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="cargar"
                className={topTabClass}
              >
                <Upload className="h-4 w-4 shrink-0" />
                <span className="font-medium text-xs sm:text-[15px] truncate">Cargar</span>
                {activosSubida > 0 && (
                  <span
                    className="ml-1 rounded-full bg-primary/10 text-primary text-[11px] font-semibold px-1.5 py-0.5 leading-none tabular-nums"
                    aria-label={`${activosSubida} procesando`}
                  >
                    {activosSubida}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Área de Visualización */}
          <div className="flex-1 min-h-0 relative">

            {/* PESTAÑA 1: DOCUMENTOS */}
            <TabsContent value="documentos" className="h-full m-0 outline-none flex flex-col data-[state=inactive]:hidden">
              <div className="flex-1 bg-card rounded-xl border border-border/50 shadow-sm flex flex-col min-h-0 overflow-hidden">
                {/* `min-h-0` imprescindible: sin él este flex item no puede ser más
                    bajo que su contenido, crece hasta el alto de TODAS las filas y la
                    tarjeta (`overflow-hidden`) lo recorta — el listado de abajo nunca
                    llega a desbordar y no hay scroll (2026-10-04). */}
                <Tabs defaultValue="facturas" className="w-full flex-1 flex flex-col min-h-0">
                  <div className="shrink-0 px-2 sm:px-4 pt-2 sm:pt-4 pb-0 bg-muted/5 border-b border-border/30">
                    <TabsList className="flex h-11 w-full justify-start rounded-none bg-transparent p-0 overflow-x-auto no-scrollbar">
                      <TabsTrigger
                        value="facturas"
                        className={docsTabClass}
                      >
                        <FileText className="mr-1.5 sm:mr-2 h-3.5 sm:h-4 w-3.5 sm:w-4" />
                        Facturas
                      </TabsTrigger>
                      <TabsTrigger
                        value="albaranes"
                        className={docsTabClass}
                      >
                        <ClipboardList className="mr-1.5 sm:mr-2 h-3.5 sm:h-4 w-3.5 sm:w-4" />
                        Albaranes
                      </TabsTrigger>
                    </TabsList>
                  </div>

                  <div className="flex-1 p-2 sm:p-4 md:p-6 bg-background flex flex-col min-h-0 overflow-hidden">
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

            {/* PESTAÑA PRODUCTOS: catálogo y categorías. Ocupa el alto de la
                pestaña; solo su lista hace scroll por dentro. */}
            <TabsContent value="productos" className="h-full m-0 outline-none data-[state=inactive]:hidden">
              {activeTab === "productos" && <TabProductos />}
            </TabsContent>

            {/* PESTAÑA 2: ASISTENTE IA */}
            {/* Monitor de gasto (08-oct-2026): una línea fija arriba; el
                desglose flota, así que la pestaña sigue sin scroll de página. */}
            <TabsContent value="chat" className="h-full m-0 outline-none flex-col gap-2 data-[state=inactive]:hidden data-[state=active]:flex">
              {activeTab === "chat" && <MonitorGastoIA modo="chat" className="shrink-0" />}
              <div className="flex-1 min-h-0 max-h-none rounded-xl overflow-hidden shadow-md">
                <ChatFacturas ref={chatRef} sugerencias={sugerenciasDinamicas} />
              </div>
            </TabsContent>

            {/* PESTAÑA 3: CARGAR DATOS */}
            {/* Sin scroll de página (petición del dueño, 05-oct-2026): la tarjeta
                ocupa el alto de la pestaña y solo su lista hace scroll por dentro
                (ver lib/facturas/alturaCargar.ts). */}
            <TabsContent value="cargar" className="h-full m-0 outline-none data-[state=inactive]:hidden">
              <div className="mx-auto flex h-full max-w-4xl flex-col gap-2">
                {activeTab === "cargar" && <MonitorGastoIA modo="ocr" className="shrink-0" />}
                <div className="flex-1 min-h-0">
                  <SubidaFacturas />
                </div>
              </div>
            </TabsContent>

          </div>
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

export default Facturas;
