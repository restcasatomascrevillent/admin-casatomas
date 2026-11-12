import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Loader2, MoveRight, Pencil, Plus, XCircle } from "lucide-react";
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
import { useIsMobile } from "@/hooks/use-mobile";
import type { MarcaId } from "@/lib/instagram";
import { cn } from "@/lib/utils";
import { ESTADOS_CALENDARIO, ESTILO_TONO, LEYENDA_CALENDARIO } from "@/components/instagram/estados";
import { InsigniaEstado, MarcaMini, PuntoTono } from "@/components/instagram/InsigniaEstado";
import { explicarErrorPublicacion } from "@/components/instagram/errores";
import { ParaOficiosos } from "@/components/instagram/ParaOficiosos";
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
import { useHuecosEncargo } from "@/components/instagram/encargos/useEncargos";
import { Miniatura, tituloEvento } from "./Miniatura";
// Antes vivían aquí: se reexportan para no romper a quien los importa de este fichero.
export { Miniatura, tituloEvento, urlMiniatura } from "./Miniatura";
import { HuecoCalendario } from "@/components/instagram/encargos/HuecoCalendario";

const NOMBRE_MARCA: Record<string, string> = { "casa-tomas": "Casa Tomás", touza: "Touza" };
const DIAS_LARGOS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Filtro de la leyenda al que pertenece cada evento. */
type FiltroEstado = (typeof LEYENDA_CALENDARIO)[number]["id"];
export function filtroDeEvento(e: Pick<EventoCalendario, "tipo" | "estado">): FiltroEstado {
  if (e.tipo === "publicada") return "publicada";
  if (e.tipo === "borrador") return "borrador";
  return e.estado === "error" ? "error" : "programada";
}

interface TarjetaProps {
  evento: EventoCalendario;
  compacta: boolean;
  onMover: (e: EventoCalendario) => void;
  onCancelar: (e: EventoCalendario) => void;
  onVerError: (e: EventoCalendario) => void;
  onAbrirPieza?: (piezaId: string) => void;
  /** En el panel del día (otro data-testid: la misma pieza sale también en la rejilla). */
  enPanel?: boolean;
}

/** Clases comunes de una tarjeta: borde izquierdo del color del estado y 44 px de alto (táctil). */
function claseTarjeta(e: EventoCalendario, compacta: boolean) {
  const tono = ESTADOS_CALENDARIO[e.estado].tono;
  return cn(
    "flex min-h-11 w-full min-w-0 items-center gap-1.5 rounded-md border border-l-[3px] bg-background text-left text-xs",
    compacta ? "p-1" : "p-1.5",
    ESTILO_TONO[tono].bordeIzquierdo,
    tono === "programada" && "bg-[rgb(146_106_38/0.06)]",
    tono === "borrador" && "border-dashed border-[#9b8a7d] border-l-solid bg-background/60 text-[#5f554d]",
    tono === "error" && "border-red-300",
  );
}

