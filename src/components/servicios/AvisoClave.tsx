import { useState } from "react";
import { ChevronDown, ExternalLink, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AYUDA_SECRETOS, enlaceSecretosSupabase } from "@/lib/servicios";
import { VERSION_APP } from "@/lib/version";

const URL_SUPABASE = import.meta.env.VITE_SUPABASE_URL as string | undefined;
/** Demo y previews: las claves de los proveedores solo están en producción (13/11/2026). */
const SOLO_EN_PRODUCCION = VERSION_APP.entorno === "demo" || VERSION_APP.entorno === "preview";

/**
 * «Falta configurar la clave X: cómo hacerlo». Pasos sin tecnicismos, permisos
 * mínimos y dónde se pega (Supabase → proyecto → Edge Functions → Secrets).
 * `opcional`: la tarjeta ya enseña datos y la clave solo añade más.
 */
export function AvisoClave({ secreto, opcional = false, soloEnProduccion = SOLO_EN_PRODUCCION }: { secreto: string; opcional?: boolean; soloEnProduccion?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const ayuda = AYUDA_SECRETOS[secreto];
  if (soloEnProduccion) {
    return (
      <p className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground" data-clave-demo={secreto}>
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 break-words">
          En la demo no está la clave <code className="break-words font-mono text-[0.8rem]">{secreto}</code>: las claves de los servicios solo están en producción, así que aquí {opcional ? "salen menos datos" : "no se lee"}. No hace falta hacer nada.
        </span>
      </p>
    );
  }
  return (
    <Collapsible open={abierto} onOpenChange={setAbierto} className="rounded-md border border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
        <KeyRound className="h-4 w-4 shrink-0" aria-hidden="true" />
        {/* Base mínima: en móvil el botón baja de línea antes que partir el nombre de la clave. */}
        <p className="min-w-[min(100%,13rem)] flex-1 text-sm">
          {opcional ? "Para ver más datos, configura la clave " : "Falta configurar la clave "}
          <code className="break-words rounded bg-amber-100 px-1 font-mono text-[0.8rem] dark:bg-amber-900">{secreto}</code>
        </p>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="ml-auto h-11 shrink-0 gap-1 px-3 text-amber-950 hover:bg-amber-100 dark:text-amber-100 dark:hover:bg-amber-900">
            Cómo hacerlo
            <ChevronDown className={`h-4 w-4 transition-transform ${abierto ? "rotate-180" : ""}`} aria-hidden="true" />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="space-y-2 border-t border-amber-200 px-3 pb-3 pt-2 text-sm dark:border-amber-800">
        {ayuda ? (
          <>
            <ol className="list-decimal space-y-1 pl-5">
              {ayuda.pasos.map((p) => <li key={p}>{p}</li>)}
              {!ayuda.yaExiste && (
                <li>
                  Guárdalo en Supabase → proyecto → Edge Functions → Secrets («Add new secret») con el nombre exacto{" "}
                  <code className="break-words font-mono text-[0.8rem]">{secreto}</code>. No hace falta volver a publicar nada: la próxima lectura ya lo usa.
                </li>
              )}
            </ol>
            <p className="text-xs">{ayuda.permisos}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button asChild variant="outline" className="h-11 gap-1.5 bg-background">
                <a href={ayuda.enlace} target="_blank" rel="noopener noreferrer">
                  {ayuda.textoEnlace}
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">(se abre en otra pestaña)</span>
                </a>
              </Button>
              <Button asChild variant="outline" className="h-11 gap-1.5 bg-background">
                <a href={enlaceSecretosSupabase(URL_SUPABASE)} target="_blank" rel="noopener noreferrer">
                  Abrir los secretos de Supabase
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">(se abre en otra pestaña)</span>
                </a>
              </Button>
            </div>
          </>
        ) : (
          <p>Guárdala en Supabase → proyecto → Edge Functions → Secrets con ese nombre exacto.</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
