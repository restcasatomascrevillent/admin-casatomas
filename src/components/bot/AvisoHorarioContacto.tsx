import { Check, Copy, Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { detectaInfoContacto } from "./constantesBot";
import type { IdiomaBotWeb } from "@/hooks/useConfigBotWeb";

interface AvisoHorarioContactoProps {
  idioma: IdiomaBotWeb;
  texto: string;
  textoEspañol: string;
  canEdit: boolean;
  onCopiarDesdeEspañol: () => void;
}

// El hueco real: chat-web/index.ts obliga al bot a decir "no lo sé" ante
// horarios/dirección/teléfono salvo que esa info esté escrita en
// "instrucciones_extra" DE ESE IDIOMA — no hay otro sitio de donde sacarla.
// Antes era un Alert amarillo enorme encima de todo; ahora es una línea de
// comprobación compacta pegada al campo al que se refiere, con la
// explicación larga en un tooltip.
export function AvisoHorarioContacto({ idioma, texto, textoEspañol, canEdit, onCopiarDesdeEspañol }: AvisoHorarioContactoProps) {
  const deteccion = detectaInfoContacto(texto);
  const puedeCopiarDeEspañol = canEdit && idioma !== "es" && textoEspañol.trim().length > 0;

  const items = [
    { clave: "horario", label: "Horario", ok: deteccion.horario },
    { clave: "contacto", label: "Teléfono / email", ok: deteccion.contacto },
    { clave: "direccion", label: "Dirección", ok: deteccion.direccion },
  ];

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="flex items-center gap-1 text-xs font-medium">
            Información básica
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Por qué importa la información básica"
                >
                  <Info className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs leading-relaxed">
                Nada de esto viene programado en el bot: si un cliente pregunta "¿a qué hora abrís?" o "¿dónde
                estáis?", solo responde bien si la respuesta está escrita aquí, en este mismo idioma. Si no, dirá
                que no lo sabe. Con las reservas igual: no puede reservar, solo remitir a llamar o escribir si se lo
                indicas. La detección es automática y aproximada — revísalo tú.
              </TooltipContent>
            </Tooltip>
          </span>
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Información detectada en las instrucciones">
            {items.map((i) => (
              <li
                key={i.clave}
                className={cn(
                  "inline-flex items-center gap-1 text-xs",
                  i.ok ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground",
                )}
              >
                {i.ok ? (
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <X className="h-3.5 w-3.5 text-amber-600 dark:text-amber-500" aria-hidden="true" />
                )}
                {i.label}
                <span className="sr-only">{i.ok ? "(detectado)" : "(no detectado)"}</span>
              </li>
            ))}
          </ul>
        </div>
        {puedeCopiarDeEspañol && (
          <Button type="button" variant="outline" size="sm" className="h-7 bg-background px-2 text-xs" onClick={onCopiarDesdeEspañol}>
            <Copy className="mr-1 h-3 w-3" aria-hidden="true" />
            Copiar desde español
          </Button>
        )}
      </div>
      {!deteccion.completa && (
        <p className="text-xs text-muted-foreground">
          El bot solo sabrá horario, contacto y dirección si los escribes aquí, en este idioma.
        </p>
      )}
    </div>
  );
}
