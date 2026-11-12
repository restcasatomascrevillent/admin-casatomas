import { useEffect, useRef, useState, useMemo } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { SubidaFacturas } from "@/components/facturas/SubidaFacturas";
import { ChatFacturas, ChatFacturasRef } from "@/components/facturas/ChatFacturas";
import { TabCompras } from "@/components/facturas/compras/TabCompras";
import { GastoIaPestana } from "@/components/facturas/GastoIaPestana";
import { MonitorGastoIA } from "@/components/facturas/MonitorGastoIA";
import { BotonAyuda } from "@/components/ayuda/BotonAyuda";
import { BotonAvisosSeccion } from "@/components/avisos/BotonAvisosSeccion";
import { MODOS_COMPRAS, PARAMS_ENLACE_COMPRAS, esNavegacionDeFicha, type ModoCompras } from "@/lib/facturas/compras";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { Upload, BarChart3, ShoppingCart, History, Percent } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImportacionHistoricaDialog } from "@/components/facturas/ImportacionHistoricaDialog";
import { useUserRole } from "@/hooks/useUserRole";
import { usePermisosFacturas } from "@/hooks/usePermisosFacturas";
import { pestanaPermitida, pestanasFacturas, type PestanaFacturas } from "@/lib/facturas/permisos";
import { EtiquetaSoloLectura } from "@/components/panel/EtiquetaSoloLectura";
import type { Factura } from "@/hooks/useFacturas";
import { useContadorDocumentos } from "@/hooks/useContadorDocumentos";
import { leerEnlaceCompras } from "@/lib/facturas/tableroCompras";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useColaSubidaOpcional } from "@/hooks/useColaSubida";
import { ALTURA_MINIMA_FACTURAS } from "@/lib/facturas/alturaCargar";
import { esRutaIaCompleta } from "@/lib/facturas/copilotoCompleto";
import { MargenesCarta } from "@/components/analisis/margenes/MargenesCarta";
import { leerArticuloEnlace } from "@/lib/dashboard/margenesDashboard";
import { cn } from "@/lib/utils";

// Rediseño del 08/10/2026: «Documentos» y «Productos» (las pestañas de antes) son
// ahora modos de Compras; sus enlaces antiguos (`?tab=productos` de la campana,
// marcadores) siguen funcionando. Desde el 05/11/2026 (petición del dueño) el orden
// es Análisis · Compras · Cargar y se entra en Análisis (valor `chat`). Desde el 10/11/2026
// (petición del dueño) «Márgenes» va detrás de Análisis: antes era la sección «Análisis
// general» del menú (/analisis, que ahora lleva a `?tab=margenes`).
const PESTANAS = ["chat", "margenes", "compras", "cargar"] as const;
/** Pestaña al entrar en /facturas sin `?tab=`. */
const PESTANA_INICIAL = "chat";
const pestanaDeUrl = (v: string | null): PestanaFacturas | null => {
  if (v === "documentos" || v === "productos") return "compras";
  return (PESTANAS as readonly string[]).includes(v ?? "") ? (v as PestanaFacturas) : null;
};
// Permisos (06/11/2026, dueño; ver lib/facturas/permisos.ts): «Ver» consulta Análisis y
// Compras; «Facturas · Subida», la pestaña Cargar (con solo Subida, es la única y los
// enlaces a Análisis o Compras llevan a ella); «Editar», todo (la IA solo con «Editar»).
// Lo que no se puede usar se OCULTA y arriba sale «Solo lectura».

