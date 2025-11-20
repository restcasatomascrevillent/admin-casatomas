import { Instagram, Facebook, Heart, MessageCircle, Calendar } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { Badge } from "@/components/ui/badge";
import { usePublicaciones } from "@/hooks/usePublicaciones";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export function CarruselPublicaciones() {
  const { data: publicaciones, isLoading } = usePublicaciones();

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!publicaciones || publicaciones.length === 0) {
    return (
      <Card className="bg-muted/50">
        <CardContent className="flex flex-col items-center justify-center h-64 text-center">
          <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No hay publicaciones aún</p>
          <p className="text-sm text-muted-foreground">Crea tu primera publicación arriba</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Carousel
      opts={{
        align: "start",
        loop: false,
      }}
      className="w-full"
    >
      <CarouselContent className="-ml-4">
        {publicaciones.map((publicacion) => (
          <CarouselItem key={publicacion.id} className="pl-4 md:basis-1/2 lg:basis-1/3">
            {publicacion.red_social === "instagram" ? (
              <InstagramCard publicacion={publicacion} />
            ) : (
              <FacebookCard publicacion={publicacion} />
            )}
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious className="-left-4" />
      <CarouselNext className="-right-4" />
    </Carousel>
  );
}

function InstagramCard({ publicacion }: { publicacion: any }) {
  return (
    <Card className="overflow-hidden border-2 hover:shadow-xl transition-all duration-300">
      {/* Instagram Header */}
      <div className="bg-gradient-to-r from-purple-500 via-pink-500 to-orange-500 p-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center">
            <Instagram className="h-4 w-4 text-pink-600" />
          </div>
          <div className="flex-1">
            <p className="text-white font-semibold text-sm">Instagram</p>
            <p className="text-white/80 text-xs">
              {publicacion.created_at
                ? format(new Date(publicacion.created_at), "d MMM, HH:mm", { locale: es })
                : "Ahora"}
            </p>
          </div>
          <Badge 
            variant={publicacion.estado === "publicado" ? "default" : "secondary"}
            className="text-xs"
          >
            {publicacion.estado || "pendiente"}
          </Badge>
        </div>
      </div>

      {/* Imagen */}
      {publicacion.imagen_url && (
        <div className="aspect-square bg-muted">
          <img
            src={publicacion.imagen_url}
            alt="Publicación"
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* Contenido */}
      <CardContent className="p-4 space-y-3">
        {/* Acciones estilo Instagram */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Heart className="h-5 w-5" />
            <span className="text-sm font-medium">234</span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <MessageCircle className="h-5 w-5" />
            <span className="text-sm font-medium">12</span>
          </div>
        </div>

        {/* Texto de la publicación */}
        <p className="text-sm text-foreground line-clamp-3">
          {publicacion.contenido}
        </p>
      </CardContent>
    </Card>
  );
}

function FacebookCard({ publicacion }: { publicacion: any }) {
  return (
    <Card className="overflow-hidden border-2 hover:shadow-xl transition-all duration-300">
      {/* Facebook Header */}
      <div className="bg-[#1877F2] p-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center">
            <Facebook className="h-4 w-4 text-[#1877F2]" />
          </div>
          <div className="flex-1">
            <p className="text-white font-semibold text-sm">Facebook</p>
            <p className="text-white/80 text-xs">
              {publicacion.created_at
                ? format(new Date(publicacion.created_at), "d MMM 'a las' HH:mm", { locale: es })
                : "Ahora"}
            </p>
          </div>
          <Badge 
            variant={publicacion.estado === "publicado" ? "default" : "secondary"}
            className="text-xs"
          >
            {publicacion.estado || "pendiente"}
          </Badge>
        </div>
      </div>

      {/* Contenido */}
      <CardContent className="p-4 space-y-3">
        {/* Texto de la publicación */}
        <p className="text-sm text-foreground whitespace-pre-wrap line-clamp-4">
          {publicacion.contenido}
        </p>

        {/* Imagen */}
        {publicacion.imagen_url && (
          <div className="aspect-video bg-muted rounded-md overflow-hidden">
            <img
              src={publicacion.imagen_url}
              alt="Publicación"
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* Acciones estilo Facebook */}
        <div className="flex items-center justify-between pt-2 border-t">
          <div className="flex items-center gap-1 text-muted-foreground hover:text-primary cursor-pointer transition-colors">
            <Heart className="h-4 w-4" />
            <span className="text-sm font-medium">Me gusta · 156</span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground hover:text-primary cursor-pointer transition-colors">
            <MessageCircle className="h-4 w-4" />
            <span className="text-sm font-medium">8 comentarios</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
