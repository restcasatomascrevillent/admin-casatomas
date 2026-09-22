import { AlertTriangle, CheckCircle2, Copy, XCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { detectaInfoContacto } from "./constantesBot";
import type { IdiomaBotWeb } from "@/hooks/useConfigBotWeb";

interface AvisoHorarioContactoProps {
  idioma: IdiomaBotWeb;
  texto: string;
  textoEspañol: string;
  canEdit: boolean;
  onCopiarDesdeEspañol: () => void;
}

// El hueco real (pedido explícitamente en el encargo): chat-web/index.ts
// obliga al bot a decir "no lo sé" ante horarios/dirección/teléfono salvo
// que esa info esté escrita en "instrucciones_extra" DE ESE IDIOMA — no hay
// ningún otro sitio de donde el bot pueda sacarla. Esta tarjeta lo hace
// visible en vez de dejar que se note el día que un cliente pregunta y el
// bot no sepa responder.
export function AvisoHorarioContacto({ idioma, texto, textoEspañol, canEdit, onCopiarDesdeEspañol }: AvisoHorarioContactoProps) {
  const deteccion = detectaInfoContacto(texto);
  const puedeCopiarDeEspañol = idioma !== "es" && textoEspañol.trim().length > 0;

  const colorClase = deteccion.completa
    ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900/40"
    : "border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/40";

  return (
    <Alert className={colorClase}>
      {deteccion.completa ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
      ) : (
        <AlertTriangle className="h-4 w-4 text-amber-600" />
      )}
      <AlertTitle>
        {deteccion.completa
          ? "Este idioma ya tiene horario y contacto"
          : "El bot no sabe horarios, dirección ni teléfono por su cuenta"}
      </AlertTitle>
      <AlertDescription className="space-y-2.5">
        <p>
          Nada de esto viene programado en el bot: si un cliente pregunta "¿a qué hora abrís?" o "¿dónde
          estáis?", solo puede responder bien si la respuesta está escrita, en este mismo idioma, en
          "Instrucciones extra" (más abajo). Si no está ahí, el bot tiene que decir que no lo sabe — para
          reservas pasa lo mismo: no puede reservar, solo puede remitir a llamar o escribir si tú se lo indicas
          aquí.
        </p>
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <Badge
            variant={deteccion.horario ? "secondary" : "outline"}
            className={deteccion.horario ? "" : "border-dashed text-muted-foreground font-normal"}
          >
            {deteccion.horario ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <XCircle className="h-3 w-3 mr-1" />}
            Horario {deteccion.horario ? "detectado" : "no detectado"}
          </Badge>
          <Badge
            variant={deteccion.contacto ? "secondary" : "outline"}
            className={deteccion.contacto ? "" : "border-dashed text-muted-foreground font-normal"}
          >
            {deteccion.contacto ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <XCircle className="h-3 w-3 mr-1" />}
            Teléfono/email {deteccion.contacto ? "detectado" : "no detectado"}
          </Badge>
          <Badge
            variant={deteccion.direccion ? "secondary" : "outline"}
            className={deteccion.direccion ? "" : "border-dashed text-muted-foreground font-normal"}
          >
            {deteccion.direccion ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <XCircle className="h-3 w-3 mr-1" />}
            Dirección {deteccion.direccion ? "detectada" : "no detectada"}
          </Badge>
          <span className="text-[10px] text-muted-foreground">(detección automática aproximada — revísalo tú)</span>
        </div>
        {canEdit && puedeCopiarDeEspañol && (
          <Button type="button" variant="outline" size="sm" className="mt-1 bg-background" onClick={onCopiarDesdeEspañol}>
            <Copy className="h-3.5 w-3.5 mr-1.5" />
            Copiar las instrucciones del español para traducirlas
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
