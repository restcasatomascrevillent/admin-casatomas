import { useEffect, useState } from "react";
import { CalendarIcon, ChevronLeft, ChevronRight, Clock, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useEdicionReserva } from "@/hooks/useEdicionReserva";
import { useArrastrarHoja } from "@/hooks/useArrastrarHoja";
import { claveDia, diaDeClave, pasarHoja, tituloHoja } from "@/lib/reservas/libroReservas";
import { etiquetaEstadoReserva } from "@/lib/reservas/estadosReserva";
import { MIN_LETRAS_BUSQUEDA, useBuscarReservas, useReservasPorEstado } from "@/hooks/useBusquedaReservas";
import { ReservasDeLaHoja } from "./ReservasDeLaHoja";
import { ResultadosLista } from "./ResultadosLista";

// ============================================================================
// LA LISTA COMO EL LIBRO (10/11/2026, petición del dueño: «hacer o simular como
// el libro, que tenga hojas que vas pasando»)
// ----------------------------------------------------------------------------
// Una hoja por día con la estética del libro de «Escribir reserva» (papel
// crema, renglones azules, margen rosa) y lo apuntado por Comida y Cena
// (`ReservasDeLaHoja`, la misma consulta por día). Se pasan hojas con ← →, el
// calendario, «Hoy» o deslizando el dedo a izquierda/derecha. Desde 1280 px
// se ve el libro abierto: el día a la izquierda y el siguiente a la derecha.
// Tocar un renglón abre el editor de siempre (`useEdicionReserva`, como la
// tabla). La página no desplaza (regla del dueño): el bloque mide lo que queda
// de pantalla (`useAlturaDisponible`) y solo hace scroll cada hoja por dentro.
// La animación de pasar hoja es corta y solo con `motion-safe`.
// ============================================================================

/** Suelo del bloque del libro (px): por debajo vuelve el scroll de página. */
const ALTURA_MINIMA_LIBRO = 360;
interface Props {
  /**
   * Un estado que llega de un aviso o de un enlace (`?status=`): la Lista abre esas reservas de hoy en
   * adelante en vez de la hoja del día. «pendiente» es el botón «Pendientes».
   */
  estadoInicial?: string | null;
  /**
   * «+ Añadir reserva a este día» (10/11/2026, petición del dueño): abre el diálogo «Nueva Reserva» de la
   * página ya puesto en el día de la hoja. Sin él (sin permiso de crear) el botón no sale.
   */
  onAnadirReserva?: (fecha: string) => void;
  /** La reserva recién creada: el libro va a su día y la resalta. */
  resaltar?: { id: string; fecha: string } | null;
}

function Hoja({
  fecha,
  lado,
  onAbrir,
  resaltada,
}: {
  fecha: string;
  lado: "izquierda" | "derecha" | "sola";
  onAbrir: (id: string) => void;
  resaltada?: string | null;
}) {
  return (
    <article
      aria-label={`Hoja del ${tituloHoja(fecha)}`}
      className={cn(
        // 11/11/2026 (dueño: «el libro vale que se vea bien pero no hace falta que parezca un libro»): una tarjeta
        // limpia, sin papel, sin margen rojo ni renglones azules.
        "flex min-h-0 min-w-0 flex-1 flex-col border bg-card text-card-foreground shadow-sm",
        lado === "izquierda" && "rounded-l-xl",
        lado === "derecha" && "rounded-r-xl",
        lado === "sola" && "rounded-xl",
      )}
    >
      {/* 11/11/2026 («ajusta la estética»): el día ya está en la barra; aquí solo para el lector de pantalla. */}
      <h2 className="sr-only">{tituloHoja(fecha)}</h2>
      {/* `touch-pan-y` y `overflow-x-hidden` AQUÍ, en el contenedor con scroll: si no, el navegador se queda el
          gesto lateral y arrastrar no pasa la hoja (ver `useArrastrarHoja`). */}
      <div
        className="min-h-0 flex-1 touch-pan-y overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-3 sm:px-5"
        data-testid="hoja-scroll"
      >
        <ReservasDeLaHoja fecha={fecha} onAbrirReserva={onAbrir} resaltada={resaltada} />
      </div>
    </article>
  );
}

