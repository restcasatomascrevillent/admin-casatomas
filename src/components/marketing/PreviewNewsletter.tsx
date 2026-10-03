import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { TipoNewsletter } from "./SelectorTipoNewsletter";
// MISMA función que usa enviar-newsletter para el correo real (código puro, ver
// la cabecera de plantillas.ts): la vista previa no puede divergir del envío.
// Antes esto era una copia a mano de las plantillas, sin escapar el texto.
import { renderNewsletter } from "../../../supabase/functions/enviar-newsletter/plantillas";

interface PreviewNewsletterProps {
  tipo: TipoNewsletter | null;
  titulo: string;
  mensaje: string;
  imagenUrl?: string;
}

/** En el envío real cada suscriptor recibe aquí su enlace personal firmado. */
const ENLACE_BAJA_VISTA_PREVIA = "#enlace-personal-de-baja";

const TEXTO_VACIO: Record<TipoNewsletter, { titulo: string; mensaje: string }> = {
  anuncio: { titulo: "Título del anuncio", mensaje: "El mensaje aparecerá aquí..." },
  nuevo_menu: { titulo: "Título del menú", mensaje: "El mensaje aparecerá aquí..." },
  oferta: { titulo: "Título de la oferta", mensaje: "El mensaje aparecerá aquí..." },
};

export function PreviewNewsletter({ tipo, titulo, mensaje, imagenUrl }: PreviewNewsletterProps) {
  const html = useMemo(() => {
    if (!tipo) return "";
    return renderNewsletter(
      {
        tipo,
        titulo: titulo || TEXTO_VACIO[tipo].titulo,
        mensaje: mensaje || TEXTO_VACIO[tipo].mensaje,
        imagenUrl,
      },
      ENLACE_BAJA_VISTA_PREVIA,
    );
  }, [tipo, titulo, mensaje, imagenUrl]);

  if (!tipo) {
    return (
      <Card className="h-full flex items-center justify-center bg-muted/30 min-h-[500px]">
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            Selecciona un tipo de newsletter para ver la preview
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="bg-muted/30 p-2 text-center text-xs text-muted-foreground border-b">
        Vista previa del email
      </div>
      <div className="max-h-[600px] overflow-y-auto">
        <iframe
          srcDoc={html}
          className="w-full min-h-[550px] border-0"
          title="Vista previa del email"
          sandbox=""
        />
      </div>
      <div className="p-2 text-center text-xs text-muted-foreground border-t">
        El pie con el enlace para darse de baja se añade siempre, automáticamente. Cada suscriptor recibe su
        enlace personal y el botón «Cancelar suscripción» de su programa de correo.
      </div>
    </Card>
  );
}
