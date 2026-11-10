import { formatoSalida, problemasArchivos, proporcion, TIPOS_CONTENIDO, type Canal, type Medio, type TipoContenido } from "@/lib/rrss/formatos";
import { cn } from "@/lib/utils";

interface Props {
  canal: Canal;
  tipo: TipoContenido;
  /** Archivos ya subidos (para saber qué contenidos casan). */
  archivos: { tipo: Medio }[];
  onTipo: (t: TipoContenido) => void;
}

export function PasoContenido({ canal, tipo, archivos, onTipo }: Props) {
  const hayVideos = archivos.some((a) => a.tipo === "video");
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Elige qué vas a crear. Las medidas son las que publica cada red para ese formato.</p>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" role="group" aria-label="Tipo de contenido">
        {TIPOS_CONTENIDO.map((t) => {
          const f = formatoSalida(canal, t, hayVideos);
          const motivo = archivos.length > 0 ? problemasArchivos(f, archivos)[0] : undefined;
          const activo = tipo === t;
          return (
            <button
              key={t}
              type="button"
              disabled={!!motivo}
              aria-pressed={activo}
              data-testid={`tipo:${t}`}
              onClick={() => onTipo(t)}
              className={cn(
                "flex min-h-11 flex-col items-start gap-1 rounded-lg border p-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                activo ? "border-primary bg-primary/5" : "border-border hover:bg-muted",
                motivo && "cursor-not-allowed opacity-60 hover:bg-transparent",
              )}
            >
              <span className="font-medium">{f.etiqueta}</span>
              <span className="text-xs text-muted-foreground">{f.descripcion}</span>
              <span className="text-xs text-muted-foreground">
                {f.ancho}×{f.alto} px · {proporcion(f)} · {f.medio === "video" ? "sale en vídeo" : "sale en imagen"}
              </span>
              {motivo && <span className="text-xs font-medium text-destructive">{motivo}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
