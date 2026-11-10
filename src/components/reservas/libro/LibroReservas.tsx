import { useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarIcon, ChevronLeft, ChevronRight, ClipboardList, Eraser, Loader2, PenLine, Save, Sparkles, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { FormularioReserva } from "@/components/reservas/FormularioReserva";
import { CLAVE_RESERVAS_SERVICIO_DIA } from "@/hooks/useReservasServicioDia";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { useGastoLecturaManuscrita } from "@/hooks/useGastoLecturaManuscrita";
import { formatearEurPequeno } from "@/lib/reservas/gastoLecturaManuscrita";
import { useBorradoresPendientes, useGuardarBorrador, useResolverBorrador, type BorradorManuscrito } from "@/hooks/useBorradoresManuscritos";
import {
  claveDia,
  datosAltaDesdeInterpretada,
  diaDeClave,
  interpretarReservaEscrita,
  pasarHoja,
  tituloHoja,
  type ReservaInterpretada,
} from "@/lib/reservas/libroReservas";
import { useArrastrarHoja } from "@/hooks/useArrastrarHoja";
import { useDosColumnas } from "@/hooks/useDosColumnas";
import { LienzoManuscrito, type LienzoManuscritoApi } from "./LienzoManuscrito";
import { ReservasDeLaHoja } from "./ReservasDeLaHoja";

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
//
// «Nueva reserva» única (10/11/2026, petición del dueño: «unifica las dos
// listas, que salga como la segunda y después ya el formulario o para
// escribir»): este componente ES el diálogo entero. Arriba siempre la hoja del
// día en grande; debajo se elige «Escribir con lápiz» o «Formulario» (se
// recuerda en el dispositivo). El formulario no repite su lista del día y, si
// se le cambia la fecha, la hoja de arriba pasa a ese día.
//
// Dos columnas en horizontal (10/11/2026, petición del dueño): con ≥ 1024 px, o
// tablet en horizontal con ≥ 900 px (`useDosColumnas`), a la izquierda la hoja
// del día (~40 %) y a la derecha «Apuntar nueva» con el formulario o el lienzo
// (~60 %), cada una con su scroll y a toda la altura; el formulario va en una
// sola columna (`formulario-una-columna`, index.css) con su «Crear Reserva»
// pegado abajo. En vertical, apilado como antes. Los avisos (toasts) salen a la
// izquierda mientras el diálogo está abierto (`data-dialogo-nueva-reserva`),
// para no tapar el botón de guardar.
//
// Pasar hojas arrastrando (`useArrastrarHoja`) SOLO en la lista de la hoja,
// nunca en el lienzo de escribir.
// ============================================================================

type ModoApunte = "lapiz" | "formulario";
const CLAVE_MODO = "reservas.modoAlta";

function leerModo(): ModoApunte {
  try {
    return localStorage.getItem(CLAVE_MODO) === "formulario" ? "formulario" : "lapiz";
  } catch {
    return "lapiz";
  }
}

const PAPEL = "bg-[#fbf6e9] text-stone-800";

interface Props {
  /** Solo «Reservas · Crear»: el alta sin «Ocupa la sala entera» (como «Nueva Reserva»). */
  soloCrear?: boolean;
  /** "yyyy-MM-dd": el libro se abre en esa hoja y el formulario con ese día (desde «Añadir reserva a este día»). */
  fechaInicial?: string | null;
  /** Al crear una reserva (por formulario o lápiz). */
  onReservaCreada?: (reserva: { id: string; fecha: string }) => void;
}

function fechaCorta(clave: string): string {
  return format(diaDeClave(clave), "d 'de' MMMM", { locale: es });
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

export function LibroReservas({ soloCrear = false, fechaInicial = null, onReservaCreada }: Props) {
  const queryClient = useQueryClient();
  const { data: espaciosData } = useEspaciosReserva();
  const espacios = useMemo(
    () => ((espaciosData ?? []) as Array<{ id: string; nombre: string; activa?: boolean }>).filter((e) => e.activa !== false),
    [espaciosData],
  );
  const [fecha, setFecha] = useState(() => fechaInicial ?? claveDia(new Date()));
  const dosColumnas = useDosColumnas();
  const [calendarioAbierto, setCalendarioAbierto] = useState(false);
  const [trazos, setTrazos] = useState(0);
  const [interpretando, setInterpretando] = useState(false);
  const [imagen, setImagen] = useState<string | null>(null);
  const [interpretada, setInterpretada] = useState<ReservaInterpretada | null>(null);
  const [resaltada, setResaltada] = useState<string | null>(null);
  const lienzo = useRef<LienzoManuscritoApi | null>(null);
  const [modo, setModo] = useState<ModoApunte>(leerModo);
  // Cambia tras cada alta por formulario: lo vacía para la siguiente.
  const [altaFormulario, setAltaFormulario] = useState(0);
  const datosFormulario = useMemo(() => ({ fecha: diaDeClave(fecha) }), [fecha]);
  const elegirModo = (m: ModoApunte) => {
    setModo(m);
    try {
      localStorage.setItem(CLAVE_MODO, m);
    } catch {
      /* sin almacenamiento: no se recuerda */
    }
  };
  // Borrador que se está pasando a limpio (guardado antes sin interpretar).
  const [borradorActivo, setBorradorActivo] = useState<string | null>(null);
  const { data: pendientes = [] } = useBorradoresPendientes();
  const guardarBorrador = useGuardarBorrador();
  const resolverBorrador = useResolverBorrador();
  const pendientesHoja = pendientes.filter((b) => b.fecha === fecha);
  // Gasto de las lecturas (10/11/2026, «monitorizar el gasto»): línea discreta bajo los botones.
  const { data: gastoLectura } = useGastoLecturaManuscrita();
  const primerDiaPendiente = pendientes.find((b) => b.fecha !== fecha)?.fecha ?? null;

  const revisando = !!interpretada;
  // Identidad estable: FormularioReserva reescribe sus campos si cambia.
  const datosAlta = useMemo(() => (interpretada ? datosAltaDesdeInterpretada(interpretada) : null), [interpretada]);
  const otraFecha = interpretada?.fecha_escrita && interpretada.fecha && interpretada.fecha !== fecha ? interpretada.fecha : null;

  const irA = (clave: string) => {
    setFecha(clave);
    setResaltada(null);
  };
  // Arrastrar con el dedo en la LISTA de la hoja (no en el lienzo): a la izquierda, día siguiente.
  const { manejadores: arrastre, desplazamiento } = useArrastrarHoja((delta) => irA(pasarHoja(fecha, delta)));
  const avisarCreada = (creada: { id?: string | null; fecha?: string | null } | null | undefined) => {
    if (creada?.id && creada.fecha) onReservaCreada?.({ id: creada.id, fecha: creada.fecha });
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
    <div className="flex h-full min-h-0 flex-col" data-dialogo-nueva-reserva="">
      {/* Cabecera: pasar hojas */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 pr-12">
        <Button type="button" variant="outline" size="icon" className="h-11 w-11" aria-label="Día anterior" onClick={() => irA(pasarHoja(fecha, -1))}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <Popover open={calendarioAbierto} onOpenChange={setCalendarioAbierto}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" className="h-11 min-w-[16rem] justify-start text-base font-semibold">
              <CalendarIcon className="mr-2 h-4 w-4" />
              {tituloHoja(fecha)}
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
      <div
        className={cn("flex min-h-0 flex-1", dosColumnas ? "flex-row" : "flex-col", PAPEL, revisando && "hidden")}
        data-columnas={dosColumnas ? "2" : "1"}
      >
        <div
          className={cn(
            "min-h-[22dvh] touch-pan-y overflow-y-auto overflow-x-hidden overscroll-contain border-l-4 border-rose-300/70 px-6 py-5",
            dosColumnas ? "w-2/5 shrink-0 border-r border-r-stone-300" : "flex-1",
          )}
          data-testid="lista-hoja-libro"
          {...arrastre}
        >
          <div
            style={desplazamiento ? { transform: `translateX(${desplazamiento}px)` } : undefined}
            className={cn(!desplazamiento && "transition-transform duration-200")}
          >
          <PorPasarALimpio
            borradores={pendientesHoja}
            ocupado={interpretando || resolverBorrador.isPending}
            onInterpretar={(b) => interpretar(b)}
            onDescartar={descartarBorrador}
          />
          <ReservasDeLaHoja fecha={fecha} resaltada={resaltada} />
          </div>
        </div>
        <div className={cn("flex min-h-0 flex-col", dosColumnas && "min-w-0 flex-1")} data-testid="columna-apuntar">
        <div
          className={cn(
            "flex flex-wrap items-center gap-3 px-6",
            dosColumnas ? "border-b border-stone-300 py-4" : "border-t-2 border-dashed border-stone-300 pt-3",
          )}
        >
          <span className="text-base font-semibold text-stone-600">Apuntar nueva:</span>
          <div role="group" aria-label="Cómo apuntarla" className="inline-flex rounded-lg border-2 border-stone-700/70 bg-white p-0.5">
            <Button
              type="button"
              variant={modo === "lapiz" ? "default" : "ghost"}
              className="h-11 px-4 text-base font-semibold"
              aria-pressed={modo === "lapiz"}
              onClick={() => elegirModo("lapiz")}
            >
              <PenLine className="mr-2 h-4 w-4" />
              Escribir con lápiz
            </Button>
            <Button
              type="button"
              variant={modo === "formulario" ? "default" : "ghost"}
              className="h-11 px-4 text-base font-semibold"
              aria-pressed={modo === "formulario"}
              onClick={() => elegirModo("formulario")}
            >
              <ClipboardList className="mr-2 h-4 w-4" />
              Formulario
            </Button>
          </div>
        </div>
        {modo === "formulario" ? (
          <div
            className={cn(
              "overflow-y-auto overscroll-contain bg-background px-6 pt-4 text-foreground",
              // En dos columnas, SIN relleno inferior: el `sticky bottom-0` del pie se pega al borde del relleno del
              // contenedor, y con `pb-6` quedaba una franja de 24 px por debajo del botón por la que asomaban los
              // campos («Dentro | Fuera»). El pie lleva su propio fondo y borde (`.formulario-una-columna`, index.css).
              dosColumnas ? "formulario-una-columna min-h-0 flex-1 pb-0" : "max-h-[58dvh] pb-6",
            )}
          >
            <div className={cn("mx-auto", dosColumnas ? "max-w-2xl" : "max-w-4xl")}>
              <FormularioReserva
                key={altaFormulario}
                datosPreseleccionados={datosFormulario}
                soloCrear={soloCrear}
                ocultarReservasDelDia
                onCambioFecha={(f) => {
                  if (f !== fecha) irA(f);
                }}
                onSuccess={(creada) => {
                  void queryClient.invalidateQueries({ queryKey: [CLAVE_RESERVAS_SERVICIO_DIA] });
                  if (creada?.fecha) setFecha(creada.fecha);
                  setResaltada(creada?.id ?? null);
                  setAltaFormulario((n) => n + 1);
                  avisarCreada(creada);
                }}
              />
            </div>
          </div>
        ) : (
        <div
          className={cn("px-6 pb-4 pt-3", dosColumnas && "flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain")}
          data-testid="zona-lapiz"
        >
          <p className="mb-2 shrink-0 text-base text-stone-500">
            Escribe la reserva con el lápiz, p. ej. <span className="font-medium">«Esther 2px salón 14:15»</span>. Sin fecha, se apunta el {fechaCorta(fecha)}.
          </p>
          {/* En dos columnas el renglón ocupa todo el alto que queda (mínimo 280 px) y los botones van abajo
              (10/11/2026: con alto fijo quedaba media columna vacía). Apilado, el alto de siempre. */}
          <div
            className={cn(
              "overflow-hidden rounded-md border border-stone-300 bg-white/70",
              dosColumnas ? "min-h-[280px] flex-1" : "h-[clamp(11rem,32dvh,20rem)]",
            )}
            data-testid="caja-lienzo"
          >
            <LienzoManuscrito ref={lienzo} onCambio={setTrazos} />
          </div>
          <div className="mt-4 flex shrink-0 flex-wrap items-center gap-3">
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
          {gastoLectura && gastoLectura.mes.lecturas > 0 && (
            <p className="mt-2 shrink-0 text-right text-xs text-stone-500" data-testid="gasto-lectura">
              Este mes: {gastoLectura.mes.lecturas} {gastoLectura.mes.lecturas === 1 ? "lectura" : "lecturas"} ·{" "}
              {formatearEurPequeno(gastoLectura.mes.eur)}
              {gastoLectura.mes.eurPorLectura != null && <> ({formatearEurPequeno(gastoLectura.mes.eurPorLectura)} cada una)</>}
            </p>
          )}
        </div>
        )}
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
                avisarCreada(creada);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
