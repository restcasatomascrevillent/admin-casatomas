import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Users, Calendar as CalendarIcon, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";

interface CalendarioOcupacionProps {
  onDayClick?: (date: Date, reservas: any[]) => void;
  onEspacioClick?: (espacioId: string) => void;
}

export function CalendarioOcupacion({ onDayClick, onEspacioClick }: CalendarioOcupacionProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  
  const { data: espacios } = useEspaciosReserva();

  // Obtener reservas del mes
  const { data: reservasMes, isLoading } = useQuery({
    queryKey: ["reservas_mes", format(currentMonth, "yyyy-MM")],
    queryFn: async () => {
      const inicio = format(startOfMonth(currentMonth), "yyyy-MM-dd");
      const fin = format(endOfMonth(currentMonth), "yyyy-MM-dd");

      const { data, error } = await supabase
        .from("reservas")
        .select(`
          id,
          fecha,
          hora,
          numero_comensales,
          estado,
          nombre,
          sala_id,
          espacios_reserva!reservas_sala_id_fkey (id, nombre, capacidad_maxima)
        `)
        .gte("fecha", inicio)
        .lte("fecha", fin)
        .neq("estado", "cancelada")
        .order("fecha")
        .order("hora");

      if (error) throw error;
      return data;
    },
  });

  // Calcular estadísticas por día
  const statsPerDay = useMemo(() => {
    if (!reservasMes || !espacios) return {};

    const stats: Record<string, { 
      total: number; 
      comensales: number; 
      capacidad: number;
      porcentaje: number;
      reservas: any[];
    }> = {};

    const capacidadTotal = espacios.reduce((acc, e) => acc + (e.capacidad_maxima || 0), 0);

    reservasMes.forEach((r) => {
      const key = r.fecha;
      if (!stats[key]) {
        stats[key] = { 
          total: 0, 
          comensales: 0, 
          capacidad: capacidadTotal,
          porcentaje: 0,
          reservas: []
        };
      }
      stats[key].total++;
      stats[key].comensales += r.numero_comensales;
      stats[key].reservas.push(r);
    });

    // Calcular porcentajes
    Object.keys(stats).forEach((key) => {
      stats[key].porcentaje = stats[key].capacidad > 0
        ? Math.round((stats[key].comensales / stats[key].capacidad) * 100)
        : 0;
    });

    return stats;
  }, [reservasMes, espacios]);

  // Obtener reservas del día seleccionado agrupadas por espacio
  const reservasDelDia = useMemo(() => {
    if (!selectedDate || !reservasMes) return {};

    const dateKey = format(selectedDate, "yyyy-MM-dd");
    const reservas = reservasMes.filter((r) => r.fecha === dateKey);

    // Agrupar por espacio
    const grouped: Record<string, { espacio: any; reservas: any[] }> = {};
    
    reservas.forEach((r) => {
      const espacioId = r.sala_id;
      if (!grouped[espacioId]) {
        grouped[espacioId] = {
          espacio: r.espacios_reserva,
          reservas: [],
        };
      }
      grouped[espacioId].reservas.push(r);
    });

    return grouped;
  }, [selectedDate, reservasMes]);

  const handlePrevMonth = () => {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const getOccupancyColor = (percentage: number) => {
    if (percentage >= 80) return "bg-destructive/20 text-destructive border-destructive/40";
    if (percentage >= 50) return "bg-primary/20 text-primary border-primary/40";
    if (percentage > 0) return "bg-green-500/20 text-green-700 border-green-500/40";
    return "";
  };

  // Días del mes para el calendario personalizado
  const daysInMonth = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
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
            <Button variant="ghost" onClick={handlePrevMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <h3 className="text-xl font-semibold">
              {format(currentMonth, "MMMM yyyy", { locale: es })}
            </h3>
            <Button variant="ghost" onClick={handleNextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Calendario */}
        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            {/* Header días de la semana */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((day) => (
                <div key={day} className="text-center text-sm font-medium text-muted-foreground py-2">
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
                const isSelected = selectedDate && isSameDay(day, selectedDate);
                const isToday = isSameDay(day, new Date());

                return (
                  <button
                    key={dateKey}
                    onClick={() => setSelectedDate(day)}
                    className={cn(
                      "aspect-square p-1 rounded-lg border transition-all hover:shadow-md",
                      "flex flex-col items-center justify-start gap-1",
                      isSelected ? "ring-2 ring-primary border-primary" : "border-border hover:border-primary/50",
                      isToday && "bg-accent/50",
                      dayStats && getOccupancyColor(dayStats.porcentaje)
                    )}
                  >
                    <span className={cn(
                      "text-sm font-medium",
                      isToday && "bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center"
                    )}>
                      {format(day, "d")}
                    </span>
                    
                    {dayStats && (
                      <>
                        <div className="text-xs font-semibold">
                          {dayStats.porcentaje}%
                        </div>
                        <div className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                          <CalendarIcon className="h-2.5 w-2.5" />
                          {dayStats.total}
                          <Users className="h-2.5 w-2.5 ml-1" />
                          {dayStats.comensales}
                        </div>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Panel de día seleccionado */}
        <Card className="h-fit max-h-[500px] flex flex-col">
          <CardContent className="p-4 flex flex-col h-full overflow-hidden">
            {selectedDate ? (
              <div className="flex flex-col h-full overflow-hidden">
                <div className="flex items-center gap-2 mb-4 flex-shrink-0">
                  <CalendarIcon className="h-5 w-5 text-primary" />
                  <h4 className="font-semibold">
                    {format(selectedDate, "EEEE, d 'de' MMMM", { locale: es })}
                  </h4>
                </div>

                {Object.keys(reservasDelDia).length === 0 ? (
                  <p className="text-muted-foreground text-sm py-4 text-center">
                    No hay reservas para este día
                  </p>
                ) : (
                  <div className="space-y-4 overflow-y-auto flex-1 pr-2">
                    {Object.entries(reservasDelDia).map(([espacioId, { espacio, reservas }]) => (
                      <div key={espacioId} className="space-y-2">
                        <Button
                          variant="ghost"
                          className="w-full justify-start p-2 h-auto"
                          onClick={() => onEspacioClick?.(espacioId)}
                        >
                          <MapPin className="h-4 w-4 mr-2" />
                          <span className="font-medium">{espacio?.nombre || "Espacio"}</span>
                          <Badge variant="secondary" className="ml-auto">
                            {reservas.length}
                          </Badge>
                        </Button>

                        <div className="pl-6 space-y-1">
                          {reservas.map((r: any) => (
                            <div
                              key={r.id}
                              className="flex items-center justify-between text-sm p-2 bg-muted/50 rounded"
                            >
                              <div>
                                <p className="font-medium">{r.nombre}</p>
                                <p className="text-xs text-muted-foreground">
                                  {r.hora} · {r.numero_comensales} personas
                                </p>
                              </div>
                              <Badge variant="outline" className="text-xs">
                                {r.estado}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <CalendarIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Selecciona un día</p>
                <p className="text-sm">para ver las reservas</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Leyenda */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4 items-center justify-center text-sm">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-green-500/20 border border-green-500/40" />
              <span>Baja ocupación (&lt;50%)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-primary/20 border border-primary/40" />
              <span>Media (50-80%)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-destructive/20 border border-destructive/40" />
              <span>Alta (&gt;80%)</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
