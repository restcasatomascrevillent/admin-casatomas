import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, PlayCircle, TriangleAlert } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { supabase } from "@/integrations/supabase/client";
import type { DraftBotWeb, IdiomaBotWeb } from "@/hooks/useConfigBotWeb";
import { IDIOMAS } from "./constantesBot";

interface VistaPreviaBotProps {
  /** es = borrador en edición; en/fr = lo último traducido y guardado. */
  borradores: Record<IdiomaBotWeb, DraftBotWeb>;
}

const SALUDO: Record<IdiomaBotWeb, { manana: string; tarde: string; noche: string }> = {
  es: { manana: "Buenos días", tarde: "Buenas tardes", noche: "Buenas noches" },
  en: { manana: "Good morning", tarde: "Good afternoon", noche: "Good evening" },
  fr: { manana: "Bonjour", tarde: "Bon après-midi", noche: "Bonsoir" },
};

// Mismos tramos horarios que contextoTemporalMadrid() en
// supabase/functions/chat-web/index.ts (hora de Madrid; 06-12 / 12-20 / 20-06).
// Se duplica aquí a propósito: es UI de vista previa en el navegador del
// dueño, no puede importar código de una Edge Function Deno.
function saludoActual(idioma: IdiomaBotWeb): string {
  const hora = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hour12: false }).format(new Date()),
  );
  const g = SALUDO[idioma];
  return hora >= 6 && hora < 12 ? g.manana : hora >= 12 && hora < 20 ? g.tarde : g.noche;
}

type ResultadoPrueba = { tipo: "ok" | "no_disponible" | "error"; texto: string };

// La prueba en vivo es una acción de solo lectura respecto a configBotWeb
// (no guarda nada): invoca la Edge Function real. Ahora mismo chat-web
// devuelve 404 (no está desplegada) y sus tablas de memoria tampoco existen
// — en vez de dejar que eso se vea como un fallo roto o un "no funciona"
// genérico, se explica la causa más probable con claridad.
async function probarBotEnVivo(idioma: IdiomaBotWeb): Promise<ResultadoPrueba> {
  try {
    const { data, error } = await supabase.functions.invoke("chat-web", {
      body: { mensaje: "Hola, ¿qué tal?", idiom: idioma },
    });

    if (error) {
      const status = (error as { context?: { status?: number } })?.context?.status;
      if (status === 404) {
        return {
          tipo: "no_disponible",
          texto: "La función chat-web todavía no está desplegada en producción (404). No es un problema de tu configuración — la vista previa de arriba sí refleja lo que has escrito.",
        };
      }
      if (status === 503) {
        return {
          tipo: "no_disponible",
          texto: "El bot respondió que su limitador de peticiones no está disponible (503) — probablemente porque las tablas de memoria de chat-web aún no existen en la base de datos. Tampoco es un problema de esta configuración.",
        };
      }
      return {
        tipo: "error",
        texto: `No se pudo contactar con el bot en vivo (${status ?? "error de red"}): ${error.message}`,
      };
    }

    if (data?.success === false) {
      return { tipo: "error", texto: data.respuesta || "El bot respondió con un error." };
    }
    return { tipo: "ok", texto: data?.respuesta || "(respuesta vacía)" };
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    return {
      tipo: "no_disponible",
      texto: `No se pudo conectar con el bot en vivo. Lo más probable es que chat-web todavía no esté desplegada. Detalle técnico: ${detalle}`,
    };
  }
}

export function VistaPreviaBot({ borradores }: VistaPreviaBotProps) {
  const [idioma, setIdioma] = useState<IdiomaBotWeb>("es");
  const draft = borradores[idioma];
  const saludo = useMemo(() => saludoActual(idioma), [idioma]);
  const [probando, setProbando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoPrueba | null>(null);

  const handleProbar = async () => {
    setProbando(true);
    setResultado(null);
    const r = await probarBotEnVivo(idioma);
    setResultado(r);
    setProbando(false);
  };

  return (
    <Card className="p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5">
          <h3 className="text-base font-semibold">Vista previa</h3>
          <p className="text-sm text-muted-foreground">
            {idioma === "es"
              ? "Cómo se comportará el bot con lo que ves ahora. Se actualiza sola, sin guardar."
              : "Lo último traducido y guardado en este idioma (no incluye cambios sin guardar)."}
          </p>
        </div>
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={idioma}
          onValueChange={(v) => {
            if (!v) return;
            setIdioma(v as IdiomaBotWeb);
            setResultado(null);
          }}
          aria-label="Idioma de la vista previa"
        >
          {IDIOMAS.map((i) => (
            <ToggleGroupItem key={i.value} value={i.value} className="h-7 px-2 text-xs uppercase" title={i.label}>
              {i.value}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
            Primer mensaje de una conversación nueva
          </p>
          <div className="rounded-2xl rounded-tl-sm bg-muted px-4 py-2.5 text-sm inline-block max-w-full">
            <span className="font-medium">{saludo}.</span>{" "}
            {draft.mensaje_bienvenida ? (
              draft.mensaje_bienvenida
            ) : (
              <span className="italic text-muted-foreground">
                (sin mensaje de bienvenida — el bot improvisará un saludo genérico en el tono elegido)
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5">
            El saludo ("{saludo}") lo calcula el bot solo, según la hora en Madrid — el mensaje de bienvenida es
            una sugerencia que se combina con él, no un texto fijo palabra por palabra.
          </p>
        </div>

        <div className="space-y-1.5 text-sm border-t pt-3">
          <p>
            <span className="text-muted-foreground">Tono: </span>
            {draft.tono || "(sin definir — usará un tono profesional genérico por defecto)"}
          </p>
          <p>
            <span className="text-muted-foreground">Priorizará estos platos </span>
            <span className="text-muted-foreground">(si siguen activos en la pestaña Carta): </span>
            {draft.platos.length ? draft.platos.join(", ") : "ninguno — recomendará libremente entre los platos activos"}
          </p>
          <p>
            <span className="text-muted-foreground">Priorizará estos vinos </span>
            <span className="text-muted-foreground">(si siguen activos en la pestaña Carta): </span>
            {draft.vinos.length ? draft.vinos.join(", ") : "ninguno — recomendará libremente entre los vinos activos"}
          </p>
          <p>
            <span className="text-muted-foreground">Frases que puede usar cuando encajen: </span>
            {draft.frases_personalizadas || "ninguna"}
          </p>
          <div>
            <span className="text-muted-foreground">Instrucciones extra que seguirá al pie de la letra:</span>
            {draft.instrucciones_extra ? (
              <pre className="mt-1 whitespace-pre-wrap text-xs bg-muted/50 border rounded-md p-2 font-sans">
                {draft.instrucciones_extra}
              </pre>
            ) : (
              <span className="italic text-muted-foreground"> ninguna</span>
            )}
          </div>
        </div>

        <div className="border-t pt-3">
          <Button type="button" variant="outline" size="sm" onClick={handleProbar} disabled={probando}>
            {probando ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" />
            ) : (
              <PlayCircle className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            )}
            Probar el bot en vivo
          </Button>
          {resultado && (
            <div
              role="status"
              className={`mt-2 text-xs rounded-md border p-2.5 leading-relaxed ${
                resultado.tipo === "ok"
                  ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-900/40"
                  : resultado.tipo === "no_disponible"
                  ? "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900/40"
                  : "bg-destructive/10 border-destructive/30"
              }`}
            >
              {resultado.tipo !== "ok" && <TriangleAlert className="h-3.5 w-3.5 inline mr-1 -mt-0.5" />}
              {resultado.texto}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
