// ============================================================================
// CALENDARIO DEL MES — pestaña Calendario de /reservas
// ----------------------------------------------------------------------------
// Dos piezas: la cuadrícula del mes y, al lado, el REPARTO DEL DÍA por salas
// (`DetalleDiaEspacios`). El encargo del dueño (2026-09-26) era ese panel:
//   "y luego en el calendario que al hacer click un día se vean los espacios
//    bien puestos"
//
// ---------------------------------------------------------------------------
// QUÉ SE VE EN LA CUADRÍCULA (rediseño del 2026-10-01)
// ---------------------------------------------------------------------------
// Cada casilla enseña los COMENSALES del día en grande, un color que es el %
// de ocupación del servicio más lleno (comida o cena) y, discreto, un punto si
// hay reservas sin sala dentro de la ventana de asignación. Toda la lógica
// (umbrales, colores, qué estados cuentan, aforo de Casa Tomás, ventana) vive en
// `src/lib/reservas/ocupacionCalendario.ts`, que es puro y está testeado; la
// casilla es `CasillaOcupacion.tsx` y la leyenda `LeyendaOcupacion.tsx`.
//
// Historia: el calendario anterior coloreaba por «reservas sin sala» (verde /
// ámbar). Desde que el cliente ya no elige sala (reservas-sin-salas: la sala y
// la mesa las pone el personal en una ventana de 48 h) casi todo el futuro salía
// ámbar y el color dejó de decir nada. Antes de eso hubo un «%» que SIEMPRE
// valía 0 (`statsPerDay` lo inicializaba y no lo calculaba nunca) y se quitó.
// Ahora el porcentaje existe de verdad, medido contra el aforo de Casa Tomás.
//
// ---------------------------------------------------------------------------
// DOS CONSULTAS, DOS DUEÑOS (y no se prestan datos)
// ---------------------------------------------------------------------------
// · La CUADRÍCULA lee la tabla `reservas` del mes entero (`reservas_mes`), y el
//   aforo de Casa Tomás de `espacios_reserva` (la caché que ya usa media app: no
//   es una consulta más). Nada de N+1: una consulta por mes.
// · El PANEL DEL DÍA lee la vista `vista_asignacion_dia` por su cuenta, desde
//   `useResumenAsignacionDia`, y de ahí saca también las mesas.
//
// CUIDADO CON LAS 1000 FILAS: PostgREST devuelve como mucho 1000 filas por
// petición (el tope por defecto de Supabase). Con ~1.000 reservas confirmadas
// en un mes, una sola consulta habría dejado sin contar el final del mes sin
// dar error. Por eso `leerReservasDelMes` pide el mes por PÁGINAS de 1000 y
// sigue hasta tener todas (con el recuento exacto que devuelve el servidor, para
// no fiarse del tamaño de la última página).
//
// `"reservas_mes"` es la clave que invalidan las mutaciones de reservas
// (`clavesCache.ts`); un test lee este fichero para comprobar que sigue aquí.
//
// ---------------------------------------------------------------------------
// SOLO CASA TOMÁS (decisión del dueño, 2026-10-01)
// ---------------------------------------------------------------------------
// Touza ya no admite reservas. El calendario mide la ocupación SOLO de Casa
// Tomás, contra su aforo por turno, sin selector de negocio ni mezcla de aforos;
// si en los datos antiguos aparece una reserva de `marca = 'touza'`, se ignora
// con la regla común de todo el panel (`admiteReservas`, en negocios.ts), igual
// que en el panel del día.
//
// ---------------------------------------------------------------------------
// ALTURA FIJA, SIN SCROLL (encargo del dueño, 2026-10-04)
// ---------------------------------------------------------------------------
// «Que esta vista calcule la altura para el tamaño de la pantalla, para que sea
// fija, sin scroll.» Las cuentas y su porqué están en
// `lib/reservas/alturaCalendario.ts`; la medida, en `useAlturaDisponible`.
//   · ≥ lg: el bloque (cabecera del mes + [calendario | panel del día] +
//     leyenda) mide justo lo que queda de ventana desde su posición. La rejilla
//     reparte ese alto entre sus semanas (5 o 6, `minmax(0,1fr)`), la casilla se
//     adapta a su fila (`medirCasilla`) y el panel del día hace scroll interno.
//   · < lg: panel del día debajo; el calendario (cabecera + mes entero) ocupa la
//     altura visible y el resto queda a un scroll de página.
//   · Sin medida (jsdom, sin ResizeObserver) o ventana muy baja (< suelo): el
//     layout de siempre / el suelo, y la página hace scroll.
// ============================================================================

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { eachDayOfInterval, endOfMonth, format, isSameDay, isSameMonth, startOfMonth } from "date-fns";
import { es } from "date-fns/locale";
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { useIsCompactNav } from "@/hooks/use-mobile";
import { useAlturaDisponible, useTamanoElemento } from "@/hooks/useAlturaDisponible";
import {
  ALTURA_LEYENDA_COMPLETA,
  alturaTarjetaCalendario,
  medirCasilla,
  semanasDelMes,
  tamanoCasilla,
} from "@/lib/reservas/alturaCalendario";
import { useConfiguracionReservas } from "@/hooks/useConfiguracionReservas";
import { ReservasEnVivoContexto, useReservasEnVivo } from "@/hooks/useReservasEnVivo";
import { REFRESCO_PERIODICO } from "@/lib/realtimeCanal";
import { aforoCasaTomas, resumirMes, type ReservaCalendario } from "@/lib/reservas/ocupacionCalendario";
import { esSalaPrivada } from "@/lib/reservas/salaPrivada";
import { configAsignacionDesde, fechaMadrid } from "@/lib/reservas/ventanaAsignacion";
import { DetalleDiaEspacios } from "./DetalleDiaEspacios";
import { CasillaOcupacion } from "./CasillaOcupacion";
import { LeyendaOcupacion } from "./LeyendaOcupacion";

