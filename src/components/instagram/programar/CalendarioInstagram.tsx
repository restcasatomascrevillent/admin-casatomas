import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, ExternalLink, ImageOff, Loader2, MoveRight, Pencil, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { baseFotosPublica, obtenerPlantilla, urlRecurso, type MarcaId } from "@/lib/instagram";
import { cn } from "@/lib/utils";
import {
  agruparPorDia,
  construirEventos,
  DIAS_CORTOS,
  diasVista,
  hoyMadrid,
  moverVista,
  rangoVista,
  textoInstante,
  tituloVista,
  type EventoCalendario,
  type VistaCalendario,
} from "./logica";
import { ProgramarPiezaDialog } from "./ProgramarPiezaDialog";
import { useAccionesProgramacion, useCalendarioInstagram } from "./useProgramacionInstagram";

const BASE_FOTOS = baseFotosPublica(String(import.meta.env.VITE_SUPABASE_URL ?? ""));
const NOMBRE_MARCA: Record<string, string> = { "casa-tomas": "Casa Tomás", touza: "Touza" };

const ETIQUETA_ESTADO_EVENTO: Record<EventoCalendario["estado"], { texto: string; clase: string }> = {
  programada: { texto: "Programada", clase: "bg-sky-100 text-sky-800" },
  publicando: { texto: "Publicando…", clase: "bg-amber-100 text-amber-900" },
  publicada: { texto: "Publicada", clase: "bg-emerald-100 text-emerald-800" },
  error: { texto: "Error", clase: "bg-red-100 text-red-800" },
  cancelada: { texto: "Cancelada", clase: "bg-muted text-muted-foreground" },
  borrador: { texto: "Borrador", clase: "bg-violet-100 text-violet-800" },
};

/** Título corto de la pieza: titular o cita, o el nombre de la plantilla. */
function tituloEvento(e: EventoCalendario): string {
  const datos = e.pieza?.datos ?? null;
  const texto = [datos?.titular, datos?.cita].find((t): t is string => typeof t === "string" && !!t.trim());
  if (texto) return texto;
  const plantilla = e.pieza?.plantilla ? obtenerPlantilla(e.pieza.plantilla)?.nombre ?? e.pieza.plantilla : "Pieza";
  return plantilla.replace(/^Touza · /, "");
}

