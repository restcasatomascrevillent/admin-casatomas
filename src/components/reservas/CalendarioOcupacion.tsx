// ============================================================================
// CALENDARIO DEL MES — pestaña Calendario de /reservas
// ----------------------------------------------------------------------------
// Dos piezas: la cuadrícula del mes y, al lado, el REPARTO DEL DÍA por salas
// (`DetalleDiaEspacios`). El encargo del dueño (2026-09-26) era ese panel:
//   "y luego en el calendario que al hacer click un día se vean los espacios
//    bien puestos"
//
// ---------------------------------------------------------------------------
// QUÉ MIDE LA CUADRÍCULA (y por qué ya no hay porcentaje de aforo)
// ---------------------------------------------------------------------------
// Cada casilla enseña reservas, comensales y cuántas siguen SIN SALA, y se
// colorea por eso último: ámbar si queda reparto pendiente, verde si ya está
// todo repartido por sala. Es el GRADO 1 del cierre, el que se puede saber del
// mes entero con la única consulta que ya se hacía.
//
// Antes había un "%" en cada casilla que SIEMPRE valía 0: `statsPerDay`
// inicializaba `porcentaje: 0` y no lo calculaba nunca. Como
// `getOccupancyColor(0)` devolvía "", los colores y la leyenda "Baja / Media /
// Alta" no funcionaron nunca tampoco. Se ha quitado, no arreglado, y a
// propósito:
//
//   · El aforo es POR MARCA (`casa_tomas` / `touza`), y este calendario mezcla
//     los dos negocios a propósito (decisión del dueño 2026-09-24). Un único
//     porcentaje sumando las dos capacidades no significa nada: un día con
//     Casa Tomás lleno y Touza vacío daría "50 %", que no describe ninguno de
//     los dos servicios.
//   · El porcentaje que sí significa algo -`porcentajeCerrado`, cuánto del día
//     está cerrado a nivel de mesa- necesita las asignaciones de mesa de todo
//     el mes, y eso no cabe en esta consulta. Se enseña DÍA A DÍA en el panel
//     de la derecha, que es donde se trabaja.
//
// Y ojo con el color: NUNCA en rojo. "Pendiente de repartir" es el estado
// normal de un día que aún está lejos, no una alarma.
//
// ---------------------------------------------------------------------------
// DOS CONSULTAS, DOS DUEÑOS (y ya no se prestan datos)
// ---------------------------------------------------------------------------
// · La CUADRÍCULA lee la tabla `reservas` del mes entero (`reservas_mes`), que
//   es lo único que cabe en una consulta: cuenta reservas, comensales y las que
//   siguen sin sala de cada día.
// · El PANEL DEL DÍA lee la vista `vista_asignacion_dia` por su cuenta, desde
//   `useResumenAsignacionDia`, y de ahí saca también las mesas.
//
// Hasta el 2026-09-26 este componente le pasaba además las reservas del día
// seleccionado como RESPALDO, porque la vista aún no estaba aplicada. Ya lo
// está (migración `20260926140000_asignaciones_mesa_sin_solapes.sql`), así que
// el respaldo se ha quitado: solo servía para tapar la vista y, de paso, hacía
// que una reserva con sala y sin mesa saliera como "no disponible" en vez de
// como trabajo pendiente. `reservas_mes` se queda porque la cuadrícula la
// necesita, no porque el panel dependa de ella.
//
// ---------------------------------------------------------------------------
// TODOS LOS NEGOCIOS JUNTOS
// ---------------------------------------------------------------------------
// Casa Tomás + Touza · El Reservado (decisión del dueño 2026-09-24): la
// cuadrícula solo cuenta reservas y comensales por día, y cada sala del panel
// lleva su insignia de negocio. Quien calcule aforo debe hacerlo por negocio
// (trigger `validar_capacidad_reserva`).
// ============================================================================

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import {
  eachDayOfInterval,
  endOfMonth,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
} from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Users, Calendar as CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { DetalleDiaEspacios } from "./DetalleDiaEspacios";

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

/** Recuento de un día para la cuadrícula. */
type StatsDia = {
  total: number;
  comensales: number;
  /** Grado 1 pendiente: reservas que todavía no tienen sala. */
  sinSala: number;
};

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

