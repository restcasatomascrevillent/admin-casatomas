import { useEffect, useRef, useState, useMemo } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { SubidaFacturas } from "@/components/facturas/SubidaFacturas";
import { ChatFacturas, ChatFacturasRef } from "@/components/facturas/ChatFacturas";
import { TabCompras } from "@/components/facturas/compras/TabCompras";
import { GastoIaPestana } from "@/components/facturas/GastoIaPestana";
import { MonitorGastoIA } from "@/components/facturas/MonitorGastoIA";
import type { ModoCompras } from "@/lib/facturas/compras";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, MessageSquare, Upload, BarChart3, Package, Zap, ShoppingCart } from "lucide-react";
import { Factura, useFacturas, useAlbaranes } from "@/hooks/useFacturas";
import { useChatFacturas } from "@/hooks/useChatFacturas";
import type { Sugerencia } from "@/components/facturas/ChatArea";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useColaSubidaOpcional } from "@/hooks/useColaSubida";
import { ALTURA_MINIMA_FACTURAS } from "@/lib/facturas/alturaCargar";

// Rediseño del 08/10/2026: Compras | IA | Cargar. «Documentos» y «Productos»
// (las pestañas de antes) son ahora modos de Compras; sus enlaces antiguos
// (`?tab=productos` de la campana, marcadores) siguen funcionando.
const PESTANAS = ["compras", "chat", "cargar"] as const;
const pestanaDeUrl = (v: string | null): string | null => {
  if (v === "documentos" || v === "productos") return "compras";
  return (PESTANAS as readonly string[]).includes(v ?? "") ? (v as string) : null;
};

const Facturas = () => {
  const chatRef = useRef<ChatFacturasRef>(null);
  // `?tab=cargar`: el indicador global de subidas, los toasts y la campana
  // llevan directos a la pestaña «Cargar», también si ya estabas en Facturas.
  const [searchParams, setSearchParams] = useSearchParams();
  const { key: claveNavegacion } = useLocation();
  const tabUrl = pestanaDeUrl(searchParams.get("tab"));
  const [activeTab, setActiveTab] = useState<string>(tabUrl ?? "compras");
  // `?tab=productos` (la campana, marcadores antiguos) abre Compras en el modo Productos.
  const modoPedido = useMemo(
    () => (searchParams.get("tab") === "productos" ? { modo: "productos" as ModoCompras, clave: claveNavegacion } : undefined),
    [searchParams, claveNavegacion],
  );
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
    "flex h-10 items-center gap-1 sm:gap-2 rounded-none border-b-2 border-transparent bg-transparent px-2 sm:px-3 text-muted-foreground shadow-none transition-colors hover:text-foreground pointer-coarse:min-h-11 data-[state=active]:border-[hsl(38,59%,45%)] data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none";

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
          <div className="mb-2 w-full shrink-0 border-b border-border/60">
            <TabsList className="-mb-px flex h-auto w-full justify-start gap-0 rounded-none bg-transparent p-0 sm:w-auto sm:gap-1 pointer-coarse:min-h-11">
              <TabsTrigger value="compras" className={`${topTabClass} flex-1 sm:flex-none`}>
                <ShoppingCart className="h-4 w-4 shrink-0" />
                <span className="font-medium text-xs sm:text-[15px] truncate">Compras</span>
                {totalDocumentos > 0 && (
                  <span className="hidden sm:inline ml-1 rounded-full bg-primary/10 text-primary text-[11px] font-semibold px-1.5 py-0.5 leading-none">
                    {totalDocumentos}
                  </span>
                )}
              </TabsTrigger>
              {/* IA + lo gastado este mes (texto pequeño que abre el desglose). */}
              <div className="flex min-w-0 flex-1 items-center sm:flex-none">
                <TabsTrigger value="chat" className={`${topTabClass} min-w-0 flex-1 sm:flex-none`}>
                  <MessageSquare className="h-4 w-4 shrink-0" />
                  <span className="font-medium text-xs sm:text-[15px] truncate">IA</span>
                  {totalConversaciones > 0 && (
                    <span className="hidden sm:inline ml-1 rounded-full bg-[hsl(38,59%,45%)/0.12] text-[hsl(38,59%,45%)] text-[11px] font-semibold px-1.5 py-0.5 leading-none">
                      {totalConversaciones}
                    </span>
                  )}
                </TabsTrigger>
                <GastoIaPestana />
              </div>
              <TabsTrigger value="cargar" className={`${topTabClass} flex-1 sm:flex-none`}>
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

            {/* PESTAÑA COMPRAS: un buscador, Documentos · Productos · Proveedores,
                lista compacta y ficha. Ocupa el alto de la pestaña; solo la lista
                y la ficha hacen scroll por dentro. */}
            {/* `forceMount`: seguir montada al ir a «IA» desde una ficha, para
                encontrar al volver la misma búsqueda y la misma ficha abierta. */}
            <TabsContent value="compras" forceMount className="h-full m-0 outline-none data-[state=inactive]:hidden">
              <TabCompras onPreguntarIA={handlePreguntarIA} modoPedido={modoPedido} />
            </TabsContent>

            {/* PESTAÑA IA: el gasto de IA ya no ocupa una línea aquí; va junto a la
                pestaña (GastoIaPestana). */}
            <TabsContent value="chat" className="h-full m-0 outline-none data-[state=inactive]:hidden">
              <div className="h-full min-h-0 overflow-hidden">
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
