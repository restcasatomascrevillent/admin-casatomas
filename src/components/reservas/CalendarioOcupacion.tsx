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
// ============================================================================

import { useEffect, useMemo, useState } from "react";
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
import { useConfiguracionReservas } from "@/hooks/useConfiguracionReservas";
import { aforoCasaTomas, resumirMes, type ReservaCalendario } from "@/lib/reservas/ocupacionCalendario";
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

  // Reservas del mes: la consulta de la CUADRÍCULA y de nadie más. El panel del
  // día NO come de aquí: lee `vista_asignacion_dia`.
  const {
    data: reservasMes,
    isLoading,
    isError,
    error,
    isFetching,
    refetch,
  } = useQuery({
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

  // Cifras y nivel de cada día del mes.
  const resumenes = useMemo(
    () => (reservasMes ? resumirMes(reservasMes, aforo, { hoy, ahora, ventanaHoras }) : {}),
    [reservasMes, aforo, hoy, ahora, ventanaHoras],
  );

  /**
   * Cambia de mes. Si el día seleccionado se queda fuera del mes nuevo hay que
   * mover la selección: los datos cargados son los del mes visible, así que un
   * día de otro mes pintaría "no hay reservas" siendo mentira.
   */
  const cambiarMes = (offset: number) => {
    const nuevo = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + offset, 1);
    setCurrentMonth(nuevo);
    setSelectedDate((sel) => (isSameMonth(sel, nuevo) ? sel : diaPorDefectoDelMes(nuevo)));
  };

  const daysInMonth = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });

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

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-4 sm:space-y-6">
        {/* Navegación del mes */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
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
            pantalla en el móvil. */}
        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3">
          {/* Calendario */}
          <Card className="min-w-0 lg:col-span-2">
            <CardContent className="p-2 sm:p-4">
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
                  <div className="mb-1 grid grid-cols-7 gap-0.5 sm:mb-2 sm:gap-1">
                    {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((day) => (
                      <div
                        key={day}
                        className="py-1 text-center text-xs font-medium text-muted-foreground sm:py-2 sm:text-sm"
                      >
                        {day}
                      </div>
                    ))}
                  </div>

                  {/* Días del mes */}
                  <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
                    {/* Espacios vacíos para alinear el primer día */}
                    {Array.from({ length: (startOfMonth(currentMonth).getDay() + 6) % 7 }).map((_, i) => (
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
                          onSeleccionar={setSelectedDate}
                        />
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Panel del día: el reparto por salas. Con tope de alto solo a partir de
              `lg`, donde va en columna junto al calendario; apilado (por debajo de
              `lg`) crece libre, que es lo que evita que se corte nada. */}
          <Card className="flex min-w-0 flex-col lg:max-h-[620px]">
            <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
              <DetalleDiaEspacios fecha={selectedDate} onEspacioClick={onEspacioClick} />
            </CardContent>
          </Card>
        </div>

        <LeyendaOcupacion ventanaHoras={ventanaHoras} aforo={aforo} aforoNoDisponible={errorEspacios} />
      </div>
    </TooltipProvider>
  );
}
