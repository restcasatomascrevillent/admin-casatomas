import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarIcon, ChevronLeft, ChevronRight, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { FormularioReserva } from "@/components/reservas/FormularioReserva";
import { CLAVE_RESERVAS_SERVICIO_DIA } from "@/hooks/useReservasServicioDia";
import { claveDia, diaDeClave, pasarHoja, tituloHoja } from "@/lib/reservas/libroReservas";
import { useArrastrarHoja } from "@/hooks/useArrastrarHoja";
import { useDosColumnas } from "@/hooks/useDosColumnas";
import { ReservasDeLaHoja } from "./ReservasDeLaHoja";

// ============================================================================
// «NUEVA RESERVA» — la hoja del día y el formulario (10/11/2026, petición del dueño)
// ----------------------------------------------------------------------------
// Una hoja por día (← → y calendario para pasar hojas): arriba, o a la izquierda en horizontal, lo ya
// apuntado (`useReservasServicioDia`); al lado, «Apuntar nueva» con el ALTA MANUAL de siempre
// (`FormularioReserva`): mismas validaciones, aforo, blacklist, permisos y canal `manual`. Al guardar,
// la reserva sale apuntada en su hoja. Ocupa el diálogo entero y hace scroll solo por dentro: la página
// del panel no desplaza (regla del dueño).
//
// 11/11/2026, petición del dueño («Quita la opción de escribir la reserva a mano con lápiz»): fuera el
// lápiz (lienzo, «Interpretar», «Guardar sin interpretar» y «Por pasar a limpio»). Solo queda el
// formulario.
//
// Dos columnas en horizontal: con ≥ 1024 px, o tablet en horizontal con ≥ 900 px (`useDosColumnas`), a la
// izquierda la hoja del día (~40 %) y a la derecha el formulario (~60 %), cada una con su scroll y a toda
// la altura; el formulario va en una sola columna (`formulario-una-columna`, index.css) con su «Crear
// Reserva» pegado abajo. En vertical, apilado. Los avisos (toasts) salen a la izquierda mientras el
// diálogo está abierto (`data-dialogo-nueva-reserva`), para no tapar el botón de guardar.
//
// Pasar hojas arrastrando (`useArrastrarHoja`) en la lista de la hoja.
// ============================================================================

// Sin papel (11/11/2026, «no hace falta que parezca un libro»): fondo y texto normales del panel.
const PAPEL = "bg-background text-foreground";

interface Props {
  /** Solo «Reservas · Crear»: el alta sin «Ocupa la sala entera» (como «Nueva Reserva»). */
  soloCrear?: boolean;
  /** "yyyy-MM-dd": el libro se abre en esa hoja y el formulario con ese día (desde «Añadir reserva a este día»). */
  fechaInicial?: string | null;
  /** Al crear una reserva. */
  onReservaCreada?: (reserva: { id: string; fecha: string }) => void;
  /**
   * Solo apuntar (10/11/2026, petición del dueño): abierto desde «+ Añadir reserva a este día» del libro de la
   * Lista, que ya enseña la hoja detrás. Sin la hoja del día: el formulario centrado a todo el ancho (máx. 48rem).
   * El día se sigue pudiendo cambiar con ← → y el calendario.
   */
  soloApuntar?: boolean;
  /** Cada vez que cambia el día de la hoja (para el título del diálogo). */
  onCambioFecha?: (fecha: string) => void;
}

export function LibroReservas({ soloCrear = false, fechaInicial = null, onReservaCreada, soloApuntar = false, onCambioFecha }: Props) {
  const queryClient = useQueryClient();
  const [fecha, setFecha] = useState(() => fechaInicial ?? claveDia(new Date()));
  const anchoParaDos = useDosColumnas();
  // Con `soloApuntar` no hay hoja: una sola columna, la del formulario, a todo el ancho y alto.
  const dosColumnas = anchoParaDos && !soloApuntar;
  // La columna del formulario ocupa el alto disponible (con su propio scroll).
  const apuntarAlto = dosColumnas || soloApuntar;
  useEffect(() => {
    onCambioFecha?.(fecha);
  }, [fecha, onCambioFecha]);
  const [calendarioAbierto, setCalendarioAbierto] = useState(false);
  const [resaltada, setResaltada] = useState<string | null>(null);
  // Cambia tras cada alta: vacía el formulario para la siguiente.
  const [altaFormulario, setAltaFormulario] = useState(0);
  const datosFormulario = useMemo(() => ({ fecha: diaDeClave(fecha) }), [fecha]);

  const irA = (clave: string) => {
    setFecha(clave);
    setResaltada(null);
  };
  // Arrastrar con el dedo en la LISTA de la hoja: a la izquierda, día siguiente.
  const { manejadores: arrastre, desplazamiento } = useArrastrarHoja((delta) => irA(pasarHoja(fecha, delta)));
  const avisarCreada = (creada: { id?: string | null; fecha?: string | null } | null | undefined) => {
    if (creada?.id && creada.fecha) onReservaCreada?.({ id: creada.id, fecha: creada.fecha });
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
      </div>

      {/* Hoja: lo apuntado + el formulario */}
      <div
        className={cn("flex min-h-0 flex-1", dosColumnas ? "flex-row" : "flex-col", PAPEL)}
        data-columnas={dosColumnas ? "2" : "1"}
        data-solo-apuntar={soloApuntar ? "" : undefined}
      >
        <div
          className={cn(
            "min-h-[22dvh] touch-pan-y overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-4 sm:px-6",
            soloApuntar ? "hidden" : dosColumnas ? "w-2/5 shrink-0 border-r" : "flex-1",
          )}
          data-testid="lista-hoja-libro"
          {...arrastre}
        >
          <div
            style={desplazamiento ? { transform: `translateX(${desplazamiento}px)` } : undefined}
            className={cn(!desplazamiento && "transition-transform duration-200")}
          >
          <ReservasDeLaHoja fecha={fecha} resaltada={resaltada} />
          </div>
        </div>
        <div className={cn("flex min-h-0 flex-col", apuntarAlto && "min-w-0 flex-1")} data-testid="columna-apuntar">
        <div
          className={cn(
            "flex flex-wrap items-center gap-3 px-6",
            apuntarAlto ? "border-b py-4" : "border-t pt-3",
          )}
        >
          <span className="inline-flex items-center gap-2 text-base font-semibold text-muted-foreground">
            <ClipboardList className="h-4 w-4" aria-hidden="true" />
            Apuntar nueva
          </span>
        </div>
        <div
            className={cn(
              "overflow-y-auto overscroll-contain bg-background px-6 pt-4 text-foreground",
              // En dos columnas, SIN relleno inferior: el `sticky bottom-0` del pie se pega al borde del relleno del
              // contenedor, y con `pb-6` quedaba una franja de 24 px por debajo del botón por la que asomaban los
              // campos («Dentro | Fuera»). El pie lleva su propio fondo y borde (`.formulario-una-columna`, index.css).
              apuntarAlto ? "formulario-una-columna min-h-0 flex-1 pb-0" : "max-h-[58dvh] pb-6 [&_form>div.sticky:last-child]:-bottom-6", // 11/11/2026: pie pegado al borde real (sin franja por la que asomen los campos)
            )}
          >
            <div className={cn("mx-auto", soloApuntar ? "max-w-3xl" : dosColumnas ? "max-w-2xl" : "max-w-4xl")}>
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
        </div>
      </div>

    </div>
  );
}
