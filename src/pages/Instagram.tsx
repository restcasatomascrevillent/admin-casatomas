import { useState } from "react";
import { BarChart3, CalendarDays, Clapperboard, Flag, KanbanSquare, PenLine } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { EditorInstagram } from "@/components/marketing/instagram/EditorInstagram";
import { CalendarioInstagram } from "@/components/instagram/programar";
import { CampanasInstagram, leerPieza } from "@/components/instagram/campanas";
import type { PiezaInstagram } from "@/components/marketing/instagram/usePiezasInstagram";
import { MetricasInstagram } from "@/components/instagram/metricas";
import { crearReelDesdeBase, type ReelPieza } from "@/components/instagram/reels";
import { PestanaReels } from "@/components/instagram/video";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { EncargosInstagram, usePendientesEncargos, useRolesEncargos } from "@/components/instagram/encargos";
// ── Crear en el móvil (instagram-movil): ver el bloque «Crear en el móvil» más abajo. ──
import { CrearMovil } from "@/components/instagram/movil";
import { useIsMobile } from "@/hooks/use-mobile";

/**
 * Suelo (px) del alto de la página: por debajo (ventanas muy bajas, teclado
 * abierto en el móvil) deja de encoger y la página hace scroll.
 */
const ALTURA_MINIMA_INSTAGRAM = 360;

const PESTANAS = ["crear", "campanas", "reels", "calendario", "encargos", "metricas"] as const;

const CONTENIDO_PESTANA = "mt-0 flex-1 min-h-0 overflow-y-auto overscroll-contain data-[state=inactive]:hidden";

/**
 * Instagram: sección propia del menú (05/11/2026, antes era una pestaña de
 * Newsletter). Mismo permiso que Newsletter: la sección «marketing».
 *
 * Pestañas (mismo patrón que Newsletter):
 *  · Crear: editor (formulario, vista previa y Publicar/Programar/Historial/Conexión).
 *  · Campañas: propuestas de la IA; aceptar crea BORRADORES con fecha prevista
 *    (docs/instagram-campanas.md). Al abrir un borrador (aquí o en el
 *    calendario) se pasa a «Crear» con sus datos.
 *  · Reels: montar un reel con las 5 bases de la marca y verlo animado
 *    (docs/instagram-reels.md), generar el MP4 y probarlo, publicarlo o
 *    programarlo (docs/instagram-video.md).
 *  · Calendario: piezas programadas y publicadas (docs/instagram-programar.md).
 *  · Encargos: piezas automáticas y encargos a Oficiosos (docs/instagram-encargos.md).
 *    La agencia (permiso «instagram_agencia» sin Marketing) solo ve esta pestaña.
 *  · Métricas: estadísticas de la cuenta y de cada publicación (docs/instagram-metricas.md).
 * `?tab=calendario`, `?tab=campanas`, `?tab=encargos` (con `&encargo=<id>`) o `?tab=metricas` abre directamente esa pestaña.
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
  const [pestana, setPestana] = useState(() => {
    const pedida = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab");
    return PESTANAS.includes(pedida as (typeof PESTANAS)[number]) ? (pedida as string) : "crear";
  });
  const [abrir, setAbrir] = useState<{ pieza: PiezaInstagram; clave: number } | null>(null);
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

  return (
    <DashboardLayout>
      {/* Sin título de página: «Instagram» activo en el menú lateral ya dice dónde estás. */}
      <div ref={setRaiz} className="flex flex-col" style={alto ? { height: alto } : undefined}>
        <Tabs value={pestanaVisible} onValueChange={setPestana} className="flex flex-1 min-h-0 flex-col gap-2 sm:gap-3">
          <PestanasPagina
            pestanas={[
              { valor: "crear", etiqueta: "Crear y publicar", etiquetaCorta: "Crear", icono: <PenLine /> },
              { valor: "campanas", etiqueta: "Campañas", icono: <Flag /> },
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

          {/* Desde `lg` el editor reparte el alto en tres columnas con scroll propio. */}
          <TabsContent value="crear" className={`${CONTENIDO_PESTANA} lg:flex lg:flex-col lg:overflow-hidden`} data-testid="pagina-instagram">
            {/* La agencia sin Marketing no tiene editor (no puede leer piezas ni Drive). */}
            {!soloAgencia && !crearEnMovil && <EditorInstagram abrir={abrir} />}
            {/* ── Crear en el móvil (instagram-movil) ── */}
            {!soloAgencia && crearEnMovil && <CrearMovil incrustado onEditorCompleto={() => setEditorCompletoEnMovil(true)} />}
          </TabsContent>

          {/* Campañas: dos columnas con scroll propio desde `lg`. */}
          <TabsContent value="campanas" className={`${CONTENIDO_PESTANA} lg:overflow-hidden`}>
            {pestana === "campanas" && (
              <CampanasInstagram className="lg:h-full" onAbrirBorrador={(id) => void abrirEnEditor(id)} onVerCalendario={() => setPestana("calendario")} />
            )}
          </TabsContent>

          {/* Reels: el reel vive en la página para no perderlo al cambiar de pestaña. */}
          <TabsContent value="reels" className={`${CONTENIDO_PESTANA} lg:overflow-hidden`}>
            {pestana === "reels" && <PestanaReels reel={reel} onChange={setReel} piezaId={reelPiezaId} onPiezaId={setReelPiezaId} />}
          </TabsContent>

          {/* Calendario y Métricas solo se montan al abrirlas: así no consultan nada si no se miran. */}
          <TabsContent value="calendario" className={CONTENIDO_PESTANA}>
            {pestana === "calendario" && (
              <CalendarioInstagram
                marca="todas"
                onAbrirPieza={(id) => void abrirEnEditor(id)}
                onAbrirEncargo={(id) => {
                  setEncargoAbierto(id);
                  setPestana("encargos");
                }}
              />
            )}
          </TabsContent>

          {/* Encargos: el tablero reparte el alto y cada columna hace scroll. */}
          <TabsContent value="encargos" className={`${CONTENIDO_PESTANA} overflow-hidden`}>
            {pestanaVisible === "encargos" && (
              <EncargosInstagram encargoInicial={encargoAbierto} onAbrirPieza={(id) => void abrirEnEditor(id)} />
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
