import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, CalendarDays, Clapperboard, Flag, Home, KanbanSquare, PenLine } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { CrearInstagram } from "@/components/instagram/crear";
import { useIsMobile } from "@/hooks/use-mobile";
import { CalendarioInstagram } from "@/components/instagram/programar";
import { CampanasInstagram, CLAVE_CAMPANAS, leerPieza, listarCampanas, type IdeaSemanaIA } from "@/components/instagram/campanas";
import type { PiezaInstagram } from "@/components/marketing/instagram/usePiezasInstagram";
import { MetricasInstagram } from "@/components/instagram/metricas";
import { crearReelDesdeBase, type ReelPieza } from "@/components/instagram/reels";
import { PestanaReels } from "@/components/instagram/video";
import { EstudioInstagram } from "@/components/instagram/estudio/EstudioInstagram";
import { IndicadorCuenta, SelectorMarca, type FiltroMarca } from "@/components/instagram/BarraInstagram";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { EncargosInstagram, usePendientesEncargos, useRolesEncargos, type DatosFormulario } from "@/components/instagram/encargos";
// ── Crear en el móvil (instagram-movil): ver el bloque «Crear en el móvil» más abajo. ──
import { CrearMovil } from "@/components/instagram/movil";

/**
 * Suelo (px) del alto de la página: por debajo (ventanas muy bajas, teclado
 * abierto en el móvil) deja de encoger y la página hace scroll.
 */
const ALTURA_MINIMA_INSTAGRAM = 360;

const PESTANAS = ["estudio", "crear", "campanas", "reels", "calendario", "encargos", "metricas"] as const;
type Pestana = (typeof PESTANAS)[number];

const CONTENIDO_PESTANA = "mt-0 flex-1 min-h-0 overflow-y-auto overscroll-contain data-[state=inactive]:hidden";

const MARCA_GUARDADA = "instagram:marca";

function marcaInicial(): FiltroMarca {
  try {
    const m = typeof window === "undefined" ? null : window.sessionStorage.getItem(MARCA_GUARDADA);
    return m === "casa-tomas" || m === "touza" ? m : "todas";
  } catch {
    return "todas";
  }
}

/**
 * Instagram: sección propia del menú (05/11/2026, antes era una pestaña de
 * Newsletter). Mismo permiso que Newsletter: la sección «marketing».
 *
 * Pestañas (maqueta instagram-studio/propuesta/maqueta, evaluación de diseño C):
 *  · Estudio (por defecto): la semana, la sugerencia de la IA, las próximas
 *    publicaciones, los encargos abiertos y 3 cifras (components/instagram/estudio).
 *  · Crear: «Qué publicar» (fotos, qué contar, Montar con IA, Ajustar a mano) y
 *    «Así quedará» (móvil de Instagram, texto, Publicar ahora / Programar), sin
 *    paso de prueba (src/components/instagram/crear, 05/11/2026). El historial
 *    ya no está en Crear (Calendario / «Publicadas») ni la conexión (indicador
 *    «● @cuenta» de la barra de pestañas): los hacen otros encargos.
 *  · Campañas: propuestas de la IA; aceptar crea BORRADORES con fecha prevista
 *    (docs/instagram-campanas.md). Al abrir un borrador se pasa a «Crear».
 *  · Reels: montar un reel con las bases de la marca, generar el MP4 y
 *    programarlo (docs/instagram-reels.md, docs/instagram-video.md). Siguiente
 *    paso pendiente: que sea un formato más de «Crear», como en la maqueta.
 *  · Calendario: mes con panel del día (docs/instagram-programar.md).
 *  · Encargos: piezas automáticas y encargos a Oficiosos (docs/instagram-encargos.md).
 *    La agencia (permiso «instagram_agencia» sin Marketing) solo ve esta pestaña.
 *  · Métricas: estadísticas de la cuenta y de cada publicación (docs/instagram-metricas.md).
 * A la derecha de la barra: la marca que filtra todas las pestañas («Las dos /
 * Casa Tomás / Touza») y el indicador «● @cuenta», que abre la conexión.
 * `?tab=<pestaña>` abre directamente esa pestaña (`&encargo=<id>` en Encargos).
 *
 * Regla del panel: sin scroll vertical de página. La página mide el alto que
 * queda en pantalla (`useAlturaDisponible`) y cada pestaña hace scroll por
 * dentro. Sin medida (jsdom) cae al layout normal.
 */
