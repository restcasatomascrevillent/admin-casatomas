import { AlertTriangle, Bot, Check, Copy, Loader2, RefreshCw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Peticion } from "@/lib/peticiones";
import {
  ETIQUETA_REPO,
  ETIQUETA_RIESGO,
  ETIQUETA_TIPO,
  normalizarAnalisis,
  type NivelRiesgo,
} from "../../../supabase/functions/_shared/peticiones";
import { fechaCorta } from "./utilidades";

interface Props {
  peticion: Pick<Peticion, "analisis" | "analisis_estado" | "analisis_error" | "analisis_modelo" | "analizado_en">;
  onReanalizar: () => void;
  reanalizando: boolean;
}

const COLOR_RIESGO: Record<NivelRiesgo, string> = {
  bajo: "text-emerald-700 dark:text-emerald-300",
  medio: "text-amber-700 dark:text-amber-300",
  alto: "text-destructive",
};

function Bloque({ titulo, numero, children, testId }: { titulo: string; numero: number; children: ReactNode; testId: string }) {
  return (
    <section className="space-y-2 rounded-lg border bg-card p-4" aria-labelledby={`bloque-${testId}`} data-testid={testId}>
      <h3 id={`bloque-${testId}`} className="flex items-center gap-2 text-base font-semibold">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs text-primary" aria-hidden="true">{numero}</span>
        {titulo}
      </h3>
      {children}
    </section>
  );
}

async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}

/** El análisis de la IA en tres bloques: «Qué quieren», «Tarea propuesta (cómo lo haría)» y «Prompt para la IA». */
export function AnalisisTicket({ peticion, onReanalizar, reanalizando }: Props) {
  const [copiado, setCopiado] = useState(false);
  const estado = reanalizando ? "analizando" : peticion.analisis_estado;
  const a = estado === "hecho" ? normalizarAnalisis(peticion.analisis) : null;

  const botonReanalizar = (texto = "Volver a analizar") => (
    <Button variant="outline" className="h-11 gap-2" onClick={onReanalizar} disabled={reanalizando}>
      <RefreshCw className={cn("h-4 w-4", reanalizando && "animate-spin")} aria-hidden="true" /> {texto}
    </Button>
  );

  if (estado === "pendiente" || estado === "analizando") {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm" role="status" aria-live="polite" data-testid="analisis-en-curso">
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" aria-hidden="true" />
        <span>{estado === "pendiente" ? "Pendiente de analizar: la IA empieza en un momento…" : "La IA está analizando la petición (suele tardar menos de un minuto)…"}</span>
      </div>
    );
  }

  if (estado === "error" || !a) {
    return (
      <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4" role="alert" data-testid="analisis-error">
        <p className="flex items-start gap-2 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <span>
            <span className="font-medium">No se ha podido analizar.</span>{" "}
            {estado === "error" ? peticion.analisis_error || "Motivo desconocido." : "El análisis guardado no se puede leer."} La petición está guardada igual.
          </span>
        </p>
        {botonReanalizar()}
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="analisis-ticket">
      <Bloque titulo="Qué quieren" numero={1} testId="bloque-que-quieren">
        <p className="text-base">{a.resumen}</p>
        <p className="text-xs text-muted-foreground">Tipo: <span className="font-medium text-foreground">{ETIQUETA_TIPO[a.tipo]}</span></p>
        {a.preguntas.length > 0 && (
          <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
            <p className="font-medium">Habría que preguntarle:</p>
            <ul className="list-disc pl-5">{a.preguntas.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        )}
      </Bloque>

      <Bloque titulo="Tarea propuesta (cómo lo haría)" numero={2} testId="bloque-tarea">
        <p className="whitespace-pre-wrap text-sm">{a.tarea_propuesta}</p>
        {a.pasos.length > 0 && (
          <ol className="list-decimal space-y-1 pl-5 text-sm">{a.pasos.map((p, i) => <li key={`${i}-${p}`}>{p}</li>)}</ol>
        )}
        <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 pt-1 text-sm">
          <dt className="text-muted-foreground">Dónde</dt>
          <dd>{ETIQUETA_REPO[a.repo]}</dd>
          {a.modulos_afectados.length > 0 && (
            <>
              <dt className="text-muted-foreground">Afecta a</dt>
              <dd>{a.modulos_afectados.join(" · ")}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Riesgo</dt>
          <dd>
            <span className={cn("font-semibold", COLOR_RIESGO[a.riesgo.nivel])}>{ETIQUETA_RIESGO[a.riesgo.nivel]}</span>
            {a.riesgo.motivo ? ` · ${a.riesgo.motivo}` : ""}
          </dd>
          <dt className="text-muted-foreground">Base de datos</dt>
          <dd>{a.toca_bd ? "Sí, hay que tocarla (migración en la demo primero)" : "No hace falta tocarla"}</dd>
        </dl>
        {a.criterios_aceptacion.length > 0 && (
          <div className="text-sm">
            <p className="font-medium">Para darla por buena:</p>
            <ul className="list-disc pl-5">{a.criterios_aceptacion.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
        )}
      </Bloque>

      <Bloque titulo="Prompt para la IA" numero={3} testId="bloque-prompt">
        <p className="text-xs text-muted-foreground">Listo para pegar en una IA de programación (incluye las reglas del repositorio).</p>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs" data-testid="prompt-ia">{a.prompt_ia}</pre>
        <Button
          className="h-11 gap-2"
          onClick={async () => {
            if (await copiar(a.prompt_ia)) {
              setCopiado(true);
              toast.success("Prompt copiado");
              setTimeout(() => setCopiado(false), 2000);
            } else {
              toast.error("No se ha podido copiar: selecciona el texto y cópialo a mano.");
            }
          }}
        >
          {copiado ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          {copiado ? "Copiado" : "Copiar prompt"}
        </Button>
      </Bloque>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Bot className="h-3.5 w-3.5" aria-hidden="true" />
          Análisis de la IA{peticion.analisis_modelo ? ` (${peticion.analisis_modelo})` : ""}{peticion.analizado_en ? ` · ${fechaCorta(peticion.analizado_en)}` : ""}. Revísalo antes de usarlo.
        </span>
        {botonReanalizar()}
      </div>
    </div>
  );
}