// `onDayClick` ya no existe. Estaba declarada y desestructurada, pero NUNCA se
// llamaba ni nadie la pasaba (el único consumidor es `Reservas.tsx`, que pasa
// solo `onEspacioClick`), así que era una promesa falsa: quien la usara no
// recibiría nada. Se ha quitado en vez de cablearla porque nadie la ha pedido.
// El día se selecciona dentro de este componente y el panel de la derecha ya
// enseña todo lo del día.
interface CalendarioOcupacionProps {
  /** Salta al plano de una sala. La pasa `Reservas.tsx`. Sigue siendo opcional. */
  onEspacioClick?: (espacioId: string) => void;
}

/** Filas por petición de PostgREST (el tope por defecto de Supabase). */
const FILAS_POR_PAGINA = 1000;
/** Freno de seguridad: 20.000 reservas en un mes no existen; si llega, algo va mal. */
const PAGINAS_MAXIMAS = 20;

/**
 * Todas las reservas NO canceladas del mes, página a página. Las canceladas
 * nunca cuentan; el resto (incluidas completadas y «No vino») se trae porque
 * los días pasados se enseñan como histórico: el filtro por estado vivo lo hace
 * `resumirMes`, que es lo que se testea.
 *
 * `as any` en la tabla: `marca` no está en los tipos generados para `reservas`.
 * Mismo recurso que `useDisponibilidad.ts`.
 */
async function leerReservasDelMes(inicio: string, fin: string): Promise<ReservaCalendario[]> {
  const filas: ReservaCalendario[] = [];
  let total: number | null = null;

  for (let pagina = 0; pagina < PAGINAS_MAXIMAS; pagina++) {
    const desde = pagina * FILAS_POR_PAGINA;
    const { data, error, count } = await supabase
      .from("reservas" as any)
      .select("id, fecha, hora, numero_comensales, estado, marca, espacio_id", { count: "exact" })
      .gte("fecha", inicio)
      .lte("fecha", fin)
      .neq("estado", "cancelada")
      // `id` desempata: sin un orden total, dos páginas pueden repetir o saltarse filas.
      .order("fecha")
      .order("hora")
      .order("id")
      .range(desde, desde + FILAS_POR_PAGINA - 1);

    if (error) throw error;
    const lote = (data ?? []) as unknown as ReservaCalendario[];
    filas.push(...lote);
    if (typeof count === "number") total = count;

    // Se acaba cuando ya están todas (según el recuento del servidor) o, si el
    // servidor no lo da, cuando una página llega corta. Una página vacía corta
    // siempre: no hay nada más que pedir.
    if (lote.length === 0) break;
    if (total !== null ? filas.length >= total : lote.length < FILAS_POR_PAGINA) break;
  }

  return filas;
}

