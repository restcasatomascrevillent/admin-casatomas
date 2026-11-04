import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { EditorInstagram } from "@/components/marketing/instagram/EditorInstagram";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";

/**
 * Suelo (px) del alto de la página: por debajo (ventanas muy bajas, teclado
 * abierto en el móvil) deja de encoger y la página hace scroll.
 */
const ALTURA_MINIMA_INSTAGRAM = 360;

/**
 * Instagram: sección propia del menú (05/11/2026, antes era una pestaña de
 * Newsletter). Mismo permiso que Newsletter: la sección «marketing».
 *
 * Regla del panel: sin scroll vertical de página. La página mide el alto que
 * queda en pantalla (`useAlturaDisponible`, el mismo patrón que Newsletter) y,
 * desde `lg`, el editor reparte ese alto en tres columnas (formulario, vista
 * previa y publicar) con scroll propio; por debajo van apiladas y desplaza el
 * bloque, no la página. Sin medida (jsdom) cae al layout normal.
 */
export default function Instagram() {
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_INSTAGRAM);

  return (
    <DashboardLayout>
      {/* Sin título de página: «Instagram» activo en el menú lateral ya dice dónde estás. */}
      <div ref={setRaiz} className="flex flex-col" style={alto ? { height: alto } : undefined}>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain lg:flex lg:flex-col lg:overflow-hidden" data-testid="pagina-instagram">
          <EditorInstagram />
        </div>
      </div>
    </DashboardLayout>
  );
}