function urlMiniatura(e: EventoCalendario): string | null {
  const ruta = e.pieza?.imagen_ruta;
  if (!ruta || e.tipo === "publicada") return null; // publicada: el JPEG ya no está en el bucket
  const url = /^https?:\/\//.test(ruta) ? ruta : urlRecurso(BASE_FOTOS, ruta);
  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(e.pieza?.updated_at ?? "")}`;
}

function Miniatura({ evento, className }: { evento: EventoCalendario; className?: string }) {
  const [fallo, setFallo] = useState(false);
  const url = urlMiniatura(evento);
  const proporcion = evento.pieza?.formato === "story" ? "aspect-[9/16]" : "aspect-[4/5]";
  if (!url || fallo) {
    return (
      <span className={cn("flex shrink-0 items-center justify-center rounded bg-muted text-muted-foreground", proporcion, className)}>
        <ImageOff className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    );
  }
  return <img src={url} alt="" loading="lazy" onError={() => setFallo(true)} className={cn("shrink-0 rounded object-cover", proporcion, className)} />;
}

interface TarjetaProps {
  evento: EventoCalendario;
  compacta: boolean;
  onMover: (e: EventoCalendario) => void;
  onCancelar: (e: EventoCalendario) => void;
  onVerError: (e: EventoCalendario) => void;
  onAbrirPieza?: (piezaId: string) => void;
}

/** Borrador de campaña (fecha prevista, sin programar): borde discontinuo; abre el editor si hay callback. */
function TarjetaBorrador({ evento, compacta, onAbrirPieza }: Pick<TarjetaProps, "evento" | "compacta" | "onAbrirPieza">) {
  const titulo = tituloEvento(evento);
  const etiqueta = `${evento.hora} · ${NOMBRE_MARCA[evento.marca] ?? evento.marca} · ${titulo} · Borrador sin programar`;
  const contenido = (
    <>
      <Miniatura evento={evento} className={compacta ? "w-6" : "w-9"} />
      <span className="min-w-0 flex-1">
        <span className="font-semibold tabular-nums">{evento.hora}</span>
        {!compacta && <span className="block truncate">{titulo}</span>}
        <span className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
          <span className="truncate">{NOMBRE_MARCA[evento.marca] ?? evento.marca}</span>
          {!compacta && <span className={cn("rounded-full px-1.5 py-px font-medium", ETIQUETA_ESTADO_EVENTO.borrador.clase)}>Borrador</span>}
        </span>
      </span>
    </>
  );
  const clase = "flex w-full min-w-0 items-center gap-1.5 rounded-md border border-dashed border-violet-400 bg-background/60 p-1 text-left text-xs";
  return onAbrirPieza ? (
    <button
      type="button"
      data-testid="evento-instagram"
      data-estado="borrador"
      onClick={() => onAbrirPieza(evento.piezaId)}
      className={cn(clase, "transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
      aria-label={`${etiqueta}. Abrir en el editor`}
    >
      {contenido}
    </button>
  ) : (
    <div data-testid="evento-instagram" data-estado="borrador" className={clase} aria-label={etiqueta} role="note">
      {contenido}
    </div>
  );
}

function TarjetaEvento({ evento, compacta, onMover, onCancelar, onVerError, onAbrirPieza }: TarjetaProps) {
  if (evento.tipo === "borrador") return <TarjetaBorrador evento={evento} compacta={compacta} onAbrirPieza={onAbrirPieza} />;
  const estado = ETIQUETA_ESTADO_EVENTO[evento.estado];
  const titulo = tituloEvento(evento);
  const editable = evento.tipo === "programada" && (evento.estado === "programada" || evento.estado === "error");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="evento-instagram"
          data-estado={evento.estado}
          className={cn(
            "flex w-full min-w-0 items-center gap-1.5 rounded-md border bg-background p-1 text-left text-xs transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            evento.estado === "error" && "border-red-300",
          )}
          aria-label={`${evento.hora} · ${NOMBRE_MARCA[evento.marca] ?? evento.marca} · ${titulo} · ${estado.texto}`}
        >
          <Miniatura evento={evento} className={compacta ? "w-6" : "w-9"} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1">
              <span className="font-semibold tabular-nums">{evento.hora}</span>
              {evento.estado === "error" && <AlertTriangle className="h-3 w-3 text-red-600" aria-hidden="true" />}
              {evento.estado === "publicando" && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
            </span>
            {!compacta && <span className="block truncate">{titulo}</span>}
            <span className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
              <span className="truncate">{NOMBRE_MARCA[evento.marca] ?? evento.marca}</span>
              {!compacta && <span className={cn("rounded-full px-1.5 py-px font-medium", estado.clase)}>{estado.texto}</span>}
            </span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="space-y-0.5">
          <span className="block truncate">{titulo}</span>
          <span className="block text-xs font-normal text-muted-foreground">
            {textoInstante(evento.instante)} · {estado.texto}
            {evento.estado === "error" && evento.intentos > 0 ? ` (${evento.intentos} ${evento.intentos === 1 ? "intento" : "intentos"})` : ""}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {editable && (
          <DropdownMenuItem onSelect={() => onMover(evento)}>
            <MoveRight className="mr-2 h-4 w-4" aria-hidden="true" />
            {evento.estado === "error" ? "Volver a programar…" : "Mover…"}
          </DropdownMenuItem>
        )}
        {evento.error && (
          <DropdownMenuItem onSelect={() => onVerError(evento)}>
            <AlertTriangle className="mr-2 h-4 w-4" aria-hidden="true" />
            {evento.estado === "error" ? "Ver error" : "Ver último aviso"}
          </DropdownMenuItem>
        )}
        {onAbrirPieza && (
          <DropdownMenuItem onSelect={() => onAbrirPieza(evento.piezaId)}>
            <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
            Abrir la pieza
          </DropdownMenuItem>
        )}
        {evento.permalink && (
          <DropdownMenuItem asChild>
            <a href={evento.permalink} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
              Ver en Instagram
            </a>
          </DropdownMenuItem>
        )}
        {editable && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onCancelar(evento)}>
              <XCircle className="mr-2 h-4 w-4" aria-hidden="true" />
              {evento.estado === "error" ? "Quitar del calendario" : "Cancelar la programación"}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface CalendarioInstagramProps {
  /** Filtro de marca; por defecto, las dos. */
  marca?: MarcaId | "todas";
  vistaInicial?: VistaCalendario;
  /** Si se pasa, el menú de cada pieza ofrece «Abrir la pieza» y un borrador se abre al pulsarlo. */
  onAbrirPieza?: (piezaId: string) => void;
  /** Alto mínimo (px) por debajo del cual la página hace scroll; ver useAlturaDisponible. */
  altoMinimo?: number;
  className?: string;
}

/**
 * Calendario de Instagram (semana y mes) con las piezas programadas, las
 * publicadas y los borradores de campaña (borde discontinuo), en hora de Madrid. Cada pieza: miniatura, hora, marca y estado;
 * su menú permite mover (reprogramar), cancelar, ver el error, abrir la pieza
 * y verla en Instagram. Ocupa el alto que queda en pantalla
 * (useAlturaDisponible): sin scroll de página, el scroll va dentro de cada día.
 */
export function CalendarioInstagram({ marca = "todas", vistaInicial = "semana", onAbrirPieza, altoMinimo = 360, className }: CalendarioInstagramProps) {
  const [nodo, setNodo] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(nodo, altoMinimo);
  const [vista, setVista] = useState<VistaCalendario>(vistaInicial);
  const [dia, setDia] = useState(() => hoyMadrid());
  const hoy = hoyMadrid();

  const dias = useMemo(() => diasVista(vista, dia), [vista, dia]);
  const { desde, hasta } = useMemo(() => rangoVista(vista, dia), [vista, dia]);
  const { data, isLoading, error } = useCalendarioInstagram(desde, hasta);
  const porDia = useMemo(() => {
    const eventos = construirEventos(data?.programaciones ?? [], data?.publicadas ?? [], data?.borradores ?? []).filter((e) => marca === "todas" || e.marca === marca);
    return agruparPorDia(eventos);
  }, [data, marca]);

  const { cancelar } = useAccionesProgramacion();
  const [moviendo, setMoviendo] = useState<EventoCalendario | null>(null);
  const [cancelando, setCancelando] = useState<EventoCalendario | null>(null);
  const [viendoError, setViendoError] = useState<EventoCalendario | null>(null);

  const mes = dia.slice(0, 7);
  const compacta = vista === "mes";
  const total = [...porDia.values()].reduce((n, l) => n + l.length, 0);

  async function confirmarCancelar() {
    if (!cancelando?.programacionId) return;
    try {
      await cancelar.mutateAsync(cancelando.programacionId);
      toast.success(cancelando.estado === "error" ? "Quitada del calendario" : "Programación cancelada");
    } catch (e) {
      toast.error("No se pudo cancelar", { description: (e as Error).message });
    } finally {
      setCancelando(null);
    }
  }

  return (
    <div
      ref={setNodo}
      className={cn("flex min-h-0 flex-col gap-2", className)}
      style={alto ? { height: alto } : undefined}
      data-testid="calendario-instagram"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setDia((d) => moverVista(vista, d, -1))} aria-label={vista === "semana" ? "Semana anterior" : "Mes anterior"}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => setDia(hoyMadrid())}>
            Hoy
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setDia((d) => moverVista(vista, d, 1))} aria-label={vista === "semana" ? "Semana siguiente" : "Mes siguiente"}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <h3 className="text-sm font-semibold first-letter:uppercase" aria-live="polite">
          {tituloVista(vista, dia)}
        </h3>
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Cargando" />}
        {!isLoading && !error && total === 0 && <span className="text-xs text-muted-foreground">Nada programado ni publicado en estas fechas.</span>}
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          className="ml-auto"
          value={vista}
          onValueChange={(v) => v && setVista(v as VistaCalendario)}
          aria-label="Vista del calendario"
        >
          <ToggleGroupItem value="semana" className="h-8 px-2.5 text-xs">
            Semana
          </ToggleGroupItem>
          <ToggleGroupItem value="mes" className="h-8 px-2.5 text-xs">
            Mes
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {error ? (
        <p className="text-sm text-destructive">No se pudo cargar el calendario: {(error as Error).message}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border">
          <div className="hidden shrink-0 grid-cols-7 border-b bg-muted/40 text-center text-[11px] font-medium uppercase text-muted-foreground sm:grid">
            {DIAS_CORTOS.map((d) => (
              <div key={d} className="py-1">
                {d}
              </div>
            ))}
          </div>
          <div
            className={cn(
              "grid min-h-0 flex-1 grid-cols-1 overflow-y-auto sm:grid-cols-7 sm:overflow-hidden",
              vista === "mes" ? "sm:grid-rows-6" : "sm:grid-rows-1",
            )}
          >
            {dias.map((d) => {
              const eventos = porDia.get(d) ?? [];
              const fuera = vista === "mes" && d.slice(0, 7) !== mes;
              const pasado = d < hoy;
              return (
                <section
                  key={d}
                  aria-label={textoDia(d)}
                  className={cn(
                    "flex min-h-0 flex-col border-b border-r p-1 last:border-r-0",
                    vista === "mes" && "min-h-[4.5rem]",
                    fuera && "bg-muted/30 text-muted-foreground",
                    pasado && !fuera && "bg-muted/10",
                  )}
                >
                  <div className="mb-1 flex shrink-0 items-center gap-1 text-xs">
                    <span
                      className={cn(
                        "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 tabular-nums",
                        d === hoy && "bg-primary font-semibold text-primary-foreground",
                      )}
                    >
                      {Number(d.slice(8))}
                    </span>
                    <span className="text-muted-foreground sm:hidden">{textoDia(d)}</span>
                    {compacta && eventos.length > 0 && <span className="ml-auto text-[10px] text-muted-foreground">{eventos.length}</span>}
                  </div>
                  <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                    {eventos.map((e) => (
                      <li key={e.clave}>
                        <TarjetaEvento
                          evento={e}
                          compacta={compacta}
                          onMover={setMoviendo}
                          onCancelar={setCancelando}
                          onVerError={setViendoError}
                          onAbrirPieza={onAbrirPieza}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}

      <ProgramarPiezaDialog
        piezaId={moviendo?.piezaId ?? null}
        programacionId={moviendo?.programacionId ?? null}
        inicial={moviendo?.estado === "error" ? null : moviendo?.instante ?? null}
        open={Boolean(moviendo)}
        onOpenChange={(o) => !o && setMoviendo(null)}
      />

      <AlertDialog open={Boolean(cancelando)} onOpenChange={(o) => !o && setCancelando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{cancelando?.estado === "error" ? "¿Quitar del calendario?" : "¿Cancelar la programación?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelando ? `${tituloEvento(cancelando)} · ${textoInstante(cancelando.instante)}. ` : ""}
              No se publicará. La pieza se conserva y se puede volver a programar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelar.isPending}>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={(ev) => {
                ev.preventDefault();
                void confirmarCancelar();
              }}
              disabled={cancelar.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancelar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {cancelando?.estado === "error" ? "Quitar" : "Cancelar la programación"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={Boolean(viendoError)} onOpenChange={(o) => !o && setViendoError(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5" aria-hidden="true" />
              {viendoError?.estado === "error" ? "No se pudo publicar" : "Último aviso"}
            </DialogTitle>
            <DialogDescription>
              {viendoError ? `${tituloEvento(viendoError)} · ${textoInstante(viendoError.instante)}` : ""}
              {viendoError && viendoError.intentos > 0 ? ` · ${viendoError.intentos} ${viendoError.intentos === 1 ? "intento" : "intentos"}` : ""}
            </DialogDescription>
          </DialogHeader>
          <p className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-sm">{viendoError?.error}</p>
          {viendoError?.estado === "error" && (
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  setMoviendo(viendoError);
                  setViendoError(null);
                }}
              >
                Volver a programar…
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function textoDia(dia: string): string {
  return textoInstante(`${dia}T12:00:00Z`).split(",")[0];
}
