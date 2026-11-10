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
//   (El candado del Reservado se quitó el 2026-10-15: el Reservado solo se ve en
//   la pestaña Hoy. Sigue fuera de aforo: no suma comensales, reservas ni %.)
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
//   · compacta: número arriba, comensales debajo (una cifra por línea: en una casilla de ~46 px el número del día y una cifra de 3 dígitos no caben juntos, P-01) y la barra fina.
// La casilla llena su celda (`h-full`, sin alto mínimo) y recorta lo que no
// quepa (`overflow-hidden`): por eso nunca desborda. Sin `densidad` (jsdom,
// navegador sin ResizeObserver) conserva el comportamiento responsive de antes.
// ============================================================================

import { format } from "date-fns";
import { es } from "date-fns/locale";
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
  /**
   * Servicios sin reservas web/teléfono con el local ABIERTO (jueves de tapas, dueño 2026-11-10:
   * «Abierto, sin reservas web»). No se pinta «Cerrado» ni rayado: solo «Sin reservas web», discreto.
   */
  sinReservaWeb?: readonly ServicioCerrado[];
  /**
   * «Evento: sala entera» (20261119100000): un texto por evento del día, p. ej.
   * «Evento: Boda García (Salón, comida)». La casilla enseña el primero.
   */
  eventos?: readonly string[];
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
  sinReservaWeb,
  eventos,
}: CasillaOcupacionProps) {
  const cierraComida = !!cierres?.some((c) => c.turno === "comida");
  const cierraCena = !!cierres?.some((c) => c.turno === "cena");
  const textoCierre =
    cierraComida && cierraCena ? "Cerrado" : cierraComida ? "Sin comida" : cierraCena ? "Sin cena" : null;
  // Si además hay un cierre de verdad, manda el cierre (es lo que importa en la casilla).
  const textoSinWeb = !textoCierre && sinReservaWeb && sinReservaWeb.length > 0 ? "Sin reservas web" : null;
  const textoEtiqueta = textoCierre ?? textoSinWeb;
  const fija = densidad !== undefined;
  const compacta = densidad === "compacta";
  // Con etiqueta de cierre (o de evento) la casilla de alto fijo tiene una línea más: la cifra cede
  // ese alto y «N res.» se calla (sigue en el tooltip y el aria-label) para que nada se monte ni se
  // corte por abajo (el tamaño de `medirCasilla` no cuenta con ella).
  const lineasExtra = (textoEtiqueta ? 1 : 0) + (eventos && eventos.length > 0 && !compacta ? 1 : 0);
  const verReservas = fija && densidad === "completa" && lineasExtra === 0;
  const verPorcentaje = fija && densidad !== "compacta";
  const nivel = resumen?.nivel ?? "vacio";
  // Un día pasado se ve atenuado, tenga o no reservas.
  const estilo = estiloNivel(esPasado ? "pasado" : nivel);
  const descripcion = describirDia(resumen, ventanaHoras);
  const etiqueta = `${format(dia, "d 'de' MMMM", { locale: es })}: ${descripcion.aria}${
    textoCierre
      ? `. ${textoCierre} para reservas`
      : textoSinWeb
        ? ". Abierto, sin reservas por la web ni por teléfono"
        : ""
  }${eventos && eventos.length > 0 ? `. ${eventos.join(". ")}` : ""}`;

  const conReservas = !!resumen && resumen.reservas > 0;
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

  // El punto de «sin sala»: mismo en todas las densidades.
  const indicadores = (
    <>
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
  // Una cifra de 2-3 dígitos nunca puede ser más ancha que la casilla: el tamaño en px es el techo y `cqw` lo recorta por nº de dígitos (P-01).
  const digitos = String(resumen?.comensales ?? 0).length;
  const fuenteCifra = fuenteComensales ? Math.max(20, fuenteComensales - lineasExtra * (compacta ? 6 : 8)) : 0;
  const cifra = conReservas ? (
    <span
      data-testid="comensales-casilla"
      data-fuente={fija && fuenteComensales ? fuenteCifra : undefined}
      aria-hidden="true"
      className={cn(
        "font-bold leading-none",
        "text-center",
        !fija && "[font-size:clamp(1.25rem,32cqw,2.25rem)]",
      )}
      style={fija && fuenteComensales ? { fontSize: `min(${fuenteCifra}px, calc(100cqw / ${(digitos * 0.62 + 0.3).toFixed(2)}))` } : undefined}
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
      data-cierre={
        textoCierre ? (cierraComida && cierraCena ? "dia" : cierraComida ? "comida" : "cena") : textoSinWeb ? "sin-web" : undefined
      }
      className={cn(
        "relative flex w-full cursor-pointer flex-col overflow-hidden rounded-lg border text-left",
        "transition-shadow hover:shadow-md motion-reduce:transition-none",
        fija
          ? cn("h-full min-h-0", compacta ? "gap-0.5 p-1.5" : "gap-1 p-2")
          : "min-h-[4.5rem] gap-1 p-1.5 sm:min-h-[6rem] sm:p-2",
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
      {/* Número del día y, si toca, el punto de «sin sala». La cifra de comensales va siempre en su propia línea. */}
      <span className="flex items-start justify-between gap-1">
        <span className="flex min-w-0 items-start gap-0.5">
          <span
            className={cn(
              "flex items-center justify-center rounded-full px-1 font-medium leading-none tabular-nums",
              !fija && "h-6 min-w-6 text-base sm:h-7 sm:min-w-7 sm:text-lg",
              fija && (densidad === "completa" ? "h-7 min-w-7 text-lg" : "h-6 min-w-6 text-lg"),
              esHoy && cn(estilo.hoy, "font-semibold"),
            )}
          >
            {format(dia, "d")}
          </span>
          {compacta && conReservas && resumen.sinSalaEnVentana > 0 && indicadores}
        </span>
        {!compacta && <span className="flex shrink-0 items-center gap-0.5">{indicadores}</span>}
      </span>

      {/* La etiqueta de cierre no se recorta nunca (dueño, 2026-11-10: «la palabra cerrado se ve
          cortada»): `shrink-0` para que la columna flex no la aplaste contra la cifra en una casilla
          de alto fijo, sin `truncate` (si un día no cabe en una línea, parte en dos) y también en la
          densidad compacta, donde antes los días de medio servicio la escondían. */}
      {textoEtiqueta && (
        <span
          data-testid="cierre-casilla"
          className={cn(
            "block shrink-0 break-words text-sm leading-tight",
            textoCierre ? "font-semibold uppercase" : "font-medium",
            cierraComida && cierraCena ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {textoCierre ?? (
            // «Sin reservas web» parte en dos líneas en una casilla estrecha (iPad vertical) y empuja
            // el % fuera: ahí basta «Sin web» (el aria-label lo dice entero). La casilla es contenedor.
            <>
              <span className="[@container(min-width:7.5rem)]:hidden">Sin web</span>
              <span className="hidden [@container(min-width:7.5rem)]:inline">{textoSinWeb}</span>
            </>
          )}
        </span>
      )}
      {eventos && eventos.length > 0 && (
        <span
          data-testid="evento-casilla"
          aria-hidden="true"
          className={cn(
            "shrink-0 truncate rounded bg-violet-100 px-1 text-sm font-semibold leading-tight text-violet-900 dark:bg-violet-900/40 dark:text-violet-100",
            compacta && "hidden",
          )}
        >
          {eventos.length > 1 ? `${eventos.length} eventos` : "Evento"}
        </span>
      )}
      {conReservas && (
        <>
          {cifra}
          {(verReservas || !fija) && (
            <span
              data-testid="reservas-casilla"
              aria-hidden="true"
              className={cn("text-center text-sm font-medium leading-none", !fija && "hidden sm:block")}
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
                  className={cn("text-center text-sm font-semibold leading-none", !fija && "hidden sm:block")}
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
  if (!conReservas) return boton;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{boton}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-[20rem] space-y-0.5 text-sm">
        <p className="font-semibold">{conMayuscula(format(dia, "EEEE, d 'de' MMMM", { locale: es }))}</p>
        {descripcion.lineas.map((linea, i) => (
          <p key={i}>{linea}</p>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}
