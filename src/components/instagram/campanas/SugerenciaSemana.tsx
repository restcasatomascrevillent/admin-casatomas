/**
 * «Sugerencia de la semana» para la futura pantalla de Inicio de Instagram
 * (maqueta: pantalla «Estudio»). Enseña gratis (sin IA) las fechas señaladas
 * de la semana (RPC marketing_fechas_entre) y, solo al pulsar «Pedir ideas»,
 * pide a la IA de 3 a 5 ideas (instagram-ia, ideas_semana). «Otra idea» pasa a
 * la siguiente y «Crear» se la da a quien lo monte (no crea nada por sí solo).
 *
 *   <SugerenciaSemana marca="casa-tomas" onCrear={(idea) => …} onVerCampanas={() => …} />
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarDays, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { inicioSemana, hoyMadrid, sumarDias } from "@/components/instagram/programar/logica";
import { obtenerPlantilla, type MarcaId } from "@/lib/instagram";
import { cn } from "@/lib/utils";
import { fechasEntre, pedirIdeasSemana, type IdeaSemanaIA, type RespuestaIdeas } from "./api";
import { textoDia, textoRango } from "./logica";

export interface SugerenciaSemanaProps {
  marca: MarcaId;
  /** Cualquier día de la semana (AAAA-MM-DD); por defecto, la actual. */
  semana?: string;
  /** Si se pasa, cada idea tiene «Crear». */
  onCrear?: (idea: IdeaSemanaIA) => void;
  /** Si se pasa, sale «Ver campañas». */
  onVerCampanas?: () => void;
  className?: string;
}

const MOTIVO: Record<string, string> = {
  fecha_senalada: "Fecha señalada",
  temporada: "Temporada",
  plato: "Plato de la carta",
  novedad: "Novedad",
  metricas: "Lo que mejor funciona",
};

export function SugerenciaSemana({ marca, semana, onCrear, onVerCampanas, className }: SugerenciaSemanaProps) {
  const lunes = inicioSemana(semana ?? hoyMadrid());
  const domingo = sumarDias(lunes, 6);
  const [indice, setIndice] = useState(0);

  const fechas = useQuery({
    queryKey: ["marketing_fechas", marca, lunes],
    queryFn: () => fechasEntre(lunes, domingo, marca),
  });
  const ideas = useMutation<RespuestaIdeas, Error>({
    mutationFn: () => pedirIdeasSemana(marca, lunes),
    onSuccess: () => setIndice(0),
  });
  const lista = ideas.data?.ideas ?? [];
  const idea = lista.length ? lista[indice % lista.length] : null;

  return (
    <article aria-labelledby="sugerencia-semana-titulo" className={cn("space-y-3 rounded-lg border bg-card p-4", className)} data-testid="sugerencia-semana">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="sugerencia-semana-titulo" className="text-sm font-semibold">
          Sugerencia de la semana <span className="font-normal text-muted-foreground">· {textoRango(lunes, domingo)}</span>
        </h2>
        {onVerCampanas && (
          <button type="button" onClick={onVerCampanas} className="text-xs text-primary underline-offset-2 hover:underline">
            Ver campañas
          </button>
        )}
      </header>

      <div className="flex flex-wrap gap-1.5" aria-label="Fechas señaladas de la semana">
        {fechas.isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Cargando fechas" />}
        {(fechas.data ?? []).map((f) => (
          <span key={`${f.titulo}-${f.desde}`} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs" title={f.verificacion === "sin verificar" ? "Fecha sin verificar" : undefined}>
            <CalendarDays className="h-3 w-3" aria-hidden="true" />
            {f.titulo}
            {f.verificacion === "sin verificar" && <span className="text-muted-foreground">(sin verificar)</span>}
          </span>
        ))}
        {!fechas.isLoading && !fechas.error && (fechas.data ?? []).length === 0 && <span className="text-xs text-muted-foreground">Sin fechas señaladas esta semana.</span>}
      </div>

      {idea ? (
        <div className="space-y-2" data-testid="idea-semana">
          <span className="text-[11px] font-medium uppercase tracking-wide text-primary">{MOTIVO[idea.motivo] ?? idea.motivo}</span>
          <h3 className="text-base font-semibold leading-snug">{idea.titulo}</h3>
          <p className="text-sm">{idea.idea}</p>
          <p className="text-xs text-muted-foreground">
            {textoDia(idea.fecha)} · {idea.formato === "story" ? "Story" : "Post"} · {obtenerPlantilla(idea.plantilla)?.nombre ?? idea.plantilla}
            {idea.plato ? ` · ${idea.plato.nombre}` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {onCrear && (
              <Button size="sm" onClick={() => onCrear(idea)}>
                Crear
              </Button>
            )}
            {lista.length > 1 && (
              <Button size="sm" variant="ghost" onClick={() => setIndice((i) => i + 1)}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Otra idea ({(indice % lista.length) + 1}/{lista.length})
              </Button>
            )}
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => ideas.mutate()} disabled={ideas.isPending}>
          {ideas.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          {ideas.isPending ? "Pensando ideas…" : "Pedir ideas a la IA"}
        </Button>
      )}
      {ideas.error && (
        <Alert variant="destructive" className="py-2">
          <AlertDescription className="text-xs">{ideas.error.message}</AlertDescription>
        </Alert>
      )}
    </article>
  );
}
