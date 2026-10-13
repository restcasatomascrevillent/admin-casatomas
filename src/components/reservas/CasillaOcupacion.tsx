// ============================================================================
// CASILLA DE UN DÍA DE LA CUADRÍCULA DEL MES
// ----------------------------------------------------------------------------
// Qué se ve en cada casilla (de más a menos importante):
//   1. LOS COMENSALES del día, en GRANDE. Es lo que el dueño quiere leer de un
//      vistazo (petición del 2026-10-01).
//   2. El COLOR de fondo: el % de ocupación del turno más lleno del día (comida
//      o cena) sobre el aforo de Casa Tomás. Escala y umbrales en
//      `src/lib/reservas/ocupacionCalendario.ts`.
//   3. Dos barras finas, comida (izquierda) y cena (derecha), cada una con su %
//      sobre el aforo, y debajo el % del turno más lleno (o «Completo»). Así el
//      color nunca va solo.
//   4. El nº de reservas, pequeño.
//   5. Un punto discreto si hay reservas SIN SALA dentro de la ventana de
//      asignación (48 h por defecto). Fuera de la ventana no hay nada que decir.
//   6. Un candado si el Reservado (sala privada) está ocupado ese día en la comida
//      o en la cena. Está FUERA DE AFORO (2026-10-03): no suma comensales, reservas
//      ni %, pero el personal tiene que ver que está. El detalle (qué turno) va en
//      el tooltip y en el `aria-label`.
//
// Los días PASADOS van atenuados y sin escala ni barras (histórico: lo que se
// reservó, sin canceladas). Hoy y el futuro cuentan solo las reservas vivas.
//
// En pantallas estrechas (móvil: ~46 px por casilla) se quedan el número del
// día, los comensales y las barras; el nº de reservas y el % escrito aparecen
// desde `sm`. Todo está también en el `aria-label` y en el tooltip.
//
// ALTURA FIJA (2026-10-04): cuando el calendario reparte la altura de la
// pantalla entre las filas del mes, pasa a la casilla su `densidad` (ver
// `medirCasilla` en `lib/reservas/alturaCalendario.ts`) y el tamaño de la cifra:
//   · completa: todo lo de arriba.
//   · media:    sin «N res.».
//   · compacta: una línea (número · indicadores · comensales) y la barra fina.
// La casilla llena su celda (`h-full`, sin alto mínimo) y recorta lo que no
// quepa (`overflow-hidden`): por eso nunca desborda. Sin `densidad` (jsdom,
// navegador sin ResizeObserver) conserva el comportamiento responsive de antes.
// ============================================================================

import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Lock } from "lucide-react";
import type { ServicioCerrado } from "../../../supabase/functions/_shared/cierres";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  CLASES_PUNTO_SIN_SALA,
  describirDia,
  estiloNivel,
  type ResumenDiaCalendario,
} from "@/lib/reservas/ocupacionCalendario";
import type { DensidadCasilla } from "@/lib/reservas/alturaCalendario";

export interface CasillaOcupacionProps {
  dia: Date;
  /** `YYYY-MM-DD` del día de la casilla. */
  fechaISO: string;
  /** `undefined` = nada que contar ese día. */
  resumen: ResumenDiaCalendario | undefined;
  esPasado: boolean;
  esHoy: boolean;
  seleccionada: boolean;
  /** Ventana de asignación, para decir «en las próximas N h». */
  ventanaHoras: number;
  onSeleccionar: (dia: Date) => void;
  /** Altura fija: qué enseña la casilla según el alto de su fila. Sin ella, layout responsive de siempre. */
  densidad?: DensidadCasilla;
  /** Tamaño (px) de la cifra de comensales cuando hay `densidad`. */
  fuenteComensales?: number;
  /** Servicios sin reservas web/teléfono ese día (cierre semanal o manual). */
  cierres?: readonly ServicioCerrado[];
}

/** «jueves, 15 de octubre» → «Jueves, 15 de octubre» (solo la primera letra: `capitalize` pondría «De»). */
const conMayuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);

