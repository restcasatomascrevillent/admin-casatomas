import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Mail, Users, Eye, Heart, MessageCircle } from "lucide-react";

export function EstadisticasMarketing() {
  const estadisticas = [
    {
      titulo: "Tasa de Apertura",
      valor: "42.3%",
      cambio: "+5.2%",
      icono: Mail,
      color: "text-blue-600",
      bgColor: "bg-blue-50",
    },
    {
      titulo: "Nuevos Suscriptores",
      valor: "127",
      cambio: "+23",
      icono: Users,
      color: "text-green-600",
      bgColor: "bg-green-50",
    },
    {
      titulo: "Alcance Total",
      valor: "8,945",
      cambio: "+1.2K",
      icono: Eye,
      color: "text-purple-600",
      bgColor: "bg-purple-50",
    },
    {
      titulo: "Engagement",
      valor: "7.8%",
      cambio: "+0.5%",
      icono: Heart,
      color: "text-pink-600",
      bgColor: "bg-pink-50",
    },
  ];

  const ultimasPublicaciones = [
    {
      red: "Instagram",
      contenido: "Nuevo menú degustación disponible 🍽️",
      fecha: "Hace 2 horas",
      likes: 142,
      comentarios: 23,
    },
    {
      red: "Facebook",
      contenido: "¡Reserva ya para San Valentín! 💕",
      fecha: "Hace 5 horas",
      likes: 89,
      comentarios: 12,
    },
    {
      red: "Instagram",
      contenido: "Behind the scenes con nuestro chef 👨‍🍳",
      fecha: "Hace 1 día",
      likes: 267,
      comentarios: 45,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {estadisticas.map((stat, index) => (
          <Card key={index}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {stat.titulo}
              </CardTitle>
              <div className={`${stat.bgColor} p-2 rounded-lg`}>
                <stat.icono className={`h-4 w-4 ${stat.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.valor}</div>
              <p className="text-xs text-muted-foreground flex items-center mt-1">
                <TrendingUp className="mr-1 h-3 w-3 text-green-600" />
                {stat.cambio} vs mes anterior
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Últimas Publicaciones</CardTitle>
            <CardDescription>
              Rendimiento de tus publicaciones recientes
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {ultimasPublicaciones.map((pub, index) => (
                <div
                  key={index}
                  className="flex items-start gap-4 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                >
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-primary">
                        {pub.red}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {pub.fecha}
                      </span>
                    </div>
                    <p className="text-sm">{pub.contenido}</p>
                    <div className="flex gap-4 mt-2">
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Heart className="h-3 w-3" />
                        {pub.likes}
                      </span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <MessageCircle className="h-3 w-3" />
                        {pub.comentarios}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rendimiento por Red Social</CardTitle>
            <CardDescription>
              Comparativa de engagement en tus redes
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between mb-2">
                  <span className="text-sm font-medium">Instagram</span>
                  <span className="text-sm text-muted-foreground">8.4%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 w-[84%]" />
                </div>
              </div>
              
              <div>
                <div className="flex justify-between mb-2">
                  <span className="text-sm font-medium">Facebook</span>
                  <span className="text-sm text-muted-foreground">6.2%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 w-[62%]" />
                </div>
              </div>

              <div className="mt-6 p-4 bg-muted/50 rounded-lg">
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">Consejo:</span> Tus
                  publicaciones en Instagram tienen mejor engagement. Considera
                  publicar más contenido visual y usar stories.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