/**
 * Qué día se selecciona al entrar en un mes: hoy si cae dentro (lo normal al
 * abrir la pestaña), y si no el día 1. Nunca se queda sin selección: el panel
 * del día tiene que traer información desde el primer render, que es justo lo
 * que antes no pasaba (había que pulsar para ver algo).
 */
function diaPorDefectoDelMes(mes: Date): Date {
  const hoy = new Date();
  return isSameMonth(hoy, mes) ? hoy : startOfMonth(mes);
}

/** Lo legible de un error de PostgREST/red, para poder reportarlo sin mirar logs. */
function mensajeDeError(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error.trim();
  if (error instanceof Error) return error.message.trim();
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message).trim();
  }
  return "";
}

/**
 * La consulta del mes ha fallado. Antes un fallo dejaba la cuadrícula VACÍA y
 * sin avisar —«no hay reservas en todo el mes», que es mentira—; ahora se dice
 * y se ofrece reintentar. Mismo lenguaje que el error del panel del día.
 */
function BloqueErrorMes({
  error,
  reintentando,
  onReintentar,
}: {
  error: unknown;
  reintentando: boolean;
  onReintentar: () => void;
}) {
  const detalle = mensajeDeError(error);
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <div className="flex min-w-0 items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">No se han podido leer las reservas de este mes</p>
          <p className="text-xs text-muted-foreground">
            No se enseña ninguna cifra para no dar por buenos unos datos que no se han llegado a leer. Vuelve a
            intentarlo.
          </p>
          {detalle && <p className="break-words text-xs text-muted-foreground/80">{detalle}</p>}
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3 gap-2"
        onClick={onReintentar}
        disabled={reintentando}
      >
        <RefreshCw className={cn("h-3.5 w-3.5", reintentando && "animate-spin")} aria-hidden="true" />
        {reintentando ? "Reintentando…" : "Reintentar"}
      </Button>
    </div>
  );
}