/** Una barra fina: relleno y pista salen del color del texto de la casilla. */
function Barra({ porcentaje }: { porcentaje: number | null }) {
  const ancho = porcentaje === null ? 0 : Math.max(0, Math.min(100, porcentaje));
  return (
    <span className="relative block h-1 min-w-0 flex-1 overflow-hidden rounded-full">
      <span className="absolute inset-0 bg-current opacity-20" />
      <span className="absolute inset-y-0 left-0 rounded-full bg-current" style={{ width: `${ancho}%` }} />
    </span>
  );
}

export function CasillaOcupacion({
  dia,
  fechaISO,
  resumen,
  esPasado,
  esHoy,
  seleccionada,
  ventanaHoras,
  onSeleccionar,
  densidad,
  fuenteComensales,
  cierres,
}: CasillaOcupacionProps) {
  const cierraComida = !!cierres?.some((c) => c.turno === "comida");
  const cierraCena = !!cierres?.some((c) => c.turno === "cena");
  const textoCierre =
    cierraComida && cierraCena ? "Cerrado" : cierraComida ? "Sin comida" : cierraCena ? "Sin cena" : null;
  const fija = densidad !== undefined;
  const compacta = densidad === "compacta";
  const verReservas = fija && densidad === "completa";
  const verPorcentaje = fija && densidad !== "compacta";
  const nivel = resumen?.nivel ?? "vacio";
  // Un día pasado se ve atenuado, tenga o no reservas.
  const estilo = estiloNivel(esPasado ? "pasado" : nivel);
  const descripcion = describirDia(resumen, ventanaHoras);
  const etiqueta = `${format(dia, "d 'de' MMMM", { locale: es })}: ${descripcion.aria}${
    textoCierre ? `. ${textoCierre} para reservas` : ""
  }`;

  const conReservas = !!resumen && resumen.reservas > 0;
  // El Reservado ocupado (fuera de aforo): indicador aparte, aunque no haya más reservas.
  const hayPrivada = !!resumen && resumen.salasPrivadas.length > 0;
  const hayBarras =
    conReservas &&
    !resumen.esPasado &&
    (resumen.turnos.comida.porcentaje !== null || resumen.turnos.cena.porcentaje !== null);
  const textoPorcentaje =
    hayBarras && resumen.masLleno
      ? resumen.masLleno.nivel === "completo"
        ? "Completo"
        : `${resumen.masLleno.porcentaje}%`
      : null;

  // El Reservado ocupado (candado) y el punto de «sin sala»: mismos en todas las densidades.
  const indicadores = (
    <>
      {hayPrivada && (
        <Lock
          aria-hidden="true"
          data-testid="indicador-sala-privada"
          className="mt-0.5 h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5"
        />
      )}
      {conReservas && resumen.sinSalaEnVentana > 0 && (
        <span
          aria-hidden="true"
          data-testid="punto-sin-sala"
          className={cn("mr-0.5 mt-0.5 h-2.5 w-2.5 shrink-0 sm:h-3 sm:w-3", CLASES_PUNTO_SIN_SALA)}
        />
      )}
    </>
  );

  // La cifra protagonista. Sin `tabular-nums`: en un número grande suelto las
  // cifras de ancho fijo lo abren (121 se ve suelto). Con altura fija su tamaño
  // sale de la casilla medida (px); sin ella, del ancho (`cqw`).
  const cifra = conReservas ? (
    <span
      data-testid="comensales-casilla"
      aria-hidden="true"
      className={cn(
        "font-bold leading-none",
        compacta ? "shrink-0" : "text-center",
        !fija && "[font-size:clamp(1.125rem,30cqw,2rem)]",
      )}
      style={fija && fuenteComensales ? { fontSize: `${fuenteComensales}px` } : undefined}
    >
      {resumen.comensales}
    </span>
  ) : null;

  const boton = (
    <button
      type="button"
      onClick={() => onSeleccionar(dia)}
      aria-pressed={seleccionada}
      aria-label={etiqueta}
      data-fecha={fechaISO}
      data-densidad={densidad}
      data-nivel={esPasado && conReservas ? "pasado" : nivel}
      data-cierre={textoCierre ? (cierraComida && cierraCena ? "dia" : cierraComida ? "comida" : "cena") : undefined}
      className={cn(
        "relative flex w-full cursor-pointer flex-col overflow-hidden rounded-lg border text-left",
        "transition-shadow hover:shadow-md motion-reduce:transition-none",
        fija
          ? cn("h-full min-h-0", compacta ? "gap-0.5 p-1" : "gap-1 p-1.5")
          : "min-h-[3.75rem] gap-0.5 p-1 sm:min-h-[4.75rem] sm:gap-1 sm:p-1.5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        // Cada casilla mide su propio ancho: el número grande se escala con él (cqw).
        "[container-type:inline-size]",
        estilo.celda,
        // Día cerrado entero para reservas: rayado diagonal, se distingue sin color.
        cierraComida &&
          cierraCena &&
          "bg-[repeating-linear-gradient(135deg,transparent_0_6px,hsl(var(--muted-foreground)/0.12)_6px_8px)]",
        seleccionada && "z-10 ring-2 ring-primary ring-offset-1",
      )}
    >
      {/* Número del día y, si toca, el punto de «sin sala». En la casilla compacta
          la cifra de comensales comparte esta misma línea. */}
      <span className={cn("flex gap-1", compacta ? "min-w-0 items-center justify-between" : "items-start justify-between")}>
        <span className="flex min-w-0 items-start gap-0.5">
          <span
            className={cn(
              "flex items-center justify-center rounded-full px-1 font-medium leading-none tabular-nums",
              !fija && "h-5 min-w-5 text-[11px] sm:h-6 sm:min-w-6 sm:text-sm",
              fija && (compacta ? "h-5 min-w-5 text-xs" : "h-6 min-w-6 text-sm"),
              esHoy && cn(estilo.hoy, "font-semibold"),
            )}
          >
            {format(dia, "d")}
          </span>
          {compacta && (hayPrivada || (conReservas && resumen.sinSalaEnVentana > 0)) && indicadores}
        </span>
        {compacta ? (
          conReservas && cifra
        ) : (
          <span className="flex shrink-0 items-center gap-0.5">{indicadores}</span>
        )}
      </span>

      {textoCierre && (
        <span
          data-testid="cierre-casilla"
          className={cn(
            "truncate text-[10px] font-semibold uppercase leading-none tracking-wide",
            cierraComida && cierraCena ? "text-destructive" : "text-muted-foreground",
            compacta && !(cierraComida && cierraCena) && "hidden",
          )}
        >
          {textoCierre}
        </span>
      )}
      {conReservas && (
        <>
          {!compacta && cifra}
          {(verReservas || !fija) && (
            <span
              data-testid="reservas-casilla"
              aria-hidden="true"
              className={cn("text-center text-[10px] leading-none opacity-80", !fija && "hidden sm:block")}
            >
              {resumen.reservas} res.
            </span>
          )}

          {hayBarras && (
            <span aria-hidden="true" className={cn("mt-auto flex w-full flex-col", compacta ? "gap-0" : "gap-0.5 sm:gap-1")}>
              <span className="flex w-full gap-[2px]" data-testid="barras-casilla">
                <Barra porcentaje={resumen.turnos.comida.porcentaje} />
                <Barra porcentaje={resumen.turnos.cena.porcentaje} />
              </span>
              {textoPorcentaje && (!fija || verPorcentaje) && (
                <span
                  data-testid="porcentaje-casilla"
                  className={cn("text-center text-[10px] font-semibold leading-none", !fija && "hidden sm:block")}
                >
                  {textoPorcentaje}
                </span>
              )}
            </span>
          )}
        </>
      )}
    </button>
  );

  // Sin nada que contar no hay tooltip: no diría más que la propia casilla.
  if (!conReservas && !hayPrivada) return boton;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{boton}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-[18rem] space-y-0.5 text-xs">
        <p className="font-semibold">{conMayuscula(format(dia, "EEEE, d 'de' MMMM", { locale: es }))}</p>
        {descripcion.lineas.map((linea, i) => (
          <p key={i}>{linea}</p>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}