export default function Instagram() {
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_INSTAGRAM);
  const [reel, setReel] = useState<ReelPieza>(() => crearReelDesdeBase("del-mar"));
  const [reelPiezaId, setReelPiezaId] = useState<string | null>(null);
  const [pestana, setPestana] = useState<string>(() => {
    const pedida = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab");
    return PESTANAS.includes(pedida as Pestana) ? (pedida as string) : "estudio";
  });
  const [marca, setMarcaEstado] = useState<FiltroMarca>(marcaInicial);
  const setMarca = (m: FiltroMarca) => {
    setMarcaEstado(m);
    try {
      window.sessionStorage.setItem(MARCA_GUARDADA, m);
    } catch {
      /* sin almacenamiento: solo en memoria */
    }
  };
  const [abrir, setAbrir] = useState<{ pieza: PiezaInstagram; clave: number } | null>(null);
  const [diaCalendario, setDiaCalendario] = useState<string | null>(null);
  const [pedir, setPedir] = useState<{ clave: number; datos?: Partial<DatosFormulario> } | null>(null);
  const rolesEncargos = useRolesEncargos();
  const pendientesEncargos = usePendientesEncargos();
  // Agencia sin Marketing: solo «Encargos» (el resto de pestañas es del restaurante).
  const soloAgencia = !rolesEncargos.cargando && rolesEncargos.agencia && !rolesEncargos.restaurante;
  const pestanaVisible = soloAgencia ? "encargos" : pestana;
  // ── Crear en el móvil (instagram-movil) ───────────────────────────────────
  // Por debajo de 768 px la pestaña «Crear» es el asistente rápido CrearMovil,
  // salvo si se abre una pieza concreta (campañas, calendario) o se pide el
  // editor completo. Bloque aparte a propósito: el Crear de escritorio lo
  // rediseña otro cambio y así no se pisan.
  const esMovil = useIsMobile();
  const [editorCompletoEnMovil, setEditorCompletoEnMovil] = useState(false);
  const crearEnMovil = esMovil && !abrir && !editorCompletoEnMovil;
  // ── fin Crear en el móvil ─────────────────────────────────────────────────
  const [encargoAbierto, setEncargoAbierto] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("encargo"),
  );

  // Propuestas de campaña nuevas (contador dorado de la pestaña, como la maqueta). Misma consulta que la pestaña.
  const campanas = useQuery({
    queryKey: [...CLAVE_CAMPANAS, "lista"],
    queryFn: () => listarCampanas("todas"),
    enabled: !rolesEncargos.cargando && rolesEncargos.restaurante,
    staleTime: 60_000,
  });
  const propuestasNuevas = useMemo(
    () => (campanas.data ?? []).filter((c) => c.estado === "propuesta" && (marca === "todas" || c.marca === marca)).length,
    [campanas.data, marca],
  );

  // Borradores de campaña (y cualquier pieza del calendario): se abren en «Crear».
  const abrirEnEditor = async (piezaId: string) => {
    try {
      const pieza = await leerPieza(piezaId);
      if (!pieza) {
        toast.error("Esa pieza ya no existe");
        return;
      }
      setAbrir({ pieza, clave: Date.now() });
      setPestana("crear");
    } catch (e) {
      toast.error("No se pudo abrir la pieza", { description: (e as Error).message });
    }
  };

  // «Nueva pieza» (Estudio, «Nueva pieza este día» del calendario) e ideas de la semana: de momento
  // solo llevan a «Crear». Rellenar la pieza (marca, día, plantilla, titular y foto de la idea) queda
  // para el rediseño de Crear (otro agente): ver docs/instagram.md, «Pantallas y uso».
  const nuevaPieza = (_dia: string | null = null) => setPestana("crear");
  const crearIdea = (_idea: IdeaSemanaIA) => setPestana("crear");

  const abrirEncargo = (id: string) => {
    setEncargoAbierto(id);
    setPestana("encargos");
  };

  return (
    <DashboardLayout>
      {/* Sin título de página: «Instagram» activo en el menú lateral ya dice dónde estás. */}
      <div ref={setRaiz} className="flex flex-col" style={alto ? { height: alto } : undefined}>
        <Tabs value={pestanaVisible} onValueChange={setPestana} className="flex flex-1 min-h-0 flex-col gap-2 sm:gap-3">
          <PestanasPagina
            accionesDebajoEnMovil="lg"
            acciones={
              soloAgencia ? undefined : (
                <>
                  <SelectorMarca valor={marca} onCambio={setMarca} />
                  <IndicadorCuenta marca={marca} />
                </>
              )
            }
            pestanas={[
              { valor: "estudio", etiqueta: "Estudio", icono: <Home /> },
              { valor: "crear", etiqueta: "Crear", icono: <PenLine /> },
              {
                valor: "campanas",
                etiqueta: "Campañas",
                icono: <Flag />,
                contador: propuestasNuevas,
                tonoContador: "dorado" as const,
                etiquetaContador: `${propuestasNuevas} ${propuestasNuevas === 1 ? "propuesta nueva" : "propuestas nuevas"}`,
              },
              { valor: "reels", etiqueta: "Reels", icono: <Clapperboard /> },
              { valor: "calendario", etiqueta: "Calendario", icono: <CalendarDays /> },
              {
                valor: "encargos",
                etiqueta: "Encargos",
                icono: <KanbanSquare />,
                contador: pendientesEncargos,
                tonoContador: "dorado" as const,
                etiquetaContador: `${pendientesEncargos} pendientes`,
              },
              { valor: "metricas", etiqueta: "Métricas", icono: <BarChart3 /> },
            ].filter((p) => !soloAgencia || p.valor === "encargos")}
          />

          {/* Estudio: dos columnas con listas que hacen scroll por dentro desde `lg`. */}
          <TabsContent value="estudio" className={`${CONTENIDO_PESTANA} lg:overflow-hidden`}>
            {!soloAgencia && pestana === "estudio" && (
              <EstudioInstagram
                className="lg:h-full"
                marca={marca}
                onIr={(p) => setPestana(p)}
                onVerDia={(d) => {
                  setDiaCalendario(d);
                  setPestana("calendario");
                }}
                onAbrirPieza={(id) => void abrirEnEditor(id)}
                onNuevaPieza={() => nuevaPieza()}
                onCrearIdea={crearIdea}
                onAbrirEncargo={abrirEncargo}
                onPedirEncargo={(datos) => {
                  setPedir({ clave: Date.now(), datos });
                  setPestana("encargos");
                }}
              />
            )}
          </TabsContent>

          {/* Desde `lg` Crear reparte el alto en dos columnas con scroll propio. */}
          <TabsContent value="crear" className={`${CONTENIDO_PESTANA} lg:flex lg:flex-col lg:overflow-hidden`} data-testid="pagina-instagram">
            {/* La agencia sin Marketing no tiene editor (no puede leer piezas ni Drive). */}
            {!soloAgencia && !crearEnMovil && <CrearInstagram abrir={abrir} onVerCalendario={() => setPestana("calendario")} />}
            {/* ── Crear en el móvil (instagram-movil) ── */}
            {!soloAgencia && crearEnMovil && <CrearMovil incrustado onEditorCompleto={() => setEditorCompletoEnMovil(true)} />}
          </TabsContent>

          {/* Campañas: dos columnas con scroll propio desde `lg`. */}
          <TabsContent value="campanas" className={`${CONTENIDO_PESTANA} lg:overflow-hidden`}>
            {pestana === "campanas" && (
              <CampanasInstagram
                className="lg:h-full"
                marca={marca}
                onAbrirBorrador={(id) => void abrirEnEditor(id)}
                onVerCalendario={() => setPestana("calendario")}
                onAbrirEncargo={abrirEncargo}
              />
            )}
          </TabsContent>

          {/* Reels: el reel vive en la página para no perderlo al cambiar de pestaña. */}
          <TabsContent value="reels" className={`${CONTENIDO_PESTANA} lg:overflow-hidden`}>
            {pestana === "reels" && <PestanaReels reel={reel} onChange={setReel} piezaId={reelPiezaId} onPiezaId={setReelPiezaId} marca={marca} />}
          </TabsContent>

          {/* Calendario y Métricas solo se montan al abrirlas: así no consultan nada si no se miran. */}
          <TabsContent value="calendario" className={CONTENIDO_PESTANA}>
            {pestana === "calendario" && (
              <CalendarioInstagram
                marca={marca}
                diaInicial={diaCalendario}
                onAbrirPieza={(id) => void abrirEnEditor(id)}
                onNuevaPieza={(dia) => nuevaPieza(dia)}
                onAbrirEncargo={abrirEncargo}
              />
            )}
          </TabsContent>

          {/* Encargos: el tablero reparte el alto y cada columna hace scroll. */}
          <TabsContent value="encargos" className={`${CONTENIDO_PESTANA} overflow-hidden`}>
            {pestanaVisible === "encargos" && (
              <EncargosInstagram
                encargoInicial={encargoAbierto}
                onAbrirPieza={(id) => void abrirEnEditor(id)}
                marca={soloAgencia ? undefined : marca}
                pedir={pedir}
              />
            )}
          </TabsContent>

          <TabsContent value="metricas" className={CONTENIDO_PESTANA}>
            {pestana === "metricas" && <MetricasInstagram />}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
