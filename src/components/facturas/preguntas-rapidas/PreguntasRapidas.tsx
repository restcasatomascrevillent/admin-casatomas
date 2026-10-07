// Botonera y tarjeta de las PREGUNTAS RÁPIDAS del chat de facturas.
// Ninguna de las dos toca la IA: los botones llaman a RPC SQL y la tarjeta
// pinta el resultado en el hilo como «mensaje del sistema» (solo en memoria;
// ver usePreguntasRapidas.ts).
import { Loader2, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResultadoRapido } from "@/hooks/usePreguntasRapidas";
import { TEXTO_RPC_NO_DISPONIBLE } from "@/lib/facturas/preguntasRapidas";
import type { PreguntaRapida } from "./catalogo";

interface BarraProps {
  catalogo: PreguntaRapida[];
  onPreguntar: (preguntaId: string) => void;
  cargando: (preguntaId: string) => boolean;
  /** La RPC aún no existe en la BD (migración sin aplicar). */
  noDisponible?: (preguntaId: string) => boolean;
}

/**
 * Una sola fila con desplazamiento horizontal: no crece en alto (la pestaña IA
 * tiene altura calculada y sin scroll de página). Botones de 44 px.
 */
export function BarraPreguntasRapidas({ catalogo, onPreguntar, cargando, noDisponible = () => false }: BarraProps) {
  return (
    <div
      role="group"
      aria-label="Respuestas al instante, sin IA"
      className="flex shrink-0 items-center gap-2 overflow-x-auto border-t border-border/60 bg-background/80 px-3 py-1.5 [scrollbar-width:thin]"
    >
      <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground" title="Responden al momento leyendo los datos, sin usar la IA">
        <Zap className="h-3.5 w-3.5" aria-hidden />
        <span className="hidden sm:inline">Al instante:</span>
      </span>
      {catalogo.map((p) => {
        const Icono = p.icono;
        const ocupado = cargando(p.id);
        const pendiente = noDisponible(p.id);
        const deshabilitado = !!p.proximamente || !p.consultar || ocupado || pendiente;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onPreguntar(p.id)}
            disabled={deshabilitado}
            title={pendiente ? TEXTO_RPC_NO_DISPONIBLE : p.descripcion}
            aria-busy={ocupado || undefined}
            className={cn(
              "inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border/70 bg-card px-3.5 text-sm text-foreground transition-colors",
              "hover:border-[hsl(38,59%,45%)] hover:text-[hsl(38,59%,35%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38,59%,45%)]",
              "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border/70 disabled:hover:text-foreground",
            )}
          >
            {ocupado ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Icono className="h-4 w-4" aria-hidden />}
            {p.etiqueta}
            {p.proximamente && <span className="text-xs text-muted-foreground">· próximamente</span>}
            {pendiente && <span className="text-xs text-muted-foreground">· pendiente</span>}
          </button>
        );
      })}
    </div>
  );
}

interface TarjetaProps {
  resultado: ResultadoRapido;
  pregunta: PreguntaRapida | undefined;
  onDescartar: (id: string) => void;
}

export function TarjetaResultadoRapido({ resultado, pregunta, onDescartar }: TarjetaProps) {
  const Icono = pregunta?.icono ?? Zap;
  const Resultado = pregunta?.Resultado;
  return (
    <section
      aria-label={`Respuesta al instante: ${pregunta?.etiqueta ?? resultado.preguntaId}`}
      className="animate-in fade-in slide-in-from-bottom-2 rounded-xl border border-dashed border-border bg-card/80 p-3 shadow-sm duration-300"
    >
      <header className="mb-2 flex items-start gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
          <Icono className="h-3.5 w-3.5 text-foreground" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-tight text-foreground">{pregunta?.etiqueta ?? "Consulta"}</h3>
          <p className="text-xs text-muted-foreground">
            {pregunta?.descripcion}
            {" · "}
            <span className="whitespace-nowrap">al instante, sin IA</span>
            {" · "}
            {new Date(resultado.creadoEn).toLocaleTimeString("es-ES", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Europe/Madrid",
            })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onDescartar(resultado.id)}
          className="-mr-1 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Quitar esta respuesta"
          title="Quitar"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {resultado.estado === "cargando" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Consultando…
        </p>
      )}
      {resultado.estado === "error" && (
        <p className="text-sm text-destructive" role="alert">
          No se ha podido consultar: {resultado.error}
        </p>
      )}
      {resultado.estado === "no_disponible" && (
        <p className="text-sm text-muted-foreground" role="status">
          {TEXTO_RPC_NO_DISPONIBLE}
        </p>
      )}
      {resultado.estado === "ok" && Resultado && <Resultado datos={resultado.datos} />}
    </section>
  );
}