/** Borrador de campaña (fecha prevista, sin programar): borde discontinuo; abre el editor si hay callback. */
function TarjetaBorrador({ evento, compacta, onAbrirPieza, enPanel }: Pick<TarjetaProps, "evento" | "compacta" | "onAbrirPieza" | "enPanel">) {
  const titulo = tituloEvento(evento);
  const etiqueta = `${evento.hora} · ${NOMBRE_MARCA[evento.marca] ?? evento.marca} · ${titulo} · Borrador sin programar`;
  const contenido = (
    <>
      <Miniatura evento={evento} className={compacta ? "w-7" : "w-9"} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className="font-semibold tabular-nums">{evento.hora}</span>
          {!compacta && <MarcaMini marca={evento.marca} className="ml-auto h-5 w-5" />}
        </span>
        <span className="block truncate">{titulo}</span>
        {!compacta && <InsigniaEstado info={ESTADOS_CALENDARIO.borrador} className="mt-0.5" />}
      </span>
    </>
  );
  const clase = claseTarjeta(evento, compacta);
  return onAbrirPieza ? (
    <button
      type="button"
      data-testid={enPanel ? "evento-panel" : "evento-instagram"}
      data-estado="borrador"
      onClick={() => onAbrirPieza(evento.piezaId)}
      className={cn(clase, "transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
      aria-label={`${etiqueta}. Abrir en el editor`}
    >
      {contenido}
    </button>
  ) : (
    <div data-testid={enPanel ? "evento-panel" : "evento-instagram"} data-estado="borrador" className={clase} aria-label={etiqueta} role="note">
      {contenido}
    </div>
  );
}

function TarjetaEvento({ evento, compacta, onMover, onCancelar, onVerError, onAbrirPieza, enPanel }: TarjetaProps) {
  if (evento.tipo === "borrador") return <TarjetaBorrador evento={evento} compacta={compacta} onAbrirPieza={onAbrirPieza} enPanel={enPanel} />;
  const estado = ESTADOS_CALENDARIO[evento.estado];
  const titulo = tituloEvento(evento);
  const editable = evento.tipo === "programada" && (evento.estado === "programada" || evento.estado === "error");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid={enPanel ? "evento-panel" : "evento-instagram"}
          data-estado={evento.estado}
          className={cn(claseTarjeta(evento, compacta), "transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
          aria-label={`${evento.hora} · ${NOMBRE_MARCA[evento.marca] ?? evento.marca} · ${titulo} · ${estado.etiqueta}`}
        >
          <Miniatura evento={evento} className={compacta ? "w-7" : "w-9"} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1">
              <span className="font-semibold tabular-nums">{evento.hora}</span>
              {evento.estado === "error" && <AlertTriangle className="h-3 w-3 text-red-600" aria-hidden="true" />}
              {evento.estado === "publicando" && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
              {!compacta && <MarcaMini marca={evento.marca} className="ml-auto h-5 w-5" />}
            </span>
            <span className="block truncate">{titulo}</span>
            {!compacta && <InsigniaEstado info={estado} className="mt-0.5" />}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="space-y-0.5">
          <span className="block truncate">{titulo}</span>
          <span className="block text-xs font-normal text-muted-foreground">
            {textoInstante(evento.instante)} · {estado.etiqueta}
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
            {evento.estado === "error" ? "Ver qué ha pasado" : "Ver último aviso"}
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
  /** Vista al abrir; por defecto el mes (en pantallas estrechas, la semana). */
  vistaInicial?: VistaCalendario;
  /** Día que se abre (AAAA-MM-DD; p. ej. al pulsar un día de la semana en el Estudio). */
  diaInicial?: string | null;
  /** Si se pasa, el menú de cada pieza ofrece «Abrir la pieza» y un borrador se abre al pulsarlo. */
  onAbrirPieza?: (piezaId: string) => void;
  /** Si se pasa, el panel del día ofrece «Nueva pieza este día». */
  onNuevaPieza?: (dia: string) => void;
  /** Alto mínimo (px) por debajo del cual la página hace scroll; ver useAlturaDisponible. */
  altoMinimo?: number;
  className?: string;
  /** Si se pasa, un hueco de encargo (fecha deseada de un encargo enviado) abre su ficha. */
  onAbrirEncargo?: (encargoId: string) => void;
}

function vistaPorDefecto(v?: VistaCalendario): VistaCalendario {
  if (v) return v;
  // En el móvil el mes apila 42 días en una columna: mejor la semana.
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 639px)").matches ? "semana" : "mes";
}

/** «jueves 12 de noviembre». */
function textoDiaLargo(dia: string): string {
  const [, m, d] = dia.split("-").map(Number);
  const i = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return `${DIAS_LARGOS[(i + 6) % 7]} ${d} de ${MESES_LARGOS[m - 1]}`;
}

/**
 * Calendario de Instagram (evaluación de diseño C7, 05/11/2026): mes por
 * defecto con un panel del día a la derecha (piezas grandes y «Nueva pieza
 * este día»), leyenda que filtra por estado (publicada, programada, borrador,
 * encargo, con error) y tarjetas con miniatura, hora y título de 44 px. Las
 * piezas programadas, publicadas, borradores de campaña (borde discontinuo) y
 * huecos de encargo, en hora de Madrid. El menú de cada pieza permite mover,
 * cancelar, ver qué ha pasado (en llano), abrir la pieza y verla en Instagram.
 * Ocupa el alto que queda en pantalla (useAlturaDisponible): sin scroll de
 * página, el scroll va dentro de cada día y del panel.
 */
export function CalendarioInstagram({
  marca = "todas",
  vistaInicial,
  diaInicial = null,
  onAbrirPieza,
  onNuevaPieza,
  altoMinimo = 360,
  className,
  onAbrirEncargo,
}: CalendarioInstagramProps) {
  const [nodo, setNodo] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(nodo, altoMinimo);
  // Móvil (12/11/2026): sin alto fijo (siete filas de día no caben apretadas: la pestaña hace scroll) y la leyenda
  // de estados plegada tras un botón «Filtros».
  const esMovil = useIsMobile();
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [vista, setVista] = useState<VistaCalendario>(() => vistaPorDefecto(vistaInicial));
  const [dia, setDia] = useState(() => diaInicial ?? hoyMadrid());
  const [elegido, setElegido] = useState(() => diaInicial ?? hoyMadrid());
  const [ocultos, setOcultos] = useState<Set<FiltroEstado>>(() => new Set());
  const hoy = hoyMadrid();

  useEffect(() => {
    if (!diaInicial) return;
    setDia(diaInicial);
    setElegido(diaInicial);
  }, [diaInicial]);

  const dias = useMemo(() => diasVista(vista, dia), [vista, dia]);
  const { desde, hasta } = useMemo(() => rangoVista(vista, dia), [vista, dia]);
  const { data, isLoading, error } = useCalendarioInstagram(desde, hasta);
  const porDia = useMemo(() => {
    const eventos = construirEventos(data?.programaciones ?? [], data?.publicadas ?? [], data?.borradores ?? []).filter(
      (e) => (marca === "todas" || e.marca === marca) && !ocultos.has(filtroDeEvento(e)),
    );
    return agruparPorDia(eventos);
  }, [data, marca, ocultos]);

  // Huecos de encargo (docs/instagram-encargos.md): vacío sin la migración o sin permiso.
  const huecos = useHuecosEncargo(desde, hasta);
  const huecosDe = (d: string) => (ocultos.has("encargo") ? [] : (huecos.get(d) ?? []).filter((h) => marca === "todas" || h.marca === marca));
  const { cancelar } = useAccionesProgramacion();
  const [moviendo, setMoviendo] = useState<EventoCalendario | null>(null);
  const [cancelando, setCancelando] = useState<EventoCalendario | null>(null);
  const [viendoError, setViendoError] = useState<EventoCalendario | null>(null);

  const mes = dia.slice(0, 7);
  const compacta = vista === "mes";
  const total = [...porDia.values()].reduce((n, l) => n + l.length, 0);
  const eventosElegido = porDia.get(elegido) ?? [];
  const huecosElegido = huecosDe(elegido);
  const explicado = viendoError ? explicarErrorPublicacion(viendoError.error) : null;

  const alternarFiltro = (id: FiltroEstado) =>
    setOcultos((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

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

  const tarjeta = (e: EventoCalendario, comp: boolean, enPanel = false) => (
    <TarjetaEvento evento={e} compacta={comp} enPanel={enPanel} onMover={setMoviendo} onCancelar={setCancelando} onVerError={setViendoError} onAbrirPieza={onAbrirPieza} />
  );

  return (
    <div ref={setNodo} className={cn("flex min-h-0 flex-col gap-2", className)} style={alto && !esMovil ? { height: alto } : undefined} data-testid="calendario-instagram">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setDia((d) => moverVista(vista, d, -1))} aria-label={vista === "semana" ? "Semana anterior" : "Mes anterior"}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => {
              setDia(hoyMadrid());
              setElegido(hoyMadrid());
            }}
          >
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
        {!isLoading && !error && total === 0 && ocultos.size === 0 && <span className="text-xs text-muted-foreground">Nada programado ni publicado en estas fechas.</span>}
        {esMovil && (
          <button
            type="button"
            onClick={() => setFiltrosAbiertos((a) => !a)}
            aria-expanded={filtrosAbiertos}
            aria-controls="leyenda-calendario"
            className="ml-auto inline-flex h-12 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="filtros-calendario"
          >
            Filtros{ocultos.size > 0 ? ` (${ocultos.size} ocultos)` : ""}
            <ChevronDown aria-hidden="true" className={cn("h-4 w-4 transition-transform", filtrosAbiertos && "rotate-180")} />
          </button>
        )}
        <div
          id="leyenda-calendario"
          role="group"
          aria-label="Filtrar por estado"
          className={cn("ml-auto flex flex-wrap items-center gap-1", esMovil && "order-last w-full gap-2", esMovil && !filtrosAbiertos && "hidden")}
          data-testid="leyenda-calendario"
        >
          {LEYENDA_CALENDARIO.map((l) => {
            const activo = !ocultos.has(l.id);
            return (
              <button
                key={l.id}
                type="button"
                aria-pressed={activo}
                onClick={() => alternarFiltro(l.id)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11",
                  activo ? "bg-background text-foreground" : "bg-muted/50 text-muted-foreground line-through",
                )}
              >
                <PuntoTono tono={l.tono} className={cn(!activo && "opacity-40")} />
                {l.etiqueta}
              </button>
            );
          })}
        </div>
        <ToggleGroup type="single" size="sm" variant="outline" value={vista} onValueChange={(v) => v && setVista(v as VistaCalendario)} aria-label="Vista del calendario">
          <ToggleGroupItem value="mes" className="h-8 px-2.5 text-xs">
            Mes
          </ToggleGroupItem>
          <ToggleGroupItem value="semana" className="h-8 px-2.5 text-xs">
            Semana
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {error ? (
        <p className="text-sm text-destructive">No se ha podido cargar el calendario. Vuelve a probar en un rato.</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border">
            <div className="hidden shrink-0 grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium uppercase text-muted-foreground sm:grid">
              {DIAS_CORTOS.map((d) => (
                <div key={d} className="py-1">
                  {d}
                </div>
              ))}
            </div>
            <div className={cn("grid min-h-0 flex-1 grid-cols-1 overflow-y-auto sm:grid-cols-7 sm:overflow-hidden", vista === "mes" ? "sm:grid-rows-6" : "sm:grid-rows-1")}>
              {dias.map((d) => {
                const eventos = porDia.get(d) ?? [];
                const huecosDia = huecosDe(d);
                const fuera = vista === "mes" && d.slice(0, 7) !== mes;
                const pasado = d < hoy;
                const sel = d === elegido;
                return (
                  <section
                    key={d}
                    aria-label={textoDia(d)}
                    data-dia={d}
                    onClick={(ev) => {
                      // Pulsar el hueco del día lo elige (las tarjetas tienen su propio menú).
                      if ((ev.target as HTMLElement).closest("button,a,[role=menu]")) return;
                      setElegido(d);
                    }}
                    className={cn(
                      "flex min-h-0 cursor-pointer flex-col border-b border-r p-1 last:border-r-0 max-sm:min-h-14",
                      vista === "mes" && "min-h-[4.5rem]",
                      fuera && "bg-muted/30 text-muted-foreground",
                      pasado && !fuera && "bg-muted/10",
                      sel && "shadow-[inset_0_0_0_2px_#b6852f]",
                    )}
                  >
                    <div className="mb-1 flex shrink-0 items-center gap-1 text-xs">
                      <button
                        type="button"
                        data-compacto
                        onClick={() => setElegido(d)}
                        aria-label={`Ver el ${textoDiaLargo(d)}`}
                        aria-pressed={sel}
                        className={cn(
                          "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 tabular-nums hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          d === hoy && "bg-primary font-semibold text-primary-foreground hover:bg-primary",
                        )}
                      >
                        {Number(d.slice(8))}
                      </button>
                      <span className="text-muted-foreground sm:hidden">{textoDia(d)}</span>
                      {compacta && eventos.length + huecosDia.length > 1 && (
                        <span className="ml-auto text-xs text-muted-foreground">{eventos.length + huecosDia.length}</span>
                      )}
                    </div>
                    <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                      {huecosDia.map((h) => (
                        <li key={`encargo-${h.id}`}>
                          <HuecoCalendario hueco={h} compacta={compacta} onAbrir={onAbrirEncargo} />
                        </li>
                      ))}
                      {eventos.map((e) => (
                        <li key={e.clave}>{tarjeta(e, compacta)}</li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          </div>

          {/* Panel del día (maqueta, `.dia-detalle`) */}
          <aside
            aria-label={`Día ${textoDiaLargo(elegido)}`}
            className="flex min-h-0 shrink-0 flex-col rounded-md border bg-card lg:w-[17rem]"
            data-testid="panel-dia"
          >
            <header className="flex shrink-0 items-baseline justify-between gap-2 border-b px-3 py-2">
              <h4 className="text-sm font-semibold first-letter:uppercase">{textoDiaLargo(elegido)}</h4>
              <span className="text-xs text-muted-foreground">
                {eventosElegido.length + huecosElegido.length} {eventosElegido.length + huecosElegido.length === 1 ? "pieza" : "piezas"}
              </span>
            </header>
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-2">
              {huecosElegido.map((h) => (
                <li key={`encargo-${h.id}`}>
                  <HuecoCalendario hueco={h} onAbrir={onAbrirEncargo} enPanel />
                </li>
              ))}
              {eventosElegido.map((e) => (
                <li key={e.clave}>{tarjeta(e, false, true)}</li>
              ))}
              {eventosElegido.length + huecosElegido.length === 0 && (
                <li className="rounded-md border border-dashed p-3 text-center text-sm text-muted-foreground">
                  {elegido < hoy ? "Este día no se publicó nada." : "Nada este día. Es un buen hueco para una story o un post."}
                </li>
              )}
            </ul>
            {onNuevaPieza && elegido >= hoy && (
              <div className="shrink-0 border-t p-2">
                <Button type="button" variant="outline" className="w-full pointer-coarse:min-h-11" onClick={() => onNuevaPieza(elegido)}>
                  <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Nueva pieza este día
                </Button>
              </div>
            )}
          </aside>
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
          {explicado && (
            <div className="space-y-2 text-sm" data-testid="error-explicado">
              <p className="font-medium">{explicado.titulo}</p>
              <p className="text-muted-foreground">{explicado.queHacer}</p>
              {explicado.detalle && (
                <ParaOficiosos>
                  <p className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono">{explicado.detalle}</p>
                </ParaOficiosos>
              )}
            </div>
          )}
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
