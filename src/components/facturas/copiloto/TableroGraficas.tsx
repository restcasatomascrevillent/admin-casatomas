// Área central del copiloto: las gráficas que se van generando, como tarjetas
// que se quedan fijadas (la más reciente arriba). Solo esta zona hace scroll.
import { useEffect, useRef, type ReactNode } from "react";
import { LineChart, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChipSeguimiento, Tarjeta } from "@/lib/facturas/tableroGraficas";
import type { PreguntaRapida } from "../preguntas-rapidas/catalogo";
import { SelectorEvolucionPrecio } from "../preguntas-rapidas/SelectorEvolucionPrecio";
import { TarjetaGrafica } from "./TarjetaGrafica";

/** Respuestas al instante que son gráficas o rankings: las del estado vacío del tablero. */
const ATAJOS_TABLERO = ["evolucion-precio", "gasto-por-mes", "top-proveedores", "gasto-categoria", "subidas-precio"];

interface Props {
  tarjetas: Tarjeta[];
  catalogo: PreguntaRapida[];
  seleccionadaId: string | null;
  onAlternarSeleccion: (id: string) => void;
  onQuitar: (t: Tarjeta) => void;
  onSeguimiento: (t: Tarjeta, chip: ChipSeguimiento) => void;
  /** Lanza una respuesta al instante (sin IA) desde el estado vacío. */
  onAtajo: (preguntaId: string, parametros?: unknown) => void;
  cargandoAtajo: (preguntaId: string) => boolean;
  atajoNoDisponible: (preguntaId: string) => boolean;
  /** Abriendo una conversación del historial. */
  cargando: boolean;
  /** La IA está contestando. */
  pensando: boolean;
  /** Barra superior (historial, «Al instante», limpiar). */
  barra: ReactNode;
}

const FOCO = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38,59%,45%)] focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function TableroGraficas({
  tarjetas,
  catalogo,
  seleccionadaId,
  onAlternarSeleccion,
  onQuitar,
  onSeguimiento,
  onAtajo,
  cargandoAtajo,
  atajoNoDisponible,
  cargando,
  pensando,
  barra,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Al llegar una tarjeta nueva (va arriba), el tablero vuelve arriba para verla.
  const primera = tarjetas[0]?.id;
  useEffect(() => {
    if (primera) scrollRef.current?.scrollTo?.({ top: 0, behavior: "smooth" });
  }, [primera]);

  const porId = (id: string) => catalogo.find((p) => p.id === id);
  const vacio = tarjetas.length === 0;

  return (
    <section aria-labelledby="tablero-graficas-titulo" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <h2 id="tablero-graficas-titulo" className="sr-only">
        Tablero de gráficas
      </h2>
      {barra}

      {pensando && (
        // Solo visual: el copiloto ya anuncia «Escribiendo…» a los lectores de pantalla.
        <p className="flex shrink-0 items-center gap-2 px-1 pb-1 text-xs text-muted-foreground" aria-hidden="true">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[hsl(38,59%,45%)]" />
          La IA está preparando la respuesta; si trae gráfica, aparecerá aquí arriba.
        </p>
      )}

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-lg"
        data-tour="facturas-ia-tablero"
        aria-busy={cargando || undefined}
      >
        {cargando && vacio ? (
          <div className="grid gap-3 p-1" aria-hidden>
            {[0, 1].map((i) => (
              <div key={i} className="h-64 animate-pulse rounded-xl border border-border/40 bg-muted/40" />
            ))}
          </div>
        ) : vacio ? (
          <EstadoVacio
            atajos={ATAJOS_TABLERO.map(porId).filter((p): p is PreguntaRapida => !!p && !p.proximamente && !!p.consultar)}
            onAtajo={onAtajo}
            cargando={cargandoAtajo}
            noDisponible={atajoNoDisponible}
          />
        ) : (
          <ul className="grid gap-3 p-1 2xl:grid-cols-2" aria-label="Gráficas del tablero">
            {tarjetas.map((t) => (
              <li key={t.id} className="min-w-0">
                <TarjetaGrafica
                  tarjeta={t}
                  pregunta={t.origen === "rapida" ? porId(t.resultado.preguntaId) : undefined}
                  seleccionada={seleccionadaId === t.id}
                  onAlternarSeleccion={() => onAlternarSeleccion(t.id)}
                  onQuitar={() => onQuitar(t)}
                  onSeguimiento={(chip) => onSeguimiento(t, chip)}
                  ocupado={pensando}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function EstadoVacio({
  atajos,
  onAtajo,
  cargando,
  noDisponible,
}: {
  atajos: PreguntaRapida[];
  onAtajo: (id: string, parametros?: unknown) => void;
  cargando: (id: string) => boolean;
  noDisponible: (id: string) => boolean;
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 px-4 py-6 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-[hsl(38,59%,45%)]">
        <LineChart className="h-5 w-5" aria-hidden />
      </div>
      <div className="max-w-md">
        <h3 className="text-base font-semibold text-foreground">Aquí se quedan tus gráficas</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Pídele una gráfica al copiloto («¿cómo ha ido el precio de la merluza?») o saca una al instante, sin IA.
          Toca una gráfica para preguntar sobre ella.
        </p>
      </div>
      {atajos.length > 0 && (
        <ul className="grid w-full max-w-xl gap-2 sm:grid-cols-2" aria-label="Gráficas al instante, sin IA">
          {atajos.map((p) => {
            const Icono = p.icono;
            const ocupado = cargando(p.id);
            const pendiente = noDisponible(p.id);
            const boton = (
              <button
                type="button"
                onClick={p.pide ? undefined : () => onAtajo(p.id)}
                disabled={ocupado || pendiente}
                aria-busy={ocupado || undefined}
                title={p.descripcion}
                className={cn(
                  "flex min-h-11 w-full items-center gap-2.5 rounded-lg border border-border/60 bg-card px-3 py-2 text-left text-sm text-foreground transition-colors",
                  "hover:border-[hsl(38,59%,45%)] disabled:cursor-not-allowed disabled:opacity-50",
                  FOCO,
                )}
              >
                {ocupado ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                ) : (
                  <Icono className="h-4 w-4 shrink-0 text-[hsl(38,59%,45%)]" aria-hidden />
                )}
                <span className="min-w-0 flex-1 leading-snug">{p.etiqueta}</span>
                {pendiente && <span className="text-xs text-muted-foreground">pendiente</span>}
              </button>
            );
            return (
              <li key={p.id}>
                {p.pide === "producto" && !pendiente ? (
                  <SelectorEvolucionPrecio onElegir={(params) => onAtajo(p.id, params)}>{boton}</SelectorEvolucionPrecio>
                ) : (
                  boton
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