export function CalendarioOcupacion({ onEspacioClick }: CalendarioOcupacionProps) {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());

  // Reservas del mes: la consulta de la CUADRÍCULA y de nadie más. Trae
  // `espacio_id` porque de ahí sale el grado 1 (con sala / sin sala) de cada
  // casilla. El panel del día NO come de aquí: lee `vista_asignacion_dia`.
  //
  // `as any` + cast final: `marca` no está en los tipos generados para
  // `reservas`. Mismo recurso que `useDisponibilidad.ts`.
  const { data: reservasMes, isLoading } = useQuery({
    queryKey: ["reservas_mes", format(currentMonth, "yyyy-MM")],
    queryFn: async () => {
      const inicio = format(startOfMonth(currentMonth), "yyyy-MM-dd");
      const fin = format(endOfMonth(currentMonth), "yyyy-MM-dd");

      const { data, error } = await supabase
        .from("reservas" as any)
        .select(`
          id,
          fecha,
          hora,
          numero_comensales,
          estado,
          nombre,
          marca,
          espacio_id
        `)
        .gte("fecha", inicio)
        .lte("fecha", fin)
        .neq("estado", "cancelada")
        .order("fecha")
        .order("hora");

      if (error) throw error;
      return data as any[];
    },
  });

  // Recuento por día.
  const statsPerDay = useMemo(() => {
    const stats: Record<string, StatsDia> = {};
    if (!reservasMes) return stats;

    reservasMes.forEach((r: any) => {
      const key = r.fecha;
      if (!stats[key]) stats[key] = { total: 0, comensales: 0, sinSala: 0 };
      stats[key].total++;
      stats[key].comensales += Number(r.numero_comensales) || 0;
      if (!r.espacio_id || !String(r.espacio_id).trim()) stats[key].sinSala++;
    });

    return stats;
  }, [reservasMes]);

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

  /**
   * Color de la casilla según el REPARTO POR SALA. Nada de rojo: que queden
   * reservas sin sala es lo normal en un día que aún está lejos, no un fallo.
   */
  const colorDeReparto = (stats: StatsDia | undefined) => {
    if (!stats || stats.total === 0) return "";
    if (stats.sinSala > 0)
      return "bg-amber-500/15 text-amber-900 border-amber-500/40 dark:text-amber-200";
    return "bg-green-500/15 text-green-800 border-green-500/40 dark:text-green-300";
  };

  const daysInMonth = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });

  if (isLoading) {
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
    <div className="space-y-6">
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

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
        {/* Calendario */}
        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            {/* Header días de la semana */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((day) => (
                <div
                  key={day}
                  className="text-center text-sm font-medium text-muted-foreground py-2"
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Días del mes */}
            <div className="grid grid-cols-7 gap-1">
              {/* Espacios vacíos para alinear el primer día */}
              {Array.from({ length: (startOfMonth(currentMonth).getDay() + 6) % 7 }).map((_, i) => (
                <div key={`empty-${i}`} className="aspect-square" />
              ))}

              {daysInMonth.map((day) => {
                const dateKey = format(day, "yyyy-MM-dd");
                const dayStats = statsPerDay[dateKey];
                const isSelected = isSameDay(day, selectedDate);
                const isToday = isSameDay(day, new Date());

                return (
                  <button
                    key={dateKey}
                    onClick={() => setSelectedDate(day)}
                    aria-pressed={isSelected}
                    aria-label={
                      dayStats
                        ? `${format(day, "d 'de' MMMM", { locale: es })}: ${dayStats.total} reservas, ${dayStats.comensales} comensales${dayStats.sinSala > 0 ? `, ${dayStats.sinSala} sin sala` : ", todas con sala"}`
                        : `${format(day, "d 'de' MMMM", { locale: es })}: sin reservas`
                    }
                    className={cn(
                      "aspect-square p-1 rounded-lg border transition-all hover:shadow-md",
                      "flex flex-col items-center justify-start gap-0.5 overflow-hidden",
                      isSelected
                        ? "ring-2 ring-primary border-primary"
                        : "border-border hover:border-primary/50",
                      isToday && "bg-accent/50",
                      colorDeReparto(dayStats),
                    )}
                  >
                    <span
                      className={cn(
                        "text-sm font-medium tabular-nums",
                        isToday &&
                          "bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center",
                      )}
                    >
                      {format(day, "d")}
                    </span>

                    {dayStats && (
                      <>
                        <div
                          className="text-[10px] flex items-center gap-0.5 tabular-nums"
                          aria-hidden="true"
                        >
                          <CalendarIcon className="h-2.5 w-2.5" />
                          {dayStats.total}
                          <Users className="h-2.5 w-2.5 ml-1" />
                          {dayStats.comensales}
                        </div>
                        {/* Solo se escribe lo que hay: si todo está repartido,
                            la casilla ya lo dice con el color verde y no hace
                            falta gastar una línea en "0 sin sala".

                            `hidden sm:block`: por debajo de `sm` la casilla no
                            da para tres líneas y el texto saldría cortado. Ahí
                            la información no se pierde: el color ámbar sigue
                            estando y el `aria-label` del botón la dice entera. */}
                        {dayStats.sinSala > 0 && (
                          <div
                            className="hidden text-[10px] font-medium leading-none tabular-nums sm:block"
                            aria-hidden="true"
                          >
                            {dayStats.sinSala} sin sala
                          </div>
                        )}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Panel del día: el reparto por salas. Con tope de alto solo a partir de
            `lg`, donde va en columna junto al calendario; apilado (por debajo de
            `lg`) crece libre, que es lo que evita que se corte nada. */}
        <Card className="flex flex-col lg:max-h-[620px]">
          <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
            <DetalleDiaEspacios fecha={selectedDate} onEspacioClick={onEspacioClick} />
          </CardContent>
        </Card>
      </div>

      {/* Leyenda. Describe lo que la cuadrícula pinta DE VERDAD (reparto por
          sala). La anterior hablaba de "Baja / Media / Alta ocupación", que
          nunca llegó a funcionar porque el porcentaje siempre era 0. */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded border border-green-500/40 bg-green-500/15" />
              <span>Todas las reservas tienen sala</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded border border-amber-500/40 bg-amber-500/15" />
              <span>Quedan reservas por repartir por sala</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded border border-border" />
              <span>Sin reservas</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
