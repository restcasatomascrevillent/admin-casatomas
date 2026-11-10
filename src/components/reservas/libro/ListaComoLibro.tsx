import { useRef, useState, type ReactNode, type TouchEvent } from "react";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useEdicionReserva } from "@/hooks/useEdicionReserva";
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
/** Desplazamiento horizontal mínimo (px) para que deslizar pase hoja. */
const UMBRAL_DESLIZAR = 60;

interface Props {
  /** Algo más para la barra de arriba (el conmutador «Libro | Tabla»). */
  extra?: ReactNode;
}

function Hoja({ fecha, lado, onAbrir }: { fecha: string; lado: "izquierda" | "derecha" | "sola"; onAbrir: (id: string) => void }) {
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
      <h2 className="shrink-0 border-b-2 border-sky-300/70 px-6 pb-2 pt-3 text-2xl font-semibold text-stone-800">{tituloHoja(fecha)}</h2>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-l-4 border-rose-300/70 px-5 py-3" data-testid="hoja-scroll">
        <ReservasDeLaHoja fecha={fecha} onAbrirReserva={onAbrir} />
      </div>
    </article>
  );
}

export function ListaComoLibro({ extra }: Props) {
  const [fecha, setFecha] = useState(() => claveDia(new Date()));
  // Hacia dónde se pasó la última hoja: decide de qué lado entra la nueva.
  const [sentido, setSentido] = useState<1 | -1>(1);
  const [calendarioAbierto, setCalendarioAbierto] = useState(false);
  // Una sola hoja siempre (10/11/2026, petición del dueño: con dos hojas no se veían los nombres).
  const dosHojas = false as boolean;
  const { editarReserva, dialogoEdicion } = useEdicionReserva();
  const [bloque, setBloque] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(bloque, ALTURA_MINIMA_LIBRO);
  const inicioToque = useRef<{ x: number; y: number } | null>(null);

  const irA = (clave: string) => {
    if (clave === fecha) return;
    setSentido(clave > fecha ? 1 : -1);
    setFecha(clave);
  };
  const pasar = (delta: 1 | -1) => irA(pasarHoja(fecha, delta));

  const alTocar = (e: TouchEvent) => {
    const t = e.touches[0];
    inicioToque.current = t ? { x: t.clientX, y: t.clientY } : null;
  };
  const alSoltar = (e: TouchEvent) => {
    const ini = inicioToque.current;
    inicioToque.current = null;
    const t = e.changedTouches[0];
    if (!ini || !t) return;
    const dx = t.clientX - ini.x;
    const dy = t.clientY - ini.y;
    if (Math.abs(dx) < UMBRAL_DESLIZAR || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    // Como en un libro: el dedo hacia la izquierda pasa a la hoja siguiente.
    pasar(dx < 0 ? 1 : -1);
  };

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
        onTouchStart={alTocar}
        onTouchEnd={alSoltar}
        onTouchCancel={() => {
          inicioToque.current = null;
        }}
        data-testid="libro-lista"
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
            <Hoja fecha={fecha} lado="sola" onAbrir={editarReserva} />
          )}
        </div>
      </div>
      {dialogoEdicion}
    </div>
  );
}
