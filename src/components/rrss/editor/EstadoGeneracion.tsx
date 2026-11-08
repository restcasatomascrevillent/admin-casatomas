import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { generacionActiva, type Generacion } from "@/components/rrss/api";
import type { FaseGeneracion } from "./useGenerar";

interface Props {
  fase: FaseGeneracion;
  generacion: Generacion | null | undefined;
  /** Piezas que se están haciendo (para «foto 2 de 5»). */
  piezas: number;
  onCancelar: () => void;
  cancelando: boolean;
  onReintentar: () => void;
  onVerResultado: () => void;
}

const TEXTO_FASE: Partial<Record<FaseGeneracion, string>> = {
  guardando: "Guardando el trabajo…",
  planificando: "La IA está preparando la edición…",
  lanzando: "Enviando la edición al motor…",
};

export function EstadoGeneracion({ fase, generacion: g, piezas, onCancelar, cancelando, onReintentar, onVerResultado }: Props) {
  const textoFase = TEXTO_FASE[fase];
  if (textoFase) {
    return (
      <div role="status" className="flex items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {textoFase}
      </div>
    );
  }
  if (!g) return null;

  if (generacionActiva(g)) {
    const fraccion = Math.min(1, Math.max(0, g.progreso?.fraccion ?? 0));
    const n = Math.max(1, g.piezas?.length ?? piezas);
    const actual = Math.min(n, Math.floor(fraccion * n) + 1);
    const titulo = g.estado === "pendiente" ? "En cola, enseguida empieza…" : g.medio === "video" ? "Montando el vídeo…" : `Editando fotos ${actual} de ${n}…`;
    return (
      <div role="status" data-testid="generacion-activa" className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2 font-medium">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {titulo}
          </span>
          <Button type="button" variant="outline" size="sm" disabled={cancelando} onClick={onCancelar}>
            Cancelar
          </Button>
        </div>
        <Progress value={Math.round(fraccion * 100)} className="h-2" aria-label="Progreso de la generación" />
        {g.progreso?.paso && <p className="text-xs text-muted-foreground">{g.progreso.paso}</p>}
        <p className="text-xs text-muted-foreground">Puedes salir de esta pantalla: el trabajo sigue y lo verás al volver.</p>
      </div>
    );
  }

  if (g.estado === "error") {
    return (
      <div role="alert" data-testid="generacion-error" className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
        <p className="flex items-start gap-2 font-medium">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          La última generación ha fallado
        </p>
        <p className="break-words text-muted-foreground">{g.error || "El motor no ha dado más detalles."}</p>
        <Button type="button" variant="outline" size="sm" onClick={onReintentar}>
          Reintentar
        </Button>
      </div>
    );
  }
  if (g.estado === "cancelado") {
    return (
      <p className="flex items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
        <XCircle className="h-4 w-4" aria-hidden="true" /> Cancelaste la última generación.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[rgb(17_126_57/0.3)] bg-[rgb(17_126_57/0.06)] p-3 text-sm">
      <span className="flex items-center gap-2 text-[#117e39]">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> La última generación ha terminado.
      </span>
      <Button type="button" variant="outline" size="sm" onClick={onVerResultado}>
        Ver el resultado
      </Button>
    </div>
  );
}