export function ListaComoLibro({ estadoInicial = null, onAnadirReserva, resaltar = null }: Props) {
  const [fecha, setFecha] = useState(() => claveDia(new Date()));
  // Hacia dónde se pasó la última hoja: decide de qué lado entra la nueva.
  const [sentido, setSentido] = useState<1 | -1>(1);
  const [calendarioAbierto, setCalendarioAbierto] = useState(false);
  // Una sola hoja siempre (10/11/2026, petición del dueño: con dos hojas no se veían los nombres).
  const dosHojas = false as boolean;
  const { editarReserva, dialogoEdicion } = useEdicionReserva();
  const [bloque, setBloque] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(bloque, ALTURA_MINIMA_LIBRO);
  const [resaltada, setResaltada] = useState<string | null>(null);
  // Buscador (todo el histórico) y «Pendientes» / estado del aviso. Con cualquiera de los dos se ven
  // los resultados en lugar de la hoja; «Ver el día» o quitarlos vuelve a la hoja.
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState<string | null>(estadoInicial);
  const busqueda = useBuscarReservas(texto);
  const pendientes = useReservasPorEstado("pendiente");
  const otroEstado = useReservasPorEstado(estado && estado !== "pendiente" ? estado : null);
  const porEstado = estado === "pendiente" ? pendientes : otroEstado;
  const buscando = texto.trim().length >= MIN_LETRAS_BUSQUEDA;
  const numPendientes = pendientes.data?.length ?? 0;

  const irA = (clave: string) => {
    setTexto("");
    setEstado(null);
    if (clave === fecha) return;
    setSentido(clave > fecha ? 1 : -1);
    setFecha(clave);
  };
  const pasar = (delta: 1 | -1) => irA(pasarHoja(fecha, delta));
  // Arrastrar con el dedo sobre TODA la hoja (como en un libro, a la izquierda = hoja siguiente).
  const { manejadores, desplazamiento } = useArrastrarHoja(pasar);

  // Al crear una reserva desde «Añadir reserva a este día», el libro va a su día y la resalta.
  useEffect(() => {
    if (!resaltar) return;
    setSentido(resaltar.fecha >= fecha ? 1 : -1);
    setFecha(resaltar.fecha);
    setResaltada(resaltar.id);
    // Solo cuando llega una reserva nueva, no al pasar hojas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resaltar]);

  const hoy = claveDia(new Date());

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* Barra: pasar hojas, «Hoy», el buscador y «Pendientes». */}
      {/* 11/11/2026 («ajusta la estética»): en tablet, arriba el día y «Añadir reserva»; debajo, el buscador a todo
          lo ancho (que se lea entero) y «Pendientes». Desde 1280 px, todo en una línea. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="order-1 flex items-center gap-1">
          <Button type="button" variant="outline" size="icon" className="h-11 w-11" aria-label="Hoja anterior" onClick={() => pasar(-1)}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Popover open={calendarioAbierto} onOpenChange={setCalendarioAbierto}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" className="h-11 justify-start px-3 text-base font-semibold" aria-label="Elegir día">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {tituloHoja(fecha)}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-0">
              <Calendar
                mode="single"
                selected={diaDeClave(fecha)}
                defaultMonth={diaDeClave(fecha)}
                onSelect={(d) => {
                  if (d) irA(claveDia(d));
                  setCalendarioAbierto(false);
                }}
              />
            </PopoverContent>
          </Popover>
          <Button type="button" variant="outline" size="icon" className="h-11 w-11" aria-label="Hoja siguiente" onClick={() => pasar(1)}>
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>
        <Button type="button" variant="outline" className="order-1 h-11 px-4 text-base" onClick={() => irA(hoy)} disabled={fecha === hoy && !buscando && !estado}>
          Hoy
        </Button>
        {onAnadirReserva && !buscando && !estado && (
          <Button
            type="button"
            className="order-2 ml-auto h-11 gap-2 bg-emerald-600 px-4 text-base font-semibold text-white shadow-sm hover:bg-emerald-700 xl:order-3"
            onClick={() => onAnadirReserva(fecha)}
          >
            <Plus className="h-5 w-5" /> Añadir reserva a este día
          </Button>
        )}
        <div className="order-3 flex w-full items-center gap-2 xl:order-2 xl:w-auto xl:flex-1">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Buscar nombre, teléfono o email"
              aria-label="Buscar en todas las reservas"
              className="h-11 pl-9 pr-10 text-base"
            />
            {texto && (
              <button
                type="button"
                className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground"
                aria-label="Borrar la búsqueda"
                onClick={() => setTexto("")}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button
            type="button"
            variant={estado === "pendiente" ? "default" : "outline"}
            className="h-11 gap-2 text-base"
            aria-pressed={estado === "pendiente"}
            onClick={() => {
              setTexto("");
              setEstado((e) => (e === "pendiente" ? null : "pendiente"));
            }}
          >
            <Clock className="h-4 w-4" /> Pendientes
            <span
              className={cn(
                "min-w-6 rounded-full px-1.5 text-sm font-semibold tabular-nums",
                estado === "pendiente" ? "bg-primary-foreground/20" : numPendientes ? "bg-status-pending text-status-pending-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              {numPendientes}
            </span>
          </Button>
        </div>
      </div>

      {/* El libro */}
      <div
        ref={setBloque}
        className={cn("mx-auto flex w-full min-w-0 touch-pan-y flex-col overflow-hidden", dosHojas ? "max-w-[96rem]" : "max-w-4xl", !alto && "min-h-[60dvh]")}
        style={alto ? { height: alto } : undefined}
        {...manejadores}
        data-testid="libro-lista"
      >
        <div
          style={desplazamiento ? { transform: `translateX(${desplazamiento}px)` } : undefined}
          className={cn("flex min-h-0 min-w-0 w-full flex-1", !desplazamiento && "transition-transform duration-200")}
          data-testid="hoja-que-sigue-al-dedo"
        >
        <div
          key={fecha}
          className={cn(
            // min-w-0 en cada caja flex (10/11/2026): sin él, una nota larga ensanchaba la hoja y la página hacía scroll horizontal.
            "flex min-h-0 min-w-0 w-full flex-1 motion-safe:duration-300 motion-safe:animate-in motion-safe:fade-in-0",
            sentido === 1 ? "motion-safe:slide-in-from-right-8" : "motion-safe:slide-in-from-left-8",
          )}
          data-sentido={sentido === 1 ? "siguiente" : "anterior"}
        >
          {buscando ? (
            <ResultadosLista
              titulo={<>Resultados de «{texto.trim()}»</>}
              reservas={busqueda.data}
              cargando={busqueda.isLoading || busqueda.escribiendo}
              error={busqueda.isError}
              onReintentar={() => void busqueda.refetch()}
              vacio="No hay ninguna reserva con ese nombre, teléfono o email."
              nota={busqueda.data && busqueda.data.length >= busqueda.limite ? `Se enseñan las ${busqueda.limite} más recientes: escribe algo más para afinar.` : null}
              conTelefono
              onAbrir={editarReserva}
              onVerDia={irA}
            />
          ) : estado ? (
            <ResultadosLista
              titulo={
                <span className="flex flex-wrap items-center gap-2">
                  {estado === "pendiente" ? "Pendientes de verificar" : `${etiquetaEstadoReserva(estado)}s`}
                  <span className="text-base font-normal text-muted-foreground">desde hoy</span>
                </span>
              }
              reservas={porEstado.data}
              cargando={porEstado.isLoading}
              error={porEstado.isError}
              onReintentar={() => void porEstado.refetch()}
              vacio={estado === "pendiente" ? "No hay reservas pendientes de verificar." : "No hay reservas en este estado desde hoy."}
              conTelefono
              onAbrir={editarReserva}
              onVerDia={irA}
            />
          ) : dosHojas ? (
            <>
              <Hoja fecha={fecha} lado="izquierda" onAbrir={editarReserva} />
              {/* El lomo del libro */}
              <div aria-hidden className="w-2 shrink-0 bg-gradient-to-r from-stone-400/60 via-stone-200 to-stone-400/60" />
              <Hoja fecha={pasarHoja(fecha, 1)} lado="derecha" onAbrir={editarReserva} />
            </>
          ) : (
            <Hoja fecha={fecha} lado="sola" onAbrir={editarReserva} resaltada={resaltada} />
          )}
        </div>
        </div>
      </div>
      {dialogoEdicion}
    </div>
  );
}
