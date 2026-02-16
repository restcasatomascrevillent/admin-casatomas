import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Users, CalendarCheck, Clock, Utensils } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

interface OcupacionPorEspacioProps {
  className?: string;
}

interface ResumenOcupacion {
  confirmadas: number;
  pendientes: number;
  comensalesConfirmados: number;
  comensalesPendientes: number;
  capacidadTotal: number;
  porcentajeOcupacion: number;
  comida: { reservas: number; comensales: number };
  cena: { reservas: number; comensales: number };
  proximaReserva: string | null;
}

function useResumenOcupacionCompleto() {
  return useQuery({
    queryKey: ["resumen-ocupacion-hoy-completo"],
    queryFn: async (): Promise<ResumenOcupacion> => {
      const today = format(new Date(), "yyyy-MM-dd");

      const [{ data: reservas }, { data: espacios }] = await Promise.all([
        supabase
          .from("reservas")
          .select("estado, numero_comensales, hora")
          .eq("fecha", today)
          .neq("estado", "cancelada"),
        supabase
          .from("espacios_reserva")
          .select("capacidad_maxima")
          .eq("activa", true),
      ]);

      const capacidadTotal = (espacios || []).reduce((s, e) => s + (e.capacidad_maxima || 0), 0);

      const confirmadas = (reservas || []).filter((r) => r.estado === "confirmada");
      const pendientes = (reservas || []).filter((r) => r.estado === "pendiente");

      const comensalesConfirmados = confirmadas.reduce((s, r) => s + (r.numero_comensales || 0), 0);
      const comensalesPendientes = pendientes.reduce((s, r) => s + (r.numero_comensales || 0), 0);

      const isComida = (hora: string) => {
        const h = parseInt(hora.split(":")[0]);
        return h < 17;
      };

      const allActive = reservas || [];
      const comida = allActive.filter((r) => isComida(r.hora));
      const cena = allActive.filter((r) => !isComida(r.hora));

      // Próxima reserva
      const now = format(new Date(), "HH:mm:ss");
      const futuras = allActive
        .filter((r) => r.hora >= now)
        .sort((a, b) => a.hora.localeCompare(b.hora));

      return {
        confirmadas: confirmadas.length,
        pendientes: pendientes.length,
        comensalesConfirmados,
        comensalesPendientes,
        capacidadTotal,
        porcentajeOcupacion: capacidadTotal > 0 ? Math.round((comensalesConfirmados / capacidadTotal) * 100) : 0,
        comida: {
          reservas: comida.length,
          comensales: comida.reduce((s, r) => s + (r.numero_comensales || 0), 0),
        },
        cena: {
          reservas: cena.length,
          comensales: cena.reduce((s, r) => s + (r.numero_comensales || 0), 0),
        },
        proximaReserva: futuras.length > 0 ? futuras[0].hora.slice(0, 5) : null,
      };
    },
    refetchInterval: 60000,
  });
}

export function OcupacionPorEspacio({ className }: OcupacionPorEspacioProps) {
  const { data, isLoading } = useResumenOcupacionCompleto();

  const getStatusColor = (porcentaje: number) => {
    if (porcentaje < 50) return { bg: "bg-green-500/10", text: "text-green-600", bar: "bg-green-500", label: "Baja" };
    if (porcentaje < 80) return { bg: "bg-amber-500/10", text: "text-amber-600", bar: "bg-amber-500", label: "Moderada" };
    return { bg: "bg-red-500/10", text: "text-red-600", bar: "bg-red-500", label: "Alta" };
  };

  if (isLoading) {
    return (
      <Card className={`h-full ${className || ""}`}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-lg font-semibold">Ocupación de Hoy</CardTitle>
          <Building2 className="h-5 w-5 text-primary" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse space-y-2">
                <div className="h-4 bg-muted rounded w-1/3" />
                <div className="h-2 bg-muted rounded" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const colors = getStatusColor(data.porcentajeOcupacion);
  const totalReservas = data.confirmadas + data.pendientes;
  const totalComensales = data.comensalesConfirmados + data.comensalesPendientes;

  return (
    <Card className={`h-full ${className || ""}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base sm:text-lg font-semibold">Ocupación de Hoy</CardTitle>
        <Building2 className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Barra de ocupación principal */}
        <div className={`p-3 rounded-lg ${colors.bg}`}>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <span className={`text-2xl font-bold ${colors.text}`}>{data.porcentajeOcupacion}%</span>
              <Badge variant="outline" className={`${colors.text} border-current text-[10px]`}>
                {colors.label}
              </Badge>
            </div>
            <span className="text-xs text-muted-foreground">
              {data.comensalesConfirmados}/{data.capacidadTotal} pax
            </span>
          </div>
          <div className="h-2 bg-background/50 rounded-full overflow-hidden">
            <div
              className={`h-full ${colors.bar} transition-all duration-500`}
              style={{ width: `${Math.min(100, data.porcentajeOcupacion)}%` }}
            />
          </div>
        </div>

        {/* Métricas rápidas */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
            <CalendarCheck className="h-4 w-4 text-primary shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{data.confirmadas}</p>
              <p className="text-[10px] text-muted-foreground">Confirmadas</p>
            </div>
          </div>
          <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
            <Clock className="h-4 w-4 text-amber-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{data.pendientes}</p>
              <p className="text-[10px] text-muted-foreground">Pendientes</p>
            </div>
          </div>
        </div>

        {/* Desglose Comida / Cena */}
        <div className="border-t pt-2 space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-1.5">
              <Utensils className="h-3.5 w-3.5 text-orange-500" />
              <span className="text-muted-foreground">Comida</span>
            </div>
            <span className="font-medium">
              {data.comida.reservas} res. · {data.comida.comensales} pax
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-1.5">
              <Utensils className="h-3.5 w-3.5 text-indigo-500" />
              <span className="text-muted-foreground">Cena</span>
            </div>
            <span className="font-medium">
              {data.cena.reservas} res. · {data.cena.comensales} pax
            </span>
          </div>
        </div>

        {/* Próxima reserva */}
        {data.proximaReserva && (
          <div className="border-t pt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>Próxima reserva</span>
            <span className="font-semibold text-foreground">{data.proximaReserva}h</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