export function CalendarioOcupacion({ onEspacioClick }: CalendarioOcupacionProps) {
  // Nodos medidos (ref de callback + estado: el raíz no existe mientras carga el mes).
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const [rejilla, setRejilla] = useState<HTMLDivElement | null>(null);
  const alturaBloque = useAlturaDisponible(raiz);
  const tamanoRejilla = useTamanoElemento(rejilla);
  // Menú fijo desde 1024 px (= `lg`): calendario y panel van lado a lado.
  const apilado = useIsCompactNav();

  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());

  // El reloj de la pantalla: una vez por minuto, para que «hoy» y la ventana de
  // asignación se muevan solos si la pestaña se queda abierta (p. ej. toda la noche).
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAhora(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  // «Hoy» es el de Madrid, no el del navegador: los días pasados y la ventana de
  // asignación se miden con la hora del restaurante.
  const hoy = fechaMadrid(ahora);

  // Cambios de `reservas` y de mesas hechos en otro dispositivo: refrescan la
  // cuadrícula (`reservas_mes`) y el panel del día (`resumen-asignacion-dia`).
  useReservasEnVivo();

  // Reservas del mes: la consulta de la CUADRÍCULA y de nadie más. El panel del
  // día NO come de aquí: lee `vista_asignacion_dia`. Con el respaldo de cada
  // minuto (solo con la pestaña a la vista) mientras no llegue realtime.
  const {
    data: reservasMes,
    isLoading,
    isError,
    error,
    isFetching,
    refetch,
  } = useQuery({
    ...REFRESCO_PERIODICO,
    queryKey: ["reservas_mes", format(currentMonth, "yyyy-MM")],
    queryFn: () =>
      leerReservasDelMes(
        format(startOfMonth(currentMonth), "yyyy-MM-dd"),
        format(endOfMonth(currentMonth), "yyyy-MM-dd"),
      ),
  });

  // El aforo de Casa Tomás: de sus espacios activos (caché compartida con media
  // app). La ventana de asignación: de la configuración (48 h por defecto
  // mientras carga o si falla).
  const { data: espacios, isLoading: cargandoEspacios, isError: errorEspacios } = useEspaciosReserva();
  const { data: configuracion } = useConfiguracionReservas();
  const { ventanaHoras } = configAsignacionDesde(configuracion);
  const aforo = useMemo(() => aforoCasaTomas(espacios), [espacios]);
  // Las salas privadas (el Reservado) están fuera de aforo: no suman en las cifras, pero la casilla las marca.
  const salasPrivadas = useMemo(
    () =>
      ((espacios ?? []) as Array<{ id?: string; nombre?: string }>)
        .filter((e) => e?.id && esSalaPrivada(e as Parameters<typeof esSalaPrivada>[0]))
        .map((e) => ({ id: e.id as string, nombre: (e.nombre ?? "").trim() || "Sala privada" })),
    [espacios],
  );

  // Cifras y nivel de cada día del mes.
  const resumenes = useMemo(
    () => (reservasMes ? resumirMes(reservasMes, aforo, { hoy, ahora, ventanaHoras, salasPrivadas }) : {}),
    [reservasMes, aforo, hoy, ahora, ventanaHoras, salasPrivadas],
  );

  /**
   * Cambia de mes. Si el día seleccionado se queda fuera del mes nuevo hay que
   * mover la selección: los datos cargados son los del mes visible, así que un
   * día de otro mes pintaría "no hay reservas" siendo mentira.
   */
  // Apilado (por debajo de `lg`) el panel del día queda debajo de la rejilla: tocar un día no
  // cambiaba nada a la vista. Con dedo, si el panel no se ve, se baja hasta él.
  const panelDiaRef = useRef<HTMLDivElement | null>(null);
  const elegirDia = (dia: Date) => {
    setSelectedDate(dia);
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    if (!window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(min-width: 1024px)").matches) return;
    window.requestAnimationFrame(() => {
      const caja = panelDiaRef.current?.getBoundingClientRect();
      if (caja && caja.top > window.innerHeight * 0.6) {
        panelDiaRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      }
    });
  };

  const cambiarMes = (offset: number) => {
    const nuevo = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + offset, 1);
    setCurrentMonth(nuevo);
    setSelectedDate((sel) => (isSameMonth(sel, nuevo) ? sel : diaPorDefectoDelMes(nuevo)));
  };

  const daysInMonth = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });
  const huecosIniciales = (startOfMonth(currentMonth).getDay() + 6) % 7;
  const semanas = semanasDelMes(huecosIniciales, daysInMonth.length);

  // Altura fija: `alturaBloque` es null hasta medir (y siempre en jsdom).
  const tamano = tamanoRejilla ? tamanoCasilla(tamanoRejilla, semanas) : null;
  const { densidad, fuenteComensales } = medirCasilla(tamano ?? { ancho: 100, alto: 80 });

  // Los espacios casi siempre ya están en caché (la página los pide al montarse):
  // solo se espera por ellos si de verdad faltan, para no pintar el mes en gris
  // un instante y que luego salte a color.
  if (isLoading || (cargandoEspacios && !espacios)) {
    return (
      <Card>
        <CardContent className="p-8">
          <div className="flex items-center justify-center">
            <div
              className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
              aria-label="Cargando el calendario"
            />
          </div>
        </CardContent>
      </Card>
    );
  }

  const medida = alturaBloque !== null;

  return (
    <TooltipProvider delayDuration={150}>
      <div
        ref={setRaiz}
        data-testid="calendario-ocupacion"
        data-altura-fija={medida ? String(alturaBloque) : undefined}
        className={cn("flex flex-col", medida ? "gap-3 lg:h-[var(--alto-bloque)]" : "gap-4 sm:gap-6")}
        style={
          medida
            ? ({
                "--alto-bloque": `${alturaBloque}px`,
                "--alto-calendario": `${alturaTarjetaCalendario(alturaBloque)}px`,
              } as CSSProperties)
            : undefined
        }
      >
        {/* Navegación del mes */}
        <Card className={cn(medida && "h-14 shrink-0")}>
          <CardContent className={cn("p-4", medida && "flex h-full items-center px-2 py-0")}>
            <div className="flex w-full items-center justify-between">
              <Button variant="ghost" onClick={() => cambiarMes(-1)} aria-label="Mes anterior">
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              <h3 className="text-xl font-semibold capitalize">
                {format(currentMonth, "MMMM yyyy", { locale: es })}
              </h3>
              <Button variant="ghost" onClick={() => cambiarMes(1)} aria-label="Mes siguiente">
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* `grid-cols-1` explícito: sin él, por debajo de `lg` la columna es
            `auto` y se ensancha hasta lo más ancho que lleve dentro (la tabla de
            cuartos de hora del panel), con lo que la cuadrícula se salía de la
            pantalla en el móvil. Con altura fija, desde `lg` la única fila ocupa
            todo el alto que queda (`minmax(0,1fr)`) y ambas tarjetas lo llenan. */}
        <div
          className={cn(
            "grid grid-cols-1 gap-4 lg:grid-cols-3",
            medida ? "lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)]" : "sm:gap-6",
          )}
        >
          {/* Calendario. Apilado (< lg) con altura fija: cabecera + mes entero a la vista. */}
          <Card
            className={cn(
              "min-w-0 lg:col-span-2",
              medida && "flex min-h-0 flex-col max-lg:h-[var(--alto-calendario)]",
            )}
          >
            <CardContent className={cn("p-2 sm:p-4", medida && "flex min-h-0 flex-1 flex-col p-2 sm:p-3")}>
              {isError ? (
                <BloqueErrorMes
                  error={error}
                  reintentando={isFetching}
                  onReintentar={() => {
                    void refetch();
                  }}
                />
              ) : (
                <>
                  {/* Header días de la semana */}
                  <div className={cn("grid grid-cols-7 gap-0.5 sm:gap-1", medida ? "mb-1 shrink-0" : "mb-1 sm:mb-2")}>
                    {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((day) => (
                      <div
                        key={day}
                        className={cn(
                          "text-center text-xs font-medium text-muted-foreground sm:text-sm",
                          medida ? "py-0.5" : "py-1 sm:py-2",
                        )}
                      >
                        {day}
                      </div>
                    ))}
                  </div>

                  {/* Días del mes. Con altura fija las filas se reparten el alto (5 o 6 semanas). */}
                  <div
                    ref={setRejilla}
                    data-testid="rejilla-mes"
                    className={cn("grid grid-cols-7 gap-1", medida && "min-h-0 flex-1")}
                    style={medida ? { gridTemplateRows: `repeat(${semanas}, minmax(0, 1fr))` } : undefined}
                  >
                    {/* Espacios vacíos para alinear el primer día */}
                    {Array.from({ length: huecosIniciales }).map((_, i) => (
                      <div key={`empty-${i}`} />
                    ))}

                    {daysInMonth.map((day) => {
                      const dateKey = format(day, "yyyy-MM-dd");
                      return (
                        <CasillaOcupacion
                          key={dateKey}
                          dia={day}
                          fechaISO={dateKey}
                          resumen={resumenes[dateKey]}
                          esPasado={dateKey < hoy}
                          esHoy={dateKey === hoy}
                          seleccionada={isSameDay(day, selectedDate)}
                          ventanaHoras={ventanaHoras}
                          onSeleccionar={elegirDia}
                          densidad={medida ? densidad : undefined}
                          fuenteComensales={medida ? fuenteComensales : undefined}
                        />
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Panel del día: el reparto por salas. Desde `lg`, en columna junto al
              calendario: con altura medida llena la fila (el alto lo pone la
              rejilla) y hace scroll INTERNO; sin medir, tope de 620 px. Apilado
              (por debajo de `lg`) crece libre, que es lo que evita que se corte nada. */}
          <Card
            ref={panelDiaRef}
            className={cn("flex min-w-0 flex-col scroll-mt-4", medida ? "lg:min-h-0" : "lg:max-h-[620px]")}
          >
            {/* `relative`: sin él, los hijos `position:absolute` del panel (el `caption sr-only` de
                la rejilla por cuartos) se anclan al documento, escapan del `overflow-hidden` y
                añaden unos píxeles de scroll de página bajo el calendario de altura fija. */}
            <CardContent className="relative flex min-h-0 flex-1 flex-col overflow-hidden p-4">
              {/* La rejilla por cuartos del panel ya la refresca `useReservasEnVivo`:
                  sin un segundo canal a `reservas` (`ReservasEnVivoContexto`). */}
              <ReservasEnVivoContexto.Provider value={true}>
                <DetalleDiaEspacios fecha={selectedDate} onEspacioClick={onEspacioClick} />
              </ReservasEnVivoContexto.Provider>
            </CardContent>
          </Card>
        </div>

        <LeyendaOcupacion
          ventanaHoras={ventanaHoras}
          aforo={aforo}
          aforoNoDisponible={errorEspacios}
          compacta={medida && !apilado && alturaBloque < ALTURA_LEYENDA_COMPLETA}
        />
      </div>
    </TooltipProvider>
  );
}
