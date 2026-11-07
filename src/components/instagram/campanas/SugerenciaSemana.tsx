/**
 * «Sugerencia de la semana» de la pantalla Estudio de Instagram (maqueta:
 * `#p-estudio`, variante `destacada`). Enseña gratis (sin IA) las fechas
 * señaladas de la semana (RPC marketing_fechas_entre) y, solo al pulsar
 * «Pedir ideas», pide a la IA de 3 a 5 ideas (instagram-ia, ideas_semana).
 * «Otra idea» pasa a la siguiente y «Crear» se la da a quien lo monte (no
 * crea nada por sí solo).
 *
 * Al cargar NO se llama a la IA ni a ninguna Edge Function: solo la RPC de
 * fechas (barata, guardada 1 h). Mientras llega, píldoras grises con la forma
 * de las fechas (docs/instagram-rendimiento.md).
 *
 *   <SugerenciaSemana marca="casa-tomas" destacada onCrear={(idea) => …} onVerCampanas={() => …} />
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarDays, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { inicioSemana, hoyMadrid, sumarDias } from "@/components/instagram/programar/logica";
import { MiniaturaFoto } from "@/components/instagram/MiniaturaFoto";
import { obtenerPlantilla, type MarcaId } from "@/lib/instagram";
import { cn } from "@/lib/utils";
import { fechasEntre, pedirIdeasSemana, type IdeaSemanaIA, type RespuestaIdeas } from "./api";
import { textoDia, textoRango } from "./logica";
import "@/components/instagram/titular-studio.css";

export interface SugerenciaSemanaProps {
  marca: MarcaId;
  /** Cualquier día de la semana (AAAA-MM-DD); por defecto, la actual. */
  semana?: string;
  /** Si se pasa, cada idea tiene «Crear». */
  onCrear?: (idea: IdeaSemanaIA) => void;
  /** Si se pasa, sale «Ver campañas». */
  onVerCampanas?: () => void;
  /** Si se pasa, cada idea tiene «Pedir la foto» (encargo a Oficiosos). */
  onPedirFoto?: (idea: IdeaSemanaIA) => void;
  /** Versión destacada de la pantalla Estudio (maqueta, `.sugerencia`): papel, filete dorado y titular en serif. */
  destacada?: boolean;
  className?: string;
}

/** Consulta de las fechas señaladas de la semana (compartida con el prefetch del Estudio). */
export const opcionesFechasSemana = (marca: MarcaId, lunes: string) => ({
  queryKey: ["marketing_fechas", marca, lunes] as const,
  queryFn: () => fechasEntre(lunes, sumarDias(lunes, 6), marca),
  // Las fechas señaladas de una semana casi no cambian.
  staleTime: 60 * 60_000,
  gcTime: 2 * 60 * 60_000,
});

const MOTIVO: Record<string, string> = {
  fecha_senalada: "Fecha señalada",
  temporada: "Temporada",
  plato: "Plato de la carta",
  novedad: "Novedad",
  metricas: "Lo que mejor funciona",
};

