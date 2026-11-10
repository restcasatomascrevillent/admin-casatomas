import { useEffect, useState, type ReactNode } from "react";
import { CalendarIcon, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useEdicionReserva } from "@/hooks/useEdicionReserva";
import { useArrastrarHoja } from "@/hooks/useArrastrarHoja";
import { claveDia, diaDeClave, pasarHoja, tituloHoja } from "@/lib/reservas/libroReservas";
import { ReservasDeLaHoja } from "./ReservasDeLaHoja";

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
  /** Algo más para la barra de arriba (el conmutador «Libro | Tabla»). */
  extra?: ReactNode;
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
  onAnadir,
  resaltada,
}: {
  fecha: string;
  lado: "izquierda" | "derecha" | "sola";
  onAbrir: (id: string) => void;
  onAnadir?: (fecha: string) => void;
  resaltada?: string | null;
}) {
  return (
    <article
      aria-label={`Hoja del ${tituloHoja(fecha)}`}
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col bg-[#fbf6e9] text-stone-800 shadow-md ring-1 ring-stone-300",
        lado === "izquierda" && "rounded-l-lg",
        lado === "derecha" && "rounded-r-lg",
        lado === "sola" && "rounded-lg",
      )}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b-2 border-sky-300/70 px-6 pb-3 pt-4">
        <h2 className="mr-auto text-2xl font-semibold text-stone-800">{tituloHoja(fecha)}</h2>
        {onAnadir && (
          <Button
            type="button"
            className="h-12 gap-2 bg-emerald-600 px-5 text-base font-semibold text-white shadow-sm hover:bg-emerald-700 [&_svg]:size-5"
            onClick={() => onAnadir(fecha)}
          >
            <Plus /> Añadir reserva a este día
          </Button>
        )}
      </div>
      {/* `touch-pan-y` y `overflow-x-hidden` AQUÍ, en el contenedor con scroll: si no, el navegador se queda el
          gesto lateral y arrastrar no pasa la hoja (ver `useArrastrarHoja`). */}
      <div
        className="min-h-0 flex-1 touch-pan-y overflow-y-auto overflow-x-hidden overscroll-contain border-l-4 border-rose-300/70 px-5 py-3"
        data-testid="hoja-scroll"
      >
        <ReservasDeLaHoja fecha={fecha} onAbrirReserva={onAbrir} resaltada={resaltada} />
      </div>
    </article>
  );
}

export function ListaComoLibro({ extra, onAnadirReserva, resaltar = null }: Props) {
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

  const irA = (clave: string) => {
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
    <div className="flex flex-col gap-3">
      {/* Barra: pasar hojas */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="icon" className="h-11 w-11" aria-label="Hoja anterior" onClick={() => pasar(-1)}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <Popover open={calendarioAbierto} onOpenChange={setCalendarioAbierto}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" className="h-11 min-w-[16rem] justify-start text-base font-semibold" aria-label="Elegir día">
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
        <Button type="button" variant="ghost" className="h-11 text-base" onClick={() => irA(hoy)} disabled={fecha === hoy}>
          Hoy
        </Button>
        {extra && <div className="ml-auto">{extra}</div>}
      </div>

      {/* El libro */}
      <div
        ref={setBloque}
        className={cn("mx-auto flex w-full touch-pan-y flex-col", dosHojas ? "max-w-[96rem]" : "max-w-4xl", !alto && "min-h-[60dvh]")}
        style={alto ? { height: alto } : undefined}
        {...manejadores}
        data-testid="libro-lista"
      >
        <div
          style={desplazamiento ? { transform: `translateX(${desplazamiento}px)` } : undefined}
          className={cn("flex min-h-0 flex-1", !desplazamiento && "transition-transform duration-200")}
          data-testid="hoja-que-sigue-al-dedo"
        >
        <div
          key={fecha}
          className={cn(
            "flex min-h-0 flex-1 motion-safe:duration-300 motion-safe:animate-in motion-safe:fade-in-0",
            sentido === 1 ? "motion-safe:slide-in-from-right-8" : "motion-safe:slide-in-from-left-8",
          )}
          data-sentido={sentido === 1 ? "siguiente" : "anterior"}
        >
          {dosHojas ? (
            <>
              <Hoja fecha={fecha} lado="izquierda" onAbrir={editarReserva} />
              {/* El lomo del libro */}
              <div aria-hidden className="w-2 shrink-0 bg-gradient-to-r from-stone-400/60 via-stone-200 to-stone-400/60" />
              <Hoja fecha={pasarHoja(fecha, 1)} lado="derecha" onAbrir={editarReserva} />
            </>
          ) : (
            <Hoja fecha={fecha} lado="sola" onAbrir={editarReserva} onAnadir={onAnadirReserva} resaltada={resaltada} />
          )}
        </div>
        </div>
      </div>
      {dialogoEdicion}
    </div>
  );
}
