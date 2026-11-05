// Una tarjeta del tablero del copiloto: título, la gráfica (o la tabla de la
// respuesta al instante), 1-2 frases de la IA y chips «pregúntale más».
//
// Tocar la tarjeta la SELECCIONA: la siguiente pregunta del copiloto lleva su
// contexto (ver lib/facturas/tableroGraficas.ts). Hay además un botón
// «Seleccionar» explícito para teclado y lectores de pantalla.
import type { MouseEvent } from "react";
import { Bot, Check, Crosshair, Loader2, MessageCirclePlus, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { TEXTO_RPC_NO_DISPONIBLE } from "@/lib/facturas/preguntasRapidas";
import {
  chipsSeguimiento,
  idDomTarjeta,
  serieDeTarjeta,
  tituloTarjeta,
  type ChipSeguimiento,
  type Tarjeta,
} from "@/lib/facturas/tableroGraficas";
import { GraficoSeriePrecio } from "../GraficoSeriePrecio";
import type { PreguntaRapida } from "../preguntas-rapidas/catalogo";

/** Alto de la gráfica en el tablero: más grande que en el chat de antes. */
const ALTO_GRAFICA_TABLERO = 240;


const FOCO = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38,59%,45%)] focus-visible:ring-offset-2 focus-visible:ring-offset-background";

interface Props {
  tarjeta: Tarjeta;
  /** Entrada del catálogo de preguntas rápidas (solo tarjetas «al instante»). */
  pregunta?: PreguntaRapida;
  seleccionada: boolean;
  onAlternarSeleccion: () => void;
  onQuitar: () => void;
  onSeguimiento: (chip: ChipSeguimiento) => void;
  /** La IA está contestando: los chips esperan. */
  ocupado?: boolean;
}

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });

/** Los clics en controles de dentro (o en un diálogo abierto desde la tarjeta) no la seleccionan. */
const esClicEnControl = (e: MouseEvent) =>
  !!(e.target as HTMLElement).closest?.("button, a, input, select, textarea, label, [role='dialog'], [role='menu'], [data-no-seleccionar]");

export function TarjetaGrafica({ tarjeta, pregunta, seleccionada, onAlternarSeleccion, onQuitar, onSeguimiento, ocupado }: Props) {
  const titulo = tituloTarjeta(tarjeta, pregunta?.etiqueta);
  const serie = serieDeTarjeta(tarjeta);
  const chips = chipsSeguimiento(tarjeta);
  const esIa = tarjeta.origen === "ia";
  const Icono = esIa ? Bot : (pregunta?.icono ?? Zap);

  return (
    <section
      id={idDomTarjeta(tarjeta.id)}
      // -1: «Ver gráfica» del copiloto le lleva el foco.
      tabIndex={-1}
      aria-label={titulo}
      aria-current={seleccionada ? "true" : undefined}
      data-seleccionada={seleccionada || undefined}
      onClick={(e) => {
        if (!esClicEnControl(e)) onAlternarSeleccion();
      }}
      className={cn(
        "animate-in fade-in slide-in-from-top-2 scroll-mt-2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38,59%,45%)] border bg-card p-3 shadow-sm transition-[border-color,box-shadow] duration-300 sm:p-4",
        seleccionada
          ? "border-[hsl(38,59%,45%)] ring-2 ring-[hsl(38,59%,45%)]/40"
          : "border-border/60 hover:border-border",
      )}
    >
      <header className="mb-2 flex items-start gap-2">
        <div
          className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
            esIa ? "bg-[hsl(38,59%,45%)]/10 text-[hsl(38,59%,38%)] dark:text-[hsl(38,59%,60%)]" : "bg-muted text-foreground",
          )}
        >
          <Icono className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-tight text-foreground sm:text-base">{titulo}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {esIa ? (
              <>Gráfica de la IA</>
            ) : (
              <>
                {pregunta?.descripcion}
                {pregunta?.descripcion ? " · " : null}
                <span className="whitespace-nowrap">al instante, sin IA</span>
              </>
            )}
            {" · "}
            {hora(tarjeta.creadoEn)}
          </p>
        </div>
        <button
          type="button"
          onClick={onAlternarSeleccion}
          aria-pressed={seleccionada}
          title={seleccionada ? "Dejar de preguntar sobre esta gráfica" : "Preguntar al copiloto sobre esta gráfica"}
          className={cn(
            "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
            FOCO,
            seleccionada
              ? "bg-[hsl(38,59%,45%)] text-white hover:bg-[hsl(38,59%,38%)]"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {seleccionada ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Crosshair className="h-3.5 w-3.5" aria-hidden />}
          {seleccionada ? "Seleccionada" : "Seleccionar"}
        </button>
        <button
          type="button"
          onClick={onQuitar}
          className={cn(
            "-mr-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
            FOCO,
          )}
          aria-label="Quitar esta tarjeta"
          title="Quitar del tablero"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>

      <CuerpoTarjeta tarjeta={tarjeta} pregunta={pregunta} conSerie={!!serie} />

      {esIa && tarjeta.explicacion && (
        <p className="mt-2 text-sm leading-snug text-foreground/90">{tarjeta.explicacion}</p>
      )}

      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={`Pregúntale más sobre ${titulo}`}>
          <MessageCirclePlus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          {chips.map((c) => (
            <button
              key={c.etiqueta}
              type="button"
              disabled={ocupado}
              onClick={() => onSeguimiento(c)}
              title={c.pregunta}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border border-border/70 px-3 text-xs text-foreground transition-colors sm:text-sm",
                "hover:border-[hsl(38,59%,45%)] hover:text-[hsl(38,59%,32%)] dark:hover:text-[hsl(38,59%,62%)]",
                "disabled:cursor-not-allowed disabled:opacity-50",
                FOCO,
              )}
            >
              {c.etiqueta}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function CuerpoTarjeta({ tarjeta, pregunta, conSerie }: { tarjeta: Tarjeta; pregunta?: PreguntaRapida; conSerie: boolean }) {
  if (tarjeta.origen === "ia") {
    return <GraficoSeriePrecio datos={tarjeta.serie} compacto alto={ALTO_GRAFICA_TABLERO} />;
  }
  const r = tarjeta.resultado;
  if (r.estado === "cargando") {
    return (
      <div className="space-y-2" aria-busy="true">
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Consultando…
        </p>
        <div className="h-24 animate-pulse rounded-md bg-muted/60" aria-hidden />
      </div>
    );
  }
  if (r.estado === "error") {
    return (
      <p className="text-sm text-destructive" role="alert">
        No se ha podido consultar: {r.error}
      </p>
    );
  }
  if (r.estado === "no_disponible") {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        {TEXTO_RPC_NO_DISPONIBLE}
      </p>
    );
  }
  if (conSerie) return <GraficoSeriePrecio datos={r.datos} compacto alto={ALTO_GRAFICA_TABLERO} />;
  const Resultado = pregunta?.Resultado;
  return Resultado ? <Resultado datos={r.datos} /> : null;
}

