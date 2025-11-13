import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Users, UtensilsCrossed, CalendarCheck, TrendingUp } from "lucide-react";

export default function Dashboard() {
  const [stats, setStats] = useState({
    totalWorkers: 0,
    totalReservations: 0,
    pendingReservations: 0,
    totalRooms: 0,
  });

  useEffect(() => {
    const fetchStats = async () => {
      const [workers, reservations, rooms] = await Promise.all([
        supabase.from("trabajadores").select("id", { count: "exact", head: true }),
        supabase.from("reservas").select("id, estado", { count: "exact" }),
        supabase.from("salas").select("id", { count: "exact", head: true }),
      ]);

      const pendingCount =
        reservations.data?.filter((r) => r.estado === "pendiente").length || 0;

      setStats({
        totalWorkers: workers.count || 0,
        totalReservations: reservations.count || 0,
        pendingReservations: pendingCount,
        totalRooms: rooms.count || 0,
      });
    };

    fetchStats();
  }, []);

  const statCards = [
    {
      title: "Trabajadores Activos",
      value: stats.totalWorkers,
      icon: Users,
      description: "Personal registrado",
    },
    {
      title: "Reservas Totales",
      value: stats.totalReservations,
      icon: UtensilsCrossed,
      description: "Todas las reservas",
    },
    {
      title: "Reservas Pendientes",
      value: stats.pendingReservations,
      icon: CalendarCheck,
      description: "Requieren verificación",
    },
    {
      title: "Salas Configuradas",
      value: stats.totalRooms,
      icon: TrendingUp,
      description: "Espacios del restaurante",
    },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h2>
          <p className="text-muted-foreground">
            Vista general de la gestión del restaurante
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {statCards.map((stat) => (
            <Card key={stat.title} className="hover:shadow-lg transition-shadow">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
                <stat.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary">{stat.value}</div>
                <p className="text-xs text-muted-foreground">{stat.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Bienvenido al Sistema de Gestión</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Utiliza el menú lateral para navegar entre las diferentes secciones del sistema.
              Podrás gestionar trabajadores, reservas, turnos, salas y analizar datos históricos.
            </p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
