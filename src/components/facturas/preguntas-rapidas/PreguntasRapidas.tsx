// Botonera y tarjeta de las PREGUNTAS RÁPIDAS del chat de facturas.
// Ninguna de las dos toca la IA: los botones llaman a RPC SQL y la tarjeta
// pinta el resultado en el hilo como «mensaje del sistema» (solo en memoria;
// ver usePreguntasRapidas.ts).
import { useState } from "react";
import { ChevronDown, Loader2, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResultadoRapido } from "@/hooks/usePreguntasRapidas";
import { TEXTO_RPC_NO_DISPONIBLE } from "@/lib/facturas/preguntasRapidas";
import type { PreguntaRapida } from "./catalogo";
import { SelectorEvolucionPrecio } from "./SelectorEvolucionPrecio";

interface BarraProps {
  catalogo: PreguntaRapida[];
  onPreguntar: (preguntaId: string, parametros?: unknown) => void;
  cargando: (preguntaId: string) => boolean;
  /** La RPC aún no existe en la BD (migración sin aplicar). */
  noDisponible?: (preguntaId: string) => boolean;
}

/**
 * «Al instante ▾»: un botón discreto encima de la caja de escribir que despliega
 * los chips de las preguntas (se envuelven en varias líneas, sin barra de scroll).
 * Cerrado ocupa una sola línea: la pestaña IA tiene altura calculada y sin
 * scroll de página. Al lanzar una pregunta se vuelve a plegar.
 */
export function BarraPreguntasRapidas({ catalogo, onPreguntar, cargando, noDisponible = () => false }: BarraProps) {
  const [abierta, setAbierta] = useState(false);
  const lanzar = (id: string, parametros?: unknown) => {
    onPreguntar(id, parametros);
    setAbierta(false);
  };
  return (
    <div className="mx-auto w-full max-w-3xl shrink-0 px-3 sm:px-4" data-tour="facturas-ia-al-instante">
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        data-tour="facturas-ia-al-instante-abrir"
        aria-expanded={abierta}
        title="Responden al momento leyendo los datos, sin usar la IA"
        className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38,59%,45%)] pointer-coarse:h-11 pointer-coarse:px-3"
      >
        <Zap className="h-3.5 w-3.5" aria-hidden />
        Al instante
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", abierta && "rotate-180")} aria-hidden />
      </button>
      {abierta && (
        <div
          role="group"
          aria-label="Respuestas al instante, sin IA"
          className="flex flex-wrap gap-1.5 pb-2 pt-1"
        >
          {catalogo.map((p) => {
            const Icono = p.icono;
            const ocupado = cargando(p.id);
            const pendiente = noDisponible(p.id);
            const deshabilitado = !!p.proximamente || !p.consultar || ocupado || pendiente;
            const boton = (
              <button
                key={p.id}
                type="button"
                onClick={p.pide ? undefined : () => lanzar(p.id)}
                disabled={deshabilitado}
                title={pendiente ? TEXTO_RPC_NO_DISPONIBLE : p.descripcion}
                aria-busy={ocupado || undefined}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border/60 px-3 text-xs text-foreground transition-colors pointer-coarse:h-11 pointer-coarse:text-sm",
                  "hover:border-[hsl(38,59%,45%)] hover:text-[hsl(38,59%,35%)] dark:hover:text-[hsl(38,59%,60%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38,59%,45%)]",
                  "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border/60 disabled:hover:text-foreground",
                )}
              >
                {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Icono className="h-3.5 w-3.5" aria-hidden />}
                {p.etiqueta}
                {p.proximamente && <span className="text-xs text-muted-foreground">· próximamente</span>}
                {pendiente && <span className="text-xs text-muted-foreground">· pendiente</span>}
              </button>
            );
            // Las preguntas con parámetros abren antes un selector (producto, unidad…).
            return p.pide === "producto" && !deshabilitado ? (
              <SelectorEvolucionPrecio key={p.id} onElegir={(params) => lanzar(p.id, params)}>
                {boton}
              </SelectorEvolucionPrecio>
            ) : (
              boton
            );
          })}
        </div>
      )}
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
      className="animate-in fade-in slide-in-from-bottom-2 rounded-lg border border-border/60 bg-muted/20 p-3 duration-300"
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
