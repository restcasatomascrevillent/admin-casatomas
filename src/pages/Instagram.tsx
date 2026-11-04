import { useState } from "react";
import { BarChart3, CalendarDays, PenLine } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { EditorInstagram } from "@/components/marketing/instagram/EditorInstagram";
import { CalendarioInstagram } from "@/components/instagram/programar";
import { MetricasInstagram } from "@/components/instagram/metricas";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";

/**
 * Suelo (px) del alto de la página: por debajo (ventanas muy bajas, teclado
 * abierto en el móvil) deja de encoger y la página hace scroll.
 */
const ALTURA_MINIMA_INSTAGRAM = 360;

const PESTANAS = ["crear", "calendario", "metricas"] as const;

const CONTENIDO_PESTANA = "mt-0 flex-1 min-h-0 overflow-y-auto overscroll-contain data-[state=inactive]:hidden";

/**
 * Instagram: sección propia del menú (05/11/2026, antes era una pestaña de
 * Newsletter). Mismo permiso que Newsletter: la sección «marketing».
 *
 * Pestañas (mismo patrón que Newsletter):
 *  · Crear: editor (formulario, vista previa y Publicar/Programar/Historial/Conexión).
 *  · Calendario: piezas programadas y publicadas (docs/instagram-programar.md).
 *  · Métricas: estadísticas de la cuenta y de cada publicación (docs/instagram-metricas.md).
 * `?tab=calendario` o `?tab=metricas` abre directamente esa pestaña.
 *
 * Regla del panel: sin scroll vertical de página. La página mide el alto que
 * queda en pantalla (`useAlturaDisponible`) y cada pestaña hace scroll por
 * dentro. Sin medida (jsdom) cae al layout normal.
 */
export default function Instagram() {
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_INSTAGRAM);
  const [pestana, setPestana] = useState(() => {
    const pedida = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab");
    return PESTANAS.includes(pedida as (typeof PESTANAS)[number]) ? (pedida as string) : "crear";
  });

  return (
    <DashboardLayout>
      {/* Sin título de página: «Instagram» activo en el menú lateral ya dice dónde estás. */}
      <div ref={setRaiz} className="flex flex-col" style={alto ? { height: alto } : undefined}>
        <Tabs value={pestana} onValueChange={setPestana} className="flex flex-1 min-h-0 flex-col gap-2 sm:gap-3">
          <PestanasPagina
            pestanas={[
              { valor: "crear", etiqueta: "Crear y publicar", etiquetaCorta: "Crear", icono: <PenLine /> },
              { valor: "calendario", etiqueta: "Calendario", icono: <CalendarDays /> },
              { valor: "metricas", etiqueta: "Métricas", icono: <BarChart3 /> },
            ]}
          />

          {/* Desde `lg` el editor reparte el alto en tres columnas con scroll propio. */}
          <TabsContent value="crear" className={`${CONTENIDO_PESTANA} lg:flex lg:flex-col lg:overflow-hidden`} data-testid="pagina-instagram">
            <EditorInstagram />
          </TabsContent>

          {/* Calendario y Métricas solo se montan al abrirlas: así no consultan nada si no se miran. */}
          <TabsContent value="calendario" className={CONTENIDO_PESTANA}>
            {pestana === "calendario" && <CalendarioInstagram marca="todas" />}
          </TabsContent>

          <TabsContent value="metricas" className={CONTENIDO_PESTANA}>
            {pestana === "metricas" && <MetricasInstagram />}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