const Facturas = () => {
  const chatRef = useRef<ChatFacturasRef>(null);
  const permisos = usePermisosFacturas();
  const visibles = pestanasFacturas(permisos);
  // `?tab=cargar`: el indicador global de subidas, los toasts y la campana
  // llevan directos a la pestaña «Cargar», también si ya estabas en Facturas.
  const [searchParams, setSearchParams] = useSearchParams();
  const { key: claveNavegacion, state: estadoNavegacion, pathname } = useLocation();
  // `/facturas/ia` (06/11/2026): «Pregúntale a la IA» a pantalla completa. Es esta
  // misma página (no se desmonta al ir y volver): sin pestañas y con Análisis delante.
  const pantallaIa = esRutaIaCompleta(pathname);
  // Abrir o cerrar una ficha de Compras es una entrada del historial (`?doc=` /
  // `?producto=` con la pila en el `state`, QA 05/11/2026 C-12): no es un enlace
  // nuevo, así que no se vuelve a aplicar como `modoPedido`.
  const esFichaCompras = esNavegacionDeFicha(estadoNavegacion);
  const ultimoModoPedido = useRef<{ modo: ModoCompras; clave: string; doc?: number; mes?: string; prov?: number } | undefined>(undefined);
  // Sin `?tab=` pero con un enlace a Compras (`?modo=`, `?doc=`, `?mes=`, `?prov=`…), Compras; si no, Análisis.
  // También al volver con «Atrás» a una URL sin `?tab=` (QA 05/11/2026: se quedaba en Compras).
  const tabPedida: PestanaFacturas = pantallaIa
    ? "chat"
    : pestanaDeUrl(searchParams.get("tab")) ?? (PARAMS_ENLACE_COMPRAS.some((k) => searchParams.has(k)) ? "compras" : PESTANA_INICIAL);
  // La pedida si se puede ver; si no, la primera que sí (solo Subida: Cargar).
  const tabUrl: string = pestanaPermitida(tabPedida, permisos) ?? PESTANA_INICIAL;
  const [activeTab, setActiveTab] = useState<string>(tabUrl);
  // `?tab=productos` (la campana, marcadores antiguos) abre Compras en el modo Productos.
  // `?tab=compras&modo=documentos&doc=<id>` (el «Ver» de Cargar) abre ESE documento.
  // Desde Análisis: `&mes=YYYY-MM` (Documentos de ese mes) y `&prov=<id>` (ese proveedor desplegado).
  const modoPedido = useMemo(() => {
    if (esFichaCompras) return ultimoModoPedido.current;
    const modoUrl = MODOS_COMPRAS.find((m) => m.valor === searchParams.get("modo"))?.valor;
    const docNum = Number(searchParams.get("doc"));
    const doc = Number.isInteger(docNum) && docNum > 0 ? docNum : undefined;
    const { mes, prov, local } = leerEnlaceCompras(searchParams);
    const modo: ModoCompras | undefined =
      searchParams.get("tab") === "productos" ? "productos" : (modoUrl ?? (doc || mes ? "documentos" : prov ? "proveedores" : undefined));
    return modo
      ? {
          modo,
          clave: claveNavegacion,
          doc: modo === "documentos" ? doc : undefined,
          mes: modo === "documentos" ? mes : undefined,
          prov: modo === "proveedores" ? prov : undefined,
          // El local de Análisis (un mes de Touza abre Compras en Touza cuando Compras lo lea).
          local,
        }
      : undefined;
  }, [searchParams, claveNavegacion, esFichaCompras]);
  useEffect(() => {
    ultimoModoPedido.current = modoPedido;
  }, [modoPedido]);
  useEffect(() => {
    setActiveTab(tabUrl);
    // `claveNavegacion`: volver a tocar el indicador estando ya en esta URL
    // (pero en otra pestaña) también vuelve a «Cargar».
  }, [tabUrl, claveNavegacion]);
  // Un enlace a una pestaña que no puede ver (solo Subida y `?tab=compras&doc=7`):
  // la URL pasa a la que se ve, sin apilar historial (la cola sabe así que está en Cargar).
  useEffect(() => {
    if (permisos.cargando || pantallaIa || tabUrl === tabPedida || searchParams.get("tab") === tabUrl) return;
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("tab", tabUrl);
      for (const k of PARAMS_ENLACE_COMPRAS) p.delete(k);
      return p;
    }, { replace: true });
  }, [permisos.cargando, pantallaIa, tabUrl, tabPedida, searchParams, setSearchParams]);
  // La pestaña va también a la URL (sin apilar historial): así la cola sabe si
  // estás mirando «Cargar» y no apunta en la campana lo que ya ves.
  const cambiarPestana = (v: string) => {
    setActiveTab(v);
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("tab", v);
      // El enlace profundo ya se aplicó: que no vuelva a abrir el documento al volver a Compras.
      for (const k of PARAMS_ENLACE_COMPRAS) p.delete(k);
      p.delete("articulo");
      return p;
    }, { replace: true });
  };
  // Enlaces del tablero de Análisis a Compras (un mes, un proveedor, Productos):
  // entran en el historial, así «Atrás» vuelve al tablero.
  const irA = (enlace: string) => setSearchParams(new URLSearchParams(enlace));
  // Importación histórica (04/11/2026): solo administradores con «Editar» en Facturas
  // (la Edge Function exige las dos cosas).
  const { isAdmin } = useUserRole();
  const puedeImportar = isAdmin && permisos.editar;
  const [importacionAbierta, setImportacionAbierta] = useState(false);
  const subidas = useColaSubidaOpcional();
  const activosSubida = subidas?.activos ?? 0;
  // Alto de la pantalla, calculado solo (como Calendario y Newsletter): la
  // página ocupa justo lo visible y cada pestaña reparte ese alto por dentro.
  // Sin medida (jsdom, primer pintado) cae al `calc(100dvh-6rem)` de siempre.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  // Barra única de Análisis (07/11/2026): periodo, local, «Personalizar» y la IA van en
  // ESTA fila, junto a las pestañas; ChatFacturas los pinta aquí con un portal.
  const [ranuraAnalisis, setRanuraAnalisis] = useState<HTMLDivElement | null>(null);
  const barraUnica = activeTab === "chat" && !pantallaIa;
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_FACTURAS);

  // Contadores para los badges de las pestañas
  // Un `count` de cabeceras: entrar por «Análisis» no descarga la lista de Compras.
  // Sin Compras (solo Subida) no se pide.
  const { data: totalDocumentos = 0 } = useContadorDocumentos({ enabled: permisos.consultar });
  // Compras y Análisis se montan la primera vez que se visitan (y luego se quedan
  // montadas): entrar por una no descarga la otra, y al volver siguen como estaban
  // (Análisis: el explorador, el copiloto abierto y la conversación; QA 05/11/2026).
  const [comprasMontada, setComprasMontada] = useState(activeTab === "compras");
  const [analisisMontada, setAnalisisMontada] = useState(activeTab === "chat");
  // Márgenes: `?articulo=plato:<id>` (enlace del Dashboard) abre esa ficha.
  const articuloPedido = leerArticuloEnlace(searchParams.get("articulo"));
  const veAnalisisYCompras = visibles.includes("chat");
  const veCargar = visibles.includes("cargar");
  // «Solo lectura» en Análisis y Compras para quien los consulta sin «Editar» (en Cargar sube y corrige lo suyo).
  const soloLectura = permisos.consultar && !permisos.editar && activeTab !== "cargar";
  useEffect(() => {
    if (activeTab === "compras") setComprasMontada(true);
    if (activeTab === "chat") setAnalisisMontada(true);
  }, [activeTab]);

  const handlePreguntarIA = (doc: Factura, tipo: 'factura' | 'albarán') => {
    // 1. Cambiamos a la pestaña del chat
    cambiarPestana("chat");

    // 2. Construir el prompt natural
    const provTexto = doc.proveedor ? `del proveedor ${doc.proveedor}` : "sin proveedor especificado";
    const prompt = `Hola, quiero hacerte una consulta sobre el ${tipo} número ${doc.numero_documento} ${provTexto}.`;

    // 3. Enviar consulta al chat (con setTimeout mínimo para darle tiempo a montar el DOM si estaba oculto).
    //    Sin `window.scrollTo`: la página no tiene scroll (alto = pantalla).
    setTimeout(() => {
      if (chatRef.current) {
        chatRef.current.enviarConsulta(prompt);
      }
    }, 100);
  };

  // La IA a pantalla completa exige «Editar»: sin él, a /facturas (Análisis, o Cargar con solo Subida).
  if (pantallaIa && !permisos.cargando && !permisos.editar) return <Navigate to="/facturas" replace />;

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
            // 11/11/2026 (dueño: «no es intuitivo»): en el móvil, icono + nombre en cada pestaña; los botones
            // (gasto de IA, avisos, ayuda) bajan a su propia fila para que las cuatro quepan con su texto.
            className={pantallaIa ? "hidden" : undefined}
            // En Análisis la barra de filtros va en una fila propia, bajo las pestañas, salvo en pantallas muy
            // anchas (≥ 1800 px), donde cabe todo junto: en la tablet y el portátil se partía en dos líneas y las
            // pestañas quedaban descolgadas (09/11/2026).
            accionesAnchas={barraUnica}
            iconosSoloMuyAncho={barraUnica}
            accionesDebajoEnMovil={barraUnica ? "muyAncho" : true}
            pestanas={[
              { valor: "chat", etiqueta: "Análisis", icono: <BarChart3 />, tour: "facturas-pestana-ia" },
              { valor: "margenes", etiqueta: "Márgenes", icono: <Percent />, tour: "facturas-pestana-margenes" },
              { valor: "compras", etiqueta: "Compras", icono: <ShoppingCart />, contador: totalDocumentos, tour: "facturas-pestana-compras" },
              { valor: "cargar", etiqueta: "Cargar", icono: <Upload />, contador: activosSubida, etiquetaContador: `${activosSubida} procesando`, contadorEnMovil: true, tour: "facturas-pestana-cargar" },
            ].filter((p) => visibles.includes(p.valor as PestanaFacturas))}
            acciones={
              <>
                {barraUnica && <div ref={setRanuraAnalisis} className="contents sm:flex sm:min-w-0 sm:flex-1" data-testid="ranura-analisis" />}
                {/* El gasto del chatbot es de la IA: solo con «Editar». Sin él, un hueco empuja lo demás a la derecha.
                    En Análisis, con la barra única, solo en pantallas muy anchas (no cabe en 1280). */}
                {permisos.editar ? (
                  <GastoIaPestana className={barraUnica ? "hidden 2xl:flex" : "ml-auto"} />
                ) : (
                  !barraUnica && <span className="ml-auto" aria-hidden="true" />
                )}
                {soloLectura && <EtiquetaSoloLectura />}
                {/* Avisos de facturas (06/11/2026, petición del dueño: antes era una entrada de la barra lateral).
                    Son de lo comprado (precios, documentos): solo para quien consulta Facturas. */}
                {/* 12/11/2026 (móvil): el gasto de IA, Avisos y Ayuda juntos a la derecha. Antes había dos `ml-auto` y el
                    importe quedaba suelto en medio de la fila. */}
                <div className={cn("flex items-center gap-2 sm:order-none sm:ml-0", barraUnica ? "order-4 ml-auto" : "order-2")}>
                  {permisos.consultar && <BotonAvisosSeccion seccion="facturas" compacto={barraUnica} />}
                  <BotonAyuda seccion="facturas" />
                </div>
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
            {veAnalisisYCompras && (
              <TabsContent value="compras" forceMount className="h-full m-0 outline-none data-[state=inactive]:hidden">
                {/* «Preguntar a la IA» desde una ficha: solo con «Editar». */}
                {comprasMontada && <TabCompras onPreguntarIA={permisos.editar ? handlePreguntarIA : undefined} modoPedido={modoPedido} />}
              </TabsContent>
            )}

            {/* PESTAÑA ANÁLISIS: tablero de gráficas fijas y copiloto de IA plegado
                (ChatFacturas). El gasto de IA va junto a la pestaña (GastoIaPestana). */}
            {veAnalisisYCompras && (
              <TabsContent value="chat" forceMount className="h-full m-0 outline-none data-[state=inactive]:hidden">
                <div className="h-full min-h-0 overflow-hidden">
                  {(analisisMontada || activeTab === "chat") && (
                    <ChatFacturas
                      ref={chatRef}
                      onIrA={irA}
                      activa={activeTab === "chat"}
                      pantallaCompleta={pantallaIa}
                      conIa={permisos.editar}
                      puedeEditar={permisos.editar}
                      ranuraBarra={ranuraAnalisis}
                    />
                  )}
                </div>
              </TabsContent>
            )}

            {/* PESTAÑA MÁRGENES (10/11/2026; antes, la sección «Análisis general»): la carta frente a lo que cuesta
                comprar sus ingredientes. Se monta solo al verla (su consulta es aparte). Editar escandallos, vinos y
                umbrales, con «Editar». */}
            {veAnalisisYCompras && (
              <TabsContent value="margenes" className="h-full m-0 outline-none data-[state=inactive]:hidden">
                {activeTab === "margenes" && <MargenesCarta puedeEditar={permisos.editar} articuloInicial={articuloPedido} />}
              </TabsContent>
            )}

            {/* PESTAÑA 3: CARGAR DATOS */}
            {/* Sin scroll de página (petición del dueño, 05-oct-2026): la tarjeta
                ocupa el alto de la pestaña y solo su lista hace scroll por dentro
                (ver lib/facturas/alturaCargar.ts). */}
            {veCargar && (
              <TabsContent value="cargar" className="h-full m-0 outline-none data-[state=inactive]:hidden">
                <div className="mx-auto flex h-full max-w-3xl flex-col gap-1">
                  {/* Importación histórica y gasto de lectura: de quien consulta Facturas (con solo Subida, no). */}
                  {activeTab === "cargar" && (puedeImportar || permisos.consultar) && (
                    <div className="flex min-w-0 max-w-full shrink-0 items-center justify-end gap-2">
                      {puedeImportar && (
                        <Button variant="outline" size="sm" className="mr-auto" onClick={() => setImportacionAbierta(true)}>
                          <History className="mr-1.5 h-4 w-4" /> Importación histórica
                        </Button>
                      )}
                      {permisos.consultar && (
                        <div className="min-w-0 max-w-full" data-tour="facturas-coste-lectura">
                          <MonitorGastoIA modo="ocr" />
                        </div>
                      )}
                    </div>
                  )}
                  <div className="flex-1 min-h-0">
                    <SubidaFacturas />
                  </div>
                </div>
              </TabsContent>
            )}

          </div>
        </Tabs>
      </div>
      {puedeImportar && <ImportacionHistoricaDialog open={importacionAbierta} onOpenChange={setImportacionAbierta} />}
    </DashboardLayout>
  );
};

export default Facturas;
