import { Card, CardContent } from "@/components/ui/card";
import { TipoNewsletter } from "./SelectorTipoNewsletter";

interface PreviewNewsletterProps {
  tipo: TipoNewsletter | null;
  titulo: string;
  mensaje: string;
  imagenUrl?: string;
}

export function PreviewNewsletter({ tipo, titulo, mensaje, imagenUrl }: PreviewNewsletterProps) {
  if (!tipo) {
    return (
      <Card className="h-full flex items-center justify-center bg-muted/30">
        <CardContent className="text-center py-12">
          <p className="text-muted-foreground">
            Selecciona un tipo de newsletter para ver la preview
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full overflow-hidden">
      <div className="h-1.5 bg-gradient-to-r from-amber-500 to-amber-600" />
      <CardContent className="p-0">
        <div className="bg-gradient-to-b from-amber-50 to-white dark:from-amber-950/20 dark:to-background p-6">
          {/* Header */}
          <div className="text-center mb-6">
            <h2 className="text-2xl font-serif font-bold text-foreground">Casa Tomás</h2>
            <p className="text-xs text-muted-foreground mt-1">Restaurante</p>
          </div>

          {/* Image */}
          {imagenUrl && (
            <div className="mb-6 rounded-lg overflow-hidden">
              <img
                src={imagenUrl}
                alt="Newsletter"
                className="w-full h-48 object-cover"
              />
            </div>
          )}

          {/* Title */}
          <h3 className="text-xl font-semibold text-center mb-4 text-foreground">
            {titulo || 'Título del newsletter'}
          </h3>

          {/* Message */}
          <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
            {mensaje || 'El mensaje aparecerá aquí...'}
          </div>

          {/* Footer */}
          <div className="mt-8 pt-6 border-t border-border text-center">
            <p className="text-xs text-muted-foreground">
              Has recibido este email porque estás suscrito a Casa Tomás
            </p>
            <a href="#" className="text-xs text-primary hover:underline mt-1 inline-block">
              Darse de baja
            </a>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
