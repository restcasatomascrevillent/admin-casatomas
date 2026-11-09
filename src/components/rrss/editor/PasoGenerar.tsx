import { useState } from "react";
import { AlertTriangle, HelpCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Generacion } from "@/components/rrss/api";
import { EstadoGeneracion } from "./EstadoGeneracion";
import type { ErrorGeneracion, FaseGeneracion } from "./useGenerar";

interface Props {
  /** Líneas del resumen de lo que se va a generar. */
  resumen: string[];
  /** Por qué no se puede generar ahora (null = se puede). */
  bloqueo: string | null;
  fase: FaseGeneracion;
  error: ErrorGeneracion | null;
  preguntas: string[];
  ocupado: boolean;
  generacion: Generacion | null | undefined;
  piezas: number;
  cancelando: boolean;
  onGenerar: () => void;
  onBasico: () => void;
  onSeguir: () => void;
  onResponder: (respuesta: string) => void;
  onCancelar: () => void;
  onVerResultado: () => void;
}

const SIN_IA = new Set(["ia_no_disponible", "configuracion", "servidor"]);

export function PasoGenerar({ resumen, bloqueo, fase, error, preguntas, ocupado, generacion, piezas, cancelando, onGenerar, onBasico, onSeguir, onResponder, onCancelar, onVerResultado }: Props) {
  const [respuesta, setRespuesta] = useState("");
  const sinIa = fase === "error" && error?.etapa === "ia" && SIN_IA.has(error.tipo ?? "");
  const sinReintento = error?.tipo === "cupo";
  const deshabilitado = ocupado || !!bloqueo;

  return (
    <div className="space-y-4">
      <ul className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm" aria-label="Resumen del trabajo">
        {resumen.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>

      <div className="space-y-2">
        <Button type="button" size="lg" className="gap-2" disabled={deshabilitado} onClick={onGenerar} data-testid="generar-ia">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          Generar con IA
        </Button>
        {bloqueo && !ocupado && <p className="text-xs text-muted-foreground">{bloqueo}</p>}
        {ocupado && <p className="text-xs text-muted-foreground">Hay una generación en marcha: hasta que acabe no se puede lanzar otra.</p>}
      </div>

      <EstadoGeneracion fase={fase} generacion={generacion} piezas={piezas} onCancelar={onCancelar} cancelando={cancelando} onReintentar={onGenerar} onVerResultado={onVerResultado} />

      {fase === "preguntas" && (
        <section aria-labelledby="preguntas-ia" className="space-y-3 rounded-md border-2 border-[#e7b008] bg-[#e7b008]/10 p-3 text-sm" data-testid="preguntas-ia">
          <h3 id="preguntas-ia" className="flex items-center gap-2 font-semibold">
            <HelpCircle className="h-4 w-4" aria-hidden="true" /> La IA necesita saber algo antes de seguir
          </h3>
          <ul className="list-disc space-y-1 pl-5">
            {preguntas.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <div className="space-y-1.5">
            <Label htmlFor="respuesta-ia">Tu respuesta</Label>
            <Textarea id="respuesta-ia" rows={3} value={respuesta} onChange={(e) => setRespuesta(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={!respuesta.trim() || ocupado}
              onClick={() => {
                onResponder(respuesta.trim());
                setRespuesta("");
              }}
            >
              Añadir respuesta a las instrucciones y volver a proponer
            </Button>
            <Button type="button" variant="outline" disabled={ocupado} onClick={onSeguir}>
              Seguir así
            </Button>
          </div>
        </section>
      )}

      {fase === "error" && error && (
        <div role="alert" data-testid="error-generacion" className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="flex items-start gap-2 font-medium">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            <span className="break-words">{error.mensaje}</span>
          </p>
          {sinReintento && <p className="text-xs text-muted-foreground">Has llegado al tope de uso: no se puede reintentar ahora.</p>}
          <div className="flex flex-wrap gap-2">
            {!sinReintento && (
              <Button type="button" variant="outline" size="sm" disabled={ocupado} onClick={onGenerar}>
                Reintentar
              </Button>
            )}
            {sinIa && (
              <Button type="button" size="sm" disabled={ocupado || !!bloqueo} onClick={onBasico}>
                Generar con la edición básica (sin IA)
              </Button>
            )}
          </div>
          {sinIa && <p className="text-xs text-muted-foreground">La edición básica aplica el estilo y centra el encuadre, sin propuesta de la IA.</p>}
        </div>
      )}
    </div>
  );
}