export function SugerenciaSemana({ marca, semana, onCrear, onVerCampanas, onPedirFoto, destacada, className }: SugerenciaSemanaProps) {
  const lunes = inicioSemana(semana ?? hoyMadrid());
  const domingo = sumarDias(lunes, 6);
  const [indice, setIndice] = useState(0);

  const fechas = useQuery(opcionesFechasSemana(marca, lunes));
  const ideas = useMutation<RespuestaIdeas, Error>({
    mutationFn: () => pedirIdeasSemana(marca, lunes),
    onSuccess: () => setIndice(0),
  });
  const lista = ideas.data?.ideas ?? [];
  const idea = lista.length ? lista[indice % lista.length] : null;
  const primeraFecha = (fechas.data ?? [])[0];

  return (
    <article
      aria-labelledby="sugerencia-semana-titulo"
      className={cn(
        destacada
          ? "relative grid gap-4 overflow-hidden rounded-xl border border-[#ebe1d2] bg-[#fbf8f4] py-4 pl-6 pr-4 before:absolute before:bottom-4 before:left-0 before:top-4 before:w-[3px] before:rounded-r before:bg-[#b6852f] sm:grid-cols-[minmax(0,1fr)_auto]"
          : "space-y-3 rounded-lg border bg-card p-4",
        className,
      )}
      data-testid="sugerencia-semana"
    >
      <div className="min-w-0 space-y-2">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="sugerencia-semana-titulo" className={cn("text-sm font-semibold", destacada && "text-xs uppercase tracking-[0.08em] text-[#926a26]")}>
            Sugerencia de la semana <span className="font-normal normal-case tracking-normal text-muted-foreground">· {textoRango(lunes, domingo)}</span>
          </h2>
          {onVerCampanas && !destacada && (
            <button type="button" onClick={onVerCampanas} className="text-xs text-primary underline-offset-2 hover:underline">
              Ver campañas
            </button>
          )}
        </header>

        <div className="flex flex-wrap gap-1.5" aria-label="Fechas señaladas de la semana">
          {fechas.isLoading && (
            <span role="status" aria-label="Cargando fechas" className="flex gap-1.5">
              <Skeleton className="h-5 w-28 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </span>
          )}
          {(fechas.data ?? []).map((f) => (
            <span
              key={`${f.titulo}-${f.desde}`}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
              title={f.verificacion === "sin verificar" ? "Fecha sin verificar" : undefined}
            >
              <CalendarDays className="h-3 w-3" aria-hidden="true" />
              {f.titulo}
              {f.verificacion === "sin verificar" && <span className="text-muted-foreground">(sin verificar)</span>}
            </span>
          ))}
          {!fechas.isLoading && !fechas.error && (fechas.data ?? []).length === 0 && (
            <span className="text-xs text-muted-foreground">Sin fechas señaladas esta semana.</span>
          )}
        </div>

        {idea ? (
          <div className="space-y-2" data-testid="idea-semana">
            <span className="text-xs font-medium uppercase tracking-wide text-[#926a26]">{MOTIVO[idea.motivo] ?? idea.motivo}</span>
            <h3 className={cn("font-semibold leading-snug", destacada ? "titular-studio text-xl font-normal" : "text-base")}>{idea.titulo}</h3>
            <p className="max-w-[56ch] text-sm text-muted-foreground">{idea.idea}</p>
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
              {onPedirFoto && (
                <Button size="sm" variant="outline" onClick={() => onPedirFoto(idea)}>
                  Pedir la foto
                </Button>
              )}
              {onVerCampanas && destacada && (
                <Button size="sm" variant="outline" onClick={onVerCampanas}>
                  Ver campañas
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
          <div className="space-y-2">
            {destacada && (
              <p className="titular-studio text-xl leading-snug">
                {primeraFecha ? (
                  <>
                    Esta semana: {primeraFecha.titulo}. <em className="text-[#926a26]">¿Lo contamos?</em>
                  </>
                ) : (
                  <>
                    ¿Qué publicamos esta semana? <em className="text-[#926a26]">Te propongo ideas.</em>
                  </>
                )}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={destacada ? "default" : "outline"} onClick={() => ideas.mutate()} disabled={ideas.isPending}>
                {ideas.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                {ideas.isPending ? "Pensando ideas…" : "Pedir ideas a la IA"}
              </Button>
              {onVerCampanas && destacada && (
                <Button size="sm" variant="outline" onClick={onVerCampanas}>
                  Ver campañas
                </Button>
              )}
            </div>
          </div>
        )}
        {ideas.error && (
          <Alert variant="destructive" className="py-2">
            <AlertDescription className="text-xs">No se han podido pedir ideas ahora: {ideas.error.message}</AlertDescription>
          </Alert>
        )}
      </div>

      {destacada && idea?.platoId && (
        <figure className="m-0 hidden w-[7.5rem] sm:block">
          <MiniaturaFoto marca={marca} platoId={idea.platoId} className="aspect-[4/5] w-full shadow-sm" alt={idea.plato?.nombre ?? "Foto del plato"} />
          <figcaption className="mt-1.5 text-center text-xs text-muted-foreground">Foto de la carta</figcaption>
        </figure>
      )}
    </article>
  );
}
