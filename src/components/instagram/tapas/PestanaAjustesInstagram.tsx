/**
 * Pestaña «Ajustes» de RRSS › Instagram (12/11/2026): la story automática del
 * jueves de tapas y «Lo que publicáis ahora» (las últimas publicaciones y
 * stories de la cuenta, como referencia de estilo). Cada columna hace su
 * propio scroll (la página no se desplaza).
 */
import { LoQuePublicais } from "@/components/instagram/referencias/LoQuePublicais";
import { AjustesStoryTapas } from "./AjustesStoryTapas";

export function PestanaAjustesInstagram() {
  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 overflow-y-auto lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:overflow-hidden">
      <div className="min-h-0 lg:overflow-y-auto">
        <AjustesStoryTapas />
      </div>
      <div className="min-h-[480px] lg:min-h-0">
        <LoQuePublicais marca="casa-tomas" />
      </div>
    </div>
  );
}
