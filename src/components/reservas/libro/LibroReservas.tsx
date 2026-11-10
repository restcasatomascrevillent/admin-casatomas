import { useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarIcon, ChevronLeft, ChevronRight, Eraser, Loader2, PenLine, Save, Sparkles, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { FormularioReserva } from "@/components/reservas/FormularioReserva";
import { agruparReservasDelDia } from "@/components/reservas/ReservasDelDia";
import { useReservasServicioDia, CLAVE_RESERVAS_SERVICIO_DIA } from "@/hooks/useReservasServicioDia";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { useBorradoresPendientes, useGuardarBorrador, useResolverBorrador, type BorradorManuscrito } from "@/hooks/useBorradoresManuscritos";
import { ETIQUETA_TURNO, horaCorta } from "@/lib/reservas/ocupacionSalas";
import { ESTADO_NO_SHOW, infoEstadoReserva } from "@/lib/reservas/estadosReserva";
import {
  claveDia,
  datosAltaDesdeInterpretada,
  diaDeClave,
  interpretarReservaEscrita,
  pasarHoja,
  type ReservaInterpretada,
} from "@/lib/reservas/libroReservas";
import { LienzoManuscrito, type LienzoManuscritoApi } from "./LienzoManuscrito";

// ============================================================================
// LIBRO DE RESERVAS — «Escribir reserva» (10/11/2026, petición del dueño)
// ----------------------------------------------------------------------------
// Una hoja por día (← → y calendario para pasar hojas): arriba lo ya apuntado
// (`useReservasServicioDia`, lo mismo que «Reservas del día» del alta), debajo
// un renglón en blanco para escribir con el lápiz. «Interpretar» → vista previa
// con el trazo al lado y el ALTA MANUAL de siempre (`FormularioReserva`)
// prellenada: mismas validaciones, aforo, blacklist, permisos y canal `manual`.
// Al guardar, la reserva sale apuntada en su hoja (si lo escrito traía otra
// fecha, el libro salta a ella). Ocupa el diálogo entero y hace scroll solo
// por dentro: la página del panel no desplaza (regla del dueño).
// ============================================================================

const PAPEL = "bg-[#fbf6e9] text-stone-800";

interface Props {
  /** Solo «Reservas · Crear»: el alta sin «Ocupa la sala entera» (como «Nueva Reserva»). */
  soloCrear?: boolean;
}

function fechaHoja(clave: string): string {
  const t = format(diaDeClave(clave), "EEEE d 'de' MMMM yyyy", { locale: es });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function fechaCorta(clave: string): string {
  return format(diaDeClave(clave), "d 'de' MMMM", { locale: es });
}

/** Lo ya apuntado en la hoja del día. */
function ReservasDeLaHoja({ fecha, resaltada }: { fecha: string; resaltada: string | null }) {
  const { data: reservas, isLoading, isError, refetch } = useReservasServicioDia(fecha);
  const { data: espacios } = useEspaciosReserva();
  const nombreSala = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of (espacios ?? []) as Array<{ id: string; nombre: string }>) m.set(e.id, e.nombre);
    return m;
  }, [espacios]);
  const grupos = useMemo(() => agruparReservasDelDia(reservas), [reservas]);

  if (isLoading) return <Skeleton className="h-24 w-full bg-stone-200/60" />;
  if (isError) {
    return (
      <p role="alert" className="text-sm text-red-700">
        No se pudieron cargar las reservas de este día.{" "}
        <button type="button" className="underline" onClick={() => void refetch()}>
          Reintentar
        </button>
      </p>
    );
  }
  if (!grupos.length) return <p className="py-4 text-base italic text-stone-500">Hoja en blanco: aún no hay reservas este día.</p>;

  return (
    <div className="space-y-4">
      {grupos.map((g) => (
        <section key={g.turno} aria-label={ETIQUETA_TURNO[g.turno]}>
          <h3 className="mb-1 text-base font-semibold uppercase tracking-wide text-stone-500">
            {ETIQUETA_TURNO[g.turno]} · {g.reservas.length} {g.reservas.length === 1 ? "reserva" : "reservas"} · {g.pax} pax
          </h3>
          <ul>
            {g.reservas.map((r) => {
              const info = infoEstadoReserva(r.estado);
              const sala = r.espacio_id ? nombreSala.get(r.espacio_id) : null;
              return (
                <li
                  key={r.id}
                  className={cn(
                    "flex min-h-14 items-center gap-4 border-b border-sky-300/60 px-1 py-2 text-xl",
                    r.estado === ESTADO_NO_SHOW && "opacity-60",
                    resaltada === r.id && "bg-amber-200/50",
                  )}
                >
                  <span className="w-16 shrink-0 font-semibold tabular-nums">{horaCorta(r.hora) ?? r.hora}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {r.nombre || "Sin nombre"}
                    {r.notas_cliente ? <span className="ml-2 text-lg font-normal text-stone-500">· {r.notas_cliente}</span> : null}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {r.numero_comensales} px
                  </span>
                  <span className="hidden w-32 shrink-0 truncate text-lg text-stone-600 sm:inline">{sala ?? "—"}</span>
                  {info && (
                    <Badge className={cn("shrink-0 text-sm", info.insignia)} variant={info.varianteInsignia}>
                      {info.etiqueta}
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Escritas a mano y guardadas sin interpretar en esta hoja: se pasan a limpio cuando haya tiempo. */
function PorPasarALimpio({
  borradores,
  ocupado,
  onInterpretar,
  onDescartar,
}: {
  borradores: BorradorManuscrito[];
  ocupado: boolean;
  onInterpretar: (b: BorradorManuscrito) => void;
  onDescartar: (b: BorradorManuscrito) => void;
}) {
  if (!borradores.length) return null;
  return (
    <section className="mb-5 rounded-lg border-2 border-amber-300 bg-amber-50/80 p-3" aria-label="Por pasar a limpio">
      <h3 className="mb-2 text-base font-semibold uppercase tracking-wide text-amber-800">
        Por pasar a limpio · {borradores.length}
      </h3>
      <ul className="space-y-2">
        {borradores.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-white/80 p-2">
            <img src={b.imagen} alt="Reserva escrita a mano, sin interpretar" className="h-16 max-w-full flex-1 object-contain object-left" />
            <div className="flex shrink-0 gap-2">
              <Button type="button" className="h-11 bg-emerald-600 text-white hover:bg-emerald-700" disabled={ocupado} onClick={() => onInterpretar(b)}>
                <Sparkles className="mr-2 h-4 w-4" />
                Interpretar
              </Button>
              <Button type="button" variant="outline" className="h-11 bg-white" disabled={ocupado} onClick={() => onDescartar(b)} aria-label="Descartar lo escrito">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function LibroReservas({ soloCrear = false }: Props) {
  const queryClient = useQueryClient();
  const { data: espaciosData } = useEspaciosReserva();
  const espacios = useMemo(
    () => ((espaciosData ?? []) as Array<{ id: string; nombre: string; activa?: boolean }>).filter((e) => e.activa !== false),
    [espaciosData],
  );
  const [fecha, setFecha] = useState(() => claveDia(new Date()));
  const [calendarioAbierto, setCalendarioAbierto] = useState(false);
  const [trazos, setTrazos] = useState(0);
  const [interpretando, setInterpretando] = useState(false);
  const [imagen, setImagen] = useState<string | null>(null);
  const [interpretada, setInterpretada] = useState<ReservaInterpretada | null>(null);
  const [resaltada, setResaltada] = useState<string | null>(null);
  const lienzo = useRef<LienzoManuscritoApi | null>(null);
  // Borrador que se está pasando a limpio (guardado antes sin interpretar).
  const [borradorActivo, setBorradorActivo] = useState<string | null>(null);
  const { data: pendientes = [] } = useBorradoresPendientes();
  const guardarBorrador = useGuardarBorrador();
  const resolverBorrador = useResolverBorrador();
  const pendientesHoja = pendientes.filter((b) => b.fecha === fecha);
  const primerDiaPendiente = pendientes.find((b) => b.fecha !== fecha)?.fecha ?? null;

  const revisando = !!interpretada;
  // Identidad estable: FormularioReserva reescribe sus campos si cambia.
  const datosAlta = useMemo(() => (interpretada ? datosAltaDesdeInterpretada(interpretada) : null), [interpretada]);
  const otraFecha = interpretada?.fecha_escrita && interpretada.fecha && interpretada.fecha !== fecha ? interpretada.fecha : null;

  const irA = (clave: string) => {
    setFecha(clave);
    setResaltada(null);
  };

  const nuevaReserva = () => {
    setInterpretada(null);
    setImagen(null);
    setBorradorActivo(null);
    lienzo.current?.borrar();
  };

  // «Guardar sin interpretar» (10/11/2026): por si no da tiempo; se pasa a limpio después.
  const guardarSinInterpretar = async () => {
    const png = lienzo.current?.exportar();
    if (!png) {
      toast.info("Escribe primero la reserva en el renglón");
      return;
    }
    try {
      await guardarBorrador.mutateAsync({ fecha, imagen: png });
      lienzo.current?.borrar();
      toast.success("Guardada sin interpretar", { description: `Queda en «Por pasar a limpio» del ${fechaCorta(fecha)}.` });
    } catch (e) {
      toast.error("No se pudo guardar", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const descartarBorrador = (b: BorradorManuscrito) => {
    if (!window.confirm("¿Descartar lo escrito? No se creará ninguna reserva.")) return;
    resolverBorrador.mutate(
      { id: b.id, estado: "descartado" },
      { onError: (e) => toast.error("No se pudo descartar", { description: e instanceof Error ? e.message : String(e) }) },
    );
  };

  const interpretar = (borrador?: BorradorManuscrito) => {
    const png = borrador ? borrador.imagen : lienzo.current?.exportar();
    if (!png) {
      toast.info("Escribe primero la reserva en el renglón");
      return;
    }
    void interpretarImagen(png, borrador ? borrador.fecha : fecha, borrador?.id ?? null);
  };

  const interpretarImagen = async (png: string, fechaDeHoja: string, borradorId: string | null) => {
    setInterpretando(true);
    try {
      const r = await interpretarReservaEscrita(png, espacios, fechaDeHoja);
      setImagen(png);
      setBorradorActivo(borradorId);
      setInterpretada(r);
      if (!r.texto && !r.nombre) toast.warning("No se ha entendido lo escrito: revisa los campos o vuelve a escribirlo");
    } catch (e) {
      toast.error("No se pudo interpretar", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setInterpretando(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Cabecera: pasar hojas */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 pr-12">
        <Button type="button" variant="outline" size="icon" className="h-11 w-11" aria-label="Día anterior" onClick={() => irA(pasarHoja(fecha, -1))}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <Popover open={calendarioAbierto} onOpenChange={setCalendarioAbierto}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" className="h-11 min-w-[16rem] justify-start text-base font-semibold">
              <CalendarIcon className="mr-2 h-4 w-4" />
              {fechaHoja(fecha)}
            </Button>
          </PopoverTrigger>
          {/* Sin Portal (10/11/2026): portado fuera del diálogo, el foco atrapado del libro cerraba el
              calendario o se comía el toque y no dejaba cambiar de fecha. Dentro del diálogo funciona. */}
          <PopoverPrimitive.Content
            align="start"
            sideOffset={4}
            className="z-[60] rounded-md border bg-popover p-0 text-popover-foreground shadow-md outline-none"
          >
            <Calendar
              mode="single"
              selected={diaDeClave(fecha)}
              defaultMonth={diaDeClave(fecha)}
              onSelect={(d) => {
                if (d) irA(claveDia(d));
                setCalendarioAbierto(false);
              }}
            />
          </PopoverPrimitive.Content>
        </Popover>
        <Button type="button" variant="outline" size="icon" className="h-11 w-11" aria-label="Día siguiente" onClick={() => irA(pasarHoja(fecha, 1))}>
          <ChevronRight className="h-5 w-5" />
        </Button>
        <Button type="button" variant="ghost" className="h-11" onClick={() => irA(claveDia(new Date()))}>
          Hoy
        </Button>
        {!revisando && primerDiaPendiente && (
          <Button
            type="button"
            variant="outline"
            className="ml-auto h-11 border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100"
            onClick={() => irA(primerDiaPendiente)}
          >
            {pendientes.length - pendientesHoja.length} por pasar a limpio en otros días
          </Button>
        )}
        {revisando && (
          <Button type="button" variant="outline" className="ml-auto h-11" onClick={nuevaReserva}>
            <PenLine className="mr-2 h-4 w-4" />
            Nueva reserva
          </Button>
        )}
      </div>

      {/* Hoja: lo apuntado + renglón para escribir */}
      <div className={cn("flex min-h-0 flex-1 flex-col", PAPEL, revisando && "hidden")}>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-l-4 border-rose-300/70 px-6 py-4">
          <PorPasarALimpio
            borradores={pendientesHoja}
            ocupado={interpretando || resolverBorrador.isPending}
            onInterpretar={(b) => interpretar(b)}
            onDescartar={descartarBorrador}
          />
          <ReservasDeLaHoja fecha={fecha} resaltada={resaltada} />
        </div>
        <div className="border-t-2 border-dashed border-stone-300 px-6 pb-3 pt-2">
          <p className="mb-1 text-base text-stone-500">
            Escribe la reserva con el lápiz, p. ej. <span className="font-medium">«Esther 2px salón 14:15»</span>. Sin fecha, se apunta el {fechaCorta(fecha)}.
          </p>
          <div className="h-72 overflow-hidden rounded-md border border-stone-300 bg-white/70 lg:h-96">
            <LienzoManuscrito ref={lienzo} onCambio={setTrazos} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" className="h-11 bg-white" onClick={() => lienzo.current?.borrar()} disabled={!trazos || interpretando}>
              <Eraser className="mr-2 h-4 w-4" />
              Borrar
            </Button>
            <Button type="button" variant="outline" className="h-11 bg-white" onClick={() => lienzo.current?.deshacer()} disabled={!trazos || interpretando}>
              <Undo2 className="mr-2 h-4 w-4" />
              Deshacer
            </Button>
            <Button
              type="button"
              variant="outline"
              className="ml-auto h-11 border-amber-400 bg-amber-50 px-5 text-base text-amber-900 hover:bg-amber-100"
              onClick={() => void guardarSinInterpretar()}
              disabled={!trazos || interpretando || guardarBorrador.isPending}
            >
              {guardarBorrador.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Guardar sin interpretar
            </Button>
            <Button
              type="button"
              className="h-11 bg-emerald-600 px-6 text-base text-white hover:bg-emerald-700"
              onClick={() => interpretar()}
              disabled={!trazos || interpretando}
            >
              {interpretando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {interpretando ? "Interpretando…" : "Interpretar"}
            </Button>
          </div>
        </div>
      </div>

      {/* Vista previa: el trazo al lado del alta manual prellenada */}
      {revisando && interpretada && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:overflow-hidden">
          <div className="space-y-3 lg:min-h-0 lg:overflow-y-auto">
            <h3 className="text-sm font-semibold">Lo que has escrito</h3>
            {imagen && <img src={imagen} alt="Reserva escrita a mano" className={cn("w-full rounded-md border", PAPEL)} />}
            {interpretada.texto && (
              <p className="text-sm text-muted-foreground">
                Leído: <span className="font-medium text-foreground">«{interpretada.texto}»</span>
              </p>
            )}
            {otraFecha && (
              <Alert className="border-amber-300 bg-amber-50 text-amber-900">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Lo escrito dice el <strong>{fechaCorta(otraFecha)}</strong>, no el {fechaCorta(fecha)} de la hoja abierta. Se apuntará en la fecha del
                  formulario y el libro pasará a esa hoja.
                </AlertDescription>
              </Alert>
            )}
            {interpretada.espacio_texto && !interpretada.espacio_id && (
              <Alert className="border-amber-300 bg-amber-50 text-amber-900">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  No hay ninguna sala «{interpretada.espacio_texto}»: elígela en el formulario o déjala sin asignar.
                </AlertDescription>
              </Alert>
            )}
            <Button type="button" variant="outline" className="h-11" onClick={() => setInterpretada(null)}>
              <PenLine className="mr-2 h-4 w-4" />
              Volver a escribir
            </Button>
          </div>
          <div className="rounded-lg border p-4 lg:min-h-0 lg:overflow-y-auto">
            <FormularioReserva
              datosPreseleccionados={datosAlta}
              soloCrear={soloCrear}
              confirmarAntesDeGuardar={false}
              onSuccess={(creada) => {
                void queryClient.invalidateQueries({ queryKey: [CLAVE_RESERVAS_SERVICIO_DIA] });
                if (borradorActivo) {
                  resolverBorrador.mutate({ id: borradorActivo, estado: "pasado", reservaId: creada?.id ?? null });
                }
                nuevaReserva();
                if (creada?.fecha) setFecha(creada.fecha);
                setResaltada(creada?.id ?? null);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
