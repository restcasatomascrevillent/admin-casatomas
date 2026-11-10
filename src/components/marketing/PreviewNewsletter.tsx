import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { validarBloques, type Bloque, type DisenoNewsletter } from "@/lib/newsletter/diseno";
// MISMA función que usa enviar-newsletter para el correo real (código puro, ver
// la cabecera de plantillas.ts): la vista previa no puede divergir del envío.
import { renderNewsletter } from "../../../supabase/functions/enviar-newsletter/plantillas";

interface PreviewNewsletterProps {
  diseno: DisenoNewsletter | null;
}

/** En el envío real cada suscriptor recibe aquí su enlace personal firmado. */
const ENLACE_BAJA_VISTA_PREVIA = "#enlace-personal-de-baja";

/**
 * Mientras se edita, un bloque a medias (sin texto, foto sin elegir…) no se
 * pinta, en vez de dejar la vista previa en blanco. El envío sí lo rechaza.
 */
export function bloquesParaVistaPrevia(bloques: readonly Bloque[]): Bloque[] {
  return bloques.flatMap((b): Bloque[] => {
    if (b.tipo === "separador") return [b];
    const v = validarBloques([b]);
    return v.ok ? v.bloques : [];
  });
}

export function PreviewNewsletter({ diseno }: PreviewNewsletterProps) {
  const html = useMemo(() => {
    if (!diseno) return "";
    const bloques = bloquesParaVistaPrevia(diseno.bloques);
    return renderNewsletter(
      {
        tipo: diseno.tipo,
        titulo: diseno.titulo.trim() || "Asunto del correo",
        mensaje: "",
        bloques: bloques.length ? bloques : [{ tipo: "texto", texto: "El contenido aparecerá aquí…" }],
        insignia: diseno.insignia,
        preheader: diseno.preheader,
      },
      ENLACE_BAJA_VISTA_PREVIA,
    );
  }, [diseno]);

  if (!diseno) {
    return (
      <Card className="flex items-center justify-center bg-muted/30 min-h-[500px] lg:min-h-0 lg:flex-1">
        <div className="text-center py-12 px-6">
          <p className="text-muted-foreground">Elige una plantilla o crea el correo con IA para ver aquí cómo quedará</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
      <div className="shrink-0 bg-muted/30 p-2 text-center text-xs text-muted-foreground border-b">
        Vista previa del email
      </div>
      {/* Desde `lg` el marco llena la columna (alto de pantalla) y el correo se desplaza dentro del iframe. */}
      <div className="max-h-[640px] overflow-y-auto lg:flex lg:max-h-none lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden">
        <iframe
          srcDoc={html}
          className="w-full min-h-[600px] border-0 lg:min-h-0 lg:flex-1"
          title="Vista previa del email"
          sandbox=""
        />
      </div>
      <div className="shrink-0 p-2 text-center text-xs text-muted-foreground border-t">
        El pie con el enlace para darse de baja se añade siempre, automáticamente. Cada suscriptor recibe su
        enlace personal y el botón «Cancelar suscripción» de su programa de correo.
      </div>
    </Card>
  );
}
