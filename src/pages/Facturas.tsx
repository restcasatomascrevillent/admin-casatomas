import { useEffect, useRef, useState, useMemo } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { SubidaFacturas } from "@/components/facturas/SubidaFacturas";
import { ChatFacturas, ChatFacturasRef } from "@/components/facturas/ChatFacturas";
import { TabCompras } from "@/components/facturas/compras/TabCompras";
import { GastoIaPestana } from "@/components/facturas/GastoIaPestana";
import { MonitorGastoIA } from "@/components/facturas/MonitorGastoIA";
import { BotonAyuda } from "@/components/ayuda/BotonAyuda";
import { MODOS_COMPRAS, type ModoCompras } from "@/lib/facturas/compras";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { FileText, Upload, BarChart3, Package, Zap, ShoppingCart } from "lucide-react";
import { Factura, useFacturas, useAlbaranes } from "@/hooks/useFacturas";
import { useChatFacturas } from "@/hooks/useChatFacturas";
import type { Sugerencia } from "@/components/facturas/ChatFacturas";
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
  // `?tab=compras&modo=documentos&doc=<id>` (el «Ver» de Cargar) abre ESE documento.
  const modoPedido = useMemo(() => {
    const modoUrl = MODOS_COMPRAS.find((m) => m.valor === searchParams.get("modo"))?.valor;
    const docNum = Number(searchParams.get("doc"));
    const doc = Number.isInteger(docNum) && docNum > 0 ? docNum : undefined;
    const modo: ModoCompras | undefined = searchParams.get("tab") === "productos" ? "productos" : (modoUrl ?? (doc ? "documentos" : undefined));
    return modo ? { modo, clave: claveNavegacion, doc: modo === "documentos" ? doc : undefined } : undefined;
  }, [searchParams, claveNavegacion]);
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
      // El enlace profundo ya se aplicó: que no vuelva a abrir el documento al volver a Compras.
      p.delete("modo");
      p.delete("doc");
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
          {/* Botonera de navegación superior (pieza común PestanasPagina). El gasto del chatbot este mes va aparte,
              a la derecha, para que no parezca una pestaña más; abre su desglose al tocarlo. */}
          <PestanasPagina
            pestanas={[
              { valor: "compras", etiqueta: "Compras", icono: <ShoppingCart />, contador: totalDocumentos, tour: "facturas-pestana-compras" },
              { valor: "chat", etiqueta: "Análisis", icono: <BarChart3 />, contador: totalConversaciones, tonoContador: "dorado", tour: "facturas-pestana-ia" },
              { valor: "cargar", etiqueta: "Cargar", icono: <Upload />, contador: activosSubida, etiquetaContador: `${activosSubida} procesando`, contadorEnMovil: true, tour: "facturas-pestana-cargar" },
            ]}
            acciones={
              <>
                <GastoIaPestana className="ml-auto" />
                <BotonAyuda seccion="facturas" />
              </>
            }
          />

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
              <div className="mx-auto flex h-full max-w-3xl flex-col gap-1">
                {activeTab === "cargar" && (
                  <div className="min-w-0 max-w-full shrink-0 self-end" data-tour="facturas-coste-lectura">
                    <MonitorGastoIA modo="ocr" />
                  </div>
                )}
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
