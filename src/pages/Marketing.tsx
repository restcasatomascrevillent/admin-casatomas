import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { CreadorNewsletter } from "@/components/marketing/CreadorNewsletter";
import { GestionCorreos } from "@/components/marketing/GestionCorreos";
import { EstadisticasNewsletter } from "@/components/marketing/EstadisticasNewsletter";
import { HistorialEnvios } from "@/components/marketing/HistorialEnvios";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { Send, Users, BarChart3 } from "lucide-react";

/**
 * Suelo (px) del alto de la página: por debajo (ventanas muy bajas, teclado
 * abierto en el móvil) deja de encoger y la página hace scroll. Con 360 px
 * caben la barra de pestañas y unos 300 px de contenido desplazable.
 */
const ALTURA_MINIMA_NEWSLETTER = 360;

/**
 * Contenido de cada pestaña: ocupa el alto que queda bajo la barra y hace scroll por dentro.
 * `data-[state=inactive]:hidden` imprescindible (como en Facturas): Radix deja montado el
 * contenedor de las pestañas inactivas con el atributo `hidden`, y un `lg:flex` le gana a ese
 * atributo — la pestaña oculta seguiría ocupando la mitad del alto.
 */
const CONTENIDO_PESTANA = "mt-0 flex-1 min-h-0 overflow-y-auto overscroll-contain data-[state=inactive]:hidden";

export default function Marketing() {
  // Alto de la pantalla, calculado solo (petición del dueño, 2026-10-05): el
  // mismo patrón que el Calendario de Reservas (`useAlturaDisponible`: alto del
  // viewport visual − posición del bloque − relleno del <main>, recalculado al
  // redimensionar, girar la tablet, abrir el teclado o plegar el menú). La
  // página mide justo eso: la barra de pestañas queda fija arriba y cada pestaña
  // hace scroll por dentro. Sin medida (jsdom, primer pintado sin layout) cae al
  // layout de siempre, con scroll de página.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_NEWSLETTER);

  return (
    <DashboardLayout>
      {/* Sin título de página (2026-09-25): la pestaña "Newsletter" activa
          en el menú lateral ya dice dónde estás; el subtítulo era relleno. */}
      <div ref={setRaiz} className="flex flex-col" style={alto ? { height: alto } : undefined}>
        <Tabs defaultValue="crear" className="flex flex-1 min-h-0 flex-col gap-2 sm:gap-3">
          <PestanasPagina
            pestanas={[
              { valor: "crear", etiqueta: "Enviar Newsletter", icono: <Send /> },
              { valor: "suscriptores", etiqueta: "Suscriptores", icono: <Users /> },
              { valor: "estadisticas", etiqueta: "Estadísticas", icono: <BarChart3 /> },
            ]}
          />

          {/* Desde `lg` el formulario y la vista previa van lado a lado y cada
              columna hace su propio scroll (CreadorNewsletter); por debajo van
              apiladas y desplaza la pestaña entera. */}
          <TabsContent value="crear" className={`${CONTENIDO_PESTANA} lg:flex lg:flex-col lg:overflow-hidden`}>
            <CreadorNewsletter />
          </TabsContent>

          <TabsContent value="suscriptores" className={CONTENIDO_PESTANA}>
            <GestionCorreos />
          </TabsContent>

          {/* Todo a la vista sin scroll (2026-10-06): las estadísticas llenan justo el alto de la
              pestaña y el historial va junto a la gráfica (EstadisticasNewsletter). */}
          <TabsContent value="estadisticas" className={CONTENIDO_PESTANA}>
            <EstadisticasNewsletter historial={<HistorialEnvios />} />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
